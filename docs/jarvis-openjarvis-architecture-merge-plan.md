# Jarvis and OpenJarvis Architecture Merge Plan

Status: comparison and minimal additive plan.

This document compares OpenJarvis's primitive-based architecture with the existing Jarvis OS architecture. It is not a refactor plan to replace Jarvis behavior, import OpenJarvis, or move existing routes, memory, tools, approvals, jobs, daemons, or agent code.

## Source Reality

OpenJarvis organizes a personal AI system around typed primitives:

- Intelligence: model catalog, model specs, generation defaults, supported engines.
- Engine: inference runtime adapters such as Ollama, vLLM, llama.cpp, OpenAI, Anthropic, and Google.
- Agentic Logic: pluggable agents registered behind common agent interfaces.
- Memory and Tools: searchable storage backends, tool specs, tool execution, context injection.
- Learning and Traces: interaction traces, routing policies, reward metrics, and optimization loops.

Jarvis already has a different but overlapping Joint Runtime direction:

- Jarvis Runtime Protocol and Core Runtime preview in `server/core/protocol` and `server/core/runtime`.
- Model routing and provider adapters in `server/agent/modelRouter.ts`, `server/agent/runtimeModel.ts`, and `server/agent/providers`.
- Agent harness, autonomy runtime, jobs, workers, approvals, and review loops in `server/agent`.
- Tool Gateway preview in `server/core/tools`, with live tools still owned by `server/agent/tools`.
- Memory OS, G-Brain, vector retrieval, dream synthesis, and review gates in `server/memory` and `server/brain`.
- Channels in `server/channels`, plus route and webhook surfaces in `server/routes.ts` and focused route modules.
- Trace learning through Mind Trace, quality loops, dream cycle, self-improvement, and workflow promotion.

## Primitive Mapping

| OpenJarvis primitive | Jarvis equivalent | Current Jarvis status |
|---|---|---|
| Intelligence | Model router, runtime model, frontier/default model policy | Present in `server/agent/modelRouter.ts`, `runtimeModel.ts`, provider fallback code, and roadmap/runtime docs. Missing a fully stable `server/core/models` adapter boundary. |
| Engine | Model provider adapters, local model serving, OpenRouter/OpenAI/Claude/Codex OAuth adapters | Present in `server/agent/providers/*` and runtime model resolution. Local serving is a direction, not a primary current abstraction. |
| Agents | Jarvis agent runtime, background jobs, workers, subagents, named agents | Present in `server/agent/harness.ts`, `autonomyRuntime.ts`, `jobQueue.ts`, `workerRuntime.ts`, `subagents.ts`, and named/custom agent modules. |
| Tools and Memory | Tool Gateway, Memory OS, G-Brain, approval gates, memory review | Present but split intentionally: preview Tool Gateway in `server/core/tools`; live tools in `server/agent/tools`; Memory OS in `server/memory/memoryOs.ts`; derived G-Brain in `server/brain`. |
| Learning | Mind traces, dream cycle, self-improvement, quality loop, workflow promotion | Present in `mindTrace*`, `qualityLoop.ts`, `selfImprovementLoop.ts`, `memory/dream.ts`, roadmap Phase 4/6. Missing one unified learning interface under `server/core/learning`. |

## What Jarvis Already Has

- A stronger product safety model than OpenJarvis's primitive examples: approval receipts, deliverable review, daemon boundaries, safe-write policy, auth checks, and audit-oriented runtime previews.
- A live multi-channel product surface across app, Telegram, Discord, Slack, WhatsApp, webchat, and daemon channels.
- A persistent job and worker system for long-running work, retries, observability, and reviewable deliverables.
- Memory OS and G-Brain with canonical Postgres memory review, derived brain projections, vector retrieval fallbacks, provenance, auto-review, and embedding health monitoring.
- A preview-only Core Runtime stack that already validates `JarvisEvent`, emits `ContextPacket` and `RuntimeDecision`, preflights tools, formats runtime preview reports, redacts sensitive fields, and keeps live execution disabled.
- A model/provider abstraction with fallback routing, Codex OAuth handling, direct OpenAI/open-compatible adapters, and task complexity/privacy routing.

## What Is Missing

