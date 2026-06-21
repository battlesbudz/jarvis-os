export const LOCAL_GEMMA_MODEL_ID = "gemma-4-e4b-it";
export const LOCAL_GEMMA_EXPECTED_FILE_NAME = "gemma-4-E4B-it.litertlm";
export const LOCAL_GEMMA_ENGINE = "litert-lm";
export const LOCAL_GEMMA_ENGINE_NOT_BUNDLED_MESSAGE =
  "Phone Gemma's model file is imported, but Jarvis needs to validate LiteRT-LM on this device before using it for chat.";

export interface LocalGemmaModelStatus {
  ready?: boolean;
  modelFileReady?: boolean;
  engineBundled?: boolean;
  generationReady?: boolean;
  needsModelImport?: boolean;
  needsEngineBundle?: boolean;
  needsEngineValidation?: boolean;
  engineValidated?: boolean;
  engineValidatedAtMs?: number | null;
  engineValidatedBackend?: string | null;
  engineValidatedSpeculativeDecoding?: boolean | null;
  engineValidatedDecodingMode?: string | null;
  engineValidatedContextTokens?: number | null;
  engineValidatedCpuFallbackAllowed?: boolean | null;
  engineValidatedCachePolicy?: string | null;
  engineValidatedProfileId?: string | null;
  engineValidatedProfileLabel?: string | null;
  engineLastValidationError?: string | null;
  engineLastValidationProfileId?: string | null;
  engineLastValidationProfileLabel?: string | null;
  lastEngineError?: string | null;
  modelRevision?: string | null;
  inference?: Record<string, unknown>;
  expectedMinSizeBytes?: number | null;
  expectedMaxSizeBytes?: number | null;
  modelFileSizeLooksPlausible?: boolean;
  message?: string;
  provider?: "android-local-gemma";
  runtime?: "android-app";
  storageOwner?: "jarvis-android-app";
  engine?: "litert-lm";
  model?: string;
  modelPath?: string;
  sourceName?: string;
  sourceSizeBytes?: number | null;
  sha256?: string;
  sizeBytes?: number | null;
  importedAtMs?: number;
}

export interface LocalGemmaSmokeTestRun {
  id: string;
  ok: boolean;
  backend?: string | null;
  decodingMode?: string | null;
  contextTokens?: number | null;
  durationMs?: number | null;
  outputChars?: number | null;
  text?: string | null;
  error?: string | null;
  order?: number | null;
}

export interface LocalGemmaSmokeTestResult {
  passed: boolean;
  failedCount: number;
  totalCount: number;
  durationMs?: number | null;
  profileId?: string | null;
  profileLabel?: string | null;
  backend?: string | null;
  decodingMode?: string | null;
  contextTokens?: number | null;
  runs: LocalGemmaSmokeTestRun[];
  message?: string;
}
