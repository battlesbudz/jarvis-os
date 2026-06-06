# G-Brain Implementation Plan

Status: active implementation plan.

Last updated: 2026-06-05.

G-Brain is Jarvis's derived second-brain layer. It does not replace canonical memory. It projects reviewed, durable source data into page/chunk/link structures optimized for recall, provenance, and later temporal reasoning.

Canonical truth remains in Postgres source tables:

- `user_memories`
- `people`
- `chat_history`
- `interaction_log`
- goals, plans, jobs, approvals, and connected-account context

G-Brain tables are derived and rebuildable:

- `brain_pages`
- `brain_timeline_entries`
- `brain_content_chunks`
- `brain_links`
- `brain_page_versions`
- `brain_ingest_log`
- `brain_config`

## Design Rules

- Never let G-Brain silently overwrite canonical source tables.
- Only project source data with provenance.
- Keep review gates in front of durable semantic/procedural memory.
- Treat pending, discarded, expired, or orphaned source rows as non-live projections.
- Prefer deterministic projection and maintenance before LLM synthesis.
- Feature-flag vector retrieval so deployments without pgvector keep working.
- Make every derived page recoverable from source rows.

## Completed Slices

### Slice 1: Derived Brain Foundation

Status: landed.

Implemented:

- `server/brain/types.ts`
- `server/brain/adapter.ts`
- `server/brain/chunk.ts`
- `server/brain/slug.ts`
- `server/brain/links.ts`
- migration `0008_brain_projection.sql`

Capabilities:

- upsert derived brain pages
- store page versions
- chunk compiled page truth
- store provenance
- project approved `user_memories`
- retire expired, discarded, pending, stale, and orphaned projected memory pages
- query G-Brain with Postgres full-text search
- fall back from memory retrieval to legacy retrieval when G-Brain is empty or unavailable

### Slice 2: People Projection And Links

Status: landed.

Implemented:

- `projectPeopleIntoBrain(userId, limit?)`
- duplicate-safe person slugs
- deterministic person link hints
- memory-page links to known person pages
- stale and orphaned person-page retirement

Behavior:

- each `people` row can project to a `pageType = "person"` brain page
- duplicate names receive id-suffixed slugs
- memory content mentioning known people links to the corresponding person page
- renamed or deleted people do not leave active stale pages behind

### Slice 3: Daily Maintenance

Status: landed.

Implemented:

- `server/brain/maintenance.ts`
- scheduler integration at the daily 06:00 maintenance slot
- idempotency via `proactiveScheduleLog`

Daily order:

1. user memory embedding backfill
2. deterministic memory auto-review
3. G-Brain people projection
4. G-Brain approved-memory projection
5. G-Brain stale chunk embedding refresh

### Slice 4: Brain Chunk Vector Retrieval

Status: landed and live DB verified.

Implemented:

- migration `0009_brain_vector_index.sql`
- optional `brain_content_chunks.embedding_vector vector(1536)`
- `server/brain/vector.ts`
- `refreshIndexWithEmbedder(...)`
- `queryBrainWithEmbedder(...)`
- feature flag `JARVIS_BRAIN_VECTOR_RETRIEVAL=1`

Behavior:

- embeddings are stored in JSONB and, when available, pgvector
- vector queries are attempted only when the feature flag is enabled
- vector write/query failures fall back to JSONB/FTS behavior
- this slice targets G-Brain chunks; canonical `user_memories` vector search is tracked separately below

Live DB verification on 2026-06-05:

- Command: `npm.cmd run jarvis:verify:brain-vector-db` with `JARVIS_RUN_DB_TESTS_WITH_DATABASE_URL=1`
- Target: Railway Postgres from `DATABASE_URL`
- Result: PASS
- Evidence: `0008_brain_projection.sql` and `0009_brain_vector_index.sql` executed successfully; pgvector extension version `0.8.2` is installed; `brain_content_chunks.embedding_vector` and `brain_chunks_embedding_vector_idx` exist; `refreshIndexWithEmbedder(...)` writes `embedding_vector`; vector query returns the seeded chunk under `JARVIS_BRAIN_VECTOR_RETRIEVAL=1`; a simulated pgvector failure falls back to FTS retrieval.

### Slice 5: Deterministic Memory Auto-Review

Status: landed.

Implemented:

- `server/memory/autoReview.ts`
- scheduler integration before G-Brain maintenance

Policy:

- auto-keep only pending long-term semantic/procedural memories
- require high confidence
- allow low-risk categories such as work patterns, preferences, communication style, energy rhythms, accomplishments, blockers, goals history, and facts
- allow trusted sources such as chat, Telegram, manual entries, weekly patterns, and dream cycle outputs
- leave relationships, medical, legal, financial, credentials, secrets, identity-sensitive, low-confidence, unusual-source, and generic memories pending

Status transition:

- auto-kept rows use the manual keep semantics: `pending_review = FALSE`, `review_status = 'kept'`
- auto-kept rows can then project into G-Brain

### Slice 6: Fast-Lane Continuity Fix

Status: landed.

Implemented:

- fast-lane image/tool requests bypass fast mode
- fast-lane deflections escalate to full workflow
- fast-lane exchanges persist to `chat_history`
- fast-lane exchanges update the SDK session store
- immediate recall questions bypass fast mode

Purpose:

- prevent short-term user facts from disappearing from the normal prompt path
- avoid requiring Jarvis to call a separate history action for something said seconds earlier

## Remaining Work

### Slice 7: Canonical Memory Vector Index

Status: landed and live DB verified.

Implemented:

