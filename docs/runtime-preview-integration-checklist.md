# Runtime Preview Integration Checklist

This checklist describes what can be wired after the Core Runtime preview stack lands. It keeps preview integration separate from live execution.

## Safe Preview Wiring

- Use `jarvisEventFromMessage` to adapt route or channel input into `JarvisEvent`.
- Use `tryRunRuntimeDryRun` for gated preview-only route experiments.
- Require `JARVIS_RUNTIME_DRY_RUN=1` before returning dry-run output from a route.
- Keep `JARVIS_RUNTIME_LIVE_EXECUTION` unset unless deliberately testing a named runtime-owned workflow.
- Use `runRuntimeCapabilityPreview` only with explicit AgentTool-shaped metadata.
- Display `RuntimePreviewReport`, `RuntimeApprovalPreview`, `RuntimeAuditEvent`, or `formatRuntimePreview` output.
- Treat all preview output as advisory. Existing app routes, harness, tools, memory, jobs, and approvals remain the source of live behavior.
- Use the authenticated request user as the runtime `userId`; do not trust a body-supplied user id.

## Still Forbidden

- Do not execute tools from Core Runtime preview helpers.
- Do not write memory from preview output.
- Do not enqueue jobs from preview output.
- Do not create approval records from `RuntimeApprovalPreview`.
- Do not merge runtime decisions back into the live harness without a dedicated integration PR.
- Do not enable `JARVIS_RUNTIME_LIVE_EXECUTION` without either setting a narrow `JARVIS_RUNTIME_LIVE_WORKFLOWS` allowlist or deliberately enabling `JARVIS_RUNTIME_DEFAULT_READ_ONLY`.
- Do not call injected runtime tool executors unless `executeRuntimeDecisionToolsThroughGateway` reports every tool intent as preflight-ready.

## Current Preview Integration

The first route experiment is `POST /api/runtime/dry-run`. It is authenticated, read-only, and guarded by `JARVIS_RUNTIME_DRY_RUN=1`. It:

- accepts a message plus optional `source`, `channel`, `eventId`, `createdAt`, `metadata`, `availableTools`, `auth`, and `policy` snapshots
- ignores body-supplied `userId` and uses `req.userId`
- adapts the input to `JarvisEvent`
- runs guarded dry run
- returns disabled output when `JARVIS_RUNTIME_DRY_RUN` is off
- returns `RuntimePreviewReport`, redacted `RuntimeApprovalPreview`, and `formatRuntimePreview` text when enabled
- avoids live tool registry imports unless the caller passes explicit metadata snapshots
- avoids persistence, tool execution, memory writes, job enqueueing, and approval record creation

The Settings Diagnostics screen mounts a Runtime Preview panel backed by this route. Its log is client-local only.

## Runtime-Owned Read-Only Executor

`executeRuntimeReadOnly` is the first runtime-owned executor. It handles only safe `inline_answer` decisions, returns a deterministic response envelope, and records zero executed tools and zero side effects. It declines approval-required, queued, tool-candidate, and non-answer decisions. It is not wired into live app routes yet.

## Live Route Preflight Gate

`preflightRuntimeLiveRoute` lets a future live route ask whether Core Runtime or the existing route owner should handle a request. Runtime ownership is allowed only when `JARVIS_RUNTIME_LIVE_EXECUTION=1`, `executeRuntimeReadOnly` completes, and the matched workflow id is listed in `JARVIS_RUNTIME_LIVE_WORKFLOWS` or `JARVIS_RUNTIME_DEFAULT_READ_ONLY=1`.

The runtime-owned read-only workflow ids are `general-answer`, `memory-lookup`, `email-draft-reply`, and `next-meeting-brief`. Approval-required, queued, tool-candidate, non-allowlisted, and non-matching requests continue through the existing route owner; invalid runtime events block instead of falling through.

## Runtime Read-Only Route

`POST /api/runtime/read-only` is the first runtime-owned workflow route. It is authenticated, requires `JARVIS_RUNTIME_LIVE_EXECUTION=1` and `JARVIS_RUNTIME_LIVE_WORKFLOWS=general-answer` before returning the first runtime-owned execution, ignores body-supplied `userId`, and returns only execution and decision summaries. It does not return request metadata snapshots and does not execute tools.

## Approval Workflow Preview And Resume

`buildRuntimeApprovalWorkflow` and `buildRuntimeApprovalWorkflowFromGate` describe approval-required work without executing it. Pending approvals return redacted preview data, approved gates return a `ready_to_resume` handoff for the existing owner, and rejected or expired gates remain non-resumable.

`openRuntimeApprovalGate` is the first bridge from a runtime approval decision into the existing Jarvis approval gate system. It creates an `agentApproval.requestApproval` request with redacted runtime metadata and returns a pending runtime approval workflow. Approval resume still hands back to the existing route/tool owner; runtime does not execute approved tools yet.

## Rollback

Rollback remains disabling `JARVIS_RUNTIME_DRY_RUN`, disabling `JARVIS_RUNTIME_LIVE_EXECUTION`, disabling `JARVIS_RUNTIME_DEFAULT_READ_ONLY`, removing the workflow id from `JARVIS_RUNTIME_LIVE_WORKFLOWS`, or setting `JARVIS_RUNTIME_KILL_SWITCH=1`. No runtime preview or read-only helper owns durable state.

Runtime persistence records are storage-neutral until a caller supplies an explicit writer. Rollback for this slice is removing that writer or leaving it unconfigured.
