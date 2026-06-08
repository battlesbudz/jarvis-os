# Jarvis Core Runtime

Jarvis Core Runtime is the stable execution contract for Jarvis OS. It is not a folder move and it is not a replacement for the current app, agent harness, memory layer, routes, jobs, or daemons.

The first version is a wrapper and protocol layer over the working product:

```text
Channel or app request
  -> Jarvis Runtime Protocol
  -> existing agent harness, memory, tools, jobs, approvals
  -> Mind Trace and user response
```

## Purpose

Jarvis already has powerful behavior across the app, server routes, agent harness, memory, tools, jobs, channels, and device daemons. The Core Runtime gives that behavior one shared language before any risky migration.

The runtime should make these things explicit:

- what event arrived
- what context was assembled
- what the runtime decided
- which tools were intended
- whether approval was required
- which model route was chosen
- what trace proves the path
- what failed or degraded

## Current Owners

| Runtime Concern | Current Owner | Future Core Runtime Surface |
|---|---|---|
| Request and channel input | `server/routes.ts`, route slices, channel modules | `server/core/protocol/JarvisEvent` |
| Context routing | `server/agent/contextPacks.ts`, memory modules | `server/core/protocol/ContextPacket` |
| Tool preflight and execution | `server/agent/harness.ts`, `server/agent/tools/` | `server/core/tools/toolGateway.ts` |
| Approval gates | `server/agent/agentApproval.ts`, route handlers | `server/core/protocol/ApprovalRequirement` |
| Model/provider choice | `server/agent/modelRouter.ts`, provider modules | `server/core/protocol/ModelRoute` |
| Trace | `server/agent/mindTrace.ts`, `mindTraceRecorder.ts` | `server/core/protocol/MindTraceRef` |
| Errors and degraded paths | harness callbacks, route errors, diagnostics | `server/core/protocol/RuntimeError` |

## Golden Workflows

The current golden workflow source is `docs/operations/jarvis-golden-workflows.md`. Core Runtime v0.1 does not replace that document. It converts those workflow definitions into protocol examples and tests.

Future runtime work should map every behavior change to at least one golden workflow:

- simple answer
- reminder with vague time
- memory lookup with provenance
- memory correction
- calendar draft requiring approval
- email draft without send
- background research job
- OAuth unavailable path
- unsafe device action rejection
- morning review of overnight work

## v0.1 Scope

Core Runtime v0.1 is intentionally small:

- add protocol schemas
- validate runtime decisions
- fail closed on invalid protocol output
- adapt one existing Mind Trace into a protocol-shaped `RuntimeDecision`
- document how existing modules map to future runtime ownership

No behavior should move in v0.1. Tool execution, memory writes, jobs, approvals, and route behavior remain owned by the existing modules.

## v0.2 Runtime Gate Preview

Core Runtime v0.2 adds a read-only Runtime Gate preview around `JarvisEvent`.

The preview maps an incoming event through the existing context-pack classifier, then emits protocol-shaped `ContextPacket`, `RuntimeDecision`, and gate outcome objects. It is deliberately observational:

- no live route changes
- no tool execution
- no memory writes
- no job enqueueing
- no approval bypasses

Invalid events fail closed into a blocked runtime decision with validation errors attached.

## Runtime Tool Preflight Preview

The Runtime Gate can now be previewed with Tool Gateway preflight in one dry-run call. This path:

- validates and classifies the incoming `JarvisEvent`
- emits protocol-shaped context and runtime decision objects
- preflights the decision's `ToolIntent` list
- returns tool readiness without executing anything

This is still preview-only. It does not change app routes, execute tools, write memory, enqueue jobs, or create approval records.

## Tool Gateway Preflight

The first Tool Gateway slice is preflight-only. It accepts protocol `ToolIntent` objects plus an explicit registry/auth/policy snapshot and returns one of:

- `ready`
- `needs_auth`
- `missing_scope`
- `provider_down`
- `blocked_by_policy`
- `approval_required`

