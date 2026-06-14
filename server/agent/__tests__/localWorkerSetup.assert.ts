import assert from "node:assert/strict";
import { _resetForTests } from "../../lib/localWorkerQueue";
import { buildLocalWorkerTelegramSetupMessage } from "../../localWorkerSetup";

async function main(): Promise<void> {
  _resetForTests();

  const message = buildLocalWorkerTelegramSetupMessage("user_local_worker_setup", "https://jarvis.example.com");

  assert.match(message, /Voice transcription worker: OFFLINE/);
  assert.match(message, /PowerShell/);
  assert.match(message, /\$env:TOKEN="lw_user_loc_/);
  assert.match(message, /\$env:SERVER="https:\/\/jarvis\.example\.com"/);
  assert.match(message, /node scripts\\jarvis-local-worker\.js/);
  assert.match(message, /set TOKEN=lw_user_loc_/);
  assert.match(message, /set SERVER=https:\/\/jarvis\.example\.com/);

  _resetForTests();
  console.log("localWorkerSetup assertions passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
