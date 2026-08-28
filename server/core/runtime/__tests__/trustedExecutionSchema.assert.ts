import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("migrations/0022_trusted_execution_authority.sql", "utf8");
const schema = readFileSync("shared/schema.ts", "utf8");
const repository = readFileSync("server/core/runtime/trustedExecutionRepository.ts", "utf8");

for (const table of [
  "trusted_execution_global_controls",
  "trusted_execution_user_controls",
  "standing_execution_grant_heads",
  "standing_execution_grant_versions",
  "execution_authorities",
  "authority_execution_steps",
  "authority_execution_attempts",
  "standing_execution_occurrences",
  "standing_execution_usage_allocations",
  "trusted_execution_audit_events",
]) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));

assert.match(migration, /enabled BOOLEAN NOT NULL DEFAULT FALSE/g, "global and per-user flags must default off");
assert.match(migration, /UNIQUE \(user_id, source_action_kind, source_action_key\)/, "direct and consent actions need stable dedupe");
assert.match(migration, /UNIQUE \(grant_id, trigger_lineage_id, trigger_occurrence_key\)/, "occurrence dedupe must exclude grant version");
assert.match(migration, /UNIQUE \(authority_id, step_key\)/, "every authority step needs stable membership");
assert.match(migration, /UNIQUE \(authority_execution_step_id, lease_generation\)/, "attempts need monotonic fencing generations");
assert.match(migration, /compensation_expires_at >= expires_at/, "recovery deadline cannot precede forward expiry");
assert.match(schema, /default\(false\)/, "Drizzle control flags must default off");
assert.match(repository, /pg_advisory_xact_lock/, "source and standing issuance must serialize dedupe and limit checks");
assert.match(repository, /for\("update"\)/, "consumption and lifecycle changes must share database locks");
assert.match(repository, /boundaryState, "not_started"/, "side-effect boundary must use compare-and-set fencing");

console.log("All Trusted Execution schema and transaction-contract assertions passed.");
