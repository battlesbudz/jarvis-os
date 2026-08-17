# Product Requirements Document: Active Project Capsule + Universal Live Action Card

One continuous view of what Jarvis knows, what it is doing, and what needs the user next

- **Product:** Jarvis OS
- **Status:** Proposed for implementation
- **Prepared:** August 16, 2026
- **Audience:** Product, mobile, server/runtime, agent, and QA contributors
- **Target:** Incremental rollout behind feature flags; no big-bang migration
- **Source baseline:** Jarvis OS main at [`ed8de904`](https://github.com/battlesbudz/jarvis-os/commit/ed8de9040398ad72d7e0d3a4c21eb3a0a459ca2d) plus current architectural direction

> **Product decision:** Build a shared read model and UI contract over Jarvis's existing projects, jobs, approvals, deliverables, tools, and device runtimes. Do not replace those execution systems in this feature.

## 1. Executive summary

Jarvis can already create projects, queue background workers, request approvals, control devices, produce deliverables, and expose diagnostics. The user experience, however, is fragmented across chat, voice, Projects, Inbox, Mission Control, and Settings. A user can be told that work was queued without receiving one durable, live answer to three basic questions: What project are we working on? What is Jarvis doing right now? What do I need to do next?

This PRD introduces two connected surfaces. The Active Project Capsule provides persistent, bounded project context for the user and for Jarvis's runtime. The Universal Live Action Card provides a single presentation and interaction contract for long-running or stateful work, regardless of which subsystem owns execution.

| **Surface**                | **Primary question**            | **Lifetime**                                | **Canonical inputs**                                        |
|----------------------------|---------------------------------|---------------------------------------------|-------------------------------------------------------------|
| Active Project Capsule     | What are we working toward?     | Persistent until switched or cleared        | Project, plan, project sessions, artifacts, active actions  |
| Universal Live Action Card | What is Jarvis doing right now? | From acknowledgement through terminal state | Jobs, tools, approvals, devices, deliverables, event stream |

## 2. Problem statement

### 2.1 User problem

- Project context is visible mainly inside the Projects experience and is not reliably carried into every chat or voice continuation.

- Background work, approval gates, deliverables, browser activity, device actions, and diagnostics use different status representations and controls.

- A queued acknowledgement can feel like a dead end when there is no immediately visible progress, current step, or artifact trail.

- After reconnecting, changing surfaces, or restarting voice, users can lose confidence that Jarvis remembers the objective and the exact action state.

- When something stalls or fails, users must infer whether Jarvis is waiting, retrying, blocked by approval, missing authentication, or actually finished.

### 2.2 System problem

Jarvis already holds the required source data, but it is distributed. Project state lives in jarvis_projects and project sessions. Worker progress and approval checkpoints live within agent job runtime data. Deliverables and approval gates have separate lifecycles. Browser, desktop, and Android actions can emit progress without a shared persistent envelope. The product lacks one normalized, user-scoped projection that can be rendered consistently everywhere.

### 2.3 Why now

Recent Jarvis work has improved memory continuity, background jobs, approvals, Android control, voice, and diagnostics. The next leverage point is not another isolated capability. It is a reliability and legibility layer that makes existing capabilities feel like one assistant. This feature also creates the presentation contract needed for future Bluetooth glasses, smart-home adapters, and local hardware integrations.

## 3. Product vision and principles

> **Vision:** Whenever Jarvis starts work, the user should immediately see the relevant project, the current action, the next checkpoint, and any required intervention - without hunting through another screen.

| **Principle**            | **Meaning**                                                                                                |
|--------------------------|------------------------------------------------------------------------------------------------------------|
| State over prose         | The card must reflect authoritative runtime state, not a model-generated status sentence.                  |
| One action, one identity | The same work item keeps the same action ID across screens, reconnects, retries, and approval pauses.      |
| Visible degradation      | Waiting, stalled, offline, rate-limited, and failed states must be explicit.                               |
| Approval integrity       | The card may expose an existing approval, but it must never invent, bypass, or duplicate an approval gate. |
| Bounded context          | The project capsule is compact, provenance-bearing, and never a raw dump of files or chat history.         |
| Progress without theater | Percent complete is optional. A truthful current step is preferable to a fabricated percentage.            |
| Adapters, not rewrites   | Existing execution owners remain canonical; the new layer normalizes and projects their state.             |

## 4. Goals, non-goals, and scope

### 4.1 Goals

- Give every authenticated user a clear active-project indicator that persists across supported Jarvis surfaces.

- Inject a safe, bounded project capsule into runtime context when an active project is relevant.

- Render long-running and stateful work through one Live Action Card component and one shared action lifecycle.

- Allow reconnecting clients to reconstruct active state without relying on an in-memory stream replay.

- Surface approval, waiting-for-user, artifacts, failure recovery, and cancellation consistently.

- Reduce duplicate status questions and false claims that work has completed.

### 4.2 MVP scope

- Project activation, switching, clearing, and context-resolution precedence.

- Capsule builder for general and app projects using existing project, plan, session, artifact, job, and deliverable data.

- Persistent live-action projection for agent jobs, project work sessions, approval waits, and deliverable handoff.

- Compact and expanded card states in mobile chat/voice-adjacent UI, Projects, Inbox, and Mission Control.

- REST snapshot endpoints plus a cursor-based server event stream with polling fallback.

- Cancel, retry, open approval, and open artifact controls when supported by the source owner.

- Stall detection and sanitized activity events.

### 4.3 Non-goals

- Replacing agentJobs, jarvisProjects, deliverables, approval gates, workflows, or daemon execution with a new orchestration engine.

- Showing internal chain-of-thought, hidden model reasoning, raw prompts, secrets, tokens, cookies, shell output, or sensitive device payloads.

- Inventing a precise completion percentage when the execution owner cannot supply one.

- Building gesture control, CAD, 3D printing, Kasa control, or Bluetooth-glasses integration in this release.

- Guaranteeing full feature parity in third-party text channels during MVP; those channels receive a compact text fallback.

- Automatically changing the active project because semantic retrieval merely mentioned another project.

## 5. Users and jobs to be done

| **User situation**                           | **Job to be done**                                                  | **Expected outcome**                                      |
|----------------------------------------------|---------------------------------------------------------------------|-----------------------------------------------------------|
| Continuing a multi-session build             | Keep the goal and next step active across chat, voice, and Projects | Jarvis resumes without repeating settled questions        |
| Running research or document work            | See that work is alive and inspect the current step                 | No need to ask whether the task started                   |
| Approval-gated action                        | Understand exactly what is blocked and approve safely               | One approval, one receipt, then visible resumption        |
| Device or browser automation                 | See the target, current operation, and safe control options         | User can intervene or cancel without guessing             |
| Recovering after app or network interruption | Reconstruct project and action state                                | The same cards reappear with current authoritative status |
| Diagnosing a failure                         | Distinguish failed, stalled, waiting, and retrying                  | The next recovery action is explicit                      |

## 6. Core concepts

### 6.1 Active Project Capsule

A compact, versioned read model representing the project context currently relevant to a user request or session. It is derived from authoritative project state and related records; it is not itself long-term memory.

### 6.2 Universal Live Action

A persistent, normalized projection of stateful Jarvis work. It references the canonical execution owner and exposes only the fields needed for display, controls, recovery, and audit. The projection does not execute work by itself.

### 6.3 Live Action Card

The reusable UI component that renders a Universal Live Action in compact or expanded form. Card behavior is driven by action state and capabilities rather than by source-specific UI branches.

### 6.4 Relationship

The capsule answers the durable question, 'What are we working on?' Live Action Cards answer the transient question, 'What is happening now?' A project capsule may summarize zero or more active actions; an action may be associated with a project or may be unscoped.

## 7. Experience requirements

### 7.1 Active Project Capsule anatomy

| **Field**        | **Compact view**             | **Expanded view**                         | **Context packet**                     |
|------------------|------------------------------|-------------------------------------------|----------------------------------------|
| Project identity | Title + status               | Title, description, goal                  | ID, title, goal                        |
| Progress         | Current step + concise state | Plan, completed steps, last progress time | Current, last, and next step           |
| Attention        | Waiting/approval badge       | Pending question or approval details      | Reason and safe reference ID           |
| Actions          | Count + top action           | Active/recent Live Action Cards           | Top action summaries only              |
| Artifacts        | Latest artifact              | Recent files/deliverables with deep links | Names, types, provenance; no raw bytes |
| Freshness        | Updated relative time        | Source timestamps and uncertainty         | generatedAt + source revisions         |

### 7.2 Capsule behavior by surface

- Chat: show a slim capsule above the composer when a project is active; tap to expand or switch.

- Voice: announce only meaningful changes, such as a project switch or approval wait. Do not narrate every progress event. The visual capsule remains available in the voice screen.

- Projects: the selected project displays the expanded capsule and all project-scoped actions.

- Inbox and Mission Control: show project linkage on each card and allow navigation back to the project.

- Text channels: use one compact status line and a deep link when available; do not stream noisy step updates.

### 7.3 Live Action Card anatomy

| **Area**  | **Required content**                                            | **Rules**                                                             |
|-----------|-----------------------------------------------------------------|-----------------------------------------------------------------------|
| Header    | Action icon, title, project label, status badge                 | Title is stable; status is derived from the normalized lifecycle      |
| Now       | Current step or truthful state explanation                      | Never substitute model-generated filler for missing progress          |
| Progress  | Optional percent, phase count, or indeterminate indicator       | Percent must come from the source owner or deterministic plan math    |
| Attention | Approval, question, authentication, provider, or device blocker | Expose one primary next action                                        |
| Activity  | Sanitized user-visible events with timestamps                   | No hidden reasoning, secrets, raw command payloads, or unbounded logs |
| Outputs   | Artifacts, deliverables, previews, and links                    | Every output carries provenance and availability state                |
| Controls  | Open, cancel, pause, resume, retry, approve/reject deep link    | Only render capabilities confirmed by the source adapter              |

### 7.4 Action lifecycle

| **Normalized state** | **Meaning**                              | **Typical source mappings**                                   | **Primary card treatment**             |
|----------------------|------------------------------------------|---------------------------------------------------------------|----------------------------------------|
| created              | Acknowledged but not yet queued          | Request accepted; projection created                          | Neutral, brief                         |
| queued               | Waiting for an execution slot            | agentJobs.queued, project planning queued                     | Queue position/age if known            |
| running              | Actively executing                       | job running, project session running, device operation active | Current step + live indicator          |
| waiting_approval     | Blocked on an existing approval gate     | pending approval/checkpoint                                   | Prominent approval call to action      |
| waiting_user         | Needs information or a choice            | project question_pending, workflow paused_waiting             | Show question and respond action       |
| paused               | Intentionally or resource paused         | resource_paused, project paused                               | Reason + resume if supported           |
| succeeded            | Execution completed successfully         | job complete/delivered, project complete                      | Output summary + artifact links        |
| failed               | Execution terminated unsuccessfully      | job/project failed                                            | Safe error + retry/recovery            |
| cancelled            | Cancellation reached a terminal state    | job cancelled, user aborted                                   | Muted terminal state                   |
| expired              | Required continuation is no longer valid | approval expired, session lease expired                       | Explain that a new request is required |

> **Lifecycle rule:** A cancel request is an event and may temporarily display 'Cancelling'; the terminal action state remains cancelled only after the execution owner confirms cancellation.

### 7.5 Compact and expanded behavior

- Compact cards show the minimum trustworthy status: title, status, current step, one blocker/output, and one primary control.

- Expanded cards show activity history, timestamps, project linkage, outputs, diagnostic hint, and all supported controls.

- Completed cards collapse automatically after acknowledgement but remain accessible in the relevant project or Inbox history.

- Multiple actions group by project. The most urgent card ranks first: approval, waiting user, failed, running, queued, paused, terminal.

## 8. Functional requirements

### 8.1 Active Project Capsule

| **ID**  | **Requirement**          | **Acceptance statement**                                                                                                                                 |
|---------|--------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------|
| APC-001 | Activation               | The user can activate, switch, or clear a project from Chat, Voice, or Projects.                                                                         |
| APC-002 | Resolution               | Resolve project context in this order: explicit request project ID, session binding, channel/thread binding, global user binding, none.                  |
| APC-003 | No semantic switching    | Memory retrieval or a project name mention must not silently change the active binding.                                                                  |
| APC-004 | Bounded packet           | Default context rendering is no more than 1,200 characters and 450 estimated tokens; oversize sections are deterministically truncated by priority.      |
| APC-005 | State separation         | Project capsule data is labeled current state; historical MemoryOS evidence remains separately labeled and provenance-bearing.                           |
| APC-006 | Freshness                | Include generatedAt, source timestamps, and uncertainty when any required source is unavailable.                                                         |
| APC-007 | Project data             | Include identity, goal, status, current/last/next step, pending question, latest session summary, active action summaries, and recent artifact metadata. |
| APC-008 | Context injection        | Inject only when a project resolves for the request and the route supports the shared runtime context builder.                                           |
| APC-009 | Authorization            | Every read and binding mutation is scoped to the authenticated user; body-supplied user IDs are ignored.                                                 |
| APC-010 | Cross-device             | Global binding changes become visible to another authenticated client within five seconds or on next foreground refresh.                                 |
| APC-011 | Deleted/archived project | Clear invalid bindings and present a non-blocking explanation; never inject stale project data.                                                          |
| APC-012 | Trace                    | Record capsule version, project ID, selected source IDs, omissions, and render length without recording private content in diagnostics.                  |

### 8.2 Universal Live Action

| **ID**  | **Requirement** | **Acceptance statement**                                                                                                              |
|---------|-----------------|---------------------------------------------------------------------------------------------------------------------------------------|
| LAC-001 | Identity        | Create one stable liveActionId for each logical source-action lineage. Retry-created source records rebind that action to the current sourceId instead of creating a second card. |
| LAC-002 | Projection      | Execution owners remain canonical; adapters project their state into live_actions and append user-visible events.                     |
| LAC-003 | Idempotency     | Replayed or duplicate source events do not create duplicate cards or regress the action version.                                      |
| LAC-004 | Ordering        | Every update carries a monotonically increasing version and event sequence; clients ignore older versions.                            |
| LAC-005 | Persistence     | A fresh client can reconstruct all active cards and the last 30 days of terminal cards without stream history.                        |
| LAC-006 | Progress        | Percent is nullable. currentStep, updatedAt, and progress kind are supported independently.                                           |
| LAC-007 | Approval        | Map existing gates/checkpoints to waiting_approval; approval actions must route through the existing gate/receipt APIs.               |
| LAC-008 | Waiting user    | Represent project questions, missing input, authentication, and recoverable choices with one primary next action.                     |
| LAC-009 | Controls        | Render only adapter-declared controls. Commands are authenticated, idempotent, source-dispatched, and audited.                        |
| LAC-010 | Cancel          | Display cancel_requested immediately, then reflect cancelled or the source's rejection/error.                                         |
| LAC-011 | Artifacts       | Attach typed references to deliverables/files/URLs with provenance, availability, and safe preview metadata.                          |
| LAC-012 | Activity        | Store a bounded, sanitized event stream; events over retention limits compact into a summary.                                         |
| LAC-013 | Stall           | Mark a running action stale when no heartbeat arrives within its adapter threshold; stale is a warning, not a terminal state.         |
| LAC-014 | Reconnect       | REST snapshot plus cursor stream resumes without duplicate cards or missing terminal transitions.                                     |
| LAC-015 | Hierarchy       | Support optional parentActionId for project -\> session -\> worker or research -\> artifact sub-actions.                              |
| LAC-016 | Redaction       | Never persist or render secrets, authorization headers, cookies, raw shell commands, hidden reasoning, or unrestricted stdout/stderr. |
| LAC-017 | Failure         | Display a user-safe error summary, failure category, retry eligibility, and next recovery action.                                     |
| LAC-018 | Channels        | Provide a compact text serializer for Telegram, Discord, Slack, WhatsApp, and webchat, and suppress high-frequency progress noise.    |

### 8.3 Accessibility and interaction

- Status is conveyed by text and icon, never by color alone.

- Cards expose accessible names, focus order, and minimum touch targets compatible with the existing mobile design system.

- Live updates use polite announcements; routine progress does not repeatedly interrupt screen-reader or voice users.

- Reduced-motion mode replaces pulsing/spinning treatments with static indicators.

- Relative times have an accessible absolute timestamp in expanded view.

## 9. Technical design

> **Architecture decision:** Use a materialized read model with source adapters. The source systems continue to own execution and safety. The read model owns normalized display state, persistence, event delivery, and client reconstruction.

### 9.1 Proposed components

| **Component**            | **Responsibility**                                                                                | **Suggested location**                                  |
|--------------------------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------|
| Shared contracts         | Zod/TypeScript schemas for capsule, action, event, control capability, artifact, and API payloads | shared/projectContext.ts; shared/liveActions.ts         |
| Project binding resolver | Persist and resolve global/session/channel project bindings with deterministic precedence         | server/projectContext/projectBinding.ts                 |
| Capsule builder          | Join project, plan, session, artifacts, actions, and uncertainty into a bounded read model        | server/projectContext/capsuleBuilder.ts                 |
| Action projector         | Upsert normalized action state and append sanitized events from source adapters                   | server/liveActions/projector.ts                         |
| Source adapters          | Map jobs, projects, approvals, deliverables, tools, and devices into the normalized contract      | server/liveActions/adapters/\*                          |
| Command dispatcher       | Authorize and route cancel/pause/resume/retry/open commands to canonical owners                   | server/liveActions/commands.ts                          |
| Snapshot/stream routes   | Authenticated snapshots, details, commands, and cursor event stream                               | server/routes/liveActionRoutes.ts                       |
| Client state             | Snapshot hydration, stream merge, version checks, polling fallback                                | lib/liveActions.ts; hooks/useLiveActions.ts             |
| UI components            | Compact/expanded ProjectCapsule and LiveActionCard                                                | components/projectContext/\*; components/liveActions/\* |

### 9.2 Data model

#### Active project bindings

> active_project_bindings
>
> id, user_id, project_id
>
> scope: global \| session \| channel
>
> scope_key, activation_source
>
> created_at, updated_at, expires_at?
>
> UNIQUE(user_id, scope, scope_key)

Resolution precedence is explicit projectId on the current event, then session, then channel/thread, then global. A binding is a current-state pointer and must not be stored as semantic memory.

#### Live actions

> live_actions
>
> id, user_id, project_id?, parent_action_id?
>
> lineage_type, source_lineage_key, source_type, source_id, kind, title, status, version
>
> current_step?, progress_kind, progress_value?
>
> attention?, control_capabilities, artifact_refs
>
> error_category?, error_summary?, retry_eligible
>
> created_at, started_at?, updated_at, completed_at?
>
> UNIQUE(user_id, lineage_type, source_lineage_key)
>
> live_action_events
>
> id, action_id, sequence, event_type, message?
>
> safe_metadata, user_visible, created_at
>
> UNIQUE(action_id, sequence)

The first version may project current agent job runtime events into these tables without modifying agent_jobs. Future execution owners publish the same event contract directly. Terminal records remain queryable for 30 days by default; audit or compliance retention remains with the canonical owner.

#### Retry lineage and canonical command targets

The immutable pair (`lineage_type`, `source_lineage_key`) identifies the logical work across replacement source records; `source_type` and `source_id` identify the mutable current command owner. `lineage_type` is fixed when the action is first created and never changes during retry, approval continuation, or adapter reconciliation. For an initial agent job, `lineage_type = agent_job` and `source_lineage_key = <root job ID>`. Explicit user retries bypass the general `submitAgentJob` duplicate guard so they always persist a replacement job with `retryOfJobId`; they must never alias the lineage to an unrelated already-active duplicate. For a retry-created job, the projector follows `retryOfJobId` to the root, reuses the existing `liveActionId`, updates `source_id` to the newest canonical job ID, and appends `action.retry_scheduled` followed by the new queued/running events. Commands always dispatch to the current `source_id`; historical source IDs remain event metadata for audit and reconciliation. The replacement insert, lineage rebind, and event append are atomic and idempotent so concurrent retry projection cannot create a second card. If a canonical owner cannot bypass deduplication, it must persist an equivalent atomic lineage-rebind signal before returning success; an HTTP-only deduplication response is insufficient.

#### Approval continuation lineage

A top-level approval that exists before execution is the lineage root for the resulting work. Its live action uses `lineage_type = approval_gate` and the gate ID as `source_lineage_key`. When `continueTopLevelApproval` creates a job carrying `input.originApprovalGateId`, the approval and job adapters atomically reuse that action's `liveActionId`, update only the mutable `source_type` and `source_id` to the continuation job, append `action.approval_resolved` and queued/running events, and retain the gate ID in safe lineage metadata. The waiting approval card therefore visibly resumes instead of terminating beside a second job card. If an approval is already attention on a pre-existing action, that parent lineage remains authoritative and the gate never creates its own card. Adapter tests must cover both top-level gate-to-job continuation and approval checkpoints within an existing job.

For approval continuations that do not create an agent job, the canonical approval owner must persist an idempotent continuation outcome before the HTTP decision route returns. The durable record is keyed by gate ID and records an allowlisted owner type/reference plus `started | succeeded | failed | rejected`, timestamps, and a safe failure category; it never stores raw tool arguments or secrets. `handleJarvisApprovalDecision`, direct-email continuation, and Agent SDK resumption must write `started` and a terminal outcome (or atomically update an equivalent existing receipt). The approval projector keeps the same lineage, shows running after `started`, and derives succeeded, failed, or cancelled/rejected only from that persisted outcome. A transient callback result or `approved` gate status alone is insufficient. Reconciliation must repair the Live Action from this durable owner record after reconnect, and adapter tests cover success, rejection, and continuation failure for every non-job owner path.

### 9.3 Shared object contracts

| **Object**            | **Required fields**                                                | **Important optional fields**                                                           |
|-----------------------|--------------------------------------------------------------------|-----------------------------------------------------------------------------------------|
| ProjectContextCapsule | version, projectId, title, goal, status, generatedAt, sources      | currentStep, lastAction, nextAction, attention, activeActions, artifacts, uncertainty   |
| LiveAction            | id, source, kind, title, status, version, capabilities, timestamps | projectId, parentActionId, progress, attention, events, artifacts, error, diagnosticRef |
| LiveActionEvent       | actionId, sequence, type, createdAt, userVisible                   | message, safeMetadata                                                                   |
| ControlCapability     | type, enabled                                                      | disabledReason, confirmationRequirement, targetRoute                                    |
| ArtifactRef           | id, type, title, provenance, availability                          | preview, mimeType, sizeBytes, deepLink                                                  |

### 9.4 API and event surface

| **Method** | **Route**                           | **Purpose**                                                              |
|------------|-------------------------------------|--------------------------------------------------------------------------|
| GET        | /api/project-context/active         | Resolve binding and return the active capsule for the current scope      |
| PUT        | /api/project-context/active         | Activate/switch project for a global, session, or channel scope          |
| DELETE     | /api/project-context/active         | Clear a binding for the requested scope                                  |
| GET        | /api/projects/:id/capsule           | Return a capsule for an explicitly opened project                        |
| GET        | /api/live-actions                   | Return versioned action snapshots filtered by active/project/status/time |
| GET        | /api/live-actions/:id               | Return expanded action state and bounded events                          |
| GET        | /api/live-actions/stream?cursor=... | Resume user-scoped Server-Sent Events from a monotonic cursor            |
| POST       | /api/live-actions/:id/commands      | Dispatch a supported idempotent command to the canonical owner           |

> **Safety boundary:** Approve and reject are not generic live-action commands in MVP. The card opens or invokes the existing approval-gate route so receipts, expiry, scope, and continuation semantics stay intact.

### 9.5 Event taxonomy

- action.created; action.queued; action.started; action.progress_updated

- action.waiting_approval; action.approval_resolved; action.waiting_user

- action.paused; action.resumed; action.cancel_requested; action.cancelled

- action.artifact_attached; action.warning; action.retry_scheduled

- action.succeeded; action.failed; action.expired

### 9.6 Source adapter mapping

| **Source**              | **Canonical owner**              | **Initial normalized mapping**                                |
|-------------------------|----------------------------------|---------------------------------------------------------------|
| Background worker       | agent_jobs + workerRuntime       | queued/running/cancelling/progress/checkpoints/complete/delivered/failed/cancelled |
| Project                 | jarvis_projects + sessions       | planning/building/waiting_for_input/paused/complete/failed    |
| Approval                | existing approval gates/receipts | waiting_approval -\> resumed/rejected/expired                 |
| Deliverable             | deliverables                     | artifact attached; succeeded with needs-review attention      |
| Workflow                | agent_workflows                  | parent action plus step child actions                         |
| Browser/desktop/Android | existing tool/daemon owners      | Phase 2 adapters after job/project MVP contract stabilizes    |

## 10. Context assembly rules

### 10.1 Capsule render priority

1.  Project identity and goal.

2.  Status, current step, and pending user/approval attention.

3.  Last completed action and next planned action.

4.  At most three active-action summaries.

5.  At most three recent artifact references.

6.  Latest project-session summary when space remains.

7.  Uncertainty and omitted counts.

### 10.2 Context exclusions

- Raw project files or archive bytes.

- Full chat transcripts.

- Hidden reasoning or provider traces.

- Raw tool arguments or device/shell payloads.

- Terminal actions unrelated to the current request.

- MemoryOS results unless separately retrieved and labeled as historical evidence.

### 10.3 Runtime integration

Extend the existing runtime state-card builder with an optional projectCapsule section rather than creating a second independent prompt path. The builder receives the resolved project ID and renders the bounded capsule. Routes that do not yet use the shared state-card path may consume the same renderer behind an explicit feature flag. Capsule traces must report source availability and omissions without duplicating private content.

## 11. Reliability, security, and privacy

| **Risk area**         | **Requirement**                                                                                                  |
|-----------------------|------------------------------------------------------------------------------------------------------------------|
| Authorization         | Scope every query and mutation by authenticated user; validate project/action ownership server-side.             |
| Approval bypass       | Never synthesize approved state from UI events; only existing approval receipts can resume protected execution.  |
| Sensitive data        | Apply runtime redaction before persistence and before response serialization; safe metadata is allowlisted.      |
| State drift           | Source adapter reconciliation periodically repairs projection drift; source remains canonical.                   |
| Replay/out-of-order   | Idempotency keys, unique source mapping, sequence constraints, and client version guards prevent regression.     |
| Offline clients       | Snapshot on foreground, cursor stream resume, exponential polling fallback, and visible stale/offline treatment. |
| Unbounded logs        | Bound event message length, metadata keys, event count, and retention; compact older activity.                   |
| Cross-project leakage | Project IDs are user-scoped and capsule builder joins only explicitly linked records.                            |

## 12. Performance and service levels

| **Measure**               | **MVP target**                                      | **Measurement point**                            |
|---------------------------|-----------------------------------------------------|--------------------------------------------------|
| Initial action visibility | p95 \<= 1.5 seconds after accepted acknowledgement  | Server accepted timestamp to first rendered card |
| Progress update latency   | p95 \<= 2 seconds while connected                   | Source event to rendered version                 |
| Snapshot load             | p95 \<= 750 ms for up to 25 actions                 | Authenticated API latency                        |
| Capsule build             | p95 \<= 250 ms excluding database outage fallback   | Server builder timing                            |
| Reconnect reconstruction  | p95 \<= 3 seconds after foreground/stream reconnect | Client foreground to correct active cards        |
| Duplicate-card rate       | \< 0.1% of source actions                           | Unique mapping and analytics reconciliation      |
| Terminal-state drift      | \< 0.5% after five-minute reconciliation window     | Source vs projection audit                       |

## 13. Acceptance criteria and golden workflows

### 13.1 End-to-end acceptance criteria

- Starting a project from chat activates it, shows a capsule, and injects the same project ID into the next supported runtime turn.

- Starting deep research creates one Live Action Card before the acknowledgement is complete, then updates from queued to running to succeeded with a deliverable link.

- A voice-triggered approval-gated action moves to waiting_approval, presents the existing approval, and visibly resumes after a valid approval receipt.

- A client restart reconstructs the same active project and card state without duplicate records or lost terminal transitions.

- Cancelling a worker shows Cancelling immediately and only displays Cancelled after the worker owner confirms it.

- A stalled worker remains running with a stale warning and diagnostic/retry path; it is not falsely marked failed.

- A failed worker shows a safe error category, retry eligibility, and a single recommended next action.

- No rendered card, event, trace, or capsule contains secrets, hidden reasoning, raw shell commands, cookies, or authorization headers.

- Switching projects changes the capsule and runtime project context but does not reassign already-running actions to the new project.

- The same action rendered in Inbox, Projects, and Mission Control uses the same ID, status, progress, and primary control.

### 13.2 Golden workflow matrix

| **Workflow**               | **Expected action path**                               | **Critical assertion**                        |
|----------------------------|--------------------------------------------------------|-----------------------------------------------|
| Background research report | created -\> queued -\> running -\> succeeded           | File/deliverable appears on the original card |
| App project build          | project parent + planning/build child actions          | Capsule current step matches project plan     |
| Email/calendar approval    | running -\> waiting_approval -\> running -\> succeeded | No duplicate send/create after reconnect      |
| Project question           | running -\> waiting_user -\> running                   | Question is visible in capsule and card       |
| Worker throttle/retry      | running -\> warning/retry -\> queued -\> running       | Action identity remains stable                |
| Cancellation               | running -\> cancel_requested -\> cancelled             | Terminal state comes from owner confirmation  |
| App restart                | snapshot -\> stream resume                             | No status regression or duplicate card        |
| Cross-project switch       | capsule A -\> capsule B                                | Action A remains linked to project A          |

### 13.3 Test requirements

- Contract tests for every normalized object and lifecycle transition.

- Adapter mapping tests for agent jobs, project states, approvals, and deliverables.

- Property tests for idempotency, monotonic versioning, and out-of-order event handling.

- Authorization tests proving no cross-user project/action access.

- Redaction regression fixtures containing tokens, cookies, commands, private paths, and model-thought-like content.

- Mobile component tests for every state, long titles, accessibility labels, reduced motion, and missing optional fields.

- End-to-end tests for snapshot + stream reconnect, polling fallback, cancellation, approval continuation, and artifact handoff.

- Golden voice workflow verifying that project/action continuity survives voice-session restart.

## 14. Analytics and success metrics

### 14.1 Events

- project_capsule_viewed, expanded, activated, switched, cleared

- live_action_card_created, viewed, expanded, control_selected

- live_action_waiting_approval, approval_opened, approval_resolved

- live_action_stale_shown, retry_selected, cancel_requested, artifact_opened

- live_action_reconstructed_after_reconnect, projection_drift_detected

### 14.2 Product success

| **Outcome**                  | **Target after baseline**                                                       | **Guardrail**                                 |
|------------------------------|---------------------------------------------------------------------------------|-----------------------------------------------|
| Fewer status-check questions | 30% reduction in 'is it running/done?' follow-ups for supported actions         | No increase in notification volume complaints |
| Better continuity            | 95% of reconnect golden runs restore correct project and action                 | Zero cross-project context leakage            |
| Trustworthy completion       | 99.5% agreement between terminal card and canonical source after reconciliation | No premature success display                  |
| Useful intervention          | 80% of blocked actions expose a valid next action                               | Approval and safety policies unchanged        |
| Action discoverability       | 90% of supported actions render a card within target latency                    | No duplicate-card rate above 0.1%             |

## 15. Rollout plan and PR sequence

### Phase 0 - Baseline and flags

- Add analytics for current job/project status surfaces and define baseline status-check, drift, and reconnect metrics.

- Feature flags: JARVIS_PROJECT_CAPSULE, JARVIS_LIVE_ACTIONS_PROJECTOR, JARVIS_LIVE_ACTIONS_UI, and JARVIS_LIVE_ACTIONS_STREAM.

### PR 1 - Contracts, persistence, and projector foundation

- Add shared schemas, migrations, repository/service layer, event ordering, idempotency, redaction, and source reconciliation.

- Implement agent-job adapter first, because it already contains progress, events, approval checkpoints, and lifecycle data.

- Ship read-only snapshot endpoints and comprehensive mapping/security tests; keep UI flag off.

### PR 2 - Active Project Capsule

- Add binding resolver, capsule builder, project routes, context-renderer integration, trace, and compact capsule UI.

- Use current project records, plan steps, sessions, snapshot files, related actions, and deliverables.

- Gate runtime injection independently from visual display for safe rollout and evaluation.

### PR 3 - Universal Live Action Card

- Add client snapshot hydration, stream merge, polling fallback, compact/expanded card components, and consistent placement across Chat/Voice, Projects, Inbox, and Mission Control.

- Add project, approval, and deliverable adapters plus cancel/retry/open controls.

### PR 4 - Device/browser coverage and hardening

- Add browser, desktop connector, Android daemon, and selected tool adapters using the stabilized contract.

- Add stale thresholds by adapter, diagnostics reconciliation, channel serializer, retention compaction, and load tests.

> **Recommended first coding slice:** PR 1 should stop after an authenticated endpoint can return one correctly normalized, persistent background-worker action with ordered progress, approval checkpoint metadata, redaction, and reconnection-safe versioning. That vertical slice proves the contract before UI proliferation.

## 16. Risks and mitigations

| **Risk**                | **Impact**                     | **Mitigation**                                                                                       |
|-------------------------|--------------------------------|------------------------------------------------------------------------------------------------------|
| Second source of truth  | Cards disagree with execution  | Treat projection as a read model; reconcile against canonical owners; never execute from table state |
| Adapter sprawl          | Every tool adds bespoke logic  | Require one adapter interface and contract tests; prefer event publishers for new tools              |
| Status noise            | Voice/chat becomes distracting | Compact updates, urgency ranking, channel throttling, and user-visible event allowlist               |
| False progress          | Trust degrades                 | Nullable percent; current-step and indeterminate modes; deterministic plan math only                 |
| Approval duplication    | Unsafe or double execution     | Reference existing gates; unique gate linkage; receipt-driven continuation                           |
| Cross-project leakage   | Wrong context reaches model    | Explicit bindings, owner-scoped joins, request precedence, security tests                            |
| Migration scope         | Large risky release            | Feature flags, adapter-by-adapter rollout, no execution-engine replacement                           |
| Long-lived event growth | Storage/performance cost       | Retention, compaction, bounded payloads, indexes, and pagination                                     |

## 17. Dependencies and ownership

| **Area**                    | **Primary owner**   | **Dependency**                                                   |
|-----------------------------|---------------------|------------------------------------------------------------------|
| Shared contract + migration | Core runtime/server | Drizzle schema and migration pipeline                            |
| Job/project adapters        | Agent/runtime       | agentJobs, workerRuntime, project runner, project sessions       |
| Approval mapping            | Agent safety        | existing gate, receipt, expiry, and continuation paths           |
| Mobile surfaces             | Expo app            | shared types, API client, query cache, voice/chat layout         |
| Mission Control/Inbox       | Product UI          | normalized action hooks and existing navigation                  |
| Diagnostics                 | Reliability         | projection/source reconciliation and privacy-safe traces         |
| QA                          | Cross-functional    | golden workflows, emulator E2E, reconnect and redaction fixtures |

## 18. Definition of done

- All APC and LAC requirements marked MVP have passing automated tests.

- At least the background-worker, project, approval, and deliverable adapters are production-enabled behind flags.

- The same normalized action renders consistently in the designated mobile surfaces.

- Active project context is visible and injected through the shared state-card path with bounded output and trace evidence.

- Reconnect, cancellation, approval continuation, retry, artifact handoff, and project switching pass golden E2E workflows.

- Security review confirms authenticated scoping, no approval bypass, redaction, and no cross-project leakage.

- Production diagnostics can detect stale actions, projection drift, duplicate mappings, and stream failures.

- Rollout dashboards show latency, drift, duplication, intervention, and user status-check baselines.

- @codex review is clean on each implementation PR before merge, following the Jarvis repository review policy.

## Appendix A - Initial status mapping

| **Existing state**               | **Normalized state** | **Notes**                                                          |
|----------------------------------|----------------------|--------------------------------------------------------------------|
| agentJobs.queued                 | queued               | Preserve queue age; position only if authoritative                 |
| agentJobs.running                | running              | Use workerRuntime progress/events when present                     |
| agentJobs.cancelling             | running              | Show Cancelling attention after cancel_requested; remain non-terminal until the owner confirms cancellation |
| agentJobs.resource_paused        | paused               | Expose resource reason and resume eligibility                      |
| agentJobs.complete               | succeeded            | May also carry needs-review attention until deliverable acted on   |
| agentJobs.delivered              | succeeded            | Preserve the succeeded card and mark its deliverable as delivered; do not regress to unknown or running |
| agentJobs.failed                 | failed               | Map safe category and retry eligibility                            |
| agentJobs.cancelled              | cancelled            | Terminal                                                           |
| jarvisProjects.planning/building | running              | Current plan step is primary progress                              |
| jarvisProjects.waiting_for_input | waiting_user         | question_pending is the primary attention object                   |
| jarvisProjects.paused            | paused               | Manual or policy pause                                             |
| jarvisProjects.complete          | succeeded            | Attach archive/repo/artifacts where available                      |
| jarvisProjects.failed            | failed               | Use consecutive error context only in diagnostics, not raw UI      |
| approval pending                 | waiting_approval     | Existing gate ID and expiry; never copy approval state from client |
| approval rejected                | cancelled or failed  | Adapter selects based on canonical owner semantics                 |
| approval expired                 | expired              | Requires a new request/gate                                        |
| workflow.paused_waiting          | waiting_user         | Parent action remains stable                                       |

## Appendix B - Open implementation decisions

The product behavior in this PRD is decided. The following engineering choices should be resolved during PR 1 without changing the user contract:

- Whether the cursor stream reuses an existing authenticated SSE framework or introduces a focused live-action stream module.

- Exact event compaction threshold and retention period after measuring current job volume.

- Whether global active-project binding belongs in the planned State Kernel store or the dedicated binding table first, provided resolution semantics remain identical.

- Whether project parent actions are materialized immediately in MVP or derived from child actions until the project adapter ships.

- Which existing diagnostic event table should hold projection drift alerts versus adding a dedicated metric only.
