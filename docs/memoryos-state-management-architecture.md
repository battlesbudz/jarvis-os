# Jarvis MemoryOS And State Management Architecture

Status: active architecture.

Last updated: 2026-06-23.

Jarvis should feel like one persistent assistant even when the reasoning engine changes between GPT, Claude, Gemini, DeepSeek, Phone Gemma, or a future local model. The model is interchangeable. Jarvis owns identity, state, memory, task continuity, tools, and persistence.

## Core Rule

Memory and state are separate systems.

State is authoritative current truth. It must be fast, structured, and always available without semantic retrieval.

Memory is historical context. It is retrievable, ranked, and provenance-bearing, but it is not the source of runtime identity or current task state.

Models do not own memory. Jarvis owns memory and gives models retrieved packets.

Models do not own state. Jarvis owns state and gives models a runtime state card.

## Runtime Layers

```txt
Jarvis
|-- State Kernel
|-- Profile Store
|-- Task State Store
|-- MemoryOS
|-- Memory Router
|-- State Card Builder
|-- Agent Event Log
`-- Telemetry Layer
```

## State Kernel

The State Kernel stores current runtime truth:

- `user_id`
- `assistant_id`
- `session_id`
- `active_device`
- `active_model`
- `current_context`

This layer is the source of truth for the active session. It should never depend on vector search.

Current implementation slice:

- `server/state/stateCard.ts` accepts session state from the provider route.
- Phone Gemma receives `activeDevice`, `activeModel`, and current prompt mode through the generated card.

Planned implementation slices:

- Persist session state as a first-class store.
- Expose a single state-kernel read interface for all model providers.
- Add state snapshots to telemetry for debugging model/provider switches.

## Profile Store

The Profile Store holds structured user attributes:

- preferred name
- timezone
- language
- communication style
- stable user preferences

Profile data is configuration. It is not semantic memory.

Current implementation slice:

- `server/state/stateCard.ts` reads `users` and `user_preferences` when the database is available.
- If profile storage is unavailable, the card falls back to user id and records uncertainty instead of blocking the model.

## Task State Store

The Task State Store tracks active work:

- active scheduled tasks
- queued/running agent jobs
- active or paused workflows
- current step
- last action
- next action

This lets Jarvis continue work across sessions, devices, agents, and models.

Current implementation slice:

- `server/state/stateCard.ts` summarizes `jarvis_scheduled_tasks`, `agent_jobs`, and `agent_workflows`.

Planned implementation slices:

- Normalize task summaries behind a dedicated task-state interface.
- Add model-switch and agent-handoff events so resumed tasks can show why control moved.

## MemoryOS

MemoryOS owns historical memory:

- episodic memories
- semantic memories
- conversation summaries
- decisions
- research
- historical interactions

MemoryOS supports vector retrieval, keyword retrieval, graph traversal, recency, importance, review gates, and provenance.

Current implementation:

- `server/memory/memoryOs.ts` is the MemoryOS read facade.
- `docs/memory-os-temporal-graph-plan.md` tracks the temporal graph and G-Brain roadmap.

The state card may include MemoryOS output, but only as "Relevant Historical Context." It must not confuse that context with authoritative identity or current task state.

## Memory Router

The Memory Router decides whether a request needs memory, which stores to query, and how to rank retrieved context.

The model should not search all memory directly. It should receive an explicit retrieval packet or call an available memory tool.

Current implementation:

- Existing memory tools and `server/memory/memoryOs.ts` provide the read path.
- The first state-card slice keeps memory optional so every prompt does not become a memory dump.

Planned implementation slices:

- Route identity/current-state questions to State Kernel/Profile Store first.
- Route historical questions to MemoryOS.
- Route exact audits to keyword/provenance search before semantic recall.

## Retrieval Evaluation And Tracing

MemoryOS returns an optional content-free retrieval trace with every facade-built context. The trace records a user-scoped keyed query fingerprint and length, caller, model privacy target, opaque candidate identifiers/ranks/scores, privacy dispositions, canonical fallback use, selected identifiers, and the final outcome. HMAC values use `JARVIS_TRACE_HMAC_KEY` or the server `JWT_SECRET`; identifiers and the query fingerprint are omitted when neither secret exists. The trace deliberately excludes the raw query, raw source IDs, and memory text so diagnostics can be copied without reproducing personal content or G-Brain page slugs.

`GroundedEvidencePacket.trace` records context assembly separately: each profile, Soul, memory, commitment, and runtime source reports whether it loaded, failed, or was skipped, plus loaded/selected/omitted counts and evidence IDs. The nested MemoryOS trace makes it possible to distinguish a retrieval miss from evidence that was retrieved and then dropped during packet assembly.

`server/memory/retrievalEvaluation.ts` evaluates privacy-safe golden cases with recall at K, precision at K, reciprocal rank, forbidden hits, `missingAtRetrievalIds`, and `droppedDuringAssemblyIds`. Run the starter regression cases with:

```powershell
npm run jarvis:eval:memory-retrieval
```

Pass a private JSON artifact as the first argument to evaluate exported opaque trace identifiers without committing personal memory contents:

```powershell
npm run jarvis:eval:memory-retrieval -- path/to/private-retrieval-cases.json
```

The artifact may be an array, or an object with a `cases` array, of `{ fixture, run }` records matching `RetrievalEvaluationFixture` and `RetrievalEvaluationRun`. Ranking and query-planning changes should compare against this evaluator before replacing the current hybrid retrieval path.

## Grounding Query Planner

`server/state/groundingQueryPlanner.ts` deterministically classifies grounded personal-memory requests as broad summary, profile, temporal, relationship, commitment, or exact recall. It selects the relevant profile, Soul, MemoryOS, and commitment stores and emits at most two bounded queries. No planner model or cloud call is used.

`GroundedEvidencePacket` executes those queries against canonical MemoryOS, interleaves results by rank, deduplicates memory IDs, and applies the packet evidence limit. Its context contract requires canonical-only memory, evidence-only personal claims, and an explicit admission when requested information is not loaded. Exact runtime-owned memory audits remain separate from this model-grounding path.

This planner does not change canonical versus G-Brain ranking. Candidate-source fusion and reranking remain a separate evaluation-driven slice so query planning and ranking can be measured independently.

## State Card Builder

The State Card Builder creates a compact runtime packet:

```txt
Assistant: Jarvis

