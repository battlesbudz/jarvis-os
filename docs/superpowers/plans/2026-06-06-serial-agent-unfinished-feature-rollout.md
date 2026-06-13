# Serial Agent Unfinished Feature Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the highest-value unfinished Jarvis features in safe serial slices without destabilizing production.

**Architecture:** Use one agent per vertical slice, never parallel edits to the same subsystem. Each slice starts from the current docs, writes or updates focused tests first, changes only the files needed for that slice, runs local verification, updates the relevant roadmap/spec doc, and stops for review before the next agent begins. Production-facing slices require deployed URL verification after merge/deploy.

**Tech Stack:** TypeScript, Express, Drizzle/Postgres, Expo/React Native Web, Tauri, PowerShell, Railway, Jarvis agent test runner, `npm.cmd test`, `npm.cmd run server:build`, `npm.cmd run jarvis:doctor`.

---

## Operating Rules For Every Serial Agent

- [ ] Start from `C:\Users\justi\OneDrive\Desktop\Jarvis`.
- [ ] Run `git status --short --branch` before editing and note unrelated dirty files.
- [ ] Read the source doc for the slice before coding.
- [ ] Do not revert unrelated changes.
- [ ] Do not touch Replit/OpenClaw legacy paths except to remove remaining references.
- [ ] Use tests before implementation when practical.
- [ ] Keep generated `server_dist/index.js` out of commits unless the release path explicitly requires it.
- [ ] Run `git diff --check` before handing off.
- [ ] Update the roadmap/spec doc lines that are made true by the slice.
- [ ] Stop after each slice for human review, commit, and optional deploy.

## Stop Gates

- [ ] Stop immediately if `npm.cmd run server:build` fails after implementation.
- [ ] Stop immediately if a migration needs destructive data changes.
- [ ] Stop immediately if a slice requires production secrets, Google Console changes, code signing, or a live OAuth client update.
- [ ] Stop immediately if two agents would need to edit the same files at the same time.
- [ ] Stop immediately if deployed verification contradicts local tests.

## Serial Order

### Agent 0: Baseline And Guardrail Audit

**Purpose:** Establish a clean known starting point before feature work.

**Primary docs:**
- `JARVIS_ROADMAP.md`
- `docs/gbrain-implementation-plan.md`
- `docs/operations/deployed-jarvis-qa-2026-05-15.md`

**Commands:**
```powershell
git status --short --branch
npm.cmd run server:build
npm.cmd test
npm.cmd run jarvis:doctor
node .\node_modules\tsx\dist\cli.mjs scripts\__tests__\noReplitRuntimeDeps.test.mjs
```

**Deliverable:**
- A short baseline note in the handoff: passing/failing commands, dirty files, known production blockers.

**Do not change code unless a command exposes a tiny deterministic breakage.**

### Agent 1: Production Navigation And Projects Flow

**Purpose:** Fix the user complaint that there is no obvious click path from the main dashboard to Projects.

**Primary files:**
- `dashboard/app/page.tsx`
- `dashboard/components/Sidebar.tsx`
- `dashboard/app/projects/page.tsx`
- `app/(tabs)/projects.tsx`
- `e2e/jarvis.spec.ts`

**Tasks:**
- [ ] Add or repair a visible Projects navigation entry from the main dashboard shell.
- [ ] Add an E2E/browser-facing assertion that the dashboard can navigate to Projects by clicking UI, not by direct URL.
- [ ] Keep route labels consistent across dashboard and mobile tab naming.

**Verification:**
```powershell
npm.cmd run server:build
npm.cmd test
```

**Production verification after deploy:**
- Open only the deployed URL in the user's existing Chrome session.
- Click from dashboard to Projects.
- Confirm the Projects page loads without needing a pasted URL.

### Agent 2: Build Job Observability And Completion Watch

**Purpose:** Make long-running project/build jobs observable enough to diagnose where they stall.

**Primary docs:**
- `JARVIS_ROADMAP.md`
- `docs/superpowers/plans/2026-05-26-cloud-workforce-ephemeral-agents.md`

**Primary files:**
- `server/agent/jobQueue.ts`
- `server/agent/workerRuntime.ts`
- `server/agent/workerRuntimeJobEvents.ts`
- `server/agent/jobObservability.ts`
- `server/routes/missionControlQueueRoutes.ts`
- `components/missionControl/ProjectsScreen.tsx`
- `components/missionControl/TasksScreen.tsx`

**Tasks:**
- [ ] Broaden progress events for build-feature, research, browser, and goal-task jobs.
- [ ] Persist `queued`, `running`, `progress`, `approval_required`, `failed`, `retryable`, and `completed` checkpoints consistently.
- [ ] Add UI text/status that shows the current checkpoint and last progress timestamp for each job.
- [ ] Add a stalled-job visual state when no progress event appears inside the expected window.

