import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const settingsScreen = fs.readFileSync(path.join(repoRoot, "app/(tabs)/settings.tsx"), "utf8");
const appStorageHelper = fs.readFileSync(path.join(repoRoot, "lib/local-gemma-model-storage.ts"), "utf8");
const nativeOpHandler = fs.readFileSync(
  path.join(repoRoot, "android/app/src/main/java/com/gameplan/daemon/OpHandler.kt"),
  "utf8",
);
const nativeModelManager = fs.readFileSync(
  path.join(repoRoot, "android/app/src/main/java/com/gameplan/daemon/LocalGemmaModelManager.kt"),
  "utf8",
);
const nativeInferenceEngine = fs.readFileSync(
  path.join(repoRoot, "android/app/src/main/java/com/gameplan/daemon/LocalGemmaInferenceEngine.kt"),
  "utf8",
);
const pluginInferenceEngine = fs.readFileSync(
  path.join(repoRoot, "plugins/android-daemon-native/src/main/java/com/gameplan/daemon/LocalGemmaInferenceEngine.kt"),
  "utf8",
);

assert.match(settingsScreen, /importLocalGemmaModelFile/);
assert.match(settingsScreen, /readLocalGemmaModelStatus/);
assert.match(settingsScreen, /Use Phone Gemma/);
assert.match(settingsScreen, /Import model file/);
assert.match(settingsScreen, /localGemmaGenerationReady/);
assert.match(settingsScreen, /LOCAL_GEMMA_ENGINE_NOT_BUNDLED_MESSAGE/);
assert.doesNotMatch(settingsScreen, /model:\s*ANDROID_LOCAL_GEMMA_MODEL,[\s\S]{0,400}localGemmaStatus\?\.ready/);

assert.match(appStorageHelper, /LOCAL_GEMMA_MODEL_ID = "gemma-4-e4b-it"/);
assert.match(appStorageHelper, /LOCAL_GEMMA_EXPECTED_FILE_NAME = "gemma-4-E4B-it\.litertlm"/);
assert.match(appStorageHelper, /local_models\/\$\{LOCAL_GEMMA_MODEL_ID\}/);
assert.match(appStorageHelper, /storageOwner:\s*"jarvis-android-app"/);
assert.match(appStorageHelper, /expo-document-picker/);
assert.match(appStorageHelper, /modelFileReady\?:\s*boolean/);
assert.match(appStorageHelper, /engineBundled\?:\s*boolean/);
assert.match(appStorageHelper, /generationReady\?:\s*boolean/);
assert.match(appStorageHelper, /needsEngineBundle\?:\s*boolean/);
assert.match(appStorageHelper, /ready:\s*true/);
assert.match(appStorageHelper, /engineBundled:\s*true/);
assert.match(appStorageHelper, /generationReady:\s*true/);
assert.match(appStorageHelper, /needsEngineBundle:\s*false/);
assert.doesNotMatch(appStorageHelper, /ready:\s*true,[\s\S]{0,220}message:\s*"Local Gemma model file is stored inside the Jarvis Android app\."/);
assert.doesNotMatch(appStorageHelper, /does not bundle LiteRT-LM/);

assert.match(nativeOpHandler, /"android_local_model_generate" -> LocalGemmaModelManager\.generate\(context, op\)/);
assert.match(nativeModelManager, /package com\.gameplan\.daemon/);
assert.match(nativeModelManager, /context\.filesDir, "local_models\/\$model"/);
assert.match(nativeModelManager, /val modelRevision = buildModelRevision\(context, model, file\)/);
assert.match(nativeModelManager, /LocalGemmaInferenceEngine\.generate\(context, model, file, modelRevision, op\)/);
assert.match(nativeModelManager, /\.put\("modelFileReady", modelFileReady\)/);
assert.match(nativeModelManager, /\.put\("engineBundled", true\)/);
assert.match(nativeModelManager, /\.put\("generationReady", generationReady\)/);
assert.match(nativeModelManager, /\.put\("needsEngineBundle", false\)/);
assert.doesNotMatch(nativeModelManager, /ENGINE_NOT_BUNDLED_MESSAGE/);
assert.match(nativeInferenceEngine, /EngineConfig\(/);
assert.match(nativeInferenceEngine, /maxNumTokens = contextTokens/);
assert.match(nativeInferenceEngine, /state\.modelRevision == modelRevision/);
assert.match(nativeInferenceEngine, /val previousEngine = lockedCurrent\?\.engine/);
assert.match(nativeInferenceEngine, /DEFAULT_BACKEND = "auto"/);
assert.match(nativeInferenceEngine, /backendCandidates\(backendName\)/);
assert.match(nativeInferenceEngine, /var engine: Engine\? = null/);
assert.match(nativeInferenceEngine, /val initializedEngine = Engine\(/);
assert.match(nativeInferenceEngine, /EngineState\(modelPath, modelRevision, candidateBackendName, contextTokens, initializedEngine\)/);
assert.match(nativeInferenceEngine, /\.put\("requestedBackend", active\.backend\)/);
assert.match(nativeInferenceEngine, /\.put\("lastEngineError", lastEngineError \?: JSONObject\.NULL\)/);
assert.match(nativeInferenceEngine, /hasReachedCompletionLimit\(chunks, maxCompletionTokens\)/);
assert.match(nativeInferenceEngine, /finishReason/);
assert.equal(nativeInferenceEngine, pluginInferenceEngine);

console.log("OK: Android app imports local Gemma and native ops read it with bundled LiteRT-LM generation");