Current User:
- Preferred name
- Timezone
- Language

Current Session:
- Active device
- Active model
- Current context

Active Task State:
- Goal
- Current step
- Last action
- Next action

Relevant Historical Context:
- Optional MemoryOS packets

Available Tools:
- Tool names supplied for this route
```

The card is dynamically generated. It is never hardcoded into provider prompts.

Current implementation:

- `server/state/stateCard.ts`
- Phone Gemma prompt wiring in `server/agent/providers/androidLocalGemma.ts`
- Tests in `server/state/__tests__/stateCard.assert.ts`

Why this matters for Phone Gemma:

- Local models have smaller context windows and weaker implicit tool planning than the strongest cloud models.
- The state card gives them reliable identity and task state without asking them to infer those facts from long prompt history.
- The tool list gives them the exact names Jarvis provided so they are less likely to invent unavailable tools.

## Telemetry And Event Log

Telemetry records what actually happened:

- tool calls
- model switches
- memory writes
- state writes
- agent actions
- approval gates
- daemon actions

Telemetry is not memory. It is a flight recorder and audit trail.

Planned implementation slices:

- Emit state-card build events with provenance and uncertainty.
- Link model turns, tool calls, and task-state updates under one trace id.
- Surface orphaned or long-running local-model tasks in diagnostics.

## Retrieval Tiers

Jarvis should layer retrieval in this order:

1. Identity State: always loaded.
2. Session State: always loaded.
3. Task State: loaded when active work exists.
4. Profile Data: loaded when user-specific context is relevant.
5. Recent Interaction Summaries: loaded for conversation continuity.
6. Vector Retrieval: loaded for semantic recall.
7. Keyword Retrieval: loaded for exact matching.
8. Graph Retrieval: loaded for relationships and temporal traversal.
9. Archive Retrieval: loaded for deep historical recall.

The first four tiers are state/profile/task concerns. They should not depend on semantic search.

## Provider Contract

Every model provider should eventually consume the same Jarvis-owned context packet:

- cloud models
- local models
- daemon-backed runtimes
- future models

Provider prompts may differ in formatting, but they should not each reinvent identity, memory, task continuity, or tool availability.

First provider wired:

- Phone Gemma, because it is the most sensitive to compact state and deterministic tool names.

Next providers to wire:

- OpenAI
- Anthropic
- Google Gemini
- OpenAI-compatible local runtimes

## Runtime Identity Answers

Exact identity questions should be answered by Jarvis before a provider turn runs. This covers:

- "Who are you?"
- "Who am I?"
- "What model are you using?"

These answers are runtime state, not model reasoning. Jarvis should answer from the selected route, active model label, and Profile Store. Phone Gemma and cloud models should not be asked to guess Jarvis's identity, the user's preferred name, or the active model label for these exact identity questions.

## Design Constraints

- State must be available even if MemoryOS is down.
- Memory retrieval must be optional and provenance-bearing.
- Prompt state must stay compact for local models.
- Tool names must come from the actual route, not from model memory.
- Errors should record uncertainty instead of silently pretending state was loaded.
