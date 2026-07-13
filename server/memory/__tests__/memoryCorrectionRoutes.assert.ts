import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = readFileSync(
  path.resolve(process.cwd(), "server/routes/profileMemoryRoutes.ts"),
  "utf8",
);
const dbSource = readFileSync(path.resolve(process.cwd(), "server/db.ts"), "utf8");
const migrations = [
  "migrations/0017_memory_correction_idempotency.sql",
  "server/migrations/019_memory_correction_idempotency.sql",
].map((migrationPath) => readFileSync(path.resolve(process.cwd(), migrationPath), "utf8"));

assert.match(source, /app\.post\("\/api\/memory\/corrections"/);
assert.match(
  source,
  /recordMemoryCorrection\([\s\S]*operation: currentMemoryId \? "correct_existing_memory" : "propose_new_memory"[\s\S]*channel: "memory-review-api"/,
);
assert.match(
  source,
  /if \(currentMemoryId && !currentMemoryContent\)[\s\S]*currentMemoryContent is required when currentMemoryId is provided/,
);
assert.match(source, /correction\.status === "conflict"[\s\S]*res\.status\(409\)/);
assert.match(source, /res\.status\(correction\.recorded \? 202 : 200\)/);
assert.match(source, /reviewPath: correction\.status === "review_required" \? "\/api\/memory\/pending-review" : null/);
assert.match(source, /SELECT id, content[\s\S]*supersedes_memory_id[\s\S]*review_status = 'pending'/);
for (const sqlSource of [dbSource, ...migrations]) {
  assert.match(sqlSource, /CREATE UNIQUE INDEX IF NOT EXISTS user_memories_runtime_correction_source_uidx/);
  assert.match(sqlSource, /ON user_memories\(user_id, source_type, source_ref\)/);
  assert.match(sqlSource, /source_type = 'runtime_memory_correction'/);
}

console.log("OK: memory correction route queues review-only replacements and exposes supersession metadata");
