# Jarvis Refactor Map

This map tracks where behavior lives today and where Core Runtime should wrap it later. It is a strangler-fig map, not a folder-move plan.

## Rule

Do not move working code just to make the repo look cleaner. Add stable core interfaces, adapt existing behavior, test the adapter, then migrate one route or workflow at a time.

## Current To Future

| Current Area | Current Role | First Runtime Step | Migration Risk |
|---|---|---|---|
| `server/agent/harness.ts` | model loop, tool calls, trace persistence | emit/adapter to `RuntimeDecision` | High |
| `server/agent/mindTrace.ts` | user-visible reasoning trace | adapt to `MindTraceRef` and protocol tests | Low |
| `server/agent/contextPacks.ts` | deterministic context routing | feed `ContextPacket.sources` and risk tier | Medium |
| `server/agent/tools/` | concrete tool implementations | wrap in Tool Gateway preflight later | High |
| `server/memory/` | memory retrieval, SOUL, trust, vault | wrap with Memory Context Adapter later | High |
| `server/routes.ts` | legacy central API routes | route slices call runtime wrappers later | High |
| `server/routes/` | newer focused routes | safest place for runtime route adapters | Medium |
| `server/daemon/` | Android/desktop bridge policy and actions | device capability adapter later | High |
| `shared/schema.ts` | persistence contract | no change for v0.1 | High |
| `docs/operations/jarvis-golden-workflows.md` | workflow smoke definitions | protocol fixtures and runtime evals | Low |

## Seed PR Boundary

This first runtime seed should only add:

- `docs/jarvis-core-runtime.md`
- `docs/jarvis-runtime-protocol.md`
- `docs/refactor-map.md`
- `server/core/protocol/*`
- protocol validation tests
- one Mind Trace to Runtime Decision adapter

It should not:

- move routes
- change tool execution
- change memory writes
- change approval behavior
- change model routing
- change daemon powers

## Next Refactor After Seed

After protocol tests pass, the next safest runtime step is a read-only route or preview endpoint that can produce a `RuntimeDecision` from an existing Mind Trace or golden workflow fixture. That gives the app a visible runtime contract without changing execution.
