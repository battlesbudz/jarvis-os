import assert from "node:assert/strict";
import {
  _resetForTests,
  claimNextJob,
  completeJob,
  getOrCreateWorkerToken,
  heartbeat,
  isWorkerOnline,
  queueAudioTranscriptionJob,
  queueTranscriptJob,
} from "../../lib/localWorkerQueue";

async function main(): Promise<void> {
  _resetForTests();

  const userId = "user_local_worker_1";
  const token = getOrCreateWorkerToken(userId);

  assert.equal(isWorkerOnline(userId), false);
  assert.equal(heartbeat(token), true);
  assert.equal(isWorkerOnline(userId), true);
  assert.equal(isWorkerOnline(userId, "audio-transcription"), false);

  const urlJobPromise = queueTranscriptJob(userId, "https://example.com/video", 5_000);
  const urlJob = claimNextJob(token);
  assert.deepEqual(urlJob, {
    id: urlJob?.id,
    type: "url-transcript",
    url: "https://example.com/video",
  });
  assert.equal(completeJob(urlJob!.id, token, [{ text: "caption text", offset: 0, duration: 0 }]), true);
  assert.deepEqual(await urlJobPromise, [{ text: "caption text", offset: 0, duration: 0 }]);
  console.log("OK: legacy local workers still claim URL transcript jobs");

  const audioJobPromise = queueAudioTranscriptionJob(userId, "b2dnLWRhdGE=", "ogg", 5_000);
  assert.equal(claimNextJob(token), null);
  assert.equal(heartbeat(token, ["url-transcript", "audio-transcription"]), true);
  assert.equal(isWorkerOnline(userId, "audio-transcription"), true);

  const audioJob = claimNextJob(token);
  assert.equal(audioJob?.type, "audio-transcription");
  assert.equal(audioJob?.audio, "b2dnLWRhdGE=");
  assert.equal(audioJob?.format, "ogg");
  assert.equal(audioJob?.source, "telegram");
  assert.equal(completeJob(audioJob!.id, token, [{ text: "voice text", offset: 0, duration: 0 }]), true);
  assert.deepEqual(await audioJobPromise, [{ text: "voice text", offset: 0, duration: 0 }]);
  console.log("OK: audio transcription jobs require an audio-capable local worker");

  _resetForTests();
  console.log("\nAll local worker queue assertions passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
