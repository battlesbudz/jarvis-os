import { DeviceEventEmitter, NativeModules, Platform } from "react-native";

export type AndroidDaemonStatus = {
  available: boolean;
  connected: boolean;
  status: string;
  accessibilityEnabled: boolean;
  notificationListenerActive: boolean;
  assistantActive?: boolean;
  assistantStatus?: string;
  hotwordPhrase?: string;
  hotwordAvailability?: string;
  hotwordDetail?: string;
  hotwordRecognitionActive?: boolean;
  hotwordLastError?: string | null;
  voiceSessionActive?: boolean;
  voiceSessionState?: "idle" | "listening" | "speaking" | "working" | "approval" | "paused";
  voiceOverlayPermission?: boolean;
  serverUrl?: string;
};

export type AndroidLocalGemmaValidationOptions = {
  backend?: "auto" | "gpu" | "cpu" | "npu";
  contextTokens?: number;
  keepEngineWarm?: boolean;
  allowCpuFallback?: boolean;
  speculativeDecoding?: boolean;
  cachePolicy?: "default" | "fresh" | "none";
  profileId?: string;
  profileLabel?: string;
};

export type AndroidOutsideAppVoiceControlEvent = {
  action?: string;
  state?: string;
  outsideApp?: boolean;
  confirmationToken?: string;
  reactActive?: boolean;
};

export type AndroidNativeSpeechStatus = {
  available: boolean;
  speechRecognitionAvailable?: boolean;
  onDeviceRecognitionAvailable?: boolean;
  microphonePermissionGranted?: boolean;
  ttsAvailable?: boolean;
  ttsProvider?: string;
  locale?: string;
  status?: string;
  message?: string;
  listening?: boolean;
  modelDownloadComplete?: boolean;
  modelDownloadScheduled?: boolean;
};

export type AndroidNativeSpeechRecognitionEvent = {
  type?: "ready" | "speech_start" | "speech_end" | "rms" | "partial" | "final" | "error" | "cancelled" | "model_download_requested";
  text?: string;
  alternatives?: string[];
  error?: string;
  errorCode?: number;
  message?: string;
  recoverable?: boolean;
  onDevice?: boolean;
  locale?: string;
  rmsDb?: number;
  completedPercent?: number;
};

export type AndroidNativeSpeechRecognitionOptions = {
  locale?: string;
  interimResults?: boolean;
  timeoutMs?: number;
};

export type AndroidNativeSpeechRecognitionResult = {
  text: string;
  alternatives: string[];
};

const unavailableStatus: AndroidDaemonStatus = {
  available: false,
  connected: false,
  status: "Unavailable",
  accessibilityEnabled: false,
  notificationListenerActive: false,
};

const NativeJarvisDaemon = NativeModules.JarvisDaemonModule as
  | {
      getStatus(): Promise<AndroidDaemonStatus>;
      enable(serverUrl: string, bootstrapToken: string): Promise<AndroidDaemonStatus>;
      disconnect(): Promise<AndroidDaemonStatus>;
      openAccessibilitySettings(): Promise<void>;
      openNotificationListenerSettings(): Promise<void>;
      openAssistantSettings(): Promise<void>;
      refreshAssistantStatus(): Promise<AndroidDaemonStatus>;
      startOutsideAppVoiceSession?(): Promise<AndroidDaemonStatus>;
      pauseOutsideAppVoiceSession?(): Promise<AndroidDaemonStatus>;
      resumeOutsideAppVoiceSession?(): Promise<AndroidDaemonStatus>;
      endOutsideAppVoiceSession?(): Promise<AndroidDaemonStatus>;
      setOutsideAppVoiceSessionState?(state: string): Promise<AndroidDaemonStatus>;
      setOutsideAppVoiceApproval?(prompt: string, confirmationToken: string): Promise<AndroidDaemonStatus>;
      openOverlayPermissionSettings?(): Promise<void>;
      openAllFilesAccessSettings(): Promise<void>;
      requestCameraPermission(): Promise<void>;
      requestMicrophonePermission(): Promise<void>;
      requestScreenRecordPermission(): Promise<void>;
      getLocalGemmaStatus?(model: string): Promise<string | Record<string, unknown>>;
      validateLocalGemmaModel?(model: string): Promise<string | Record<string, unknown>>;
      validateLocalGemmaModelWithOptions?(model: string, optionsJson: string): Promise<string | Record<string, unknown>>;
      smokeTestLocalGemmaModel?(model: string, optionsJson: string): Promise<string | Record<string, unknown>>;
      getNativeSpeechStatus?(locale: string): Promise<AndroidNativeSpeechStatus>;
      startNativeSpeechRecognition?(optionsJson: string): Promise<AndroidNativeSpeechStatus>;
      stopNativeSpeechRecognition?(): Promise<AndroidNativeSpeechStatus>;
      cancelNativeSpeechRecognition?(): Promise<AndroidNativeSpeechStatus>;
      triggerNativeSpeechModelDownload?(locale: string): Promise<AndroidNativeSpeechStatus>;
    }
  | undefined;

