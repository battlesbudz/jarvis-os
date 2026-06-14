import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runCodexVoiceTurn, CodexVoiceTurnError, detectVoiceTurnAudioFormat } from "../../voiceCodexTurn";

async function main() {
  assert.equal(detectVoiceTurnAudioFormat("audio/webm;codecs=opus"), "webm");
  assert.equal(detectVoiceTurnAudioFormat("audio/wav"), "wav");
  assert.equal(detectVoiceTurnAudioFormat(undefined), "wav");
  console.log("OK: voice turn audio format detection is local and deterministic");

{
  const calls: Array<Record<string, unknown>> = [];
  const result = await runCodexVoiceTurn(
    {
      userId: "user-voice",
      text: "Can you help me plan today?",
      sdkSessionId: "voice-session-1",
    },
    {
      isWorkerOnline: () => false,
      queueAudioTranscriptionJob: async () => {
        throw new Error("worker should not be used for text turns");
      },
      runCoachAgent: async (input) => {
        calls.push(input as unknown as Record<string, unknown>);
        return {
          reply: "Start with the compliance checklist, then update the tracking system.",
          rawReply: "Start with the compliance checklist, then update the tracking system.",
          attachments: [],
          sdkSessionId: "voice-session-2",
        };
      },
    },
  );

  assert.equal(result.transcript, "Can you help me plan today?");
  assert.equal(result.reply, "Start with the compliance checklist, then update the tracking system.");
  assert.equal(result.sdkSessionId, "voice-session-2");
  assert.equal(result.audioOutput, "device");
  assert.deepEqual(calls, [
    {
      userId: "user-voice",
      userText: "Can you help me plan today?",
      channelName: "Voice",
      sdkSessionId: "voice-session-1",
    },
  ]);
}
console.log("OK: text voice turns route through the Codex OAuth coach path");

{
  const result = await runCodexVoiceTurn(
    {
      userId: "user-voice",
      audioBase64: Buffer.from("fake wav").toString("base64"),
      mimeType: "audio/wav",
    },
    {
      isWorkerOnline: () => true,
      queueAudioTranscriptionJob: async (_userId, _audio, format) => {
        assert.equal(format, "wav");
        return [{ text: "Send a quick email to Sam.", offset: 0, duration: 0 }];
      },
      runCoachAgent: async (input) => ({
        reply: `Heard: ${input.userText}`,
        rawReply: `Heard: ${input.userText}`,
        attachments: [],
        sdkSessionId: "voice-session-audio",
      }),
    },
  );

  assert.equal(result.transcript, "Send a quick email to Sam.");
  assert.equal(result.reply, "Heard: Send a quick email to Sam.");
  assert.equal(result.sdkSessionId, "voice-session-audio");
}
console.log("OK: audio voice turns transcribe locally before Codex OAuth coach routing");

{
  await assert.rejects(
    () =>
      runCodexVoiceTurn(
        {
          userId: "user-voice",
          audioBase64: Buffer.from("fake wav").toString("base64"),
          mimeType: "audio/wav",
        },
        {
          isWorkerOnline: () => false,
          queueAudioTranscriptionJob: async () => [],
          runCoachAgent: async () => ({
            reply: "should not run",
            rawReply: "should not run",
            attachments: [],
          }),
        },
      ),
    (error) => {
      assert.ok(error instanceof CodexVoiceTurnError);
      assert.equal(error.code, "LOCAL_AUDIO_TRANSCRIPTION_UNAVAILABLE");
      assert.equal(error.status, 503);
      return true;
    },
  );
}
  console.log("OK: audio voice turns refuse direct model fallback when local transcription is unavailable");

  const voiceScreen = readFileSync(path.join(process.cwd(), "app/voice-realtime.tsx"), "utf-8");
  assert.ok(voiceScreen.includes("/api/voice/codex-turn"), "voice screen should call the Codex turn endpoint");
  assert.equal(voiceScreen.includes("api.openai.com/v1/realtime"), false, "voice screen must not call OpenAI Realtime directly");
  assert.equal(voiceScreen.includes("/api/voice/realtime-session"), false, "voice screen must not request OpenAI Realtime sessions");
  assert.equal(voiceScreen.includes("/api/voice/relay-ticket"), false, "voice screen must not request OpenAI relay tickets");
  console.log("OK: voice screen uses Codex turn API instead of OpenAI Realtime");

  console.log("\nAll Codex voice turn assertions passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
