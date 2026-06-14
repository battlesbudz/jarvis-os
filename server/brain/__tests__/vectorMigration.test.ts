import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const file = path.resolve(process.cwd(), "migrations", "0009_brain_vector_index.sql");
const sql = fs.readFileSync(file, "utf8");

assert.match(sql, /CREATE EXTENSION IF NOT EXISTS vector/i);
assert.match(sql, /ALTER TABLE brain_content_chunks/i);
assert.match(sql, /embedding_vector vector\(1536\)/i);

console.log("OK: brain vector migration is present");
