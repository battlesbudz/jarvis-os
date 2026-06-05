# G-Brain Spec Sheet

Status: implementation spec.

Last updated: 2026-06-05.

## Purpose

G-Brain is a rebuildable derived brain for Jarvis. It turns reviewed source data into searchable pages, chunks, links, timeline entries, and versions while preserving provenance back to canonical source rows.

It is not the source of truth. It is a retrieval and organization layer.

## Primary Consumers

- coach chat context
- `memory_search` fallback path
- future Memory OS facade
- future temporal graph bridge
- memory review and provenance UX

## Source Inputs

Current:

- approved `user_memories`
- `people`

Planned:

- selected `chat_history` turns
- `interaction_log`
- goals and plans
- approved dream/weekly synthesis summaries
- documents and project files
- graph episodes

## Tables

### `brain_pages`

One derived page per projected source entity or memory.

Required fields:

- `user_id`
- `page_type`
- `slug`
- `title`
- `compiled_truth`
- `source_kind`
- `source_id`
- `provenance`
- `review_status`

Rules:

- unique by `(user_id, slug)`
- active pages must be rebuildable from source data
- stale pages are marked `review_status = 'discarded'`, not hard-deleted by default

### `brain_content_chunks`

Searchable chunks of `compiled_truth`.

Required fields:

- `user_id`
- `page_id`
- `chunk_index`
- `content`
- `embedding`
- `embedding_vector`
- `provenance`

Rules:

- `embedding` JSONB remains the compatibility cache
- `embedding_vector` is optional pgvector acceleration
- chunks are replaced when page truth changes

### `brain_links`

Directed page-to-page links.

Required fields:

- `from_page_id`
- `to_slug`
- `verb`
- `confidence`
- `provenance`

Current verbs:

- `mentions_person`

Rules:

- links are deterministic for known people
- duplicate-name people must use supplied person-link hints, not recomputed name-only slugs

### `brain_timeline_entries`

Optional event entries attached to pages.

Current status:

- table exists
- adapter supports writes
- no broad temporal ingestion yet

### `brain_page_versions`

Append-only history of compiled page truth.

Rules:

- every upsert creates a page version
- versions preserve provenance for audit and future rollback

### `brain_ingest_log`

Deduplication and maintenance tracking.

Current status:

- table exists
- not heavily used by the current first slices

### `brain_config`

Per-user G-Brain config.

Current status:

- table exists
- future feature flags and thresholds can live here

## Adapter Contract

The adapter is defined in `server/brain/types.ts`.

```ts
interface JarvisBrainAdapter {
  upsertEvidence(input): Promise<{ pageId: string; versionId?: string }>;
  projectApprovedMemories(userId, limit?): Promise<{ scanned: number; projected: number; skipped: number }>;
  projectPeopleIntoBrain(userId, limit?): Promise<{ scanned: number; projected: number; skipped: number }>;
  query(input): Promise<QueryBrainResult>;
  refreshIndex(scope): Promise<{ embedded: number; linked: number }>;
  queueMaintenance(scope): Promise<{ jobId: string }>;
}
```

Current caveat:

- `queueMaintenance()` is still a placeholder.
- daily maintenance calls projection and `refreshIndex()` directly.

## Projection Rules

### Approved Memories

Project when:

- memory belongs to the user
- memory is not expired
- `pendingReview` is false
- `reviewStatus` is not `pending` or `discarded`

Retire when:

- source row is deleted
- source row expires
- source row becomes pending/discarded
- slug changes

### People

Project when:

- `people.user_id` matches
- name is non-empty

Slug rules:

- unique names use `personPageSlug(name)`
- duplicate names use `personPageSlug(name, id)`

Retire when:

- source person row is deleted
- source person slug changes after rename

## Retrieval Rules

Default retrieval:

- approved pages only
- FTS over chunks
- page/chunk provenance returned with results

Vector retrieval:

- active only when `JARVIS_BRAIN_VECTOR_RETRIEVAL=1`
- attempts pgvector nearest-neighbor search over `brain_content_chunks.embedding_vector`
- reranks candidates with JSONB embeddings when available
- falls back to FTS when vector path fails

## Review And Trust Rules

G-Brain must not make pending durable facts live by itself.

Allowed live statuses:

- `active`
- `kept`
- `edited`

Blocked statuses:

- `pending`
- `discarded`

Auto-review may move safe pending canonical memories to `kept`, but only through `server/memory/autoReview.ts` policy. G-Brain projection then sees them as approved.

## Maintenance Rules

Daily scheduled maintenance should:

1. backfill missing canonical memory embeddings
2. auto-review safe pending memories
3. project people
4. project approved memories
5. refresh stale chunk embeddings

Idempotency:

- daily G-Brain maintenance uses `proactiveScheduleLog`
- auto-review uses its own daily `memory:auto_review:<date>` key

## Environment Flags

- `JARVIS_BRAIN_PROJECTION=1`: project approved memories after extraction and auto-review
- `JARVIS_BRAIN_VECTOR_RETRIEVAL=1`: enable vector query path
- `OPENAI_API_KEY`: enables OpenAI embeddings/image paths where configured
- `INFSH_API_KEY`: unrelated to G-Brain; used for media generation

## Non-Goals

- G-Brain is not Graphiti.
- G-Brain is not Redis hot state.
- G-Brain does not replace `user_memories`.
- G-Brain does not store unreviewed sensitive facts as live truth.
- G-Brain does not perform user-facing correction by itself.

## Open Questions

- Should G-Brain eventually project selected pending-but-low-risk memories as `pending` pages for conversational-only recall?
- Should `brain_ingest_log` become the canonical idempotency mechanism for all projection jobs?
- Should vector retrieval default on after DB verification, or remain opt-in per environment?
- Should canonical `user_memories` vector indexing be implemented before or after the Memory OS facade?
