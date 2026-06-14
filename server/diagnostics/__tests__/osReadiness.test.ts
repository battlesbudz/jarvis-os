import assert from "node:assert/strict";
import {
  classifyJarvisOsReadiness,
  formatJarvisOsReadiness,
  type JarvisOsProbe,
} from "../osReadiness";

const healthyProbe = (id: string, requiredFor: JarvisOsProbe["requiredFor"] = "core"): JarvisOsProbe => ({
  id,
  label: id,
  status: "healthy",
  requiredFor,
  message: `${id} is healthy`,
});

const degradedProbe = (id: string, requiredFor: JarvisOsProbe["requiredFor"]): JarvisOsProbe => ({
  id,
  label: id,
  status: "degraded",
  requiredFor,
  message: `${id} is degraded`,
  fix: `Fix ${id}`,
});

const downProbe = (id: string, requiredFor: JarvisOsProbe["requiredFor"]): JarvisOsProbe => ({
  id,
  label: id,
  status: "down",
  requiredFor,
  message: `${id} is down`,
  fix: `Fix ${id}`,
});

{
  const report = classifyJarvisOsReadiness([
    healthyProbe("database", "core"),
    healthyProbe("agent_harness", "agent_loop"),
    healthyProbe("job_queue", "background_jobs"),
  ]);

  assert.equal(report.overallStatus, "ready");
  assert.equal(report.canStartServer, true);
  assert.equal(report.canRunAgentLoop, true);
  assert.equal(report.canRunBackgroundJobs, true);
  assert.equal(report.blockers.length, 0);
}

{
  const report = classifyJarvisOsReadiness([
    downProbe("database", "core"),
    healthyProbe("agent_harness", "agent_loop"),
    healthyProbe("job_queue", "background_jobs"),
  ]);

  assert.equal(report.overallStatus, "blocked");
  assert.equal(report.canStartServer, false);
  assert.equal(report.canRunAgentLoop, false);
  assert.equal(report.blockers[0].id, "database");
}

{
  const report = classifyJarvisOsReadiness([
    healthyProbe("database", "core"),
    healthyProbe("agent_harness", "agent_loop"),
    downProbe("telegram", "channel"),
  ]);

  assert.equal(report.overallStatus, "limited");
  assert.equal(report.canStartServer, true);
  assert.equal(report.canRunAgentLoop, true);
  assert.equal(report.canUseExternalChannels, false);
}

{
  const report = classifyJarvisOsReadiness([
    healthyProbe("database", "core"),
    healthyProbe("agent_harness", "agent_loop"),
    degradedProbe("job_queue", "background_jobs"),
  ]);

  assert.equal(report.overallStatus, "limited");
  assert.equal(report.canRunBackgroundJobs, false);
  assert.equal(report.warnings[0].id, "job_queue");
}

{
  const report = classifyJarvisOsReadiness([
    downProbe("openai", "agent_loop"),
    healthyProbe("database", "core"),
    healthyProbe("job_queue", "background_jobs"),
  ]);
  const text = formatJarvisOsReadiness(report);

  assert.match(text, /Jarvis OS readiness: blocked/i);
  assert.match(text, /Fix openai/i);
}

console.log("All Jarvis OS readiness assertions passed.");
