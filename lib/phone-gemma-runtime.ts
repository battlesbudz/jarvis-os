import type { AndroidLocalGemmaValidationOptions } from "./android-daemon-native";
import {
  importLocalGemmaModelFile,
  LOCAL_GEMMA_ENGINE_NOT_BUNDLED_MESSAGE,
  LOCAL_GEMMA_EXPECTED_FILE_NAME,
  LOCAL_GEMMA_MODEL_ID,
  readLocalGemmaModelStatus,
  smokeTestLocalGemmaModel,
  validateLocalGemmaModel,
  type LocalGemmaModelStatus,
  type LocalGemmaSmokeTestResult,
} from "./local-gemma-model-storage";

export type PhoneGemmaValidationProfile = {
  id: string;
  label: string;
  backend: NonNullable<AndroidLocalGemmaValidationOptions["backend"]>;
  contextTokens: number;
  allowCpuFallback: boolean;
  speculativeDecoding?: boolean;
};

export const PHONE_GEMMA_VALIDATION_PROFILES: PhoneGemmaValidationProfile[] = [
  {
    id: "gpu-standard-1024",
    label: "GPU standard 1024",
    backend: "gpu",
    contextTokens: 1024,
    allowCpuFallback: false,
    speculativeDecoding: false,
  },
  {
    id: "gpu-standard-512",
    label: "GPU standard 512",
    backend: "gpu",
    contextTokens: 512,
    allowCpuFallback: false,
    speculativeDecoding: false,
  },
  {
    id: "gpu-auto-2048",
    label: "GPU auto 2048",
    backend: "gpu",
    contextTokens: 2048,
    allowCpuFallback: false,
  },
  {
    id: "cpu-standard-1024",
    label: "CPU standard 1024",
    backend: "cpu",
    contextTokens: 1024,
    allowCpuFallback: false,
    speculativeDecoding: false,
  },
  {
    id: "cpu-standard-512",
    label: "CPU standard 512",
    backend: "cpu",
    contextTokens: 512,
    allowCpuFallback: false,
    speculativeDecoding: false,
  },
];

export const PHONE_GEMMA_RECOMMENDED_PROFILE = PHONE_GEMMA_VALIDATION_PROFILES[0]!;

export {
  LOCAL_GEMMA_ENGINE_NOT_BUNDLED_MESSAGE,
  LOCAL_GEMMA_EXPECTED_FILE_NAME,
  type LocalGemmaModelStatus,
  type LocalGemmaSmokeTestResult,
};

export function phoneGemmaProfileOptions(profile: PhoneGemmaValidationProfile): AndroidLocalGemmaValidationOptions {
  return {
    backend: profile.backend,
    contextTokens: profile.contextTokens,
    allowCpuFallback: profile.allowCpuFallback,
    speculativeDecoding: profile.speculativeDecoding,
    profileId: profile.id,
    profileLabel: profile.label,
  };
}

export function isPhoneGemmaModelFileReady(status?: LocalGemmaModelStatus | null): boolean {
  return Boolean(status?.modelFileReady ?? (status?.ready && !status?.needsModelImport));
}

export function isPhoneGemmaGenerationReady(status?: LocalGemmaModelStatus | null): boolean {
  return status?.generationReady === true;
}

export function phoneGemmaNeedsEngine(status?: LocalGemmaModelStatus | null): boolean {
  const modelFileReady = isPhoneGemmaModelFileReady(status);
  const generationReady = isPhoneGemmaGenerationReady(status);
  return Boolean(
    status?.needsEngineBundle ||
      status?.needsEngineValidation ||
      (modelFileReady && !generationReady),
  );
}

export function normalizePhoneGemmaStatus(status?: LocalGemmaModelStatus | null): LocalGemmaModelStatus | null {
  if (!status) return null;
  const modelFileReady = isPhoneGemmaModelFileReady(status);
  const generationReady = isPhoneGemmaGenerationReady(status);
  const needsModelImport = status.needsModelImport ?? !modelFileReady;

  return {
    ...status,
    ready: status.ready === true || generationReady,
    modelFileReady,
    engineBundled: status.engineBundled !== false,
    generationReady,
    needsModelImport,
    needsEngineBundle: status.needsEngineBundle ?? false,
    needsEngineValidation:
      generationReady ? false : status.needsEngineValidation ?? modelFileReady,
    engineValidated: status.engineValidated === true || generationReady,
    provider: "android-local-gemma",
    runtime: "android-app",
    storageOwner: "jarvis-android-app",
    engine: "litert-lm",
    model: status.model || LOCAL_GEMMA_MODEL_ID,
  };
}

export function createPhoneGemmaUnavailableStatus(message: string): LocalGemmaModelStatus {
  return normalizePhoneGemmaStatus({
    ready: false,
    modelFileReady: false,
    engineBundled: true,
    generationReady: false,
    needsModelImport: true,
    needsEngineBundle: false,
    needsEngineValidation: false,
    engineValidated: false,
    provider: "android-local-gemma",
    runtime: "android-app",
    storageOwner: "jarvis-android-app",
    engine: "litert-lm",
    model: LOCAL_GEMMA_MODEL_ID,
    message,
  })!;
}

export function phoneGemmaProfileLabel(profileId?: string | null): string | null {
  if (!profileId) return null;
  return PHONE_GEMMA_VALIDATION_PROFILES.find((profile) => profile.id === profileId)?.label ?? null;
}

export function phoneGemmaRuntimeDetails(status?: LocalGemmaModelStatus | null): string | null {
  const normalized = normalizePhoneGemmaStatus(status);
  if (!normalized?.engineValidated) return null;
  const parts = [
    normalized.engineValidatedProfileLabel,
    normalized.engineValidatedBackend ? normalized.engineValidatedBackend.toUpperCase() : null,
    normalized.engineValidatedDecodingMode,
    normalized.engineValidatedContextTokens ? `${normalized.engineValidatedContextTokens} tokens` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" - ") : null;
}

export function summarizePhoneGemmaSmokeTest(result: LocalGemmaSmokeTestResult): string {
  const profile = result.profileLabel ? `${result.profileLabel}: ` : "";
  const runs = result.runs
    .map((run) => `${run.id} ${run.ok ? "OK" : "FAILED"}${run.backend ? `/${run.backend}` : ""}${run.decodingMode ? `/${run.decodingMode}` : ""}`)
    .join(", ");
  return `${profile}${result.passed ? "passed" : `${result.failedCount} failed`} (${runs}).`;
}

export async function readPhoneGemmaStatus(): Promise<LocalGemmaModelStatus> {
  return normalizePhoneGemmaStatus(await readLocalGemmaModelStatus())!;
}

export async function importPhoneGemmaModelFile(): Promise<LocalGemmaModelStatus | null> {
  return normalizePhoneGemmaStatus(await importLocalGemmaModelFile());
}

export async function validatePhoneGemmaRuntime(
  profile: PhoneGemmaValidationProfile = PHONE_GEMMA_RECOMMENDED_PROFILE,
): Promise<LocalGemmaModelStatus> {
  return normalizePhoneGemmaStatus(await validateLocalGemmaModel(phoneGemmaProfileOptions(profile)))!;
}

export async function smokeTestPhoneGemmaRuntime(
  options: AndroidLocalGemmaValidationOptions = {},
): Promise<LocalGemmaSmokeTestResult> {
  return smokeTestLocalGemmaModel(options);
}