This layer does not import the live tool registry and never executes tools. It is the policy vocabulary that future runtime adapters can use before handing execution back to the existing tool owners.

## Agent Tool Descriptor Adapter

Existing `AgentTool` objects can be adapted into Tool Gateway descriptors without importing the live registry. The adapter accepts tool-name shaped objects and optional explicit overrides, then infers conservative provider, scope, risk, and approval metadata for preflight.

This adapter is intentionally metadata-only. It does not call `execute`, mutate the tool list, or grant provider access.

## Runtime AgentTool Preflight

Runtime Tool Preflight can accept existing `AgentTool`-shaped metadata through the descriptor adapter. This convenience path allows preview callers to pass the current tool surface without importing `ALL_TOOLS` inside core runtime and without calling tool `execute` handlers.

## Runtime Preview Report

Preview output can be summarized into a compact readiness report for logs, route experiments, and UI panels. The report names the event, user, intent, response mode, risk tier, gate outcome, ready/blocked tool counts, approval requirement, and normalized reasons.

The report is derived from preview objects only. It does not execute tools, persist traces, create approvals, or alter runtime decisions.

## Runtime Redaction

Runtime protocol objects can contain tool argument previews, provider metadata, or trace-like payloads. Redaction helpers sanitize sensitive keys such as tokens, API keys, authorization headers, passwords, cookies, sessions, and private keys before preview data is shown in reports or logs.

Redaction returns new protocol-shaped objects and does not mutate the original runtime decision.

## Runtime Approval Preview

Approval-required runtime decisions can be transformed into a redacted approval preview object. The preview includes the event, user, intent, risk tier, reason, and approval-required tools with sanitized argument previews.

This is not an approval record and it does not notify, persist, approve, reject, or execute anything.

## Runtime Dry Run

Runtime dry run composes the preview pieces into one result: runtime/tool preflight preview, readiness report, and optional approval preview. It is the safest integration surface for route experiments because all outputs are derived and no side effects occur.

## Runtime Golden Dry Runs

Golden dry-run fixtures cover stable runtime expectations for general answers, memory lookup, approval-required email action, diagnostics-route approval preview, research queue, and invalid-event fail-closed behavior. These fixtures are small smoke cases for keeping the protocol, runtime gate, tool preflight, report, and approval preview aligned.

The fixture set now maps the documented golden workflow prompts for daily planning, email drafting, reminders/approvals, research, goal handoff, meeting prep, memory lookup, diagnostics, and invalid-event handling. Most workflows still remain owned by existing Jarvis modules; the runtime fixtures protect classification, gate outcome, approval, and response-mode contracts.

Exactly one fixture is marked runtime-owned in this slice: the general read-only answer. That fixture must pass through `executeRuntimeReadOnly` with zero executed tools and zero side effects. All higher-risk, tool-backed, queued, approval-required, or stateful workflows remain existing-Jarvis owned until their adapters have real execution and approval tests.

## Runtime Event Adapter

Simple route or channel inputs can be adapted into validated `JarvisEvent` objects with consistent IDs, timestamps, channel, and metadata defaults. The adapter validates through `JarvisEventSchema` and can feed dry-run previews without wiring any live route behavior.

## Runtime Feature Flags

Runtime preview, dry-run, and live workflow integration must be explicitly gated. The feature flag helper reads `JARVIS_RUNTIME_PREVIEW`, `JARVIS_RUNTIME_DRY_RUN`, `JARVIS_RUNTIME_LIVE_EXECUTION`, and `JARVIS_RUNTIME_LIVE_WORKFLOWS`, defaulting all capabilities off. Dry-run helpers still fail closed if broad live execution is enabled.

The route integration checklist lives in `docs/runtime-preview-integration-checklist.md`.

## Guarded Runtime Dry Run

Guarded dry run checks runtime feature flags before composing preview output. If dry run is disabled, callers get an explicit disabled result. If live execution is enabled, the helper throws because the current runtime slices are preview-only.

## Runtime Diagnostics Route

