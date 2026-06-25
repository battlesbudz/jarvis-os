import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = process.cwd();

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

function assertAbsent(source: string, forbidden: string[], label: string): void {
  for (const text of forbidden) {
    assert.equal(
      source.includes(text),
      false,
      `${label} should not expose legacy copy: ${text}`,
    );
  }
}

const insights = read("app/(tabs)/insights.tsx");
assertAbsent(insights, [
  "GamePlan Coach",
  "GAMEPLAN COACH",
  "Your AI Coach",
  "Message your coach",
  "<Text style={styles.headerTitle}>Coach</Text>",
  "label: 'Drill'",
  "label: 'Mentor'",
  "label: 'Strategist'",
], "Jarvis chat surface");
assert.match(insights, /<Text style=\{styles\.headerTitle\}>JARVIS<\/Text>/);
assert.match(insights, /Message JARVIS/);

const settings = read("app/(tabs)/settings.tsx");
assertAbsent(settings, [
  "Coaching Mode",
  "(['sharp', 'flow', 'mentor', 'drill', 'strategist']",
], "Settings");

const profile = read("app/(tabs)/profile.tsx");
assertAbsent(profile, [
  "Stored coach memory",
  "Tell your coach about you",
  "Coach Memory",
  "Facts your coach has learned",
], "Profile");
assert.match(profile, /MemoryOS/);
assert.match(profile, /JARVIS v1\.0\.0/);

const onboarding = read("app/onboarding.tsx");
assertAbsent(onboarding, [
  "Your coach",
  "your coach",
  "start your GamePlan",
], "Onboarding");

const lifeContextSheet = read("components/LifeContextSheet.tsx");
assertAbsent(lifeContextSheet, [
  "your coach",
], "Life context sheet");

const login = read("app/login.tsx");
assert.match(login, /<Text style=\{styles\.appName\}>JARVIS<\/Text>/);
assert.match(login, /Your personal AI operating layer/);

const skillCatalog = read("server/routes/userSkillsCatalog.ts");
assertAbsent(skillCatalog, [
  "Stoic Coach",
], "Built-in skill catalog");
assert.match(skillCatalog, /Stoic Guide/);

const skillsApp = read("app/skills.tsx");
assert.match(skillsApp, /skill\.isBuiltIn && skill\.name === LEGACY_STOIC_SKILL_NAME/);

const aiContext = read("server/services/aiCoachContextService.ts");
assertAbsent(aiContext, [
  "GamePlan Coach",
  "Your Coaching Style",
  "Drill Sergeant",
  "Wise Mentor",
  "Business Strategist",
  "Flow Coach",
], "AI context prompt defaults");
assert.match(aiContext, /Jarvis Runtime Voice/);

console.log("OK: current user-facing surfaces use JARVIS language instead of legacy Coach/GamePlan modes");
