import * as FileSystem from "expo-file-system/legacy";
import {
  getAndroidLocalGemmaStatus,
  smokeTestAndroidLocalGemmaModel,
  validateAndroidLocalGemmaModel,
  type AndroidLocalGemmaValidationOptions,
} from "./android-daemon-native";
import {
  LOCAL_GEMMA_ENGINE,
  LOCAL_GEMMA_ENGINE_NOT_BUNDLED_MESSAGE,
  LOCAL_GEMMA_EXPECTED_FILE_NAME,
  LOCAL_GEMMA_MODEL_ID,
  type LocalGemmaModelStatus,
  type LocalGemmaSmokeTestResult,
  type LocalGemmaSmokeTestRun,
} from "./phone-gemma-runtime-contract";

export {
  LOCAL_GEMMA_ENGINE,
  LOCAL_GEMMA_ENGINE_NOT_BUNDLED_MESSAGE,
  LOCAL_GEMMA_EXPECTED_FILE_NAME,
  LOCAL_GEMMA_MODEL_ID,
  type LocalGemmaModelStatus,
  type LocalGemmaSmokeTestResult,
  type LocalGemmaSmokeTestRun,
};

const LOCAL_GEMMA_DIR = `local_models/${LOCAL_GEMMA_MODEL_ID}`;
const LOCAL_GEMMA_MODEL_FILE = "model.litertlm";
const LOCAL_GEMMA_METADATA_FILE = "metadata.json";

interface LocalGemmaStoragePaths {
  dir: string;
  modelPath: string;
  metadataPath: string;
  tempPath: string;
}

interface PickedModelAsset {
  uri: string;
  name: string;
  size?: number;
}

function localGemmaImportPrompt(): string {
  return `Pick ${LOCAL_GEMMA_EXPECTED_FILE_NAME} from Downloads to store it inside Jarvis.`;
}

export function getLocalGemmaStoragePaths(): LocalGemmaStoragePaths | null {
  if (!FileSystem.documentDirectory) return null;
  const root = FileSystem.documentDirectory.endsWith("/")
    ? FileSystem.documentDirectory
    : `${FileSystem.documentDirectory}/`;
  const dir = `${root}${LOCAL_GEMMA_DIR}/`;
  return {
    dir,
    modelPath: `${dir}${LOCAL_GEMMA_MODEL_FILE}`,
    metadataPath: `${dir}${LOCAL_GEMMA_METADATA_FILE}`,
    tempPath: `${dir}${LOCAL_GEMMA_MODEL_FILE}.tmp`,
  };
}

