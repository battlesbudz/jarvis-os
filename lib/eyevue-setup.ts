export type EyeVueVoiceReadinessInput = {
  nativeSpeechAvailable?: boolean;
  speechRecognitionAvailable?: boolean;
  speechMessage?: string;
  wearableAudioAvailable?: boolean;
  wearableAudioDeviceName?: string | null;
  wearableAudioMessage?: string;
  eyevueConnected?: boolean;
  eyevueDeviceName?: string | null;
};

function normalizeEndpointName(value?: string | null): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

export function eyeVueAudioEndpointMatches(
  eyevueDeviceName?: string | null,
  wearableAudioDeviceName?: string | null,
): boolean {
  const eyevue = normalizeEndpointName(eyevueDeviceName);
  const audio = normalizeEndpointName(wearableAudioDeviceName);
  return eyevue.length > 0 && audio.length > 0 && eyevue === audio;
}

export function deriveEyeVueVoiceReadiness(input: EyeVueVoiceReadinessInput): {
  ready: boolean;
  nativeRecognitionReady: boolean;
  endpointMatches: boolean;
  detail: string;
} {
  // The external wake service uses Android's standard SpeechRecognizer, not
  // the optional API-31 on-device bridge exposed by nativeSpeechAvailable.
  const nativeRecognitionReady = input.speechRecognitionAvailable === true;
  const endpointMatches =
    input.eyevueConnected === true &&
    eyeVueAudioEndpointMatches(input.eyevueDeviceName, input.wearableAudioDeviceName);
  const ready =
    nativeRecognitionReady && input.wearableAudioAvailable === true && endpointMatches;

  if (!nativeRecognitionReady) {
    return {
      ready,
      nativeRecognitionReady,
      endpointMatches,
      detail:
        input.speechMessage ||
        "Native speech recognition must be available before wearable voice can be ready.",
    };
  }
  if (input.wearableAudioAvailable !== true) {
    return {
      ready,
      nativeRecognitionReady,
      endpointMatches,
      detail:
        input.wearableAudioMessage ||
        "Connect eyeVue first, then verify Jarvis can use the glasses microphone and speaker.",
    };
  }
  if (!endpointMatches) {
    const routed = input.wearableAudioDeviceName?.trim() || "another Bluetooth device";
    const eyevue = input.eyevueDeviceName?.trim() || "the connected eyeVue glasses";
    return {
      ready,
      nativeRecognitionReady,
      endpointMatches,
      detail: `Jarvis voice is routed to ${routed}, not ${eyevue}. Select the eyeVue audio device for calls/voice, then verify again.`,
    };
  }
  return {
    ready,
    nativeRecognitionReady,
    endpointMatches,
    detail: "eyeVue microphone and speaker route ready.",
  };
}
