import assert from "node:assert/strict";
import {
  buildTelegramCoachBatchText,
  cancelTelegramCoachMessageBatches,
  clearTelegramCoachMessageBatchesForTests,
  enqueueTelegramCoachMessageBatch,
} from "../../telegramMessageBatcher";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  clearTelegramCoachMessageBatchesForTests();

  assert.equal(
    buildTelegramCoachBatchText([{ text: "Can you help me send an email?" }]),
    "Can you help me send an email?",
  );
  console.log("OK: single Telegram messages stay unchanged");

  const batches: { userId: string; chatId: string; text: string; imageUrl?: string }[] = [];
  const handler = (batch: { userId: string; chatId: string; text: string; imageUrl?: string }) => {
    batches.push(batch);
  };

  enqueueTelegramCoachMessageBatch(
    { userId: "user-1", chatId: "chat-1", text: "Can you help me send an email?" },
    handler,
    10,
  );
  enqueueTelegramCoachMessageBatch(
    { userId: "user-1", chatId: "chat-1", text: "Actually send it to Sam about tomorrow" },
    handler,
    10,
  );
  await sleep(30);

  assert.equal(batches.length, 1);
  assert.equal(batches[0].userId, "user-1");
  assert.equal(batches[0].chatId, "chat-1");
  assert.match(batches[0].text, /The user sent 2 Telegram messages close together/);
  assert.match(batches[0].text, /1\. Can you help me send an email\?/);
  assert.match(batches[0].text, /2\. Actually send it to Sam about tomorrow/);
  console.log("OK: quick Telegram follow-ups become one context-rich coach turn");

  const separated: string[] = [];
  enqueueTelegramCoachMessageBatch(
    { userId: "user-1", chatId: "chat-1", text: "same chat" },
    (batch) => separated.push(batch.text),
    10,
  );
  enqueueTelegramCoachMessageBatch(
    { userId: "user-1", chatId: "chat-2", text: "different chat" },
    (batch) => separated.push(batch.text),
    10,
  );
  await sleep(30);

  assert.deepEqual(separated.sort(), ["different chat", "same chat"]);
  console.log("OK: different Telegram chats keep separate batches");

  let cancelledFlushCount = 0;
  enqueueTelegramCoachMessageBatch(
    { userId: "user-stop", chatId: "chat-stop", text: "Start something" },
    () => {
      cancelledFlushCount += 1;
    },
    10,
  );
  const cancelled = cancelTelegramCoachMessageBatches("user-stop");
  await sleep(30);

  assert.equal(cancelled, 1);
  assert.equal(cancelledFlushCount, 0);
  console.log("OK: stop can cancel pending Telegram message batches before they flush");

  clearTelegramCoachMessageBatchesForTests();
  console.log("\nAll Telegram message batcher assertions passed.");
}

main().catch((error) => {
  clearTelegramCoachMessageBatchesForTests();
  console.error(error);
  process.exit(1);
});
