import { PermissionsAndroid, Platform } from "react-native";
import {
  base64ToBytes,
  createCy03PacketEventHandler,
  type Cy03PacketClassification,
} from "./cy03-smart-glasses";

export const CY03_DEFAULT_DEVICE_NAME = "CY03-51EE";
export const CY03_DEFAULT_DEVICE_ADDRESS = "C6:01:01:00:51:EE";
export const CY03_SERVICE_UUID = "0000aa12-0000-1000-8000-00805f9b34fb";
export const CY03_WRITE_CHARACTERISTIC_UUID = "0000aa13-0000-1000-8000-00805f9b34fb";
export const CY03_NOTIFY_CHARACTERISTIC_UUIDS = [
  "0000aa14-0000-1000-8000-00805f9b34fb",
  "0000aa15-0000-1000-8000-00805f9b34fb",
] as const;

export type Cy03ConnectionStatus =
  | "idle"
  | "scanning"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error"
  | "unsupported";

export interface Cy03GlassesBleCallbacks {
  onStatusChanged?: (status: Cy03ConnectionStatus) => void;
  onGlassesConnected?: (device: { id: string; name: string | null }) => void;
  onGlassesDisconnected?: (error?: Error) => void;
  onPacketReceived?: (packet: Cy03PacketClassification) => void;
  onAssistantGestureDetected?: (packet: Cy03PacketClassification) => void;
  onCameraButtonPressed?: (packet: Cy03PacketClassification) => void;
  onLog?: (message: string) => void;
}

type BleModule = typeof import("react-native-ble-plx");
type BleManagerInstance = InstanceType<BleModule["BleManager"]>;
type BleDevice = import("react-native-ble-plx").Device;
type BleSubscription = { remove: () => void };

const ANDROID_BLE_PERMISSIONS = {
  bluetoothScan: "android.permission.BLUETOOTH_SCAN",
  bluetoothConnect: "android.permission.BLUETOOTH_CONNECT",
  bluetooth: "android.permission.BLUETOOTH",
  bluetoothAdmin: "android.permission.BLUETOOTH_ADMIN",
  fineLocation: "android.permission.ACCESS_FINE_LOCATION",
} as const;

export async function requestCy03BlePermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return true;

  const sdkVersion = Number(Platform.Version);
  const permissions =
    sdkVersion >= 31
      ? [
          ANDROID_BLE_PERMISSIONS.bluetoothScan,
          ANDROID_BLE_PERMISSIONS.bluetoothConnect,
          ANDROID_BLE_PERMISSIONS.fineLocation,
        ]
      : [ANDROID_BLE_PERMISSIONS.fineLocation];

  const results = await PermissionsAndroid.requestMultiple(permissions);
  return permissions.every((permission) => results[permission] === PermissionsAndroid.RESULTS.GRANTED);
}

async function loadBleModule(): Promise<BleModule> {
  if (Platform.OS === "web") {
    throw new Error("CY03 BLE support is available only in the native Android app.");
  }
  return import("react-native-ble-plx");
}

function isCy03Device(device: { id: string; name?: string | null; localName?: string | null }): boolean {
  const name = device.name ?? device.localName ?? "";
  return name.startsWith("CY03") || name === CY03_DEFAULT_DEVICE_NAME || device.id === CY03_DEFAULT_DEVICE_ADDRESS;
}

export class Cy03GlassesBleManager {
  private callbacks: Cy03GlassesBleCallbacks = {};
  private manager: BleManagerInstance | null = null;
  private device: BleDevice | null = null;
  private notifySubscriptions: BleSubscription[] = [];
  private disconnectSubscription: BleSubscription | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastDeviceId: string | null = null;
  private assistantTriggerEnabled = true;
  private reconnectEnabled = true;
  private destroyed = false;
  private status: Cy03ConnectionStatus = "idle";
  private packetHandler = createCy03PacketEventHandler({
    onPacketReceived: (packet) => {
      this.callbacks.onLog?.(`CY03 packet ${packet.hex}`);
      this.callbacks.onPacketReceived?.(packet);
    },
    onAssistantGestureDetected: (packet) => {
      if (this.assistantTriggerEnabled) {
        this.callbacks.onAssistantGestureDetected?.(packet);
      }
    },
    onCameraButtonPressed: (packet) => this.callbacks.onCameraButtonPressed?.(packet),
  });

  constructor(callbacks: Cy03GlassesBleCallbacks = {}) {
    this.callbacks = callbacks;
  }

  setAssistantTriggerEnabled(enabled: boolean): void {
    this.assistantTriggerEnabled = enabled;
  }

  getStatus(): Cy03ConnectionStatus {
    return this.status;
  }

