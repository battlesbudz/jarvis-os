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
const localVoiceLoop = read("shared/localVoiceLoop.ts");

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
  /FileSystem\.deleteAsync\(uri,\s*\{\s*idempotent:\s*true\s*\}\)/,
  "Native voice audio files should be deleted after transcription",
);

assert.match(
  insights,
  /speakTextRef\.current\(finalContent,\s*assistantId\)/,
  "The canonical assistant response should be spoken with the same chat message id",
);

assert.match(
  insights,
  /speakTextRef\.current\(assistantText,\s*assistantId\)/,
  "Voice diagnostic replies should be spoken with the same chat message id",
);

assert.match(
  insights,
  /if\s*\(shouldResumeTalkMode\)\s*\{\s*markAssistantSpeechStopped\(speakingAssistantIdRef\.current\);/,
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
  /onPress=\{interruptSpeakingAndListen\}/,
  "The speaking stop control should interrupt and return to listening",
);

assert.match(
  insights,
  /if\s*\(typeof status\.metering !== 'number'\)\s*\{\s*return;\s*\}/,
  "Native Talk Mode should skip missing metering samples instead of treating them as silence",
);

console.log("OK: in-app local voice loop wiring keeps chat, TTS, cleanup, and interrupt behavior aligned");
