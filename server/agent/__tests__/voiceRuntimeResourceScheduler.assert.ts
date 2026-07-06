import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  RESOURCE_PAUSE_REASON,
  RESOURCE_PAUSE_STARTUP_RECOVERY_MS,
  RESOURCE_PAUSED_STATUS,
  buildVoiceRestorePrompt,
  buildVoiceRestoreRecap,
  buildVoiceRuntimeIncidentBundle,
  buildVoiceRuntimeStatusAnswer,
  cancellationStatusForAgentJobStatus,
  isLocalHeavyBackgroundJob,
  resourcePauseMetadata,
  shouldAutoResumeResourcePausedJob,
  shouldRecoverStaleResourcePausedJob,
} from "../voiceRuntimeResourceCore";
import {
  runLocalVoiceRuntimeHarnessTurn,
  ScriptedFakeLocalGemmaProvider,
  type LocalVoiceAndroidEvent,
} from "../../voiceLocalRuntimeHarness";

function testResourcePauseClassification() {
  assert.equal(isLocalHeavyBackgroundJob({ agentType: "app_project", input: {} } as any), true);
  assert.equal(isLocalHeavyBackgroundJob({ agentType: "research", input: { localHeavy: true } } as any), true);
  assert.equal(isLocalHeavyBackgroundJob({ agentType: "research", input: { resourceProfile: "local_heavy" } } as any), true);
  assert.equal(isLocalHeavyBackgroundJob({ agentType: "research", input: {} } as any), false);

  const resourcePause = {
    reason: RESOURCE_PAUSE_REASON,
    pausedBy: "voice_runtime",
    pausedAt: "2026-07-06T08:00:00.000Z",
  };
  assert.deepEqual(resourcePauseMetadata({ resourcePause }), resourcePause);
  assert.equal(shouldAutoResumeResourcePausedJob({ status: RESOURCE_PAUSED_STATUS, input: { resourcePause } } as any), true);
  assert.equal(shouldAutoResumeResourcePausedJob({ status: "paused", input: { resourcePause } } as any), false);
  assert.equal(shouldAutoResumeResourcePausedJob({ status: RESOURCE_PAUSED_STATUS, input: { resourcePause: { reason: "user_paused" } } } as any), false);
  assert.equal(
    shouldRecoverStaleResourcePausedJob(
      { status: RESOURCE_PAUSED_STATUS, input: { resourcePause } } as any,
      new Date(new Date(resourcePause.pausedAt).getTime() + RESOURCE_PAUSE_STARTUP_RECOVERY_MS - 1),
    ),
    false,
  );
  assert.equal(
    shouldRecoverStaleResourcePausedJob(
      { status: RESOURCE_PAUSED_STATUS, input: { resourcePause } } as any,
      new Date(new Date(resourcePause.pausedAt).getTime() + RESOURCE_PAUSE_STARTUP_RECOVERY_MS),
    ),
    true,
  );
  assert.equal(cancellationStatusForAgentJobStatus("queued"), "cancelled");
  assert.equal(cancellationStatusForAgentJobStatus(RESOURCE_PAUSED_STATUS), "cancelled");
  assert.equal(cancellationStatusForAgentJobStatus("running"), "cancelling");
  assert.equal(cancellationStatusForAgentJobStatus("complete"), null);
  console.log("OK: voice resource scheduler distinguishes resource-paused jobs from user-paused jobs");
}

