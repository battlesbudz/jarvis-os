# CY03 / EyeVue Smart Glasses BLE Notes

Jarvis supports a local Bluetooth LE integration for user-owned CY03 / EyeVue smart glasses. This integration does not use EyeVue APIs, does not modify firmware, and only listens to BLE notifications exposed by the glasses.

## Known Device

- Name: `CY03-51EE`
- BLE address observed in nRF Connect: `C6:01:01:00:51:EE`

## Known UUIDs

- Service `AA12`: `0000aa12-0000-1000-8000-00805f9b34fb`
- Write characteristic `AA13`: `0000aa13-0000-1000-8000-00805f9b34fb`
- Notify characteristic `AA14`: `0000aa14-0000-1000-8000-00805f9b34fb`
- Notify characteristic `AA15`: `0000aa15-0000-1000-8000-00805f9b34fb`
- CCCD descriptor: `00002902-0000-1000-8000-00805f9b34fb`

## Packet Rules

Jarvis logs every packet as uppercase dash-separated hex.

Current first-pass detection rules:

- Assistant trigger: packet starts with `AC-55-00-2A-46-4B-41`
- Camera / physical button: packet starts with `AC-55-00-0C-45-01`
- Idle / connected: packet starts with `AC-55-00-0C-45-00`
- Anything else is logged as unknown for later mapping

Known packet examples:

```txt
Idle / connected:
AC-55-00-0C-45-00-00-00-00-00-00-00-00-00-45

Physical button single press / camera:
AC-55-00-0C-45-01-00-00-00-00-00-00-00-00-46

Assistant trigger from Hey Star or touch-pad hold:
AC-55-00-2A-46-4B-41-05-8A-87-BE-BF-82-94-EF-C2-40-35-41-AD-62-C9-9D-DC-93-A5-86-08-DC-55-5E-2A-9A-BA-8B-F0-E8-A8-39-E0-00-00-00-00-00-2A
```

## Runtime Behavior

The Android Settings screen has a `Smart Glasses / CY03` section with:

- Scan
- Connect
- Disconnect
- Connection status
- Last packet received
- Recent packet/event logs
- Enable/disable assistant trigger

When an assistant packet is detected, Jarvis debounces repeated events for 2 seconds, shows `Jarvis glasses trigger`, and opens voice mode with auto-start enabled.

The camera packet is logged but does not start voice mode.

## Acceptance Test

1. Delete or disable EyeVue.
2. Pair the CY03 glasses normally in Android Bluetooth.
3. Open Jarvis.
4. Open Settings, then `Smart Glasses / CY03`.
5. Tap `Connect` for the known paired device or `Scan` to discover it.
6. Hold the touch pad or say `Hey Star`.
7. Confirm Jarvis shows `Jarvis glasses trigger` and starts voice mode.
8. Press the physical camera button once.
9. Confirm the camera packet is logged and voice mode does not start.

## Future Work

- Map unknown packets into named events.
- Persist the last connected CY03 device id.
- Move the listener into a foreground service if background/off-screen listening is required.
- Add a reconnect policy setting if automatic reconnect is too aggressive for testing.
