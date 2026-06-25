import assert from "node:assert/strict";

import {
  BUILT_IN_SKILLS,
  canonicalBuiltInSkillName,
  canonicalizeBuiltInSkillRecord,
} from "../../routes/userSkillsCatalog";

const legacyStoicName = ["Stoic", "Coach"].join(" ");

assert.equal(canonicalBuiltInSkillName("Stoic Guide"), "Stoic Guide");
assert.equal(canonicalBuiltInSkillName(legacyStoicName), "Stoic Guide");

const existingBuiltInNames = new Set([legacyStoicName].map(canonicalBuiltInSkillName));
const stoicGuide = BUILT_IN_SKILLS.find((skill) => skill.name === "Stoic Guide");
assert.ok(stoicGuide, "Stoic Guide should stay in the built-in skill catalog");
assert.equal(existingBuiltInNames.has(stoicGuide.name), true);

const legacyBuiltInRecord = canonicalizeBuiltInSkillRecord({
  id: "skill_legacy",
  name: legacyStoicName,
  isBuiltIn: true,
});
assert.equal(legacyBuiltInRecord.name, "Stoic Guide");
assert.equal(legacyBuiltInRecord.id, "skill_legacy");

const customRecord = canonicalizeBuiltInSkillRecord({
  name: legacyStoicName,
  isBuiltIn: false,
});
assert.equal(customRecord.name, legacyStoicName);

console.log("OK: built-in skill aliases prevent duplicate seeding after display-name renames");
