import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const file = path.resolve(process.cwd(), "migrations", "0010_user_memory_vector_index.sql");
const sql = fs.readFileSync(file, "utf8");

assert.match(sql, /CREATE EXTENSION IF NOT EXISTS vector/i);
assert.match(sql, /ALTER TABLE user_memories/i);
assert.match(sql, /embedding_vector vector\(1536\)/i);
assert.match(sql, /embedding::text::vector\(1536\)/i);
assert.match(sql, /CREATE INDEX IF NOT EXISTS user_memories_embedding_vector_idx/i);
assert.match(sql, /review_status IN \('active', 'kept', 'edited'\)/i);

console.log("OK: canonical user memory vector migration is present");
