import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const rootSoul = readFileSync(resolve(repoRoot, "SOUL.md"), "utf8");
const agentSoul = readFileSync(resolve(repoRoot, "agents/SOUL.md"), "utf8");
const agentsMd = readFileSync(resolve(repoRoot, "AGENTS.md"), "utf8");

const contentLines = rootSoul
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

assert.ok(contentLines.length <= 10, `SOUL.md should stay tiny, found ${contentLines.length} non-empty lines`);
assert.match(rootSoul, /Battles' personal AI assistant/);
assert.match(rootSoul, /Take good notes/);
assert.doesNotMatch(rootSoul, /Justin/);
assert.doesNotMatch(rootSoul, /Workflow|Tool Policy|Routing|Update Policy/i);

assert.match(agentSoul, /Root `SOUL\.md` is the source of authority/);
assert.match(agentsMd, /workflow and tool-usage index/);
assert.match(agentsMd, /Personality lives in `SOUL\.md`/);

console.log("soulAuthority.assert.ts passed");
