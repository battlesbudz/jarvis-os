import assert from "node:assert/strict";
import { chunkText } from "../chunk";

assert.deepEqual(chunkText("   "), []);
assert.deepEqual(chunkText("Jarvis remembers approved facts.", 80), [
  "Jarvis remembers approved facts.",
]);

const input = "A sentence about memory. ".repeat(30);
const chunks = chunkText(input, 120);
assert.ok(chunks.length > 1);
assert.ok(chunks.every((chunk) => chunk.length <= 140));

const longUnpunctuated = chunkText("x".repeat(260), 80);
assert.ok(longUnpunctuated.length > 1);
assert.ok(longUnpunctuated.every((chunk) => chunk.length <= 80));

console.log("OK: brain content chunking");
