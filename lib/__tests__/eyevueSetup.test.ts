import assert from "node:assert/strict";
import { deriveEyeVueVoiceReadiness, eyeVueAudioEndpointMatches } from "../eyevue-setup";

assert.equal(eyeVueAudioEndpointMatches("eyeVue CYO3", "EYEVUE-CYO3"), true);
assert.equal(eyeVueAudioEndpointMatches("eyeVue CYO3", "Galaxy Buds"), false);
assert.equal(eyeVueAudioEndpointMatches("eyeVue CYO3", null), false);

const missingSpeech = deriveEyeVueVoiceReadiness({
  nativeSpeechAvailable: false,
  speechRecognitionAvailable: false,
  speechMessage: "Microphone permission is required.",
  wearableAudioAvailable: true,
  wearableAudioDeviceName: "eyeVue CYO3",
  eyevueConnected: true,
  eyevueDeviceName: "eyeVue CYO3",
});
assert.equal(missingSpeech.ready, false);
assert.equal(missingSpeech.detail, "Microphone permission is required.");

const wrongHeadset = deriveEyeVueVoiceReadiness({
  nativeSpeechAvailable: true,
  speechRecognitionAvailable: true,
  wakeRecognizerAvailable: true,
  wearableAudioAvailable: true,
  wearableAudioDeviceName: "Galaxy Buds",
  eyevueConnected: true,
  eyevueDeviceName: "eyeVue CYO3",
});
assert.equal(wrongHeadset.ready, false);
assert.match(wrongHeadset.detail, /Galaxy Buds/);
assert.match(wrongHeadset.detail, /eyeVue CYO3/);

const missingAudioEndpoint = deriveEyeVueVoiceReadiness({
  nativeSpeechAvailable: true,
  speechRecognitionAvailable: true,
  wakeRecognizerAvailable: true,
  wearableAudioAvailable: true,
  wearableAudioDeviceName: null,
  eyevueConnected: true,
  eyevueDeviceName: "eyeVue CYO3",
});
assert.equal(missingAudioEndpoint.ready, false);
assert.equal(missingAudioEndpoint.endpointMatches, false);

const ready = deriveEyeVueVoiceReadiness({
  nativeSpeechAvailable: true,
  speechRecognitionAvailable: true,
  wakeRecognizerAvailable: true,
  wearableAudioAvailable: true,
  wearableAudioDeviceName: "eyeVue CYO3",
  eyevueConnected: true,
  eyevueDeviceName: "eyeVue CYO3",
});
assert.equal(ready.ready, true);
assert.equal(ready.endpointMatches, true);
assert.equal(ready.detail, "eyeVue microphone and speaker route ready.");

console.log("OK: eyeVue setup readiness is bound to the actual eyeVue audio endpoint");