- A stable public Core Runtime entrypoint that can be called by future route/channel experiments without importing harness internals. The first safe slice is `runRuntimeEvent(event)`, which returns a structured decision only.
- Explicit `server/core/models` interfaces that wrap existing provider adapters without changing provider selection.
- Explicit `server/core/policy` interfaces that unify approval, risk, safe-write, daemon, memory-review, and auth preflight decisions without weakening current gates.
- Explicit `server/core/memory` adapter interfaces over Memory OS and G-Brain read/write/review surfaces.
- Explicit `server/core/learning` interfaces for Mind Trace, dream cycle outputs, workflow promotion candidates, and self-improvement proposals.
- A route-by-route migration checklist that proves each channel can preview Core Runtime decisions before any live behavior changes.

## What Should Not Be Copied

- Do not copy OpenJarvis's registry pattern wholesale. Jarvis already has live modules, tests, and safety semantics; a decorator registry would add another discovery system without solving the current risk.
- Do not replace `server/agent/harness.ts` with OpenJarvis agent classes. The Jarvis harness owns tool hooks, integration errors, approval gating, model fallback, progress, and trace recording.
- Do not replace Memory OS/G-Brain with OpenJarvis storage backends. OpenJarvis memory is useful as a retrieval primitive reference, but Jarvis requires canonical review, provenance, deletion/correction, and derived projections.
- Do not bypass existing approval gates for an OpenJarvis-style tool executor. Tool execution must stay behind Jarvis approval, auth, policy, and review surfaces.
- Do not make local model serving the only engine path. Jarvis should remain provider-agnostic across frontier, local, Codex OAuth, OpenRouter/open-compatible, and future device adapters.
- Do not let learning loops mutate prompts, tools, memory, or policy directly. Jarvis learning should produce reviewable proposals, tests, and workflow promotion candidates.

## Minimal Jarvis Core Runtime Plan

The target layout is additive:

```txt
server/core/protocol  typed event, context, decision, approval, trace vocabulary
server/core/runtime   preview-only runtime entrypoints and future orchestration facade
server/core/models    model adapter interfaces over existing provider/router code
server/core/tools     Tool Gateway metadata, preflight, and future execution handoff
server/core/policy    risk, approval, auth, safe-write, daemon, and memory-review policy contracts
server/core/learning  Mind Trace, dream cycle, quality loop, and workflow promotion adapters
server/core/memory    Memory OS and G-Brain context/review adapter contracts
```

### Safe Sequence

1. Keep Core Runtime preview-only. Add vocabulary and `runRuntimeEvent(event)` that returns a structured `RuntimeDecision` without executing tools.
2. Add `server/core/models` interfaces that adapt current provider routing metadata, with no model-call behavior change.
3. Add `server/core/memory` read-only adapter interfaces over `retrieveMemoryContext` and G-Brain retrieval, with no memory writes.
4. Add `server/core/policy` decision objects that summarize existing approval/safe-write/daemon/memory-review gates, with no policy loosening.
5. Add route/channel dry-run instrumentation behind feature flags, starting with diagnostics-only surfaces.
6. Only after preview parity is proven, allow selected callers to consume Core Runtime decisions while still delegating live execution to existing owners.

## First Safe Slice Implemented

The first slice adds explicit TypeScript vocabulary for:

- `RuntimeEvent`
- `RuntimeContextPacket`
- `RuntimeDecision`
- `RuntimeToolRequest`
- `RuntimeApprovalDecision`
- `RuntimeTrace`
- `ModelAdapter`
- `ToolGatewayAdapter`

It also adds:

```ts
runRuntimeEvent(event): Promise<RuntimeDecision>
```

This function delegates to the existing `executeRuntimeEvent` preview classifier. It validates and shapes the event into a structured decision placeholder. It does not execute real tools, enqueue jobs, write memory, create approvals, call models, or change route behavior.

## Next Safe Implementation Step

Add `server/core/models` as interfaces and adapter metadata only:

- `RuntimeModelRequest`
- `RuntimeModelResponse`
- `RuntimeModelRoute`
- `ModelRouterAdapter`

Then write a small adapter that reports how `server/agent/modelRouter.ts` would route a request without making a model call. Keep it diagnostics-only and feature-flagged.
