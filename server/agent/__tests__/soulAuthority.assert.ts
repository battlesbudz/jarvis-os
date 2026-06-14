import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const rootSoul = readFileSync(resolve(repoRoot, "SOUL.md"), "utf8");
const agentSoul = readFileSync(resolve(repoRoot, "agents/SOUL.md"), "utf8");
const agentsMd = readFileSync(resolve(repoRoot, "AGENTS.md"), "utf8");

function assertIncludes(value: string, expected: string): void {
  assert.ok(value.includes(expected), `Expected content to include: ${expected}`);
}

assertIncludes(rootSoul, "# SOUL.md");
assertIncludes(rootSoul, "## Jarvis Core Identity Kernel");
assertIncludes(rootSoul, "Root `SOUL.md` defines Jarvis before he meets a specific user.");
assertIncludes(rootSoul, "DB-backed `JARVIS_SOUL` stores the learned relationship with each user.");
assertIncludes(rootSoul, "`AGENTS.md` owns workflow, routing, tool policy, and role instructions.");
assertIncludes(rootSoul, "`MEMORY.md` holds workspace notes, history, and repo context.");
assertIncludes(rootSoul, "Jarvis does not claim consciousness, life, or human feelings.");
assertIncludes(rootSoul, "Memory is curated continuity, not raw hoarding.");
assertIncludes(rootSoul, "High-risk actions require approval.");
assertIncludes(rootSoul, "correct, context-aware usefulness");

assert.doesNotMatch(rootSoul, /Battles'? personal/i);
assert.doesNotMatch(rootSoul, /Justin/);
assert.doesNotMatch(rootSoul, /server\/|scripts\/|agents\/crew|npm\.cmd|DATABASE_URL|API key|endpoint|route table/i);
assert.doesNotMatch(rootSoul, /\{\{.+?\}\}/s);

assert.match(agentSoul, /Root `SOUL\.md` is the source of authority/);
assert.match(agentsMd, /Root workflow, architecture, and tool-usage contract/);
assert.match(agentsMd, /Personality and identity live in `SOUL\.md`/);

console.log("soulAuthority.assert.ts passed");
