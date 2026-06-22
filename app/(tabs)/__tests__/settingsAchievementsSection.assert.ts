import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../../..");
const componentSource = fs.readFileSync(path.join(repoRoot, "components/settings/AchievementsSection.tsx"), "utf8");
const modelSource = fs.readFileSync(path.join(repoRoot, "components/settings/achievementsModel.ts"), "utf8");
const settingsSource = fs.readFileSync(path.join(repoRoot, "app/(tabs)/settings.tsx"), "utf8");

for (const expected of [
  "getLifetimeXp",
  "getLevel(",
  "getLevelName",
  "getXpForNextLevel",
  "getAvailableRewards",
  "ALL_BADGES",
]) {
  assert.ok(modelSource.includes(expected), `achievements model should preserve ${expected} calculation`);
}

assert.ok(
  componentSource.includes("buildAchievementsSectionModel(stats)"),
  "AchievementsSection should render from the extracted achievements model",
);
assert.ok(
  componentSource.includes("onPress={() => onRewardPress(reward)}"),
  "AchievementsSection should preserve reward selection callback behavior",
);
assert.ok(
  settingsSource.includes("<AchievementsSection") &&
    settingsSource.includes("setSelectedReward(reward)") &&
    settingsSource.includes("setRewardModalVisible(true)"),
  "settings screen should preserve reward modal state wiring after extraction",
);

console.log("OK: settings achievements extraction preserves calculation and reward-modal wiring");