- migration `0010_user_memory_vector_index.sql`
- optional `user_memories.embedding_vector vector(1536)`
- JSONB `embedding` to pgvector backfill in the migration and embedding backfill job
- `server/memory/vectorStore.ts`
- `server/memory/vectorDbVerification.ts`
- `scripts/verify-memory-vector-db.ts`
- package script `npm.cmd run jarvis:verify:memory-vector-db`
- feature flag `JARVIS_MEMORY_VECTOR_RETRIEVAL=1`

Behavior:

- canonical memory embeddings remain stored in JSONB as the portable fallback
- pgvector writes are attempted when the column/extension are available
- vector retrieval is attempted only under `JARVIS_MEMORY_VECTOR_RETRIEVAL=1`
- vector query/write failures fall back to current JSONB/FTS behavior
- vector search is scoped to approved durable memories: `pending_review = FALSE` and `review_status IN ('active', 'kept', 'edited')`

Live DB verification on 2026-06-05:

- Command: `npm.cmd run jarvis:verify:memory-vector-db` with `JARVIS_RUN_DB_TESTS_WITH_DATABASE_URL=1`
- Target: Railway Postgres from `DATABASE_URL`
- Result: PASS
- Evidence: `0010_user_memory_vector_index.sql` executed successfully; pgvector extension version `0.8.2` is installed; `user_memories.embedding_vector` and `user_memories_embedding_vector_idx` exist; existing JSONB embeddings mirror into `embedding_vector`; vector query returns the seeded memory under `JARVIS_MEMORY_VECTOR_RETRIEVAL=1`; a simulated pgvector failure falls back through canonical memory retrieval.

### Completed Slice: Memory OS Facade Read Path

Implemented in this slice:

- `server/memory/memoryOs.ts`
- single read path for the `memory_search` tool, coach context, daily command context, Agent SDK global memory context, and G-Brain-backed retrieval
- structured provenance and uncertainty
- fallback to existing retrieval when G-Brain or vector search is unavailable

Implementation notes:

- `memory_search` now calls `retrieveMemoryContext` while preserving its existing output format, category/tier filters, profile identity fallback, and durable access-count updates.
- Coach prompt context and daily command planning route through `buildAiContextSections`, which now retrieves memories through the Memory OS facade.
- Named Agent SDK first-turn global memory context now retrieves relevant user memories through the Memory OS facade for agents with global-memory access.
- The facade exposes planned write/explanation/correction entrypoints as unavailable stubs so later slices have named integration points without implying those flows are complete.

### Later Slices

- Redis hot state for active working context
- Graphiti temporal graph adapter
- temporal query UX
- user-facing provenance and correction flows for current-vs-past facts

## Roadmap Cross-Reference

This work maps to `JARVIS_ROADMAP.md` Phase 4.1, "Structured Long-Term Memory Store." The completed vector-index pieces are live-DB-verified derived G-Brain chunk retrieval plus live-DB-verified canonical `user_memories.embedding_vector` migration/backfill/search/fallback. The targeted Memory OS read facade now gives the `memory_search` tool, coach context, daily command context, Agent SDK global memory context, and G-Brain-backed retrieval one shared read path. It does not yet migrate every legacy direct memory read. Remaining roadmap overlap is production monitoring for embedding health plus later user-facing correction/provenance flows.

## Verification Commands

Focused checks used for the current implementation:

```powershell
node .\node_modules\tsx\dist\cli.mjs server\brain\__tests__\links.test.ts
node .\node_modules\tsx\dist\cli.mjs server\brain\__tests__\maintenance.test.ts
node .\node_modules\tsx\dist\cli.mjs server\brain\__tests__\vector.test.ts
node .\node_modules\tsx\dist\cli.mjs server\brain\__tests__\vectorDbVerification.test.ts
node .\node_modules\tsx\dist\cli.mjs server\brain\__tests__\vectorMigration.test.ts
node .\node_modules\tsx\dist\cli.mjs server\memory\__tests__\autoReview.test.ts
node .\node_modules\tsx\dist\cli.mjs server\memory\__tests__\memoryOs.test.ts
node .\node_modules\tsx\dist\cli.mjs server\memory\__tests__\retrieveVectorScoring.test.ts
node .\node_modules\tsx\dist\cli.mjs server\memory\__tests__\vectorDbVerification.test.ts
node .\node_modules\tsx\dist\cli.mjs server\memory\__tests__\vectorMigration.test.ts
node .\node_modules\tsx\dist\cli.mjs server\memory\__tests__\vectorStore.test.ts
node .\node_modules\tsx\dist\cli.mjs server\agent\__tests__\memoryOsFacadeRouting.assert.ts
node .\node_modules\tsx\dist\cli.mjs server\agent\__tests__\memorySearchMemoryOs.assert.ts
node .\node_modules\tsx\dist\cli.mjs server\agent\__tests__\memorySearchIdentityFallback.assert.ts
node .\node_modules\tsx\dist\cli.mjs server\agent\__tests__\mindTraceContextPacks.test.ts
node .\node_modules\tsx\dist\cli.mjs server\agent\__tests__\dailyCommand.test.ts
node .\node_modules\tsx\dist\cli.mjs server\agent\__tests__\telegramFastPath.assert.ts
npm.cmd run server:build
```

DB-backed tests require `DATABASE_URL`.

Live DB verification:

```powershell
$env:JARVIS_RUN_DB_TESTS_WITH_DATABASE_URL='1'; npm.cmd run jarvis:verify:brain-vector-db
$env:JARVIS_RUN_DB_TESTS_WITH_DATABASE_URL='1'; npm.cmd run jarvis:verify:memory-vector-db
```