**Verification:**
```powershell
node .\node_modules\tsx\dist\cli.mjs server\agent\__tests__\jobObservability.test.ts
npm.cmd run server:build
npm.cmd test
```

**Production verification after deploy:**
- Start one real project/build job from the deployed UI.
- Watch it from queued to terminal state.
- Record the exact checkpoint where it fails if it does not finish.

### Agent 3: Approval Gate Runtime Checkpoints

**Purpose:** Ensure every approval gate appears as a worker/runtime checkpoint.

**Primary docs:**
- `docs/superpowers/plans/2026-05-26-cloud-workforce-ephemeral-agents.md`
- `docs/jarvis-action-ontology-checklist.md`

**Primary files:**
- `server/agent/agentApproval.ts`
- `server/agent/approvalNotifications.ts`
- `server/agent/workerRuntime.ts`
- `server/agent/toolCallHooks.ts`
- `server/agent/deliverableReviewActions.ts`
- `app/(tabs)/inbox.tsx`

**Tasks:**
- [ ] Add one shared helper that records an `approval_required` checkpoint when a gate is created.
- [ ] Route existing approval creation paths through that helper.
- [ ] Show approval checkpoints in Inbox/Mission Control without duplicating deliverables.
- [ ] Add tests proving approval gates created by tools, deliverables, and Agent SDK paths produce checkpoint metadata.

**Verification:**
```powershell
npm.cmd test
npm.cmd run server:build
```

### Agent 4: Memory OS Facade First Slice

**Purpose:** Create one safe memory read facade without introducing Redis or Graphiti yet.

**Primary docs:**
- `docs/memory-os-temporal-graph-plan.md`
- `docs/gbrain-implementation-plan.md`
- `docs/gbrain-spec-sheet.md`

**Primary files:**
- Create `server/memory/memoryOs.ts`
- Modify `server/agent/tools/memorySearch.ts`
- Modify `server/memory/promptContext.ts`
- Modify `server/memory/contextBuilder.ts`
- Modify `server/agent/mindTrace.ts`

**Tasks:**
- [ ] Create `retrieveMemoryContext()` that calls existing memory retrieval and optional G-Brain retrieval behind current feature flags.
- [ ] Return structured `sources`, `provenance`, `confidence`, and `uncertainty`.
- [ ] Route `memory_search` through the facade.
- [ ] Add Mind Trace metadata showing which memory source was used.
- [ ] Keep fallback behavior identical when G-Brain is unavailable.

**Verification:**
```powershell
node .\node_modules\tsx\dist\cli.mjs server\memory\__tests__\brainRetrieval.test.ts
npm.cmd test
npm.cmd run server:build
```

### Agent 5: User-Facing Memory Correction And Provenance

**Purpose:** Let the user correct/delete memories and see why Jarvis remembered something.

**Primary docs:**
- `JARVIS_ROADMAP.md`
- `docs/memory-os-temporal-graph-plan.md`

**Primary files:**
- `app/(tabs)/profile.tsx`
- `components/missionControl/MemoryScreen.tsx`
- `server/routes/profileMemoryRoutes.ts`
- `server/memory/vaultWriter.ts`
- `server/memory/protectedEntities.ts`

**Tasks:**
- [ ] Add API support for memory correction with provenance preserved.
- [ ] Add API support for user deletion/discard that cannot be silently re-promoted.
- [ ] Add UI action labels: correct, forget, why remembered.
- [ ] Add tests for correction, deletion, and blocked sensitive-memory auto-promotion.

**Verification:**
```powershell
npm.cmd test
npm.cmd run server:build
```

### Agent 6: Relationship Timeline First Slice

**Purpose:** Turn people records into source-backed relationship context instead of flat profile entries.

**Primary files:**
- `server/memory/people.ts`
- `server/routes/profileMemoryRoutes.ts`
- `server/services/aiCoachContextService.ts`
- `app/(tabs)/profile.tsx`
- `docs/gbrain-spec-sheet.md`

**Tasks:**
- [ ] Add a read-only relationship timeline API from existing calendar, Gmail sender, and memory sources.
- [ ] Show source labels and confidence.
- [ ] Use relationship summaries in email drafting and meeting prep context only when source-backed.

**Verification:**
```powershell
npm.cmd test
npm.cmd run server:build
```

### Agent 7: Slack And WhatsApp Production Readiness

**Purpose:** Validate and harden two-way channel behavior.

**Primary docs:**
- `JARVIS_ROADMAP.md`
- `docs/operations/composio-production-smoke-checklist.md`

