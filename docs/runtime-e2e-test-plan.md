# Runtime E2E Test Plan

This plan tests Core Runtime from the outside in: click through the app where runtime is wired, prompt Jarvis the way a user would, and verify the runtime-owned boundaries through diagnostics, observable app state, and storage-neutral harness checks.

The goal is not to prove every helper in isolation. Unit tests already cover that. The goal is to prove that runtime behavior feels safe and correct in real user journeys.

## Scope

Runtime functionality covered:

- runtime diagnostics UI and `/api/runtime/dry-run`
- runtime read-only route ownership and rollback flags
- runtime-owned read-only workflows: `general-answer`, `memory-lookup`, `email-draft-reply`, `next-meeting-brief`
- approval-required workflow previews and approval bridge handoff
- tool preflight, policy blocks, and no execution from preview
- persistence/audit records and redaction
- memory calibration preview
- daemon audit envelope
- scheduled task preview
- kill switch and default-off behavior

Out of scope for this plan:

- model quality scoring beyond basic user-visible correctness
- provider-specific OAuth setup smoke tests, except where auth state changes runtime preflight
- full desktop or Android daemon installation QA, except the runtime audit path
- DB migration verification beyond checking that runtime preview paths do not create rows unexpectedly

## Test Environments

Run the suite against three environments.

| Environment | Purpose | Required flags |
|---|---|---|
| Baseline safe mode | Prove runtime is default-off and existing Jarvis still works | no runtime flags |
| Preview mode | Prove diagnostics and previews work without side effects | `JARVIS_RUNTIME_DRY_RUN=1` |
| Narrow live read-only mode | Prove allowlisted read-only ownership and rollback | `JARVIS_RUNTIME_LIVE_EXECUTION=1`, narrow `JARVIS_RUNTIME_LIVE_WORKFLOWS` |

Use a dedicated QA user with disposable data:

- connected app session
- at least one approved memory
- one pending memory-review item
- desktop connector either intentionally offline or connected to a disposable workspace
- scheduled tasks page available
- email/calendar providers may be disconnected for auth-block tests, or connected to test accounts only

## Global Pass Criteria

Every runtime E2E run must satisfy these invariants:

- Preview flows never execute tools.
- Preview flows never write memory.
- Preview flows never enqueue jobs or scheduled tasks.
- Preview flows never create approval records.
- Runtime read-only ownership only happens when live execution and a named workflow allowlist are enabled.
- `JARVIS_RUNTIME_KILL_SWITCH=1` routes back to existing ownership.
- Approval-required work never returns as a direct answer.
- Runtime logs, previews, and audit envelopes redact tokens, cookies, sessions, passwords, API keys, shell command secrets, daemon stdout, and daemon stderr.
- Existing Jarvis user flows still complete when runtime declines ownership.

## User Journey Matrix

| ID | Journey | Entry point | Expected runtime result |
|---|---|---|---|
| RTE2E-01 | Runtime preview default-off | Settings > Diagnostics > Runtime Preview | Disabled, no side effects |
| RTE2E-02 | Preview a general answer | Settings > Diagnostics | Ready, `answer`, T0, no tools |
| RTE2E-03 | Preview memory lookup | Settings > Diagnostics | Ready or tool-candidate preview, no memory write |
| RTE2E-04 | Preview approval-required send | Settings > Diagnostics | Approval required, no approval record created |
| RTE2E-05 | Live read-only general answer | `/api/runtime/read-only` or future chat wiring | `runtimeOwned: true` only when allowlisted |
| RTE2E-06 | Live read-only memory lookup | `/api/runtime/read-only` | Runtime-owned only when `memory-lookup` is allowlisted |
| RTE2E-07 | Live route fallback for risky work | `/api/runtime/read-only` or chat | Existing owner, no runtime execution |
| RTE2E-08 | Kill switch rollback | Runtime read-only route | Existing owner even when other flags are enabled |
| RTE2E-09 | Memory correction prompt | Jarvis chat, Profile > Memory | Existing memory owner handles review; runtime preview is review-only |
| RTE2E-10 | Desktop daemon command prompt | Jarvis chat, Profile > Desktop Connector | Existing daemon owner and approval/permission path; runtime audit stores no raw payload |
| RTE2E-11 | Personal reminder prompt | Jarvis chat, Scheduled Tasks | User task is scheduled by existing owner; runtime preview does not enqueue |
| RTE2E-12 | Scheduled shell job prompt | Jarvis chat, Scheduled Tasks | Existing scheduler owns executable job; runtime preview fingerprints command only |
| RTE2E-13 | Diagnostics redaction | Settings/API seeded sensitive metadata | No secrets visible in UI/API/log artifacts |
| RTE2E-14 | Auth and policy blocked tools | Diagnostics API with snapshots | Tool preflight shows block/missing auth without execution |