function testResourcePausedJobsCountAsActiveDuplicates() {
  const projectRoot = process.cwd();
  const source = fs.readFileSync(path.join(projectRoot, "server/agent/tools/jobDuplicateGuard.ts"), "utf8");
  const jobQueueSource = fs.readFileSync(path.join(projectRoot, "server/agent/jobQueue.ts"), "utf8");
  const schedulerSource = fs.readFileSync(path.join(projectRoot, "server/agent/voiceRuntimeResourceScheduler.ts"), "utf8");
  const dailyCommandSource = fs.readFileSync(path.join(projectRoot, "server/dailyCommand/service.ts"), "utf8");
  const gatewaySource = fs.readFileSync(path.join(projectRoot, "server/gateway/nodeRegistry.ts"), "utf8");
  const discordSource = fs.readFileSync(path.join(projectRoot, "server/discord/slashCommands.ts"), "utf8");
  const agentRoutesSource = fs.readFileSync(path.join(projectRoot, "server/agent/agentRoutes.ts"), "utf8");
  assert.match(
    schedulerSource,
    /const VOICE_RESOURCE_ACTIVE_TTL_MS = RESOURCE_PAUSE_STARTUP_RECOVERY_MS/,
    "voice-active resource state should expire on the same TTL used for stale resource-pause recovery",
  );
  assert.match(
    schedulerSource,
    /ttlMs\?: number \| null/,
    "voice-active resource state should support non-expiring paused-session locks",
  );
  assert.match(
    schedulerSource,
    /expiresAt: ttlMs === null \? null : new Date\(now\.getTime\(\) \+ ttlMs\)\.toISOString\(\)/,
    "paused-session locks should be able to opt out of TTL expiration",
  );
  assert.match(
    schedulerSource,
    /if \(active\.expiresAt === null\) return true/,
    "non-expiring paused-session locks should stay active until an explicit release event",
  );
  assert.match(
    source,
    /inArray\(schema\.agentJobs\.status,\s*\["queued", "running", RESOURCE_PAUSED_STATUS\]\)/,
    "duplicate guard should treat voice-resource-paused jobs as active work",
  );
  assert.match(
    source,
    /or\(\s*eq\(schema\.agentJobs\.status,\s*RESOURCE_PAUSED_STATUS\),\s*gte\(schema\.agentJobs\.createdAt,\s*since\),\s*\)/s,
    "resource-paused duplicate candidates should not age out while a voice session keeps them paused",
  );
  assert.match(
    dailyCommandSource,
    /'queued', 'running', 'cancelling', \$\{RESOURCE_PAUSED_STATUS\}/,
    "Daily Command active-job queries should include voice-resource-paused jobs",
  );
  assert.match(
    gatewaySource,
    /inArray\(schema\.agentJobs\.status,\s*\["queued", "running", RESOURCE_PAUSED_STATUS\]\)/,
    "Gateway node registry should include voice-resource-paused jobs in active job nodes",
  );
  assert.match(
    discordSource,
    /j\.status === "queued" \|\| j\.status === "running" \|\| j\.status === RESOURCE_PAUSED_STATUS/,
    "Discord job status should count voice-resource-paused jobs as active",
  );
  assert.match(
    agentRoutesSource,
    /\["queued", "running", RESOURCE_PAUSED_STATUS\]\.includes\(j\.status\)/,
    "Agent route current-job selection should include voice-resource-paused jobs",
  );
  assert.match(
    jobQueueSource,
    /recoverStaleResourcePausedJobsAfterVoice\(\)/,
    "job queue startup recovery should requeue stale voice-resource-paused jobs",
  );
  assert.match(
    jobQueueSource,
    /setInterval\(\(\) => \{\s*recoverStaleVoicePausedJobs\("live recovery"\)/s,
    "job queue should also recover stale voice-resource-paused jobs while the server stays live",
  );
  assert.match(
    jobQueueSource,
    /clearInterval\(resourcePauseRecoveryTimer\)/,
    "job queue should stop the live stale voice-resource-paused recovery timer",
  );
  assert.match(
    schedulerSource,
    /eq\(schema\.agentJobs\.status,\s*RESOURCE_PAUSED_STATUS\)/,
    "voice heartbeat should load existing voice-resource-paused jobs",
  );
  assert.match(
    schedulerSource,
    /withResourcePauseHeartbeat\(job,\s*pausedAt\)/,
    "voice heartbeat should refresh existing voice-resource-paused jobs before stale recovery can requeue them",
  );
  assert.doesNotMatch(
    schedulerSource,
    /error:\s*"Paused while local voice is active\."/,
    "voice-resource-paused jobs should keep pause details in metadata instead of rendering as failed jobs",
  );
  assert.match(
    schedulerSource,
    /resourcePause'->>'pausedAt' = \$\{pause\.pausedAt\}/,
    "stale recovery should only requeue a job when the stored pausedAt still matches the stale snapshot",
  );
  assert.match(
    schedulerSource,
    /!isVoiceRuntimeResourceActiveForUser\(job\.userId, now\) && shouldRecoverStaleResourcePausedJob\(job, now\)/,
    "live stale recovery should not requeue jobs for users whose local voice resource window is still active",
  );
  console.log("OK: resource-paused jobs count as active duplicate candidates");
}

function testRuntimeStatusAndIncidentText() {
  const incident = buildVoiceRuntimeIncidentBundle({
    userId: "user-voice",
    now: new Date("2026-07-06T08:00:00.000Z"),
    lastState: "speaking",
    lastAction: "crash",
    transcript: "Read my notifications and summarize them.",
    activeTaskTitle: "Notification triage",
  });
  assert.equal(incident.id, "voice-incident-20260706080000");
  assert.match(buildVoiceRestorePrompt(incident), /restore the conversation context/i);
  assert.match(buildVoiceRestoreRecap(incident), /Notification triage/);
  assert.match(buildVoiceRuntimeStatusAnswer({
    voiceActive: true,
    voiceState: "listening",
    activeJobs: [{ id: "job-1", title: "Research competitor", status: "running" }],
    resourcePausedJobs: [{ id: "job-2", title: "Build demo app", status: RESOURCE_PAUSED_STATUS }],
    incident,
  }), /Paused for call stability: Build demo app/);
  console.log("OK: voice runtime status, incident, prompt, and recap are runtime-grounded");
}

async function testRuntimeStatusBypassesGemmaGuessing() {
  const events: LocalVoiceAndroidEvent[] = [
    { type: "scheduler", activeJobs: ["Voice call"], pausedJobs: ["Build demo app"] },
    { type: "crash", service: "outside-app voice", message: "previous service death recorded" },
  ];
  const gemma = new ScriptedFakeLocalGemmaProvider([{ type: "final", text: "I am not sure." }]);
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "What are you doing right now?",
    gemma,
    androidEvents: events,
  });

  assert.equal(gemma.prompts.length, 0);
  assert.equal(result.modelCalls.length, 0);
  assert.equal(result.diagnostics.outcome, "runtime_status_answer");
  assert.match(result.canonicalResponse, /Build demo app/);
  assert.match(result.canonicalResponse, /outside-app voice crashed/);
  assert.equal(result.chatOutput, result.ttsOutput);
  console.log("OK: local voice status questions bypass Gemma and answer from runtime state");
}

