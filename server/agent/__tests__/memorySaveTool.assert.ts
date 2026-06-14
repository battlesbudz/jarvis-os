import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const memoryCapabilitySource = fs.readFileSync(
  path.join(root, "server/capabilities/memoryCapability.ts"),
  "utf8",
);
const toolIndexSource = fs.readFileSync(
  path.join(root, "server/agent/tools/index.ts"),
  "utf8",
);
const memorySearchSource = fs.readFileSync(
  path.join(root, "server/agent/tools/memorySearch.ts"),
  "utf8",
);

assert.ok(
  /memorySaveTool/.test(memoryCapabilitySource),
  "memory capability should expose memory_save",
);

assert.ok(
  /memorySaveTool/.test(toolIndexSource),
  "tool index should export memorySaveTool for compatibility",
);

assert.ok(
  /name:\s*"memory_save"/.test(memorySearchSource),
  "memorySearch tool module should define memory_save",
);

console.log("memory_save tool exposure assertions passed");
