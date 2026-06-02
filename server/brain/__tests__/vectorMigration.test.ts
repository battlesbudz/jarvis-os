import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function main(): void {
  const migration = readFileSync("migrations/0009_brain_vector_index.sql", "utf8");

  assert.match(migration, /CREATE EXTENSION IF NOT EXISTS vector/i);
  assert.match(migration, /embedding_vector vector\(1536\)/i);
  assert.match(migration, /USING ivfflat/i);
  assert.match(migration, /vector_cosine_ops/i);

  console.log("OK: brain vector migration contract");
}

main();
