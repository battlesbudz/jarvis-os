import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const settingsScreen = fs.readFileSync(path.join(repoRoot, "app/(tabs)/settings.tsx"), "utf8");
const phoneGemmaRuntime = fs.readFileSync(path.join(repoRoot, "lib/phone-gemma-runtime.ts"), "utf8");
const phoneGemmaContract = fs.readFileSync(path.join(repoRoot, "lib/phone-gemma-runtime-contract.ts"), "utf8");
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

assert.match(settingsScreen, /@\/lib\/phone-gemma-runtime/);
assert.match(settingsScreen, /importPhoneGemmaModelFile/);
assert.match(settingsScreen, /readPhoneGemmaStatus/);
assert.match(settingsScreen, /validatePhoneGemmaRuntime/);
assert.match(settingsScreen, /Use Phone Gemma/);
assert.match(settingsScreen, /Import model file/);
assert.match(settingsScreen, /Validate engine/);
assert.match(settingsScreen, /Run smoke test/);
assert.match(settingsScreen, /localGemmaGenerationReady/);
assert.match(settingsScreen, /localGemmaValidating/);
assert.match(settingsScreen, /LOCAL_GEMMA_ENGINE_NOT_BUNDLED_MESSAGE/);
assert.doesNotMatch(settingsScreen, /type LocalGemmaValidationProfile/);
assert.doesNotMatch(settingsScreen, /LOCAL_GEMMA_VALIDATION_PROFILES/);
assert.doesNotMatch(settingsScreen, /model:\s*ANDROID_LOCAL_GEMMA_MODEL,[\s\S]{0,400}localGemmaStatus\?\.ready/);

assert.match(phoneGemmaRuntime, /PHONE_GEMMA_VALIDATION_PROFILES/);
assert.match(phoneGemmaRuntime, /PHONE_GEMMA_RECOMMENDED_PROFILE/);
assert.match(phoneGemmaRuntime, /GPU standard 1024/);
assert.match(phoneGemmaRuntime, /CPU standard 512/);
assert.match(phoneGemmaRuntime, /allowCpuFallback:\s*false/);
assert.match(phoneGemmaRuntime, /phoneGemmaProfileOptions/);
assert.match(phoneGemmaRuntime, /normalizePhoneGemmaStatus/);
assert.match(phoneGemmaRuntime, /isPhoneGemmaModelFileReady/);
assert.match(phoneGemmaRuntime, /isPhoneGemmaGenerationReady/);
assert.match(phoneGemmaRuntime, /isCurrentPhoneGemmaValidationProfile/);
assert.match(phoneGemmaRuntime, /phoneGemmaNeedsEngine/);
assert.match(phoneGemmaRuntime, /phoneGemmaRuntimeDetails/);
assert.match(phoneGemmaRuntime, /summarizePhoneGemmaSmokeTest/);
assert.match(phoneGemmaRuntime, /readPhoneGemmaStatus/);
assert.match(phoneGemmaRuntime, /validatePhoneGemmaRuntime/);
assert.match(phoneGemmaRuntime, /smokeTestPhoneGemmaRuntime/);
assert.match(phoneGemmaRuntime, /importPhoneGemmaModelFile/);
assert.match(phoneGemmaRuntime, /readLocalGemmaModelStatus/);
assert.match(phoneGemmaRuntime, /validateLocalGemmaModel/);

