import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.resolve(process.cwd(), "server/agent/capabilityGapAnalyzer.ts"),
  "utf8",
);

assert.match(
  source,
  /const MAX_AUTO_BUILDS = 0;/,
  "capability gap analysis must not auto-submit build jobs",
);
assert.match(
  source,
  /if \(MAX_AUTO_BUILDS > 0 && cluster\.riskLevel === 'low' && submitted < MAX_AUTO_BUILDS\)/,
  "legacy build path must stay behind an explicit disabled cap",
);
assert.match(
  source,
  /Queueing non-buildable gap for review[\s\S]*createGapInboxItem\(userId, cluster\)/,
  "non-buildable capability gaps should still become reviewable proposals",
);

console.log("OK: capability gap analyzer queues proposals without auto-building");
