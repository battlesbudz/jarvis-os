import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const soulSource = fs.readFileSync(path.resolve(repoRoot, "server/memory/soul.ts"), "utf8");
const brainAdapterSource = fs.readFileSync(path.resolve(repoRoot, "server/brain/adapter.ts"), "utf8");
const vaultWriterSource = fs.readFileSync(path.resolve(repoRoot, "server/memory/vaultWriter.ts"), "utf8");
const extractorSource = fs.readFileSync(path.resolve(repoRoot, "server/memory/extractor.ts"), "utf8");
const retrieveSource = fs.readFileSync(path.resolve(repoRoot, "server/memory/retrieve.ts"), "utf8");
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
const restrictedPromptReaderSources = [
  "server/routes.ts",
  "server/curiosityScanner.ts",
  "server/heartbeat.ts",
  "server/voiceRelayRoutes.ts",
  "server/memory/dream.ts",
  "server/memory/soul.ts",
  "server/memory/vaultWriter.ts",
  "server/agent/tools/memorySearch.ts",
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

const voiceRelaySource = runtimeContextSources.find((entry) => entry.file === "server/voiceRelayRoutes.ts")?.source ?? "";
assert.match(
  voiceRelaySource,
  /COALESCE\(\$\{userMemories\.sensitivity\}, 'normal'\) = 'normal'[\s\S]*userMemories\.sourceType[\s\S]*NOT SIMILAR TO[\s\S]*userMemories\.sourceRef[\s\S]*NOT SIMILAR TO/,
  "Voice relay prompt context should exclude restricted user memories",
);

assert.match(
  vaultWriterSource,
  /approvedNonRestrictedMemoryClauses[\s\S]*COALESCE\(\$\{schema\.userMemories\.sensitivity\}, 'normal'\) = 'normal'[\s\S]*schema\.userMemories\.sourceType[\s\S]*NOT SIMILAR TO[\s\S]*schema\.userMemories\.sourceRef[\s\S]*NOT SIMILAR TO/,
  "Knowledge vault source builders should exclude restricted user memories",
);

for (const { file, source } of restrictedPromptReaderSources) {
  assert.match(
    source,
    /COALESCE\(\$\{(?:schema\.)?userMemories\.sensitivity\}, 'normal'\) = 'normal'|COALESCE\(sensitivity, 'normal'\) = 'normal'|filterRawRestrictedMemoryRows|containsRawRestrictedContent/,
    `${file} should exclude restricted user memories from prompt-facing direct reads`,
  );
}

for (const { file, source } of restrictedPromptReaderSources) {
  assert.match(
    source,
    /containsRawRestrictedContent|filterRawRestrictedMemoryRows/,
    `${file} should exclude legacy raw restricted content before prompt/tool output`,
  );
}

assert.match(
  retrieveSource,
  /isRestrictedRetrievedMemory[\s\S]*containsRawRestrictedContent\(memory\.content\)/,
  "Memory retrieval should treat legacy raw restricted content as restricted even when metadata is normal",
);

assert.match(
  extractorSource,
  /planMemoryWrite\([\s\S]*sensitivity: record\.sensitivity[\s\S]*provenance: record\.provenance/,
  "Conversation extraction should route writes through the restricted memory write planner",
);

assert.match(
  extractorSource,
  /containsRawRestrictedContent\(source\)[\s\S]*skipped vault source ingest[\s\S]*ingestSource\(userId, source, sourceType\)/,
  "Conversation extraction should not pass restricted raw rich sources into vault ingest",
);

assert.match(
  extractorSource,
  /containsRawRestrictedContent\(source\)[\s\S]*isRestrictedExtractionSource\(sourceType\)[\s\S]*isRestrictedExtractionSource\(sourceRef\)[\s\S]*return \[\][\s\S]*source\.slice\(0, 1800\)/,
  "Conversation extraction should reject restricted source text before building model extraction prompts",
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