async function testRestoreRecapBypassesGemmaGuessing() {
  const events: LocalVoiceAndroidEvent[] = [
    { type: "scheduler", activeJobs: ["Notification triage"], pausedJobs: ["Build demo app"] },
    { type: "crash", service: "outside-app voice", message: "session died while listening" },
  ];
  const gemma = new ScriptedFakeLocalGemmaProvider([{ type: "final", text: "I can guess what happened." }]);
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Yes",
    gemma,
    androidEvents: events,
  });

  assert.equal(gemma.prompts.length, 0);
  assert.equal(result.modelCalls.length, 0);
  assert.equal(result.diagnostics.outcome, "runtime_voice_restore_recap");
  assert.match(result.canonicalResponse, /session died while listening/);
  assert.match(result.canonicalResponse, /Notification triage/);
  assert.match(result.canonicalResponse, /mic is still paused/i);
  assert.equal(result.chatOutput, result.ttsOutput);
  console.log("OK: local voice restore recap bypasses Gemma and keeps the mic paused");
}

async function testRestoreDismissBypassesGemmaGuessing() {
  const events: LocalVoiceAndroidEvent[] = [
    { type: "scheduler", activeJobs: ["Notification triage"], pausedJobs: ["Build demo app"] },
    { type: "crash", service: "outside-app voice", message: "session died while listening" },
  ];
  const gemma = new ScriptedFakeLocalGemmaProvider([{ type: "final", text: "I can guess about the old context." }]);
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "start fresh",
    gemma,
    androidEvents: events,
  });

  assert.equal(gemma.prompts.length, 0);
  assert.equal(result.modelCalls.length, 0);
  assert.equal(result.androidExecutions.length, 1);
  assert.equal(result.diagnostics.outcome, "runtime_voice_restore_dismissed");
  assert.equal(result.diagnostics.executedToolName, "runtime_service_status");
  assert.equal(result.canonicalResponse, "Okay, I won't restore that interrupted voice context.");
  assert.equal(result.chatOutput, result.ttsOutput);
  console.log("OK: local voice restore dismissals bypass Gemma and start fresh");
}

async function testNonVoiceResumeDoesNotTriggerRestore() {
  const gemma = new ScriptedFakeLocalGemmaProvider([{ type: "final", text: "Resuming playback." }]);
  const result = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Resume YouTube playback.",
    gemma,
    androidEvents: [],
  });

  assert.equal(gemma.prompts.length, 1);
  assert.equal(result.modelCalls.length, 1);
  assert.equal(result.diagnostics.outcome, "final");
  assert.equal(result.canonicalResponse, "Resuming playback.");

  const fileGemma = new ScriptedFakeLocalGemmaProvider([{ type: "final", text: "I can help restore that file." }]);
  const fileResult = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Restore that file.",
    gemma: fileGemma,
    androidEvents: [],
  });

  assert.equal(fileGemma.prompts.length, 1);
  assert.equal(fileResult.modelCalls.length, 1);
  assert.equal(fileResult.diagnostics.outcome, "final");
  assert.equal(fileResult.canonicalResponse, "I can help restore that file.");

  const followUpGemma = new ScriptedFakeLocalGemmaProvider([{ type: "final", text: "Continuing the current task." }]);
  const followUpResult = await runLocalVoiceRuntimeHarnessTurn({
    userId: "user-local-voice",
    transcript: "Continue that.",
    gemma: followUpGemma,
    androidEvents: [],
  });

  assert.equal(followUpGemma.prompts.length, 1);
  assert.equal(followUpResult.modelCalls.length, 1);
  assert.equal(followUpResult.diagnostics.outcome, "final");
  assert.equal(followUpResult.canonicalResponse, "Continuing the current task.");
  console.log("OK: unrelated resume commands do not trigger voice crash restore");
}

async function main() {
  testResourcePauseClassification();
  testResourcePausedJobsCountAsActiveDuplicates();
  testRuntimeStatusAndIncidentText();
  await testRuntimeStatusBypassesGemmaGuessing();
  await testRestoreRecapBypassesGemmaGuessing();
  await testRestoreDismissBypassesGemmaGuessing();
  await testNonVoiceResumeDoesNotTriggerRestore();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
