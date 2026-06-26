import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const soulSource = fs.readFileSync(path.resolve(repoRoot, "server/memory/soul.ts"), "utf8");
const brainAdapterSource = fs.readFileSync(path.resolve(repoRoot, "server/brain/adapter.ts"), "utf8");
const runtimeContextSources = [
  "server/routes.ts",
  "server/curiosityScanner.ts",
  "server/heartbeat.ts",
  "server/voiceRelayRoutes.ts",
  "server/intelligence/gut.ts",
  "server/memory/dream.ts",
].map((file) => ({
  file,
  source: fs.readFileSync(path.resolve(repoRoot, file), "utf8"),
}));
const dedupeSources = [
  "server/memory/extractor.ts",
  "server/routes/chatgptImportRoutes.ts",
].map((file) => ({
  file,
  source: fs.readFileSync(path.resolve(repoRoot, file), "utf8"),
}));

assert.match(
  soulSource,
  /approvedMemoryLifecycleFilter[\s\S]*reviewStatus\} IN \('active', 'kept', 'edited'\)/,
  "Soul generation should only use active, kept, or edited user memories",
);

assert.match(
  soulSource,
  /approvedMemoryLifecycleFilter[\s\S]*COALESCE\(\$\{schema\.userMemories\.sensitivity\}, 'normal'\) = 'normal'/,
  "Soul generation should not include restricted MemoryOS summaries in model prompt blocks",
);

assert.match(
  soulSource,
  /approvedMemoryLifecycleFilter[\s\S]*sourceType[\s\S]*NOT SIMILAR TO[\s\S]*sourceRef[\s\S]*NOT SIMILAR TO/,
  "Soul generation should not include legacy restricted source_type/source_ref rows",
);

assert.match(
  brainAdapterSource,
  /APPROVED_USER_MEMORY_REVIEW_STATUSES[\s\S]*active[\s\S]*kept[\s\S]*edited[\s\S]*!APPROVED_USER_MEMORY_REVIEW_STATUSES\.has\(memory\.reviewStatus\)/,
  "Brain projection should retire derived pages for non-approved memory lifecycle states instead of projecting them",
);

for (const { file, source } of runtimeContextSources) {
  assert.match(
    source,
    /reviewStatus\} IN \('active', 'kept', 'edited'\)|reviewStatus} IN \('active', 'kept', 'edited'\)|review_status IN \('active', 'kept', 'edited'\)/,
    `${file} should filter raw user-memory context to approved lifecycle states`,
  );
}

for (const { file, source } of dedupeSources) {
  assert.match(
    source,
    /reviewStatus\} NOT IN \('discarded', 'rejected', 'superseded', 'stale', 'archived'\)|reviewStatus} NOT IN \('discarded', 'rejected', 'superseded', 'stale', 'archived'\)/,
    `${file} should dedupe against active and pending memories while excluding terminal lifecycle states`,
  );
}

console.log("OK: derived context filters exclude non-approved memory lifecycle states");
