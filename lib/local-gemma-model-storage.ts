import * as FileSystem from "expo-file-system/legacy";

export const LOCAL_GEMMA_MODEL_ID = "gemma-4-e4b-it";
export const LOCAL_GEMMA_EXPECTED_FILE_NAME = "gemma-4-E4B-it.litertlm";
export const LOCAL_GEMMA_ENGINE_NOT_BUNDLED_MESSAGE =
  "Phone Gemma's model file is imported, but this APK does not bundle LiteRT-LM generation yet.";

const LOCAL_GEMMA_ENGINE = "litert-lm";
const LOCAL_GEMMA_DIR = `local_models/${LOCAL_GEMMA_MODEL_ID}`;
const LOCAL_GEMMA_MODEL_FILE = "model.litertlm";
const LOCAL_GEMMA_METADATA_FILE = "metadata.json";

export interface LocalGemmaModelStatus {
  ready?: boolean;
  modelFileReady?: boolean;
  engineBundled?: boolean;
  generationReady?: boolean;
  needsModelImport?: boolean;
  needsEngineBundle?: boolean;
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
  const paths = getLocalGemmaStoragePaths();
  if (!paths) {
    return {
      ready: false,
      modelFileReady: false,
      engineBundled: false,
      generationReady: false,
      needsModelImport: true,
      needsEngineBundle: false,
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
      engineBundled: false,
      generationReady: false,
      needsModelImport: true,
      needsEngineBundle: false,
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
    engineBundled: false,
    generationReady: false,
    needsModelImport: false,
    needsEngineBundle: true,
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
    engineBundled: false,
    generationReady: false,
    needsModelImport: false,
    needsEngineBundle: true,
    message: LOCAL_GEMMA_ENGINE_NOT_BUNDLED_MESSAGE,
  };
  await FileSystem.writeAsStringAsync(paths.metadataPath, JSON.stringify(metadata, null, 2));
  await deletePickerCacheFile(asset.uri);

  return readLocalGemmaModelStatus();
}