## Detailed Test Cases

### RTE2E-01: Runtime Preview Default-Off

Setup:

- Start the app/server with no runtime flags.
- Sign in as the QA user.

Steps:

1. Open the app.
2. Go to Settings.
3. Scroll to Diagnostics.
4. Find Runtime Preview.
5. Leave the prompt as `What can you do?`.
6. Click Dry Run.

Expected:

- Status pill becomes Disabled.
- Summary says runtime dry run is disabled or equivalent.
- Runtime Preview log shows one disabled entry.
- No memory rows, scheduled tasks, approval gates, daemon calls, or job queue rows are created.
- Main chat still answers normal prompts through existing Jarvis behavior.

### RTE2E-02: Preview General Answer

Setup:

- Enable `JARVIS_RUNTIME_DRY_RUN=1`.
- Keep `JARVIS_RUNTIME_LIVE_EXECUTION` unset.

Steps:

1. Open Settings > Diagnostics > Runtime Preview.
2. Enter `What can you do?`.
3. Click Dry Run.
4. Read the formatted preview and log entry.
5. Click the trash icon.

Expected:

- Status pill becomes Ready.
- Report shows an answer-mode, low-risk decision.
- Ready tool count is `0`.
- Blocked tool count is `0`.
- The formatted output is deterministic enough to compare in screenshots.
- Clearing the log removes only client-local entries.
- Repeating the same prompt does not create durable state.

### RTE2E-03: Preview Memory Lookup

Setup:

- Enable `JARVIS_RUNTIME_DRY_RUN=1`.
- Seed one approved memory for the QA user.

Steps:

1. Open Settings > Diagnostics > Runtime Preview.
2. Enter `What memory do you have about my morning planning?`.
3. Click Dry Run.
4. Then ask the same prompt in the normal Jarvis chat.

Expected:

- Runtime Preview classifies the request as memory-shaped.
- Preview remains read-only.
- Normal chat may use existing memory retrieval and answer with provenance.
- No memory is created, edited, discarded, or auto-approved by runtime preview.

### RTE2E-04: Preview Approval-Required Send

Setup:

- Enable `JARVIS_RUNTIME_DRY_RUN=1`.

Steps:

1. Open Settings > Diagnostics > Runtime Preview.
2. Enter `Send an email to Bill saying I will follow up tomorrow.`.
3. Click Dry Run.
4. Open any approval inbox/surface used by the app.

Expected:

- Status pill becomes Approval.
- Report has `approvalRequired: true`.
- Response mode is not `answer`.
- Approval preview appears in the API response or formatted text.
- No real approval gate is created from the preview.
- No email draft or send action occurs.

### RTE2E-05: Live Read-Only General Answer

Setup:

- Enable `JARVIS_RUNTIME_LIVE_EXECUTION=1`.
- Set `JARVIS_RUNTIME_LIVE_WORKFLOWS=general-answer`.
- Keep `JARVIS_RUNTIME_KILL_SWITCH` unset.

Steps:

1. Call `POST /api/runtime/read-only` as the QA user with `{"message":"What can you do?"}`.
2. In future chat wiring, ask Jarvis the same prompt from the main chat.

Expected:

- Route returns `runtimeOwned: true`.
- `runtimeWorkflowId` is `general-answer`.
- Execution status is `completed`.
- `executedToolCount` is `0`.
- Side effect count is `0`.
- Decision summary has `approvalRequired: false`.
- Existing chat wiring, if not yet connected to this route, continues to use existing owner.

### RTE2E-06: Live Read-Only Workflow Allowlist

Setup:

- Enable `JARVIS_RUNTIME_LIVE_EXECUTION=1`.
- Run the test once with only `JARVIS_RUNTIME_LIVE_WORKFLOWS=general-answer`.
- Run it again with `JARVIS_RUNTIME_LIVE_WORKFLOWS=memory-lookup,email-draft-reply,next-meeting-brief`.

Steps:

1. Call `/api/runtime/read-only` with `What memory do you have about morning planning?`.
2. Call `/api/runtime/read-only` with `Draft a reply to this email but do not send it.`.
3. Call `/api/runtime/read-only` with `Prepare me for my next meeting.`.

Expected:

