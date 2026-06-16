export type Cy03PacketType = "assistant_gesture" | "camera_button" | "idle" | "unknown";

export interface Cy03PacketClassification {
  type: Cy03PacketType;
  hex: string;
}

export interface Cy03PacketEventHandlerOptions {
  debounceMs?: number;
  now?: () => number;
  onPacketReceived?: (packet: Cy03PacketClassification) => void;
  onAssistantGestureDetected?: (packet: Cy03PacketClassification) => void;
  onCameraButtonPressed?: (packet: Cy03PacketClassification) => void;
}

const ASSISTANT_PREFIX = "AC-55-00-2A-46-4B-41";
const CAMERA_PREFIX = "AC-55-00-0C-45-01";
const IDLE_PREFIX = "AC-55-00-0C-45-00";

export function normalizeCy03Hex(input: string): string {
  const compact = input.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  const pairs = compact.match(/.{1,2}/g) ?? [];
  return pairs.join("-");
}

export function hexToBytes(input: string): number[] {
  const normalized = normalizeCy03Hex(input);
  if (!normalized) return [];
  return normalized.split("-").map((part) => Number.parseInt(part, 16));
}

export function bytesToCy03Hex(bytes: ArrayLike<number>): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
    .join("-");
}

export function base64ToBytes(base64: string): number[] {
  const atobFn = (globalThis as { atob?: (value: string) => string }).atob;
  if (typeof atobFn === "function") {
    const binary = atobFn(base64);
    return Array.from(binary, (char) => char.charCodeAt(0));
  }

  const bufferCtor = (globalThis as { Buffer?: { from: (value: string, encoding: "base64") => ArrayLike<number> } }).Buffer;
  if (bufferCtor) {
    return Array.from(bufferCtor.from(base64, "base64"));
  }

  throw new Error("Base64 decoding is unavailable in this runtime.");
}

export function classifyCy03Packet(bytes: ArrayLike<number>): Cy03PacketClassification {
  const hex = bytesToCy03Hex(bytes);
  if (hex.startsWith(ASSISTANT_PREFIX)) return { type: "assistant_gesture", hex };
  if (hex.startsWith(CAMERA_PREFIX)) return { type: "camera_button", hex };
  if (hex.startsWith(IDLE_PREFIX)) return { type: "idle", hex };
  return { type: "unknown", hex };
}

export function createCy03AssistantDebouncer(debounceMs = 2000): { shouldEmit: (nowMs?: number) => boolean } {
  let lastEmittedAt = Number.NEGATIVE_INFINITY;
  return {
    shouldEmit(nowMs = Date.now()): boolean {
      if (nowMs - lastEmittedAt < debounceMs) return false;
      lastEmittedAt = nowMs;
      return true;
    },
  };
}

export function createCy03PacketEventHandler(options: Cy03PacketEventHandlerOptions): {
  handleBytes: (bytes: ArrayLike<number>) => Cy03PacketClassification;
} {
  const debouncer = createCy03AssistantDebouncer(options.debounceMs ?? 2000);
  const now = options.now ?? Date.now;
  return {
    handleBytes(bytes: ArrayLike<number>): Cy03PacketClassification {
      const packet = classifyCy03Packet(bytes);
      options.onPacketReceived?.(packet);
      if (packet.type === "assistant_gesture" && debouncer.shouldEmit(now())) {
        options.onAssistantGestureDetected?.(packet);
      } else if (packet.type === "camera_button") {
        options.onCameraButtonPressed?.(packet);
      }
      return packet;
    },
  };
}
