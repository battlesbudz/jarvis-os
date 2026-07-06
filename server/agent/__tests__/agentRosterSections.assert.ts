import assert from "node:assert/strict";

import { buildRosterSections, isActiveAgentJobStatus } from "../../../lib/agents/rosterSections";

const agents = [
  {
    name: "JARVIS",
    isCoreAgent: true,
    isActive: 1,
    status: "online",
  },
];

const tasks = [
  { id: "queued-1", status: "queued" },
  { id: "running-1", status: "running" },
  { id: "paused-1", status: "resource_paused" },
  { id: "complete-1", status: "complete" },
];

const sections = buildRosterSections(agents, tasks);

assert.equal(isActiveAgentJobStatus("resource_paused"), true);
assert.deepEqual(
  sections.runningJobs.map((task) => task.id),
  ["queued-1", "running-1", "paused-1"],
);
assert.deepEqual(
  sections.recentJobs.map((task) => task.id),
  ["complete-1"],
);

console.log("OK: agent roster treats resource-paused jobs as active work");
