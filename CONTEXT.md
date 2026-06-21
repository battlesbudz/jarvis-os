# Jarvis OS

Jarvis OS is a personal operating layer that connects conversational intent, local device control, memory, and runtime policy across app, server, and daemon surfaces.

## Language

**Phone Gemma Runtime**:
The phone-local Android runtime that owns importing, validating, profiling, and generating with a `.litertlm` Gemma model on the user's device.
_Avoid_: Phone Gemini, Android Local Gemma when referring to the whole runtime, local model when referring to this specific phone-local module.

**Native-First Readiness**:
The rule that Phone Gemma Runtime readiness comes from the Android native runtime because it is closest to the model file, LiteRT-LM engine, memory gate, and active generation state.
_Avoid_: JS-invented readiness, server-guessed readiness.

**Active Phone Gemma Profile**:
The one validated backend and context profile that chat generation is allowed to use for the current model file revision.
_Avoid_: Dynamic chat retries, random profile selection during chat.

**Phone Gemma Diagnostic Attempt**:
A recent validation or generation attempt kept for explaining why a profile failed without making that failed profile eligible for chat generation.
_Avoid_: Treating failed attempts as fallback candidates.

**No Surprise CPU Fallback**:
The rule that Phone Gemma Runtime chat generation never switches from a non-CPU active profile to CPU during a normal message; CPU is used only when a CPU profile has been explicitly validated and made active.
_Avoid_: Background CPU rescue, opportunistic CPU retry during chat.
