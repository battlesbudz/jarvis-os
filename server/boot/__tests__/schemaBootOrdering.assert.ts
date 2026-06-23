import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.resolve("server/db.ts"), "utf8");

function assertOrdered(before: string, after: string) {
  const beforeIndex = source.indexOf(before);
  const afterIndex = source.indexOf(after);

  assert.notEqual(beforeIndex, -1, `Missing expected schema boot step: ${before}`);
  assert.notEqual(afterIndex, -1, `Missing expected schema boot step: ${after}`);
  assert(
    beforeIndex < afterIndex,
    `Schema boot step must run before dependent step: ${before} before ${after}`,
  );
}

assertOrdered(
  "CREATE TABLE IF NOT EXISTS weekly_insights",
  "CREATE UNIQUE INDEX IF NOT EXISTS weekly_insights_user_week_idx",
);
assertOrdered(
  "CREATE TABLE IF NOT EXISTS knowledge_vault_pages",
  "ALTER TABLE knowledge_vault_pages ADD COLUMN IF NOT EXISTS page_type",
);
assertOrdered(
  "CREATE TABLE IF NOT EXISTS agent_chat_sessions",
  "CREATE TABLE IF NOT EXISTS agent_chat_session_summaries",
);
assert(
  source.includes('code === "42703"') &&
    source.includes('message.includes("column \\"embedding_vector\\"")'),
  "Optional pgvector fallback must tolerate missing embedding_vector after vector column creation is skipped",
);

console.log("OK: schema boot creates tables before dependent repairs");