- With only `general-answer`, these workflows decline to the existing owner.
- With matching allowlist values, read-only candidates return `runtimeOwned: true`.
- All executions report zero tools and zero side effects.
- Any approval-required or send-like wording declines to existing owner.

### RTE2E-07: Live Route Fallback For Risky Work

Setup:

- Enable `JARVIS_RUNTIME_LIVE_EXECUTION=1`.
- Enable `JARVIS_RUNTIME_DEFAULT_READ_ONLY=1`.

Steps:

1. Call `/api/runtime/read-only` with `Send this email to Bill now.`.
2. Call `/api/runtime/read-only` with `Research the latest Expo release and save a report.`.
3. Call `/api/runtime/read-only` with `Run npm test on my desktop.`.

Expected:

- Requests do not become runtime-owned read-only executions.
- Risky/tool-backed work returns conflict or existing-owner handoff.
- No tool executes from the runtime route.
- Existing Jarvis route remains the only live owner for these actions.

### RTE2E-08: Kill Switch Rollback

Setup:

- Enable `JARVIS_RUNTIME_LIVE_EXECUTION=1`.
- Enable `JARVIS_RUNTIME_DEFAULT_READ_ONLY=1`.
- Enable `JARVIS_RUNTIME_KILL_SWITCH=1`.

Steps:

1. Call `/api/runtime/read-only` with `What can you do?`.
2. Open Settings > Diagnostics and run the same prompt.
3. Ask the same prompt in normal chat.

Expected:

- Read-only route returns existing owner, not runtime-owned.
- Diagnostics behavior remains preview-only or disabled according to dry-run flag.
- Normal chat still works through existing Jarvis behavior.
- Removing the kill switch restores the previous allowlisted read-only behavior.

### RTE2E-09: Memory Correction Prompt

Setup:

- QA user has an approved memory such as `User starts daily planning at 9:00.`
- Memory review is enabled.
- Optional harness writer is configured only in a test environment for runtime memory calibration previews.

Steps:

1. In normal Jarvis chat, prompt: `Actually, remember my daily planning block starts at 8:30 now.`
2. Open Profile > Memory.
3. Open pending memory review.
4. Approve, edit, or discard according to the app's normal memory-review UX.
5. In the runtime E2E harness, build a memory calibration preview for the same correction.

Expected:

- Normal chat uses existing memory owner and review controls.
- A pending memory/review item appears when the existing app decides to save or correct memory.
- Runtime calibration preview has `approvalRequired: true`.
- Runtime calibration preview has `writeAllowed: false`.
- Runtime calibration preview includes a Memory OS correction review result with `recorded: false`, `reviewOnly: true`, and runtime event provenance.
- Confidence is normalized if the input is percent-shaped.
- Secret metadata is redacted.
- Runtime does not directly update canonical memory.

### RTE2E-10: Desktop Daemon Command Prompt

Setup:

- Desktop connector is either offline for the negative path or connected to a disposable workspace for the positive path.
- Shell permission is disabled for the first pass and enabled for the second pass.
- Runtime daemon audit preview writer is configured only in test.

Steps:

1. Open Profile > Connected Channels.
2. Verify Desktop Connector status.
3. With shell disabled, ask Jarvis: `Run echo JARVIS_RUNTIME_E2E on my desktop.`
4. Enable shell permission.
5. Ask the same prompt again.
6. Inspect the runtime daemon audit envelope emitted by the E2E harness or test writer.

Expected:

- Offline or permission-denied states produce clear user-facing failure.
- Connected shell execution remains owned by existing daemon tooling.
- Runtime audit envelope records event id, user id, tool name, daemon surface, status, risk, approval, top-level keys, and fingerprints.
- Runtime audit envelope does not store raw command text, stdout, stderr, token values, cookies, or session ids.

### RTE2E-11: Personal Reminder Prompt

Setup:

- QA user starts with no scheduled task titled `Call Bill runtime E2E`.

Steps:

1. In normal Jarvis chat, prompt: `Remind me tomorrow at 9am to call Bill runtime E2E.`
2. Open Scheduled Tasks.
3. Find the new task.
4. In the runtime E2E harness, build a scheduled-task preview for the same title/time.

Expected:

- Existing scheduler creates the task.
- Task kind is `user_task`.
- It is not executable by Jarvis.
- Runtime scheduled-task preview has `owner: existing_scheduler`.
- Runtime scheduled-task preview has `runtimeEnqueueAllowed: false`.
- Runtime preview persistence requires an explicit writer and does not insert a task row.

### RTE2E-12: Scheduled Shell Job Prompt

