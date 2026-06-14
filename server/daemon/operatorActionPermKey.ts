import type { AndroidDaemonAction } from "./bridge";

export function operatorActionPermKey(operatorAction: Record<string, unknown>): AndroidDaemonAction | null {
  switch (operatorAction.type) {
    case "open_app": return "android_open_app";
    case "tap_element":
    case "tap_coordinates":
    case "type_text":
    case "swipe":
    case "press_key": return "android_tap_type";
    case "wait":
    case "done": return null;
    default: return "android_tap_type";
  }
}
