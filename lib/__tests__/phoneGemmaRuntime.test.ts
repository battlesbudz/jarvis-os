import assert from "node:assert/strict";
import {
  PHONE_GEMMA_RECOMMENDED_PROFILE,
  PHONE_GEMMA_VALIDATION_PROFILES,
  isPhoneGemmaGenerationReady,
  isPhoneGemmaModelFileReady,
  normalizePhoneGemmaStatus,
  phoneGemmaNeedsEngine,
  phoneGemmaProfileOptions,
  phoneGemmaRuntimeDetails,
} from "../phone-gemma-runtime";

const nativeReadyStatus = normalizePhoneGemmaStatus({
  generationReady: true,
  modelFileReady: true,
  engineValidated: true,
  engineValidatedBackend: "gpu",
  engineValidatedDecodingMode: "standard",
  engineValidatedContextTokens: 1024,
  engineValidatedProfileId: "gpu-standard-1024",
  engineValidatedProfileLabel: "GPU standard 1024",
  engineLastValidationProfileId: "cpu-standard-512",
  engineLastValidationProfileLabel: "CPU standard 512",
  engineLastValidationError: "CPU profile failed earlier",
});

assert.equal(nativeReadyStatus?.ready, true);
assert.equal(isPhoneGemmaModelFileReady(nativeReadyStatus), true);
assert.equal(isPhoneGemmaGenerationReady(nativeReadyStatus), true);
assert.equal(nativeReadyStatus?.needsEngineValidation, false);
assert.equal(phoneGemmaNeedsEngine(nativeReadyStatus), false);

assert.equal(
  phoneGemmaRuntimeDetails(nativeReadyStatus),
  "GPU standard 1024 - GPU - standard - 1024 tokens",
);

const diagnosticOnlyStatus = normalizePhoneGemmaStatus({
  modelFileReady: true,
  generationReady: false,
  engineValidated: false,
  engineLastValidationProfileId: "cpu-standard-512",
  engineLastValidationProfileLabel: "CPU standard 512",
  engineLastValidationError: "CPU profile failed earlier",
});

assert.equal(phoneGemmaRuntimeDetails(diagnosticOnlyStatus), null);
assert.equal(phoneGemmaNeedsEngine(diagnosticOnlyStatus), true);

const recommendedOptions = phoneGemmaProfileOptions(PHONE_GEMMA_RECOMMENDED_PROFILE);
assert.equal(recommendedOptions.backend, "gpu");
assert.equal(recommendedOptions.allowCpuFallback, false);
assert.equal(recommendedOptions.profileId, "gpu-standard-1024");

const explicitCpuProfile = PHONE_GEMMA_VALIDATION_PROFILES.find((profile) => profile.id === "cpu-standard-512");
assert.ok(explicitCpuProfile);
const explicitCpuOptions = phoneGemmaProfileOptions(explicitCpuProfile);
assert.equal(explicitCpuOptions.backend, "cpu");
assert.equal(explicitCpuOptions.allowCpuFallback, false);
assert.equal(explicitCpuOptions.profileId, "cpu-standard-512");

console.log("OK: Phone Gemma Runtime honors native readiness and explicit profiles");
