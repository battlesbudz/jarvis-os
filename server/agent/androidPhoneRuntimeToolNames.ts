export const ANDROID_PHONE_RUNTIME_TOOL_NAMES = [
  "android_open_app_by_name",
  "android_youtube_search",
  "android_open_phone_url",
  "android_capture_screen",
  "android_read_screen_context",
  "android_tap_screen",
  "android_type_text",
  "android_swipe_screen",
  "android_press_phone_key",
  "android_wait_for_ui",
  "android_read_notifications",
  "android_notify_user",
  "android_return_to_jarvis_chat",
] as const;

export type AndroidPhoneRuntimeToolName = typeof ANDROID_PHONE_RUNTIME_TOOL_NAMES[number];