Setup:

- Desktop connector is available only in a disposable test workspace.
- QA user starts with no scheduled job titled `Runtime E2E build smoke`.

Steps:

1. In normal Jarvis chat, prompt: `Every day at 9am, run npm test in my workspace and tell me the result.`
2. Confirm any approval or permission request required by the existing app.
3. Open Scheduled Tasks.
4. Inspect the created job.
5. Build a runtime scheduled-task preview for the same shell job in the E2E harness.

Expected:

- Existing scheduler owns the executable job.
- Task kind is `jarvis_action`.
- Any shell command follows existing daemon/scheduler approval and permission policy.
- Runtime preview has `approvalRequired: true`.
- Runtime preview stores only a shell command fingerprint.
- Raw shell command text does not appear in runtime preview artifacts.

### RTE2E-13: Diagnostics Redaction

Setup:

- Enable `JARVIS_RUNTIME_DRY_RUN=1`.

Steps:

1. Call `/api/runtime/dry-run` with a metadata payload containing `accessToken`, `cookie`, `sessionId`, `password`, and `apiKey`.
2. Include tool args in `availableTools` or policy snapshots that contain sensitive-looking keys.
3. Run a visible Settings > Diagnostics dry run afterward.
4. Capture API response, UI screenshot, and server logs from the test run.

Expected:

- API response contains `[redacted]` where sensitive keys are surfaced.
- No raw secret value appears in formatted preview, UI, client log, server log, or persisted test artifact.
- Runtime decision remains valid after redaction.

### RTE2E-14: Auth And Policy Blocked Tools

Setup:

- Enable `JARVIS_RUNTIME_DRY_RUN=1`.
- Use direct API or an E2E-only diagnostics harness that can pass `availableTools`, `auth`, and `policy` snapshots.

Steps:

1. Submit a memory lookup with `memory_search` available but no `memory:read` scope.
2. Submit a send-email prompt with `send_email` available and policy requiring approval.
3. Submit a daemon prompt with daemon tool marked blocked by policy.

Expected:

- Missing scope returns a missing-scope or blocked tool preflight status.
- Approval-required tool returns approval preview and no direct answer.
- Policy-blocked daemon tool returns blocked/degraded preview.
- No tool executes in any case.

## Automation Strategy

Automate in this order.

1. API E2E smoke tests for `/api/runtime/dry-run` and `/api/runtime/read-only`.
2. Browser/app E2E for Settings > Diagnostics > Runtime Preview.
3. Chat-prompt E2E for existing-owner fallback: memory correction, reminders, scheduled shell jobs, and daemon prompts.
4. Storage-neutral harness checks for v0.2 adapters that are not UI-wired yet.
5. Screenshot checks for Runtime Preview status transitions: Idle, Disabled, Ready, Approval, Blocked.

Recommended automation files:

- `server/core/runtime/__tests__/runtimeDiagnosticsRoutes.test.ts` for route-level expansion
- a new `server/core/runtime/__tests__/runtimeE2EPlan.assert.ts` only if the plan itself needs guardrails
- a future Playwright or Expo E2E spec for Settings > Diagnostics
- a future DB-backed smoke suite guarded by `JARVIS_RUN_DB_TESTS_WITH_DATABASE_URL=1`

## Required Evidence Per Run

Save or attach these artifacts for a full E2E run:

- environment flag snapshot with secrets omitted
- authenticated QA user id or test account label
- Runtime Preview screenshots for disabled, ready, approval, and blocked states
- API responses for `/api/runtime/dry-run` and `/api/runtime/read-only`
- scheduled task before/after row count for reminder and shell-job tests
- memory before/after state for correction tests
- approval gate before/after count for approval-preview tests
- daemon audit envelope sample with raw payload values absent
- final `npm test` output summary

## Exit Criteria

Runtime E2E is considered passing when:

- all global pass criteria hold
- every test case above either passes or has a documented product gap
- preview-only paths remain side-effect free
- runtime-owned read-only paths are limited to allowlisted workflows
- kill switch rollback is verified
- existing Jarvis chat, memory, daemon, approval, and scheduler owners still work

## Known Product Gaps To Track

- Runtime memory calibration, daemon audit, and scheduled-task preview are not exposed as user-facing UI panels yet.
- The Runtime Preview panel does not currently accept custom auth/policy/tool snapshots from the UI.
- Main chat is not yet fully wired to use runtime read-only ownership directly; `/api/runtime/read-only` is the current live route surface.
- DB-backed E2E requires a disposable database and should stay opt-in.