function parseNativeJsonResult(result: unknown): Record<string, unknown> | null {
  if (!result) return null;
  if (typeof result === "string") {
    const parsed = JSON.parse(result);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  }
  return typeof result === "object" && !Array.isArray(result)
    ? result as Record<string, unknown>
    : null;
}

export async function getAndroidDaemonStatus(): Promise<AndroidDaemonStatus> {
  if (Platform.OS !== "android" || !NativeJarvisDaemon) {
    return unavailableStatus;
  }
  return NativeJarvisDaemon.getStatus();
}

export async function getAndroidLocalGemmaStatus(model: string): Promise<Record<string, unknown> | null> {
  if (Platform.OS !== "android" || !NativeJarvisDaemon?.getLocalGemmaStatus) {
    return null;
  }
  return parseNativeJsonResult(await NativeJarvisDaemon.getLocalGemmaStatus(model));
}

export async function validateAndroidLocalGemmaModel(model: string, options: AndroidLocalGemmaValidationOptions = {}): Promise<Record<string, unknown>> {
  if (Platform.OS !== "android" || !NativeJarvisDaemon?.validateLocalGemmaModel) {
    throw new Error("Phone Gemma validation is only available in the Android app.");
  }
  const result = NativeJarvisDaemon.validateLocalGemmaModelWithOptions
    ? await NativeJarvisDaemon.validateLocalGemmaModelWithOptions(model, JSON.stringify(options))
    : await NativeJarvisDaemon.validateLocalGemmaModel(model);
  const parsed = parseNativeJsonResult(result);
  if (!parsed) throw new Error("Phone Gemma validation returned an empty status.");
  return parsed;
}

export async function smokeTestAndroidLocalGemmaModel(model: string, options: AndroidLocalGemmaValidationOptions = {}): Promise<Record<string, unknown>> {
  if (Platform.OS !== "android" || !NativeJarvisDaemon?.smokeTestLocalGemmaModel) {
    throw new Error("Phone Gemma smoke test is only available in the Android app.");
  }
  const parsed = parseNativeJsonResult(await NativeJarvisDaemon.smokeTestLocalGemmaModel(model, JSON.stringify(options)));
  if (!parsed) throw new Error("Phone Gemma smoke test returned an empty result.");
  return parsed;
}

export async function startAndroidOutsideAppVoiceSession(): Promise<AndroidDaemonStatus | null> {
  if (Platform.OS !== "android" || !NativeJarvisDaemon?.startOutsideAppVoiceSession) {
    return null;
  }
  return NativeJarvisDaemon.startOutsideAppVoiceSession();
}

export async function endAndroidOutsideAppVoiceSession(): Promise<AndroidDaemonStatus | null> {
  if (Platform.OS !== "android" || !NativeJarvisDaemon?.endOutsideAppVoiceSession) {
    return null;
  }
  return NativeJarvisDaemon.endOutsideAppVoiceSession();
}

export async function setAndroidOutsideAppVoiceSessionState(
  state: string,
): Promise<AndroidDaemonStatus | null> {
  if (Platform.OS !== "android" || !NativeJarvisDaemon?.setOutsideAppVoiceSessionState) {
    return null;
  }
  return NativeJarvisDaemon.setOutsideAppVoiceSessionState(state);
}

export async function setAndroidOutsideAppVoiceApproval(
  prompt: string,
  confirmationToken = "",
): Promise<AndroidDaemonStatus | null> {
  if (Platform.OS !== "android" || !NativeJarvisDaemon?.setOutsideAppVoiceApproval) {
    return null;
  }
  return NativeJarvisDaemon.setOutsideAppVoiceApproval(prompt, confirmationToken);
}