`POST /api/runtime/dry-run` is the first preview route integration. It adapts an authenticated request message into `JarvisEvent`, runs `tryRunRuntimeDryRun`, and returns a report, optional approval preview, and deterministic formatted text.

The route is read-only. It ignores body-supplied user ids, accepts only explicit metadata snapshots for tool/auth/policy preflight, and does not import live tool registries, execute tools, write memory, enqueue jobs, create approval records, or persist audit rows.

## Runtime Diagnostics UI

Settings > Diagnostics includes a Runtime Preview panel backed by `/api/runtime/dry-run`. The panel shows the latest preview status, formatted preview output, and a short client-local log. It does not persist previews and it does not change live app behavior.

## Runtime Preview Formatter

Runtime preview reports can be formatted into deterministic text for logs, diagnostics, or simple UI panels. Formatting consumes derived preview/report/approval objects only and does not inspect secrets or execute tools.

## Runtime Audit Event

Dry-run results can be transformed into structured audit event payloads containing event, decision, status, risk, response mode, approval, and tool-count metadata. The builder returns a payload only; it does not write logs, persist records, or emit events.

## Runtime Audit Trace Link

Runtime audit events can be linked to existing orchestration traces or adapted Mind Trace records with a persistable, preview-only payload. The link carries IDs, status, risk, approval, route, and task metadata only; it does not write the trace table, create audit rows, or execute any runtime work.

## Runtime Read-Only Executor

The first runtime-owned executor handles only `inline_answer` decisions with `answer` response mode and no approval requirement. It returns a deterministic read-only response envelope, records zero executed tools and zero side effects, and declines or blocks anything that needs approval, queueing, tool execution, or invalid-event recovery.

## Runtime Live Route Preflight Gate

Live routes can preflight a request against the runtime before choosing an owner. With `JARVIS_RUNTIME_LIVE_EXECUTION` off, the gate returns the existing route owner. With it on, only completed read-only runtime executions that match an allowlisted `JARVIS_RUNTIME_LIVE_WORKFLOWS` id become `core_runtime` owned; approval-required, queued, tool-candidate, and non-allowlisted decisions continue through the legacy route owner, while invalid runtime events block.

The first live allowlisted workflow id is `general-answer`, which covers the low-risk general answer golden workflow with zero executed tools and zero side effects.

## Runtime Read-Only Route

`POST /api/runtime/read-only` is the first route that can return a runtime-owned execution envelope. It requires authentication, `JARVIS_RUNTIME_LIVE_EXECUTION=1`, and a matching `JARVIS_RUNTIME_LIVE_WORKFLOWS` id, ignores body-supplied user ids, returns only sanitized execution and decision summaries, and declines back to the existing route owner for approval-required, queued, tool-candidate, or non-allowlisted work.

## Runtime Approval Workflow

Approval-required runtime decisions and existing approval gates can be shaped into workflow previews. Pending gates expose a redacted approval preview; approved gates become a resume handoff for the existing route/tool owner; rejected or expired gates cannot resume. Runtime does not execute the approved tool in this slice.

## Tool Capability Summary

Tool Gateway descriptors can be summarized into provider, scope, approval, and maximum-risk metadata. This helps preview callers understand the available tool surface before attempting preflight.

## Runtime Capability Preview

AgentTool-shaped metadata can be adapted once, summarized as a capability surface, and used for a runtime dry run. This provides a combined view of available tools and event-specific readiness without importing live tool registries or executing tools.

## Non-Goals

- no broad folder restructuring
- no direct tool behavior changes
- no new autonomy powers
- no model training
- no new channel or device surface
- no weakening of approval, auth, safe-write, daemon, or memory-review controls

## Done Criteria For Runtime Refactors

A Core Runtime change is done only when:

- existing behavior is preserved or the intentional change is named
- protocol validation is covered by tests
- approval boundaries are unchanged or stricter
- Mind Trace or runtime trace becomes clearer
- rollback is simply removing the wrapper or adapter
- docs explain which existing owner was wrapped
