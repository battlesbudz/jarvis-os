import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const coachContextSource = readFileSync(resolve(repoRoot, "server/services/aiCoachContextService.ts"), "utf8");
const appAgentTabSource = readFileSync(resolve(repoRoot, "app/(tabs)/insights.tsx"), "utf8");
const routesSource = readFileSync(resolve(repoRoot, "server/routes.ts"), "utf8");

assert.equal(coachContextSource.includes("## Open Commitments (user said they would do these)"), false);
assert.equal(coachContextSource.includes("Hold the user accountable to what they promised"), false);
assert.equal(routesSource.includes("If they have open commitments, call out specific ones by name"), false);
assert.equal(appAgentTabSource.includes("commitmentsSection:"), false);
assert.equal(appAgentTabSource.includes("commitmentCard:"), false);

console.log("coachPromptClutter.assert.ts passed");
