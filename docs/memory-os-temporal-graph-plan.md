# Jarvis Memory OS Temporal Graph Plan

Status: active implementation plan.

Last updated: 2026-06-05.

This plan hardens the existing Jarvis memory system instead of replacing it.

Jarvis already has:

- `user_memories` in Postgres
- memory review/trust state
- JSONB embedding cache
- memory extraction and retrieval
- SOUL context
- people and relationship helpers
- dream insights
- goals, plans, chat history, project files, and connected-account context

The next step is to make Jarvis time-aware by adding a layered Memory OS:

```txt
Redis hot state
-> Postgres + pgvector baseline memory
-> Graphiti temporal knowledge graph
-> project files / goals / profile / relationship sources
-> context router retrieval packs
-> user-visible memory review and provenance
```

## Current Implementation Status

The first G-Brain slices are now implemented as a derived second-brain layer on top of the canonical `user_memories` ledger.

Detailed G-Brain docs:

- `gbrain-implementation-plan.md`
- `gbrain-spec-sheet.md`

Landed:

- Temporal parsing exists in `server/time/temporalContext.ts` with tests.
- G-Brain derived storage exists under `server/brain/*`.
- Approved memories project into G-Brain pages, chunks, links, and versions.
- People rows project into duplicate-safe person pages.
- Memory pages link deterministically to person pages when names match known people.
- Daily G-Brain maintenance runs from the scheduler after embedding backfill.
- `brain_content_chunks` now has optional pgvector support via `embedding_vector vector(1536)`.
- Brain vector retrieval is feature-flagged by `JARVIS_BRAIN_VECTOR_RETRIEVAL=1`.
- Brain retrieval falls back to FTS/JSONB embedding rerank when pgvector is unavailable.
- G-Brain chunk-vector live DB verification passed against Railway Postgres on 2026-06-05 via `npm.cmd run jarvis:verify:brain-vector-db`.
- `user_memories` now has optional canonical pgvector support via `embedding_vector vector(1536)`.
- Canonical memory vector retrieval is feature-flagged by `JARVIS_MEMORY_VECTOR_RETRIEVAL=1`.
- Canonical memory vector write/query failures fall back to JSONB/FTS behavior.
- Canonical vector search is scoped to approved memories: `pending_review = FALSE`, `review_status IN ('active', 'kept', 'edited')`.
- Canonical memory vector live DB verification passed against Railway Postgres on 2026-06-05 via `npm.cmd run jarvis:verify:memory-vector-db`.
- A deterministic memory auto-review daemon exists in `server/memory/autoReview.ts`.
- Auto-review keeps only high-confidence, low-risk pending memories and leaves sensitive/ambiguous memories pending.
- Auto-kept memories are marked with the same state as manual keep: `pending_review = FALSE`, `review_status = 'kept'`.
- Telegram fast-lane turns now persist into normal chat history/session state so immediate recall does not depend on a separate history action.

Still planned:

- A unified `server/memory/memoryOs.ts` read/write facade.
- Redis hot state.
- Graphiti temporal graph adapter.
- Full temporal query UX and provenance display.

Roadmap cross-reference: this plan overlaps `JARVIS_ROADMAP.md` Phase 4.1. The vector-index work now covers derived G-Brain chunk vectors and canonical `user_memories.embedding_vector` support, the targeted Memory OS read facade is implemented, and production embedding-health monitoring now feeds diagnostics health. Redis hot state is the next Memory OS infrastructure slice for packable autonomy.

## Product Goal

Jarvis should understand time as a first-class part of memory.

Examples:

- "Remind me later" should resolve against the user-local clock, recent context, and active commitments.
- "Next week" should map to a concrete user-local date window.
- "What did John say last month?" should search memories, messages, project files, and the temporal graph with a bounded point-in-time filter.
- "Do I still want to use vendor X?" should distinguish current facts from superseded facts.

The target behavior is not just semantic recall. It is temporal recall with provenance and current-vs-past awareness.

## Source Reality

Current `user_memories.embedding` remains JSONB for portability, with optional `user_memories.embedding_vector` pgvector support where the extension is available. Retrieval in `server/memory/retrieve.ts` combines Postgres full-text search, optional OpenAI embeddings, cosine scoring in TypeScript, relevance, tier recency, and access count, and can prefer pgvector candidates when `JARVIS_MEMORY_VECTOR_RETRIEVAL=1`.

That gives Jarvis a scalable semantic candidate path while preserving the current fallback when pgvector is unavailable.

Graphiti is a good fit for the temporal layer because it is designed for dynamic agent memory, temporal relationships, episodes/provenance, and hybrid semantic/keyword/graph retrieval. It should not be treated as the only source of truth. Jarvis still needs Postgres as the canonical reviewable memory ledger.

## Target Architecture

### 1. Postgres Canonical Memory Ledger

Postgres remains the source of truth for user-visible memories and review controls.

Tables/classes to keep using:

- `user_memories`
- `jarvis_souls`
- `dream_insights`
- `people`
- `goals`
- `plans`
- `chat_history`
- `life_context`
- deliverables, jobs, approvals, and interaction logs

