import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../..");

function read(relPath: string): string {
  return readFileSync(path.join(root, relPath), "utf8");
}

const insights = read("app/(tabs)/insights.tsx");
const appLayout = read("app/_layout.tsx");
const localVoiceLoop = read("shared/localVoiceLoop.ts");
const channelRoutes = read("server/channels/routes.ts");

assert.match(
  localVoiceLoop,
  /LOCAL_VOICE_TURN_END_SILENCE_MS\s*=\s*5_000/,
  "Local voice should submit after about five seconds of user silence",
);

assert.match(
  localVoiceLoop,
  /LOCAL_VOICE_IDLE_PAUSE_MS\s*=\s*60_000/,
  "Local voice should keep listening for about sixty seconds after a reply",
);

assert.match(
  insights,
  /setInput\(transcriptText\);[\s\S]*?sendMessageRef\.current\(transcriptText,/,
  "Talk Mode transcripts should pass through the normal composer and canonical send path",
);

assert.match(
  insights,
  /sendMessageRef\.current\(messageText,[\s\S]*?'Chat mic transcript auto-sent'/,
  "The regular chat mic should submit a voice turn instead of only filling the composer",
);

assert.match(
  insights,
  /const draftText = inputRef\.current\.trim\(\);[\s\S]*?const messageText = draftText \? `\$\{draftText\} \$\{transcriptText\}` : transcriptText;[\s\S]*?sendMessageRef\.current\(messageText,/,
  "The regular chat mic should preserve typed drafts when it auto-sends a transcript",
);

assert.match(
  insights,
  /if \(isStreamingRef\.current\) \{[\s\S]*?setInput\(messageText\);[\s\S]*?return;[\s\S]*?\}[\s\S]*?sendMessageRef\.current\(messageText,/,
  "The regular chat mic should preserve transcripts in the composer while a response is streaming",
);

assert.match(
  appLayout,
  /host === 'insights' \|\| path === 'insights'[\s\S]*?router\.push\('\/\(tabs\)\/insights' as any\)/,
  "Outside-app voice overlay deep links should reopen the JARVIS chat tab",
);

assert.match(
  insights,
  /FileSystem\.deleteAsync\(uri,\s*\{\s*idempotent:\s*true\s*\}\)/,
  "Native voice audio files should be deleted after transcription",
);

assert.match(
  insights,
  /new SpeakableResponseSegmenter\(assistantId\)[\s\S]*?speakTextRef\.current\(chunk\.spokenText, assistantId/,
  "Canonical response chunks should keep the same chat message id",
);

assert.match(
  insights,
  /speakTextRef\.current\(assistantText,\s*assistantId\)/,
  "Voice diagnostic replies should be spoken with the same chat message id",
);

assert.match(
  insights,
  /if\s*\(shouldResumeTalkMode\)\s*\{\s*markAssistantSpeechStopped\(speakingAssistantIdRef\.current \?\? streamingSpeechRef\.current\?\.assistantId\);/,
  "Only Talk Mode interruptions should mark the assistant message as stopped",
);

assert.match(
  insights,
  /markAssistantSpeechStopped[\s\S]*?stopped:\s*true/,
  "Interrupting speech should mark the assistant message as stopped",
);

assert.match(
  insights,
  /onPress=\{isSpeaking\s*\?\s*interruptSpeakingAndListen\s*:/,
  "The mic control should interrupt speech before listening again",
);

assert.match(
  insights,
  /if\s*\(next && !isRecordingRef\.current && !isSpeakingRef\.current && !isStreamingRef\.current && !isTranscribing\)\s*\{[\s\S]*?startRecordingRef\.current\(\)/,
  "Enabling Talk Mode should start the in-app voice loop without requiring a second mic tap",
);

assert.match(
  insights,
  /isStreamingRef\.current = isStreaming;[\s\S]*?isStreamingRef\.current\) return;[\s\S]*?startRecordingRef\.current\(\)/,
  "Talk Mode should not start recording while an assistant response is still streaming",
);

assert.match(
  insights,
  /talkModeStartSeqRef\.current \+= 1;[\s\S]*?const startSeq = talkModeStartSeqRef\.current;[\s\S]*?!talkModeRef\.current \|\| talkModeStartSeqRef\.current !== startSeq/,
  "Queued Talk Mode mic starts should be canceled if Talk Mode is disabled before the timeout fires",
);

assert.match(
  insights,
  /Cleanup on blur: cancel queued Talk Mode starts[\s\S]*?return \(\) => \{[\s\S]*?talkModeStartSeqRef\.current \+= 1;[\s\S]*?stopRecordingSilentlyRef\.current\(\)/,
  "Leaving the JARVIS tab should cancel pending Talk Mode starts and stop active capture",
);

assert.match(
  insights,
  /const shouldCancelTalkModeStart = \(\) =>[\s\S]*?talkModeStartSeqRef\.current !== talkModeStartSeq[\s\S]*?isStreamingRef\.current[\s\S]*?isSpeakingRef\.current[\s\S]*?isTranscribingRef\.current[\s\S]*?if \(shouldCancelTalkModeStart\(\)\)/,
  "Async Talk Mode recorder setup should recheck cancellation and busy state before opening the mic",
);

assert.match(
  insights,
  /onPress=\{interruptSpeakingAndListen\}/,
  "The speaking stop control should interrupt and return to listening",
);

assert.match(
  insights,
  /if\s*\(isSpeakingRef\.current && speakingTextRef\.current === text\)\s*\{\s*if\s*\(talkModeRef\.current\)\s*\{\s*interruptSpeakingAndListen\(\);/,
  "The assistant bubble speaker stop should also use Talk Mode interrupt behavior",
);

assert.match(
  insights,
  /if\s*\(typeof status\.metering !== 'number'\)\s*\{\s*return;\s*\}/,
  "Native Talk Mode should skip missing metering samples instead of treating them as silence",
);

assert.match(
  insights,
  /createLocalVoiceContinuationState\(\)[\s\S]*?recognizeAndroidSpeechOnce\([\s\S]*?onEvent:[\s\S]*?event\.type === 'speech_start' \|\| event\.type === 'partial'/,
  "Android Talk Mode should reopen the recognizer and keep it open when continuation speech begins",
);

assert.match(
  insights,
  /recognizeAndroidSpeechOnce\(\{[\s\S]*?locale: 'en-US'/,
  "Android Talk Mode should explicitly use its supported English locale",
);

assert.match(
  insights,
  /addLocalVoiceTranscriptSegment\(continuationState, result\.text,[\s\S]*?submitVoiceTranscript\(continuationState\.transcript\)/,
  "Android Talk Mode should stitch recognition segments before submitting one canonical transcript",
);

assert.match(
  insights,
  /nativeSpeechManualFinishRef\.current = true;[\s\S]*?stopAndroidNativeSpeechRecognition\(\)/,
  "Manual Android mic stop should finish the current transcript without opening another continuation window",
);

assert.match(
  insights,
  /startStreamingSpeechResponse\(assistantId,[\s\S]*?appendStreamingSpeech\(assistantId, parsed\.content\)[\s\S]*?finishStreamingSpeech\(assistantId\)/,
  "Talk Mode should feed canonical response deltas to speech before the response completes",
);

assert.match(
  insights,
  /providerOnly: true[\s\S]*?nativeOnly: true/,
  "Streaming speech should fall back once to Android native TTS",
);

assert.match(insights, /providerInterruptionPending = true;[\s\S]*?!providerInterruptionPending/);
assert.match(insights, /catch \(error\) \{[\s\S]*?providerInterruptionPending = false;[\s\S]*?soundRef\.current\?\.play\(\)/);
assert.match(insights, /const interruptSpeakingAndListen[\s\S]*?if \(isStreamingRef\.current\)[\s\S]*?abortActiveChatTurn\(\)[\s\S]*?finally[\s\S]*?scheduleTalkModeRecordingStart\(\)/);
assert.match(insights, /action === 'pause'[\s\S]*?markAssistantSpeechStopped\(speakingAssistantIdRef\.current \?\? streamingSpeechRef\.current\?\.assistantId\)[\s\S]*?abortActiveChatTurn\(\)/);
assert.match(insights, /action === 'end'[\s\S]*?markAssistantSpeechStopped\(speakingAssistantIdRef\.current \?\? streamingSpeechRef\.current\?\.assistantId\)[\s\S]*?abortActiveChatTurn\(\)/);
assert.match(insights, /parsed\.type === 'aborted'[\s\S]*?markAssistantSpeechStopped\(assistantId\)[\s\S]*?cancelStreamingSpeech\(assistantId\)/);
assert.match(insights, /firstAudioDelayMs = Math\.max\(0, \(startAt - audioCtx\.currentTime\) \* 1000\)[\s\S]*?audioCtx\.state === 'running'[\s\S]*?options\.onFirstAudio/);
assert.match(insights, /if \(!options\.suppressAutoListen\)[\s\S]*?\/api\/voice\/tts-done/);
assert.match(insights, /response\.queue\.settled\(\)\.then[\s\S]*?streamingSpeechRef\.current = null;[\s\S]*?\/api\/voice\/tts-done/);
assert.match(insights, /activeSpeech\?\.assistantId === assistantId[\s\S]*?prev\[idx\]\.heardAssistantText \?\? prev\[idx\]\.content/);

assert.match(channelRoutes, /\/api\/voice\/metrics[\s\S]*?first_audio_ms[\s\S]*?interruption_ms/);
assert.match(channelRoutes, /\^\[a-z0-9_:-\]\{1,48\}\$\/i\.test\(requestedRoute\)/);
assert.doesNotMatch(channelRoutes, /\[voice-metric\][^\n]*(?:text|content|transcript)=/);

console.log("OK: in-app local voice loop wiring keeps chat, TTS, cleanup, and interrupt behavior aligned");
