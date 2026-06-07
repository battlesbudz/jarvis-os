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

## Still Forbidden

- Do not execute tools from Core Runtime preview helpers.
- Do not write memory from preview output.
- Do not enqueue jobs from preview output.
- Do not create approval records from `RuntimeApprovalPreview`.
- Do not merge runtime decisions back into the live harness without a dedicated integration PR.
- Do not enable `JARVIS_RUNTIME_LIVE_EXECUTION` until a runtime-owned executor exists with tests.

## First Live Integration Candidate

The safest first route experiment is a read-only diagnostics endpoint guarded by `JARVIS_RUNTIME_DRY_RUN=1`. It should:

- accept a message and user id
- adapt the input to `JarvisEvent`
- run guarded dry run
- return the preview report and formatted text
- avoid tool registry imports unless passing explicit metadata
- avoid persistence

## Rollback

Rollback remains deleting the preview route or disabling `JARVIS_RUNTIME_DRY_RUN`. No runtime preview helper owns durable state.