Current pgvector index layer:

- install/enable `vector` extension where supported
- add `embedding_vector vector(1536)` to `user_memories`
- backfill from existing JSONB embeddings
- keep JSONB embedding during migration as the portable fallback
- add IVFFlat index after backfill
- make retrieval prefer pgvector when available and fall back to current JSONB/FTS behavior

Do not remove memory review gates. All durable user-facing memories still require provenance, status, confidence, tier, and deletion/correction behavior.

### 2. Graphiti Temporal Knowledge Graph

Graphiti should receive "episodes" from Jarvis events, not random prompt blobs.

Episode sources:

- user chat turns
- Telegram/Discord/voice turns
- email snippets selected for context
- calendar events and meeting notes
- reminders and scheduled tasks
- goal updates
- plan edits
- project file summaries
- dream synthesis outputs
- user-approved memories
- relationship updates

Graphiti stores temporal relationships and changing facts:

- person-to-person relationship state
- user-to-goal state
- user-to-project state
- commitment lifecycle
- preferences that change over time
- "John said X on date Y"
- "Vendor preference was A, then became B"

Graphiti is the temporal reasoning layer, not the memory approval UI.

### 3. Semantic Recall

Semantic recall should combine:

- pgvector search over approved memories
- Graphiti hybrid search for temporal entity/fact context
- Postgres FTS for exact names, dates, and quoted phrases
- project file search for workspace-specific facts
- recent hot-state cache for active working context

Retrieval should return structured context:

```ts
{
  query,
  now,
  timeWindow,
  sources: {
    memories: [],
    graphFacts: [],
    projectFiles: [],
    goals: [],
    relationships: [],
    hotState: []
  },
  provenance: [],
  uncertainty: []
}
```

### 4. Redis Hot State

Redis should hold short-lived operational awareness only.

Good Redis uses:

- active conversation state
- recently mentioned people/entities
- current reminders being clarified
- active jobs and waiting approvals summary
- "Jarvis is working / blocked / waiting approval" state
- recently retrieved memory ids
- dedupe windows for reminders/tasks
- channel session state

Bad Redis uses:

- canonical long-term memory
- user-approved memory ledger
- SOUL
- permanent relationship facts
- anything that must survive with provenance

Redis entries need TTLs and must be reconstructable from Postgres/Graphiti.

### 5. Temporal Parser

Create a shared temporal parsing service used by reminders, memory search, daily planning, and graph queries.

Proposed module:

```txt
server/time/temporalContext.ts
```

Responsibilities:

- compute user-local `now`
- resolve phrases like later, tonight, tomorrow, next week, last month
- return concrete windows
- preserve ambiguity when needed
- attach timezone and source text

Example:

```ts
resolveTemporalExpression({
  userId,
  text: "what did John say last month",
  now,
  timezone
})
```

returns:

```ts
{
  kind: "past_window",
  label: "last month",
  start: "2026-04-01T00:00:00-04:00",
  end: "2026-04-30T23:59:59-04:00",
  confidence: 0.95
}
```

## New Modules

### `server/memory/vectorStore.ts`

Single abstraction over pgvector and current fallback retrieval.

Exports:

- `isPgvectorAvailable()`
- `ensureMemoryVectorSchema()`
- `upsertMemoryEmbedding(memoryId)`
- `searchMemoryVectors(input)`

### `server/memory/temporalGraph.ts`

Adapter around Graphiti.

Exports:

- `isTemporalGraphEnabled()`
- `addMemoryEpisode(input)`
- `addStructuredEpisode(input)`
- `searchTemporalGraph(input)`
- `getEntityTimeline(input)`

Feature flag:

```txt
ENABLE_TEMPORAL_GRAPH=true
```

Required env when enabled:

```txt
GRAPHITI_BASE_URL or GRAPHITI_MCP_URL
GRAPHITI_API_KEY if hosted/protected
```

### `server/memory/memoryOs.ts`

Unified read/write orchestrator.

Exports:

- `rememberEpisode(input)`
- `retrieveMemoryContext(input)`
- `explainMemoryAnswer(input)`
- `recordMemoryCorrection(input)`

This becomes the API that Jarvis Core Runtime calls before model prompts.

### `server/cache/hotState.ts`

Redis-backed short-term state with in-memory fallback for local dev.

Exports:

- `getHotState(userId)`
- `setHotState(userId, patch, ttl)`
- `appendRecentEntity(userId, entity)`
- `recordActiveApproval(userId, gateId)`
- `clearExpiredHotState(userId)`

Feature flag:

```txt
REDIS_URL
```

No Redis URL means safe in-process fallback only.

### `server/time/temporalContext.ts`

Shared temporal resolver.

Used by:

- reminders
- daily command
- memory search
- Graphiti queries
- future calendar/email retrieval

## Retrieval Flow

```txt
User request
-> PRIME / Jarvis Core Runtime classifies task
-> temporal parser extracts time window/entities
-> Memory OS retrieves:
   1. Redis hot state
   2. exact Postgres/FTS matches
   3. pgvector semantic memories
   4. Graphiti temporal facts
   5. goals/profile/relationships/project files
-> context router budgets and dedupes results
-> model receives structured, provenance-aware context
-> Mind Trace records what was loaded and why
```