export function addAndroidOutsideAppVoiceControlListener(
  listener: (event: AndroidOutsideAppVoiceControlEvent) => void,
): { remove: () => void } {
  if (Platform.OS !== "android" || !NativeJarvisDaemon) {
    return { remove: () => {} };
  }
  return DeviceEventEmitter.addListener("JarvisVoiceSessionControl", listener);
}

export async function getAndroidNativeSpeechStatus(locale = ""): Promise<AndroidNativeSpeechStatus | null> {
  if (Platform.OS !== "android" || !NativeJarvisDaemon?.getNativeSpeechStatus) {
    return null;
  }
  return NativeJarvisDaemon.getNativeSpeechStatus(locale);
}

export async function startAndroidNativeSpeechRecognition(
  options: AndroidNativeSpeechRecognitionOptions = {},
): Promise<AndroidNativeSpeechStatus | null> {
  if (Platform.OS !== "android" || !NativeJarvisDaemon?.startNativeSpeechRecognition) {
    return null;
  }
  return NativeJarvisDaemon.startNativeSpeechRecognition(JSON.stringify(options));
}

export async function stopAndroidNativeSpeechRecognition(): Promise<AndroidNativeSpeechStatus | null> {
  if (Platform.OS !== "android" || !NativeJarvisDaemon?.stopNativeSpeechRecognition) {
    return null;
  }
  return NativeJarvisDaemon.stopNativeSpeechRecognition();
}

export async function cancelAndroidNativeSpeechRecognition(): Promise<AndroidNativeSpeechStatus | null> {
  if (Platform.OS !== "android" || !NativeJarvisDaemon?.cancelNativeSpeechRecognition) {
    return null;
  }
  return NativeJarvisDaemon.cancelNativeSpeechRecognition();
}

export async function triggerAndroidNativeSpeechModelDownload(locale = ""): Promise<AndroidNativeSpeechStatus | null> {
  if (Platform.OS !== "android" || !NativeJarvisDaemon?.triggerNativeSpeechModelDownload) {
    return null;
  }
  return NativeJarvisDaemon.triggerNativeSpeechModelDownload(locale);
}

export function addAndroidNativeSpeechRecognitionListener(
  listener: (event: AndroidNativeSpeechRecognitionEvent) => void,
): { remove: () => void } {
  if (Platform.OS !== "android" || !NativeJarvisDaemon) {
    return { remove: () => {} };
  }
  return DeviceEventEmitter.addListener("JarvisNativeSpeechRecognition", listener);
}

export async function recognizeAndroidSpeechOnce(
  options: AndroidNativeSpeechRecognitionOptions = {},
): Promise<AndroidNativeSpeechRecognitionResult> {
  if (Platform.OS !== "android" || !NativeJarvisDaemon?.startNativeSpeechRecognition) {
    throw new Error("Android on-device speech recognition is only available in the Android APK.");
  }

  const status = await getAndroidNativeSpeechStatus(options.locale ?? "");
  if (status && !status.available) {
    throw new Error(status.message || "Android on-device speech recognition is not available.");
  }

  return new Promise<AndroidNativeSpeechRecognitionResult>((resolve, reject) => {
    let settled = false;
    const timeoutMs = Math.max(options.timeoutMs ?? 60_000, 5_000);
    let subscription: { remove: () => void } = { remove: () => {} };
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      subscription.remove();
      callback();
    };

    subscription = addAndroidNativeSpeechRecognitionListener((event) => {
      const eventType = String(event?.type ?? "");
      if (eventType === "final") {
        const text = String(event.text ?? "").trim();
        const alternatives = Array.isArray(event.alternatives)
          ? event.alternatives.map(value => String(value).trim()).filter(Boolean)
          : [];
        finish(() => resolve({ text, alternatives }));
      } else if (eventType === "error") {
        const message = event.message || event.error || "Android on-device speech recognition failed.";
        finish(() => reject(new Error(message)));
      } else if (eventType === "cancelled") {
        finish(() => reject(new Error("Android speech recognition was cancelled.")));
      }
    });

    timeout = setTimeout(() => {
      cancelAndroidNativeSpeechRecognition().catch(() => {});
      finish(() => reject(new Error("Android speech recognition timed out.")));
    }, timeoutMs + 2_000);

    startAndroidNativeSpeechRecognition({
      interimResults: true,
      ...options,
      timeoutMs,
    }).catch((error) => {
      finish(() => reject(error instanceof Error ? error : new Error(String(error))));
    });
  });
}

export const AndroidDaemonNative = NativeJarvisDaemon;
