# Runtime Preview Integration Checklist

This checklist describes what can be wired after the Core Runtime preview stack lands. It keeps preview integration separate from live execution.

## Safe Preview Wiring

- Use `jarvisEventFromMessage` to adapt route or channel input into `JarvisEvent`.
- Use `tryRunRuntimeDryRun` for gated preview-only route experiments.
- Require `JARVIS_RUNTIME_DRY_RUN=1` before returning dry-run output from a route.
- Keep `JARVIS_RUNTIME_LIVE_EXECUTION` unset. Current runtime slices fail closed when it is enabled.
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
- Do not enable `JARVIS_RUNTIME_LIVE_EXECUTION` for routes until a dedicated live-route integration PR proves the runtime-owned executor boundary with tests.

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

## Rollback

Rollback remains deleting the preview route or disabling `JARVIS_RUNTIME_DRY_RUN`. No runtime preview helper owns durable state.
