import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("migrations/0020_live_actions.sql", "utf8");
const schema = fs.readFileSync("shared/schema.ts", "utf8");
const routes = fs.readFileSync("server/routes/liveActionRoutes.ts", "utf8");
const mutationRoutes = fs.readFileSync("server/routes/agentJobMutationRoutes.ts", "utf8");
const cancellation = fs.readFileSync("server/agent/jobCancellation.ts", "utf8");
const requeue = fs.readFileSync("server/agent/jobRequeue.ts", "utf8");
const gateway = fs.readFileSync("server/gateway/controlPlane.ts", "utf8");

assert.match(migration, /CREATE TABLE IF NOT EXISTS "live_actions"/);
assert.match(migration, /live_actions_user_lineage_uidx/);
assert.match(migration, /live_action_events_action_sequence_uidx/);
assert.match(migration, /live_action_events_action_source_uidx/);
assert.match(schema, /export const liveActions = pgTable\("live_actions"/);
assert.match(schema, /export const liveActionEvents = pgTable\("live_action_events"/);
assert.match(routes, /if \(!req\.userId\) return res\.status\(401\)/);
assert.match(routes, /userId: req\.userId/);
assert.doesNotMatch(routes, /req\.body\?\.userId|req\.query\.userId/);
assert.match(mutationRoutes, /delete jobInput\.retryOfJobId/);
assert.match(mutationRoutes, /delete jobInput\.liveActionLineageKey/);
assert.match(mutationRoutes, /pg_advisory_xact_lock/);
assert.match(mutationRoutes, /input->>'retryOfJobId'/);
assert.match(mutationRoutes, /delete input\.resourcePause/);
assert.match(mutationRoutes, /skipDuplicateCheck: true/);
assert.match(cancellation, /agentJobs\.input\} \|\| jsonb_build_object/);
assert.match(requeue, /jsonb_build_object\('requeuedAt'/);
assert.match(gateway, /\.set\(cancellationUpdateForAgentJob\(nextStatus\)\)/);
assert.match(gateway, /delete input\.liveActionLineageKey/);

console.log("Live Action migration and authenticated route ownership assertions passed.");