## Write Flow

```txt
Event happens
-> Memory OS receives episode
-> store raw provenance in Postgres-compatible source refs
-> extract candidate user memories
-> pending review if sensitive/durable
-> write approved or reviewable memory to Postgres
-> enqueue Graphiti episode write
-> update Redis hot state
-> mark SOUL stale when relevant
```

Important: Graphiti writes should be async and recoverable. If Graphiti is down, Jarvis should still work from Postgres memory and record a diagnostics warning.

## Privacy And Safety

Do not send everything to Graphiti.

Only ingest:

- user-approved durable memories
- important episodes with source/provenance
- bounded snippets from email/calendar/project files
- summaries instead of raw private blobs when possible

Do not ingest:

- secrets
- tokens
- credentials
- full email bodies by default
- full project files by default
- screenshots/vision memories without explicit privacy controls
- rejected memories

All graph-derived facts shown to the user must include provenance.

## Implementation Phases

### Phase 1: Temporal Awareness Without New Infrastructure

Implement:

- `server/time/temporalContext.ts`
- tests for `later`, `in an hour`, `next week`, `last month`, named weekdays
- wire reminder parsing and memory search to use it
- add Mind Trace fields for `temporalExpression`, `timeWindow`, and `timezone`

Outcome:

Jarvis stops treating time phrases as vague text.

### Phase 2: pgvector Baseline

Implemented:

- schema migration with `embedding_vector vector(1536)`
- pgvector capability probe
- backfill script from existing JSONB embeddings
- vector search path with fallback to current retrieval
- tests proving fallback works when pgvector is unavailable

Outcome:

Approved memories become scalable semantic recall.

Status note, 2026-06-05: the G-Brain chunk side of this baseline and the canonical `user_memories.embedding_vector` migration/backfill/retrieval/capability/fallback slice are live-DB verified. Production embedding-health monitoring is implemented through `server/memory/embeddingHealth.ts` and diagnostics health now reports pgvector availability, JSON/vector coverage, vector-path errors, and memory subsystem degradation.

### Phase 3: Memory OS Facade

Status note, 2026-06-05: the targeted read-path facade baseline is implemented. It routes the `memory_search` tool, coach context, daily command context, Agent SDK global memory context, and G-Brain-backed retrieval through `server/memory/memoryOs.ts` with structured source/provenance fields and fallback uncertainty. Legacy direct memory reads outside those named contexts, write-path episode capture, user-facing explanation/correction, Redis hot state, and Graphiti remain later phases.

Implemented:

- `server/memory/memoryOs.ts`
- route existing `memory_search`, daily command, Agent SDK read context, and coach context through it
- return structured provenance and uncertainty
- keep current behavior as fallback

Outcome:

Jarvis has one facade for the roadmap-named memory read contexts instead of continuing to route those contexts through scattered calls. Broader read consolidation and the write API remain planned for later Memory OS slices.

### Phase 4: Redis Hot State

Implement:

- `server/cache/hotState.ts`
- TTL-backed active entities, waiting approvals, active jobs, recent reminders
- in-memory fallback for local dev
- status surface integration

Outcome:

Jarvis can maintain short-term awareness without polluting durable memory.

### Phase 5: Graphiti Adapter

Implement:

- Graphiti sidecar or MCP connection
- `server/memory/temporalGraph.ts`
- episode queue and retry behavior
- graph namespace per user
- no hard dependency during normal chat

Outcome:

Jarvis can build temporal relationship/fact history without breaking baseline memory.

### Phase 6: Temporal Query UX

Implement:

- memory review UI provenance for temporal facts
- "current fact vs older fact" display
- "why did Jarvis remember this?" expanded with graph/source lineage
- query examples in golden workflows

Outcome:

Users can inspect, correct, and trust temporal memory.

## Golden Workflows To Add

1. "Remind me later to call the company."
2. "Remind me next week to check in with John."
3. "What did John say last month?"
4. "What changed about my preference for vendor X?"
5. "What goals was I focused on in April?"
6. "What did I decide about the grow room project last week?"
7. "Who did I say I needed to follow up with yesterday?"
8. "What memory did you use to answer that?"
9. "Forget that I wanted vendor X."
10. "Correct that: John is my accountant, not my lawyer."

## Acceptance Criteria

- Time phrases resolve to concrete user-local windows.
- Memory search supports temporal filters.
- pgvector is used when available and current retrieval still works without it.
- Graphiti is optional, feature-flagged, and failure-tolerant.
- Redis hot state never becomes canonical memory.
- Mind Trace shows temporal parsing, memory sources, graph facts, and uncertainty.
- User memory review still controls durable facts.
- No secrets or unreviewed raw private data are ingested into the graph.

## Recommended First PR

Do not start with Graphiti.

Start with:

1. `server/time/temporalContext.ts`
2. reminder + memory search integration
3. tests for temporal parsing
4. Mind Trace temporal fields
5. docs update linking this plan

That creates immediate user-visible reliability and gives Graphiti clean, bounded inputs later.