assert.match(phoneGemmaContract, /LOCAL_GEMMA_MODEL_ID = "gemma-4-e4b-it"/);
assert.match(phoneGemmaContract, /LOCAL_GEMMA_EXPECTED_FILE_NAME = "gemma-4-E4B-it\.litertlm"/);
assert.match(phoneGemmaContract, /interface LocalGemmaModelStatus/);
assert.match(phoneGemmaContract, /interface LocalGemmaSmokeTestResult/);
assert.match(appStorageHelper, /from "\.\/phone-gemma-runtime-contract"/);
assert.match(appStorageHelper, /local_models\/\$\{LOCAL_GEMMA_MODEL_ID\}/);
assert.match(appStorageHelper, /storageOwner:\s*"jarvis-android-app"/);
assert.match(appStorageHelper, /expo-document-picker/);
assert.match(phoneGemmaContract, /modelFileReady\?:\s*boolean/);
assert.match(phoneGemmaContract, /engineBundled\?:\s*boolean/);
assert.match(phoneGemmaContract, /generationReady\?:\s*boolean/);
assert.match(phoneGemmaContract, /needsEngineBundle\?:\s*boolean/);
assert.match(phoneGemmaContract, /needsEngineValidation\?:\s*boolean/);
assert.match(phoneGemmaContract, /engineValidated\?:\s*boolean/);
assert.match(phoneGemmaContract, /engineValidatedContextTokens\?:\s*number/);
assert.match(appStorageHelper, /smokeTestLocalGemmaModel/);
assert.match(appStorageHelper, /getAndroidLocalGemmaStatus/);
assert.match(appStorageHelper, /validateAndroidLocalGemmaModel/);
assert.match(appStorageHelper, /ready:\s*false/);
assert.match(appStorageHelper, /engineBundled:\s*true/);
assert.match(appStorageHelper, /generationReady:\s*false/);
assert.match(appStorageHelper, /needsEngineValidation:\s*true/);
assert.match(appStorageHelper, /needsEngineBundle:\s*false/);
assert.doesNotMatch(appStorageHelper, /ready:\s*true,[\s\S]{0,220}message:\s*"Local Gemma model file is stored inside the Jarvis Android app\."/);
assert.doesNotMatch(appStorageHelper, /does not bundle LiteRT-LM/);