**Primary files:**
- `server/channels/slackChannel.ts`
- `server/channels/slackWebhook.ts`
- `server/channels/whatsappChannel.ts`
- `server/channels/whatsappWebhook.ts`
- `server/channels/outboundMiddleware.ts`
- `server/routes/connectionsRoutes.ts`
- `app/(tabs)/settings.tsx`

**Tasks:**
- [ ] Separate account linked, server configured, and runnable channel status.
- [ ] Add slash-command coverage for Slack.
- [ ] Add attachment/deliverable fallback messaging for WhatsApp.
- [ ] Add tests for blocked/unconfigured channel states.

**Verification:**
```powershell
npm.cmd test
npm.cmd run server:build
```

**Production verification requires live Slack/Twilio credentials. Stop if missing.**

### Agent 8: Daemon Safety Hardening

**Purpose:** Make desktop/Android control safer before expanding powers.

**Primary docs:**
- `JARVIS_ROADMAP.md`
- `docs/jarvis-action-ontology-checklist.md`
- `docs/jarvis-wearable-os-master-roadmap.md`

**Primary files:**
- `server/daemon/bridge.ts`
- `server/agent/tools/daemon.ts`
- `server/gateway/controlPlane.ts`
- `server/gateway/nodeRegistry.ts`
- `daemon/jarvis-daemon.js`
- `android-daemon/app/src/main/java/com/jarvis/daemon/*.kt`

**Tasks:**
- [ ] Add per-action approval metadata for shell, file write, UI control, and screen capture.
- [ ] Add audit rows/events for daemon actions.
- [ ] Add timeout and disconnected-node recovery behavior.
- [ ] Add tests for denied, timed-out, disconnected, and approved daemon actions.

**Verification:**
```powershell
npm.cmd test
npm.cmd run server:build
```

### Agent 9: Windows Connector Release Readiness

**Purpose:** Finish the commercial Windows connector path without pretending code signing is done locally.

**Primary docs:**
- `docs/superpowers/specs/2026-06-01-windows-desktop-connector-onboarding-design.md`
- `docs/superpowers/plans/2026-06-01-windows-desktop-connector-onboarding.md`
- `docs/operations/windows-desktop-connector-release.md`

**Primary files:**
- `desktop-connector/**`
- `server/routes/desktopConnectorRoutes.ts`
- `components/desktopConnector/WindowsConnectorSetupWizard.tsx`
- `components/desktopConnector/ConnectedWindowsPcCard.tsx`
- `scripts/jarvis-desktop-connector-awaken.ps1`

**Tasks:**
- [ ] Run config and copy assertions.
- [ ] Fix any broken Tauri config, sidecar path, or ceremony script issues.
- [ ] Confirm installer metadata API returns version, URL, and optional SHA.
- [ ] Document exact blocker if Rust, Tauri, or code-signing prerequisites are missing.

**Verification:**
```powershell
npx.cmd tsx server\agent\__tests__\desktopConnectorSetup.assert.ts
npx.cmd tsx server\agent\__tests__\desktopConnectorWebCopy.assert.ts
node scripts\__tests__\desktopConnectorAwakening.test.mjs
node scripts\__tests__\desktopConnectorTauriConfig.test.mjs
npm.cmd run server:build
```

### Agent 10: PRIME Runtime Route Consolidation

**Purpose:** Move one more channel into the unified PRIME path without broad rewrite.

**Primary docs:**
- `docs/jarvis-core-runtime-prime-router.md`
- `docs/agent-sdk-hitl-prototype.md`

**Primary files:**
- `server/agent/autonomyRuntime.ts`
- `server/discord/slashCommands.ts`
- `server/channels/slashCommandRouter.ts`
- `server/agent/mindTrace.ts`
- `server/agent/__tests__/jarvisCoreRuntime.assert.ts`

**Tasks:**
- [ ] Wire Discord `/jarvis chat` through `handlePrimeInput`.
- [ ] Add Mind Trace event capture for PRIME decisions.
- [ ] Keep Discord task slash commands on existing queue-specific behavior.
- [ ] Add route tests with `ENABLE_PRIME_RUNTIME=true`.

**Verification:**
```powershell
node .\node_modules\tsx\dist\cli.mjs server\agent\__tests__\jarvisCoreRuntime.assert.ts
npm.cmd test
npm.cmd run server:build
```

### Agent 11: Agent SDK Next Workflow

**Purpose:** Expand the Agent SDK prototype by one workflow only.

**Primary docs:**
- `docs/agent-sdk-hitl-prototype.md`
- `docs/operations/jarvis-golden-workflows.md`

