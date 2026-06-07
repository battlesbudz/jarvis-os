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

## Tool Gateway Preflight

The first Tool Gateway slice is preflight-only. It accepts protocol `ToolIntent` objects plus an explicit registry/auth/policy snapshot and returns one of:

- `ready`
- `needs_auth`
- `missing_scope`
- `provider_down`
- `blocked_by_policy`
- `approval_required`

This layer does not import the live tool registry and never executes tools. It is the policy vocabulary that future runtime adapters can use before handing execution back to the existing tool owners.

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