assert.match(nativeOpHandler, /"android_local_model_validate" -> LocalGemmaModelManager\.validate\(context, op\)/);
assert.match(nativeOpHandler, /"android_local_model_smoke_test" -> LocalGemmaModelManager\.smokeTest\(context, op\)/);
assert.match(nativeOpHandler, /"android_local_model_generate" -> LocalGemmaModelManager\.generate\(context, op\)/);
assert.match(nativeModelManager, /package com\.gameplan\.daemon/);
assert.match(nativeModelManager, /context\.filesDir, "local_models\/\$model"/);
assert.match(nativeModelManager, /DEFAULT_VALIDATION_PROFILE_ID = "gpu-standard-512"/);
assert.match(nativeModelManager, /VALIDATION_CACHE_POLICY = "none"/);
assert.match(nativeModelManager, /currentValidationProfilesById/);
assert.match(nativeModelManager, /ValidationProfile\("gpu-standard-512", "GPU standard 512", "gpu", 512, false, false, VALIDATION_CACHE_POLICY\)/);
assert.match(nativeModelManager, /val modelRevision = buildModelRevision\(context, model, file\)/);
assert.match(nativeModelManager, /LocalGemmaInferenceEngine\.validate\(context, model, file, modelRevision, validationOp\)/);
assert.match(nativeModelManager, /LocalGemmaInferenceEngine\.generate\(context, model, file, modelRevision, generationOpForValidatedProfile\(op, metadata\)\)/);
assert.match(nativeModelManager, /requestedValidationProfile/);
assert.match(nativeModelManager, /operationForValidationProfile/);
assert.match(nativeModelManager, /currentValidationProfile\(metadata\) != null/);
assert.match(nativeModelManager, /LOCAL_MODEL_VALIDATION_PROFILE_UNSUPPORTED/);
assert.match(nativeModelManager, /Previous Phone Gemma validation used an older or hidden profile/);
assert.match(nativeModelManager, /fun smokeTest\(context: Context, op: JSONObject\): OpResult/);
assert.match(nativeModelManager, /LocalGemmaInferenceEngine\.releaseWarmEngine\(\)/);
assert.match(nativeModelManager, /val validationError = if \(engineValidated\) null else lastEngineError \?: engineLastValidationError/);
assert.match(nativeModelManager, /preserveExistingValidation/);
assert.match(nativeModelManager, /\.put\("modelFileReady", modelFileReady\)/);
assert.match(nativeModelManager, /\.put\("engineBundled", true\)/);
assert.match(nativeModelManager, /\.put\("generationReady", generationReady\)/);
assert.match(nativeModelManager, /\.put\("needsEngineValidation", needsEngineValidation\)/);
assert.match(nativeModelManager, /\.put\("engineValidated", engineValidated\)/);
assert.match(nativeModelManager, /LOCAL_MODEL_VALIDATION_REQUIRED/);
assert.match(nativeModelManager, /shouldPreserveExistingValidation\(error\)/);
assert.match(nativeModelManager, /\.put\("needsEngineBundle", false\)/);
assert.doesNotMatch(nativeModelManager, /ENGINE_NOT_BUNDLED_MESSAGE/);
assert.match(nativeInferenceEngine, /EngineConfig\(/);
assert.match(nativeInferenceEngine, /DEFAULT_ALLOW_CPU_FALLBACK = false/);
assert.match(nativeInferenceEngine, /DEFAULT_CONTEXT_TOKENS = 2048/);
assert.match(nativeInferenceEngine, /DEFAULT_MAX_COMPLETION_TOKENS = 128/);
assert.match(nativeInferenceEngine, /fun validate\(context: Context, model: String, modelFile: File, modelRevision: String, op: JSONObject\): OpResult/);
assert.match(nativeInferenceEngine, /LOCAL_MODEL_VALIDATION_FAILED/);
assert.match(nativeInferenceEngine, /MIN_GPU_AVAILABLE_MEMORY_BYTES/);
assert.match(nativeInferenceEngine, /MIN_NPU_AVAILABLE_MEMORY_BYTES/);
assert.match(nativeInferenceEngine, /MIN_CPU_AVAILABLE_MEMORY_BYTES/);
assert.match(nativeInferenceEngine, /MIN_CPU_AVAILABLE_MEMORY_BYTES = 7000L \* 1024L \* 1024L/);
assert.match(nativeInferenceEngine, /DEFAULT_CACHE_POLICY = "none"/);
assert.match(nativeInferenceEngine, /LITERT_NO_CACHE_DIR = ":nocache"/);
assert.match(nativeInferenceEngine, /trimPromptForContext/);
assert.match(nativeInferenceEngine, /\.put\("inputTrimmed", prompt\.length != rawPrompt\.length\)/);
assert.match(nativeInferenceEngine, /\.put\("defaultCpuFallbackAllowed", DEFAULT_ALLOW_CPU_FALLBACK\)/);
assert.match(nativeInferenceEngine, /\.put\("defaultCachePolicy", DEFAULT_CACHE_POLICY\)/);
assert.match(nativeInferenceEngine, /\.put\("cpuFallbackAllowed", allowCpuFallback\)/);
assert.match(nativeInferenceEngine, /\.put\("cachePolicy", cachePolicy\)/);
assert.match(nativeInferenceEngine, /backendCandidates\(backendName, memory, allowCpuFallback\)/);
assert.match(nativeInferenceEngine, /disabled by default to avoid Android low-memory kills/);
assert.match(nativeInferenceEngine, /speculativeDecodingCandidates\(preference: Boolean\?\): List<Boolean>/);
assert.match(nativeInferenceEngine, /ExperimentalFlags\.enableSpeculativeDecoding = enableSpeculativeDecoding/);
assert.match(nativeInferenceEngine, /decodingModeName\(speculativeDecodingEnabled\)/);
assert.match(nativeInferenceEngine, /failures\.add\("\$candidateBackendName: \$\{decodingModeName\(speculativeDecodingEnabled\)\}: /);
assert.match(nativeInferenceEngine, /requestedSpeculativeDecoding = false/);
assert.match(nativeInferenceEngine, /retry_standard/);
assert.match(nativeInferenceEngine, /LOCAL_MODEL_BUSY/);
assert.match(nativeInferenceEngine, /LocalGemmaOperationAdmission/);
assert.match(nativeInferenceEngine, /LocalGemmaGenerationAdmissionResult/);
assert.match(nativeInferenceEngine, /LOCAL_MODEL_DEVICE_MEMORY_LOW/);
assert.match(nativeInferenceEngine, /releaseEngine\(clearLastError = false\)/);
assert.match(nativeInferenceEngine, /keepEngineWarm/);
assert.match(nativeInferenceEngine, /retry_cpu/);
assert.match(nativeInferenceEngine, /generationRetries/);
assert.match(nativeInferenceEngine, /shouldRetryGenerationOnCpu/);
assert.match(nativeInferenceEngine, /SupervisorJob\(job\)/);
assert.match(nativeInferenceEngine, /maxNumTokens = contextTokens/);
assert.match(nativeInferenceEngine, /\.put\("engineSpeculativeDecoding", state\?\.speculativeDecodingEnabled \?: JSONObject\.NULL\)/);
assert.match(nativeInferenceEngine, /\.put\("engineCachePolicy", state\?\.cachePolicy \?: JSONObject\.NULL\)/);
assert.match(nativeInferenceEngine, /state\.modelRevision == modelRevision/);
assert.match(nativeInferenceEngine, /state\.speculativeDecodingEnabled == speculativeDecodingPreference/);
assert.match(nativeInferenceEngine, /state\.cachePolicy == cachePolicy/);
assert.match(nativeInferenceEngine, /val previousEngine = lockedCurrent\?\.engine/);
assert.match(nativeInferenceEngine, /DEFAULT_BACKEND = "auto"/);
assert.match(nativeInferenceEngine, /backendCandidates\(backendName, memory, allowCpuFallback\)/);
assert.match(nativeInferenceEngine, /reusableBackendsFor\(backendName, candidateBackends\)/);
assert.match(nativeInferenceEngine, /listOf\(candidateBackendName\)/);
assert.match(nativeInferenceEngine, /var engine: Engine\? = null/);
assert.match(nativeInferenceEngine, /configureExperimentalFlags\(speculativeDecodingEnabled\)/);
assert.match(nativeInferenceEngine, /val initializedEngine = Engine\(/);
assert.match(nativeInferenceEngine, /EngineState\(modelPath, modelRevision, candidateBackendName, speculativeDecodingEnabled, cachePolicy, contextTokens, initializedEngine\)/);
assert.match(nativeInferenceEngine, /cacheDirFor\(context, modelRevision, candidateBackendName, speculativeDecodingEnabled, contextTokens, cachePolicy\)/);
assert.match(nativeInferenceEngine, /if \(cachePolicy == "none"\) return LITERT_NO_CACHE_DIR/);
assert.match(nativeInferenceEngine, /\.put\("requestedBackend", active\.backend\)/);
assert.match(nativeInferenceEngine, /\.put\("lastEngineError", lastEngineError \?: JSONObject\.NULL\)/);
assert.match(nativeInferenceEngine, /fun releaseWarmEngine\(\)/);
assert.match(nativeInferenceEngine, /if \(operationAdmission\.hasActiveOperation\(\)\) return/);
const generateBody = nativeInferenceEngine.slice(
  nativeInferenceEngine.indexOf("fun generate(context: Context"),
  nativeInferenceEngine.indexOf("\n    fun validate("),
);
assert.ok(generateBody.indexOf("registerActiveRequest(active)") < generateBody.indexOf("WakeWordService.pauseForLocalInference()"));
const validateBody = nativeInferenceEngine.slice(
  nativeInferenceEngine.indexOf("fun validate(context: Context"),
  nativeInferenceEngine.indexOf("\n    fun cancel("),
);
assert.ok(validateBody.indexOf("operationAdmission.tryAcquireValidation()") < validateBody.indexOf("WakeWordService.pauseForLocalInference()"));
assert.match(nativeInferenceEngine, /if \(!keepEngineWarm \|\| !generationSucceeded\)/);
assert.match(nativeInferenceEngine, /hasReachedCompletionLimit\(chunks, maxCompletionTokens\)/);
assert.match(nativeInferenceEngine, /finishReason/);
assert.match(nativeModelManager, /\.put\("keepEngineWarm", false\)/);
assert.equal(nativeInferenceEngine.replace(/\r\n/g, "\n"), pluginInferenceEngine.replace(/\r\n/g, "\n"));

console.log("OK: Android app imports local Gemma and native ops read it with bundled LiteRT-LM generation");