**Primary files:**
- `src/agent/agentRunner.ts`
- `src/agent/toolRegistry.ts`
- `src/agent/__tests__/agentSdkHitl.assert.ts`
- `scripts/agent-sdk-golden-workflows.ts`

**Tasks:**
- [ ] Add provider email-thread read support for draft replies.
- [ ] Keep `ENABLE_AGENT_SDK_RUNNER` default off.
- [ ] Add mocked scorecard coverage.
- [ ] Do not route broad email requests through the SDK until the scorecard passes.

**Verification:**
```powershell
npm.cmd run jarvis:qa:agent-sdk-hitl
npm.cmd run jarvis:qa:agent-sdk-golden
npm.cmd test
npm.cmd run server:build
```

### Agent 12: Action Ontology UI And Code Ownership

**Purpose:** Make Jarvis explain action routing and prepare safe self-code ownership.

**Primary docs:**
- `docs/jarvis-action-ontology-checklist.md`

**Primary files:**
- `server/agent/actionOntology.ts`
- `server/agent/toolAwareRouting.ts`
- `server/agent/toolResolver.ts`
- `server/agent/mindTrace.ts`
- `app/code-proposals.tsx`
- `app/(tabs)/inbox.tsx`

**Tasks:**
- [ ] Surface `actionReason` in Mind Trace/debug views.
- [ ] Add approval/review card labels for action type and actor.
- [ ] Define and test `jarvis_code_proposal` versus `jarvis_code_apply`.
- [ ] Require approval before apply, commit, push, deploy, env var, or infrastructure changes.

**Verification:**
```powershell
node .\node_modules\tsx\dist\cli.mjs server\agent\__tests__\actionOntology.assert.ts
node .\node_modules\tsx\dist\cli.mjs server\agent\__tests__\toolResolver.assert.ts
npm.cmd test
npm.cmd run server:build
```

### Agent 13: Wearable OS Architecture Contract

**Purpose:** Start wearable/spatial work with contracts, not device-specific UI.

**Primary docs:**
- `docs/jarvis-wearable-os-master-roadmap.md`

**Primary files:**
- Create `server/devices/types.ts`
- Create `server/devices/registry.ts`
- Create `server/devices/events.ts`
- Modify `server/gateway/nodeRegistry.ts`
- Modify `server/gateway/eventBus.ts`
- Create `server/agent/__tests__/wearableDeviceContract.assert.ts`

**Tasks:**
- [ ] Define device capability metadata for desktop, Android, and future XR devices.
- [ ] Define canonical wearable OS event names and payloads.
- [ ] Add adapter registration for existing desktop and Android daemon nodes.
- [ ] Do not add camera/spatial memory ingestion in this slice.

**Verification:**
```powershell
node .\node_modules\tsx\dist\cli.mjs server\agent\__tests__\wearableDeviceContract.assert.ts
npm.cmd test
npm.cmd run server:build
```

## Recommended Merge/Deploy Rhythm

1. Run Agent 0.
2. Implement Agents 1 and 2 first because they address the current live product pain: Projects navigation and stalled build visibility.
3. Deploy after Agent 2 and run deployed Chrome verification.
4. Continue Agents 3, 4, and 5 as the next reliability block.
5. Deploy again after Agent 5.
6. Continue channel/daemon/connector slices only when required credentials or local prerequisites are available.
7. Keep wearable/spatial work last because it is architecture prep, not immediate product repair.

## Final Rollout Acceptance

- Dashboard-to-Projects navigation works by click path on the deployed URL.
- A real project/build job exposes progress until terminal success/failure.
- Approval gates show visible runtime checkpoints.
- Memory answers show source/provenance through a single facade.
- Users can correct/delete memories and inspect why a memory exists.
- Slack/WhatsApp/daemon status surfaces distinguish linked from runnable.
- Windows connector path is release-ready, with signing/download blockers explicitly named if not complete.
- PRIME owns one additional channel route without breaking legacy fallbacks.
- No Replit runtime dependencies return.
- `npm.cmd test`, `npm.cmd run server:build`, and `npm.cmd run jarvis:doctor` pass or have named, accepted external blockers.

## Self-Review

- Spec coverage: This plan covers the unfinished items found in the roadmap, G-Brain/Memory OS docs, deployed QA doc, Windows connector spec, Agent SDK docs, action ontology checklist, Cloud Workforce plan, and wearable roadmap.
- Scope control: Each serial agent owns one subsystem slice and stops at verification.
- Risk control: Production secrets, code signing, OAuth console work, destructive migrations, and live channel credentials are explicit stop gates.
- First priority: Projects navigation and build/job observability come before deeper architecture because they address the user's current deployed-flow complaint.