  async scanAndConnect(): Promise<void> {
    await this.ensureReady();
    const manager = this.requireManager();
    this.stopScan();
    this.setStatus("scanning");
    this.callbacks.onLog?.("Scanning for CY03 glasses.");

    manager.startDeviceScan(null, { allowDuplicates: false }, (error, scannedDevice) => {
      if (error) {
        this.setStatus("error");
        this.callbacks.onLog?.(`CY03 scan failed: ${error.message}`);
        return;
      }
      if (!scannedDevice || !isCy03Device(scannedDevice)) return;

      this.stopScan();
      this.connect(scannedDevice.id).catch((connectError) => {
        this.setStatus("error");
        this.callbacks.onLog?.(
          `CY03 connect failed: ${connectError instanceof Error ? connectError.message : String(connectError)}`,
        );
      });
    });
  }

  async connectToKnownDevice(deviceId = CY03_DEFAULT_DEVICE_ADDRESS): Promise<void> {
    await this.connect(deviceId);
  }

  async connect(deviceId: string): Promise<void> {
    await this.ensureReady();
    const manager = this.requireManager();
    this.stopScan();
    this.clearReconnectTimer();
    this.reconnectEnabled = true;
    this.setStatus("connecting");
    this.callbacks.onLog?.(`Connecting to CY03 ${deviceId}.`);

    const connected = await manager.connectToDevice(deviceId, { autoConnect: false });
    this.device = await connected.discoverAllServicesAndCharacteristics();
    this.lastDeviceId = deviceId;
    this.subscribeToDisconnects(deviceId);
    this.subscribeToNotifications(this.device);
    this.setStatus("connected");
    this.callbacks.onGlassesConnected?.({ id: this.device.id, name: this.device.name ?? null });
  }

  async disconnect(): Promise<void> {
    this.clearReconnectTimer();
    this.reconnectEnabled = false;
    this.stopScan();
    this.removeSubscriptions();
    const manager = this.manager;
    const deviceId = this.device?.id ?? this.lastDeviceId;
    this.device = null;
    if (manager && deviceId) {
      await manager.cancelDeviceConnection(deviceId).catch(() => {});
    }
    this.setStatus("disconnected");
  }

  destroy(): void {
    this.destroyed = true;
    this.reconnectEnabled = false;
    this.clearReconnectTimer();
    this.stopScan();
    this.removeSubscriptions();
    this.manager?.destroy();
    this.manager = null;
    this.device = null;
  }

  private async ensureReady(): Promise<void> {
    if (this.destroyed) {
      throw new Error("CY03 BLE manager has been destroyed.");
    }
    const granted = await requestCy03BlePermissions();
    if (!granted) {
      this.setStatus("error");
      throw new Error("Bluetooth permissions are required to connect CY03 glasses.");
    }
    if (!this.manager) {
      const { BleManager } = await loadBleModule();
      this.manager = new BleManager();
    }
  }

  private requireManager(): BleManagerInstance {
    if (!this.manager) throw new Error("CY03 BLE manager is not initialized.");
    return this.manager;
  }

  private subscribeToNotifications(device: BleDevice): void {
    this.notifySubscriptions.forEach((subscription) => subscription.remove());
    this.notifySubscriptions = CY03_NOTIFY_CHARACTERISTIC_UUIDS.map((characteristicUuid) =>
      device.monitorCharacteristicForService(
        CY03_SERVICE_UUID,
        characteristicUuid,
        (error, characteristic) => {
          if (error) {
            this.callbacks.onLog?.(`CY03 notify ${characteristicUuid} failed: ${error.message}`);
            return;
          }
          if (!characteristic?.value) return;
          this.packetHandler.handleBytes(base64ToBytes(characteristic.value));
        },
        `cy03-${characteristicUuid}`,
      ),
    );
  }

  private subscribeToDisconnects(deviceId: string): void {
    this.disconnectSubscription?.remove();
    this.disconnectSubscription = this.requireManager().onDeviceDisconnected(deviceId, (error) => {
      this.removeNotifySubscriptions();
      this.device = null;
      this.setStatus("disconnected");
      const disconnectError = error ? new Error(error.message) : undefined;
      this.callbacks.onGlassesDisconnected?.(disconnectError);
      this.callbacks.onLog?.(
        error ? `CY03 disconnected: ${error.message}` : "CY03 disconnected.",
      );
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.destroyed || !this.reconnectEnabled || !this.lastDeviceId || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.destroyed || !this.lastDeviceId) return;
      this.connect(this.lastDeviceId).catch((error) => {
        this.callbacks.onLog?.(
          `CY03 reconnect failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        this.scheduleReconnect();
      });
    }, 2000);
  }

  private stopScan(): void {
    this.manager?.stopDeviceScan();
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private removeSubscriptions(): void {
    this.removeNotifySubscriptions();
    this.disconnectSubscription?.remove();
    this.disconnectSubscription = null;
  }

  private removeNotifySubscriptions(): void {
    this.notifySubscriptions.forEach((subscription) => subscription.remove());
    this.notifySubscriptions = [];
  }

  private setStatus(status: Cy03ConnectionStatus): void {
    this.status = status;
    this.callbacks.onStatusChanged?.(status);
  }
}
