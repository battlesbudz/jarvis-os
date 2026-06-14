import assert from "node:assert/strict";
import { transcribeTelegramAudio } from "../../telegramVoiceTranscription";

const audioBuffer = Buffer.from("fake audio");

async function main(): Promise<void> {
  const groqFirst = await transcribeTelegramAudio(
    { audioBuffer, format: "ogg", userId: "user_voice_1" },
    {
      getGroqApiKey: () => "gsk_test",
      transcribeWithGroq: async () => "groq transcript",
      isWorkerOnline: () => {
        throw new Error("worker should not be checked after Groq succeeds");
      },
    },
  );
  assert.deepEqual(groqFirst, { ok: true, text: "groq transcript", source: "groq", errors: [] });
  console.log("OK: Groq STT is preferred for Telegram voice notes");

  let workerQueued = false;
  const workerFallback = await transcribeTelegramAudio(
    { audioBuffer, format: "unknown", userId: "user_voice_2" },
    {
      getGroqApiKey: () => "gsk_test",
      transcribeWithGroq: async () => {
        throw new Error("Groq unavailable");
      },
      isWorkerOnline: () => true,
      queueAudioTranscriptionJob: async (_userId, _audio, format) => {
        workerQueued = true;
        assert.equal(format, "ogg");
        return [{ text: "worker transcript", offset: 0, duration: 0 }];
      },
    },
  );
  assert.equal(workerQueued, true);
  assert.equal(workerFallback.ok, true);
  assert.equal(workerFallback.source, "local-worker");
  assert.equal(workerFallback.text, "worker transcript");
  assert.match(workerFallback.errors.join("\n"), /Groq unavailable/);
  console.log("OK: local worker remains fallback when Groq STT fails");

  const directFallback = await transcribeTelegramAudio(
    { audioBuffer, format: "mp3", userId: "user_voice_3" },
    {
      getGroqApiKey: () => undefined,
      isWorkerOnline: () => false,
      isDirectOpenAIDisabled: () => false,
      speechToText: async () => "direct transcript",
    },
  );
  assert.equal(directFallback.ok, true);
  assert.equal(directFallback.source, "openai");
  assert.equal(directFallback.text, "direct transcript");
  console.log("OK: direct OpenAI STT remains compatibility fallback when enabled");

  const unavailable = await transcribeTelegramAudio(
    { audioBuffer, format: "ogg", userId: "user_voice_4" },
    {
      getGroqApiKey: () => undefined,
      isWorkerOnline: () => false,
      isDirectOpenAIDisabled: () => true,
    },
  );
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.failure, "local_worker_required");
  console.log("OK: unavailable transcription returns structured failure");

  console.log("telegramVoiceTranscription assertions passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