function sizeFromInfo(info: Awaited<ReturnType<typeof FileSystem.getInfoAsync>>): number | null {
  if (!info.exists) return null;
  const size = "size" in info && typeof info.size === "number" ? info.size : null;
  return size && size > 0 ? size : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function normalizeLocalGemmaStatus(raw: Record<string, unknown>): LocalGemmaModelStatus {
  const inference = asRecord(raw.inference) ?? undefined;
  return {
    ready: raw.ready === true,
    modelFileReady: raw.modelFileReady === true,
    engineBundled: raw.engineBundled !== false,
    generationReady: raw.generationReady === true,
    needsModelImport: raw.needsModelImport === true,
    needsEngineBundle: raw.needsEngineBundle === true,
    needsEngineValidation: raw.needsEngineValidation === true,
    engineValidated: raw.engineValidated === true,
    engineValidatedAtMs: numberValue(raw.engineValidatedAtMs),
    engineValidatedBackend: stringValue(raw.engineValidatedBackend) ?? null,
    engineValidatedSpeculativeDecoding: booleanValue(raw.engineValidatedSpeculativeDecoding) ?? null,
    engineValidatedDecodingMode: stringValue(raw.engineValidatedDecodingMode) ?? null,
    engineValidatedContextTokens: numberValue(raw.engineValidatedContextTokens),
    engineValidatedCpuFallbackAllowed: booleanValue(raw.engineValidatedCpuFallbackAllowed) ?? null,
    engineValidatedCachePolicy: stringValue(raw.engineValidatedCachePolicy) ?? null,
    engineValidatedProfileId: stringValue(raw.engineValidatedProfileId) ?? null,
    engineValidatedProfileLabel: stringValue(raw.engineValidatedProfileLabel) ?? null,
    engineLastValidationError: stringValue(raw.engineLastValidationError) ?? null,
    engineLastValidationProfileId: stringValue(raw.engineLastValidationProfileId) ?? null,
    engineLastValidationProfileLabel: stringValue(raw.engineLastValidationProfileLabel) ?? null,
    lastEngineError: stringValue(raw.lastEngineError) ?? null,
    modelRevision: stringValue(raw.modelRevision) ?? null,
    inference,
    expectedMinSizeBytes: numberValue(raw.expectedMinSizeBytes),
    expectedMaxSizeBytes: numberValue(raw.expectedMaxSizeBytes),
    modelFileSizeLooksPlausible: booleanValue(raw.modelFileSizeLooksPlausible),
    message: stringValue(raw.message),
    provider: "android-local-gemma",
    runtime: "android-app",
    storageOwner: "jarvis-android-app",
    engine: LOCAL_GEMMA_ENGINE,
    model: stringValue(raw.model) || LOCAL_GEMMA_MODEL_ID,
    modelPath: stringValue(raw.modelPath),
    sourceName: stringValue(raw.sourceName),
    sourceSizeBytes: numberValue(raw.sourceSizeBytes),
    sha256: stringValue(raw.sha256),
    sizeBytes: numberValue(raw.sizeBytes),
    importedAtMs: numberValue(raw.importedAtMs) ?? undefined,
  };
}

async function readMetadata(metadataPath: string): Promise<Partial<LocalGemmaModelStatus> | null> {
  const info = await FileSystem.getInfoAsync(metadataPath);
  if (!info.exists) return null;
  try {
    const raw = await FileSystem.readAsStringAsync(metadataPath);
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Partial<LocalGemmaModelStatus> : null;
  } catch {
    return null;
  }
}

export async function readLocalGemmaModelStatus(): Promise<LocalGemmaModelStatus> {
  const nativeStatus = await getAndroidLocalGemmaStatus(LOCAL_GEMMA_MODEL_ID).catch(() => null);
  if (nativeStatus) return normalizeLocalGemmaStatus(nativeStatus);

  const paths = getLocalGemmaStoragePaths();
  if (!paths) {
    return {
      ready: false,
      modelFileReady: false,
      engineBundled: true,
      generationReady: false,
      needsModelImport: true,
      needsEngineBundle: false,
      needsEngineValidation: false,
      model: LOCAL_GEMMA_MODEL_ID,
      message: "Jarvis app storage is not available on this device.",
    };
  }

  const [modelInfo, metadata] = await Promise.all([
    FileSystem.getInfoAsync(paths.modelPath),
    readMetadata(paths.metadataPath),
  ]);
  const sizeBytes = sizeFromInfo(modelInfo);

  if (!modelInfo.exists || !sizeBytes) {
    return {
      ready: false,
      modelFileReady: false,
      engineBundled: true,
      generationReady: false,
      needsModelImport: true,
      needsEngineBundle: false,
      needsEngineValidation: false,
      provider: "android-local-gemma",
      runtime: "android-app",
      storageOwner: "jarvis-android-app",
      engine: LOCAL_GEMMA_ENGINE,
      model: LOCAL_GEMMA_MODEL_ID,
      modelPath: paths.modelPath,
      message: localGemmaImportPrompt(),
    };
  }

  return {
    ...metadata,
    ready: false,
    modelFileReady: true,
    engineBundled: true,
    generationReady: false,
    needsModelImport: false,
    needsEngineBundle: false,
    needsEngineValidation: true,
    engineValidated: false,
    provider: "android-local-gemma",
    runtime: "android-app",
    storageOwner: "jarvis-android-app",
    engine: LOCAL_GEMMA_ENGINE,
    model: LOCAL_GEMMA_MODEL_ID,
    modelPath: paths.modelPath,
    sizeBytes: sizeBytes ?? metadata?.sizeBytes ?? null,
    sourceName: metadata?.sourceName,
    importedAtMs: metadata?.importedAtMs,
    message: LOCAL_GEMMA_ENGINE_NOT_BUNDLED_MESSAGE,
  };
}

function getPickedAsset(result: unknown): PickedModelAsset | null {
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;
  if (record.canceled === true || record.type === "cancel") return null;

  const firstAsset = Array.isArray(record.assets) ? record.assets[0] : record;
  if (!firstAsset || typeof firstAsset !== "object") return null;

  const asset = firstAsset as Record<string, unknown>;
  const uri = typeof asset.uri === "string" ? asset.uri : "";
  if (!uri) return null;

  return {
    uri,
    name: typeof asset.name === "string" && asset.name.trim()
      ? asset.name.trim()
      : LOCAL_GEMMA_EXPECTED_FILE_NAME,
    size: typeof asset.size === "number" ? asset.size : undefined,
  };
}

function assertValidModelAsset(asset: PickedModelAsset): void {
  if (!asset.name.toLowerCase().endsWith(".litertlm")) {
    throw new Error(`Select ${LOCAL_GEMMA_EXPECTED_FILE_NAME} or another .litertlm Gemma model file.`);
  }
}

async function deletePickerCacheFile(uri: string): Promise<void> {
  const cacheDirectory = FileSystem.cacheDirectory;
  if (!cacheDirectory || !uri.startsWith(cacheDirectory)) return;
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
}

export async function importLocalGemmaModelFile(): Promise<LocalGemmaModelStatus | null> {
  const paths = getLocalGemmaStoragePaths();
  if (!paths) {
    throw new Error("Jarvis app storage is not available on this device.");
  }

  const DocumentPicker = await import("expo-document-picker");
  const result = await DocumentPicker.getDocumentAsync({
    type: "*/*",
    multiple: false,
    copyToCacheDirectory: true,
    base64: false,
  });
  const asset = getPickedAsset(result);
  if (!asset) return null;
  assertValidModelAsset(asset);

  await FileSystem.makeDirectoryAsync(paths.dir, { intermediates: true });
  await FileSystem.deleteAsync(paths.tempPath, { idempotent: true });
  await FileSystem.copyAsync({ from: asset.uri, to: paths.tempPath });

  const copiedInfo = await FileSystem.getInfoAsync(paths.tempPath);
  const copiedSize = sizeFromInfo(copiedInfo);
  if (!copiedInfo.exists || !copiedSize) {
    await FileSystem.deleteAsync(paths.tempPath, { idempotent: true });
    throw new Error("Jarvis could not copy the selected model file.");
  }

  await FileSystem.deleteAsync(paths.modelPath, { idempotent: true });
  await FileSystem.moveAsync({ from: paths.tempPath, to: paths.modelPath });

  const metadata: LocalGemmaModelStatus = {
    provider: "android-local-gemma",
    runtime: "android-app",
    storageOwner: "jarvis-android-app",
    engine: LOCAL_GEMMA_ENGINE,
    model: LOCAL_GEMMA_MODEL_ID,
    sourceName: asset.name,
    sourceSizeBytes: asset.size ?? null,
    modelPath: paths.modelPath,
    sizeBytes: copiedSize,
    importedAtMs: Date.now(),
    ready: false,
    modelFileReady: true,
    engineBundled: true,
    generationReady: false,
    needsModelImport: false,
    needsEngineBundle: false,
    needsEngineValidation: true,
    engineValidated: false,
    engineValidatedAtMs: null,
    engineValidatedBackend: null,
    engineValidatedSpeculativeDecoding: null,
    engineValidatedDecodingMode: null,
    engineValidatedContextTokens: null,
    engineValidatedCpuFallbackAllowed: null,
    engineValidatedCachePolicy: null,
    engineValidatedProfileId: null,
    engineValidatedProfileLabel: null,
    engineLastValidationError: null,
    message: "Phone Gemma's model file is imported. Validate the LiteRT-LM engine before using it for chat.",
  };
  await FileSystem.writeAsStringAsync(paths.metadataPath, JSON.stringify(metadata, null, 2));
  await deletePickerCacheFile(asset.uri);

  return readLocalGemmaModelStatus();
}

function normalizeSmokeTestResult(raw: Record<string, unknown>): LocalGemmaSmokeTestResult {
  const runs = Array.isArray(raw.runs) ? raw.runs : [];
  return {
    passed: raw.passed === true,
    failedCount: numberValue(raw.failedCount) ?? 0,
    totalCount: numberValue(raw.totalCount) ?? runs.length,
    durationMs: numberValue(raw.durationMs),
    profileId: stringValue(raw.profileId) ?? null,
    profileLabel: stringValue(raw.profileLabel) ?? null,
    backend: stringValue(raw.backend) ?? null,
    decodingMode: stringValue(raw.decodingMode) ?? null,
    contextTokens: numberValue(raw.contextTokens),
    runs: runs
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .map((item) => ({
        id: stringValue(item.id) || "run",
        ok: item.ok === true,
        backend: stringValue(item.backend) ?? null,
        decodingMode: stringValue(item.decodingMode) ?? null,
        contextTokens: numberValue(item.contextTokens),
        durationMs: numberValue(item.durationMs),
        outputChars: numberValue(item.outputChars),
        text: stringValue(item.text) ?? null,
        error: stringValue(item.error) ?? null,
        order: numberValue(item.order),
      })),
    message: stringValue(raw.message),
  };
}

export async function validateLocalGemmaModel(options: AndroidLocalGemmaValidationOptions = {}): Promise<LocalGemmaModelStatus> {
  const status = await validateAndroidLocalGemmaModel(LOCAL_GEMMA_MODEL_ID, options);
  return normalizeLocalGemmaStatus(status);
}

export async function smokeTestLocalGemmaModel(options: AndroidLocalGemmaValidationOptions = {}): Promise<LocalGemmaSmokeTestResult> {
  const result = await smokeTestAndroidLocalGemmaModel(LOCAL_GEMMA_MODEL_ID, options);
  return normalizeSmokeTestResult(result);
}
