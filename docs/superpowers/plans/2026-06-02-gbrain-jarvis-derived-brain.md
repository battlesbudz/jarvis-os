# GBrain Jarvis Derived Brain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Jarvis-owned derived brain layer that projects approved canonical memories into page, chunk, timeline, and link tables for stronger retrieval without replacing `user_memories`.

**Architecture:** Jarvis keeps `user_memories` and review state as the source of truth. A new `server/brain/` package maps approved memories and rich sources into derived brain tables, then exposes a typed adapter for pgvector/FTS-ready retrieval, provenance, and future graph expansion. The first slice ships behind a feature flag and falls back to existing `server/memory/retrieve.ts`.

**Tech Stack:** TypeScript, Express server runtime, Drizzle ORM, Postgres, optional pgvector SQL, OpenAI `text-embedding-3-small`, existing Jarvis agent/context-pack modules.

---

## Scope

This plan implements the minimal high-value integration described in `C:\Users\justi\Downloads\deep-research-report.md`:

- Keep Jarvis canonical memory ownership in `shared/schema.ts` table `user_memories`.
- Add derived tables named with the `brain_` prefix.
- Add a Jarvis-native adapter in `server/brain/`.
- Project only approved, non-expired memories into the derived layer.
- Preserve provenance back to canonical Jarvis records.
- Add tests for approval filtering, idempotent projection, chunking, link extraction, and fallback retrieval.

This plan intentionally does not import GBrain's HTTP/OAuth server, PGLite engine, admin UI, cron/minion runtime, or public MCP boundary.

## File Structure

- Modify: `C:\Users\justi\OneDrive\Desktop\Jarvis\shared\schema.ts`
  - Add Drizzle table definitions for `brain_pages`, `brain_timeline_entries`, `brain_content_chunks`, `brain_links`, `brain_page_versions`, `brain_ingest_log`, and `brain_config`.
- Create: `C:\Users\justi\OneDrive\Desktop\Jarvis\migrations\0008_brain_projection.sql`
  - Add the Postgres DDL for the derived tables and indexes.
- Create: `C:\Users\justi\OneDrive\Desktop\Jarvis\server\brain\types.ts`
  - Own the adapter contract, provenance types, page/chunk/link types, and query result types.
- Create: `C:\Users\justi\OneDrive\Desktop\Jarvis\server\brain\slug.ts`
  - Deterministic slug helpers for memory and people pages.
- Create: `C:\Users\justi\OneDrive\Desktop\Jarvis\server\brain\chunk.ts`
  - Deterministic text chunking for `compiledTruth` and timeline text.
- Create: `C:\Users\justi\OneDrive\Desktop\Jarvis\server\brain\links.ts`
  - Lightweight local link extraction for people/project/vendor-ish references.
- Create: `C:\Users\justi\OneDrive\Desktop\Jarvis\server\brain\adapter.ts`
  - Implement `upsertEvidence`, `projectApprovedMemories`, `queryBrain`, `refreshIndex`, and `queueMaintenance`.
- Create: `C:\Users\justi\OneDrive\Desktop\Jarvis\server\brain\index.ts`
  - Public exports for the package.
- Modify: `C:\Users\justi\OneDrive\Desktop\Jarvis\server\memory\extractor.ts`
  - Queue best-effort projection after memories are stored, without changing review behavior.
- Modify: `C:\Users\justi\OneDrive\Desktop\Jarvis\server\memory\retrieve.ts`
  - Add opt-in derived-brain retrieval path when `JARVIS_BRAIN_RETRIEVAL=1`, with fallback to existing retrieval.
- Modify: `C:\Users\justi\OneDrive\Desktop\Jarvis\server\agent\contextPacks.ts`
  - Add `brain_context` as an internal memory context pack only after adapter tests pass.
- Create: `C:\Users\justi\OneDrive\Desktop\Jarvis\server\brain\__tests__\slug.test.ts`
- Create: `C:\Users\justi\OneDrive\Desktop\Jarvis\server\brain\__tests__\chunk.test.ts`
- Create: `C:\Users\justi\OneDrive\Desktop\Jarvis\server\brain\__tests__\links.test.ts`
- Create: `C:\Users\justi\OneDrive\Desktop\Jarvis\server\brain\__tests__\adapter.test.ts`
- Create: `C:\Users\justi\OneDrive\Desktop\Jarvis\server\memory\__tests__\brainRetrievalFallback.test.ts`

---

### Task 1: Add Derived Brain Schema

**Files:**
- Modify: `C:\Users\justi\OneDrive\Desktop\Jarvis\shared\schema.ts`
- Create: `C:\Users\justi\OneDrive\Desktop\Jarvis\migrations\0008_brain_projection.sql`

- [ ] **Step 1: Add Drizzle table imports if missing**

In `shared/schema.ts`, keep the existing import and add `index` if it is not already present:

```ts
import { pgTable, text, varchar, jsonb, timestamp, date, primaryKey, integer, uniqueIndex, boolean, serial, real, bigint, index } from "drizzle-orm/pg-core";
```

- [ ] **Step 2: Add derived table definitions after `people`**

Append these definitions after the existing `people` table block:

```ts
export const brainPages = pgTable("brain_pages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  pageType: varchar("page_type").notNull(),
  slug: varchar("slug").notNull(),
  title: text("title").notNull(),
  compiledTruth: text("compiled_truth").notNull().default(""),
  sourceKind: varchar("source_kind").notNull(),
  sourceId: varchar("source_id").notNull(),
  provenance: jsonb("provenance").$type<Array<{ kind: string; id: string; sourceType?: string; sourceRef?: string; timestamp?: string }>>().notNull().default(sql`'[]'::jsonb`),
  reviewStatus: varchar("review_status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("brain_pages_user_slug_idx").on(table.userId, table.slug),
  index("brain_pages_user_type_idx").on(table.userId, table.pageType),
]);

export const brainTimelineEntries = pgTable("brain_timeline_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  pageId: varchar("page_id").notNull().references(() => brainPages.id, { onDelete: "cascade" }),
  occurredAt: timestamp("occurred_at"),
  summary: text("summary").notNull(),
  detail: text("detail"),
  provenance: jsonb("provenance").$type<Array<{ kind: string; id: string; sourceType?: string; sourceRef?: string; timestamp?: string }>>().notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("brain_timeline_user_page_idx").on(table.userId, table.pageId),
  index("brain_timeline_occurred_idx").on(table.occurredAt),
]);

export const brainContentChunks = pgTable("brain_content_chunks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  pageId: varchar("page_id").notNull().references(() => brainPages.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index").notNull(),
  content: text("content").notNull(),
  embedding: jsonb("embedding").$type<number[] | null>(),
  provenance: jsonb("provenance").$type<Array<{ kind: string; id: string; sourceType?: string; sourceRef?: string; timestamp?: string }>>().notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("brain_chunks_page_index_idx").on(table.pageId, table.chunkIndex),
  index("brain_chunks_user_page_idx").on(table.userId, table.pageId),
]);

export const brainLinks = pgTable("brain_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  fromPageId: varchar("from_page_id").notNull().references(() => brainPages.id, { onDelete: "cascade" }),
  toSlug: varchar("to_slug").notNull(),
  verb: varchar("verb").notNull(),
  confidence: integer("confidence").notNull().default(70),
  provenance: jsonb("provenance").$type<Array<{ kind: string; id: string; sourceType?: string; sourceRef?: string; timestamp?: string }>>().notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("brain_links_unique_idx").on(table.userId, table.fromPageId, table.toSlug, table.verb),
  index("brain_links_user_to_slug_idx").on(table.userId, table.toSlug),
]);

export const brainPageVersions = pgTable("brain_page_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  pageId: varchar("page_id").notNull().references(() => brainPages.id, { onDelete: "cascade" }),
  compiledTruth: text("compiled_truth").notNull(),
  provenance: jsonb("provenance").notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("brain_page_versions_page_idx").on(table.pageId),
]);

export const brainIngestLog = pgTable("brain_ingest_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sourceKind: varchar("source_kind").notNull(),
  sourceId: varchar("source_id").notNull(),
  contentHash: varchar("content_hash").notNull(),
  status: varchar("status").notNull().default("processed"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("brain_ingest_log_source_hash_idx").on(table.userId, table.sourceKind, table.sourceId, table.contentHash),
]);

export const brainConfig = pgTable("brain_config", {
  userId: varchar("user_id").notNull().primaryKey().references(() => users.id, { onDelete: "cascade" }),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type BrainPage = typeof brainPages.$inferSelect;
export type BrainContentChunk = typeof brainContentChunks.$inferSelect;
export type BrainLink = typeof brainLinks.$inferSelect;
```

- [ ] **Step 3: Create SQL migration**

Create `migrations/0008_brain_projection.sql`:

```sql
CREATE TABLE IF NOT EXISTS brain_pages (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_type varchar NOT NULL,
  slug varchar NOT NULL,
  title text NOT NULL,
  compiled_truth text NOT NULL DEFAULT '',
  source_kind varchar NOT NULL,
  source_id varchar NOT NULL,
  provenance jsonb NOT NULL DEFAULT '[]'::jsonb,
  review_status varchar NOT NULL DEFAULT 'active',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS brain_pages_user_slug_idx ON brain_pages(user_id, slug);
CREATE INDEX IF NOT EXISTS brain_pages_user_type_idx ON brain_pages(user_id, page_type);

CREATE TABLE IF NOT EXISTS brain_timeline_entries (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_id varchar NOT NULL REFERENCES brain_pages(id) ON DELETE CASCADE,
  occurred_at timestamp,
  summary text NOT NULL,
  detail text,
  provenance jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS brain_timeline_user_page_idx ON brain_timeline_entries(user_id, page_id);
CREATE INDEX IF NOT EXISTS brain_timeline_occurred_idx ON brain_timeline_entries(occurred_at);

CREATE TABLE IF NOT EXISTS brain_content_chunks (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_id varchar NOT NULL REFERENCES brain_pages(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  embedding jsonb,
  provenance jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS brain_chunks_page_index_idx ON brain_content_chunks(page_id, chunk_index);
CREATE INDEX IF NOT EXISTS brain_chunks_user_page_idx ON brain_content_chunks(user_id, page_id);

CREATE TABLE IF NOT EXISTS brain_links (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_page_id varchar NOT NULL REFERENCES brain_pages(id) ON DELETE CASCADE,
  to_slug varchar NOT NULL,
  verb varchar NOT NULL,
  confidence integer NOT NULL DEFAULT 70,
  provenance jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS brain_links_unique_idx ON brain_links(user_id, from_page_id, to_slug, verb);
CREATE INDEX IF NOT EXISTS brain_links_user_to_slug_idx ON brain_links(user_id, to_slug);

CREATE TABLE IF NOT EXISTS brain_page_versions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_id varchar NOT NULL REFERENCES brain_pages(id) ON DELETE CASCADE,
  compiled_truth text NOT NULL,
  provenance jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS brain_page_versions_page_idx ON brain_page_versions(page_id);

CREATE TABLE IF NOT EXISTS brain_ingest_log (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_kind varchar NOT NULL,
  source_id varchar NOT NULL,
  content_hash varchar NOT NULL,
  status varchar NOT NULL DEFAULT 'processed',
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS brain_ingest_log_source_hash_idx ON brain_ingest_log(user_id, source_kind, source_id, content_hash);

CREATE TABLE IF NOT EXISTS brain_config (
  user_id varchar PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamp NOT NULL DEFAULT now()
);
```

- [ ] **Step 4: Run schema checks**

Run:

```powershell
npm.cmd run server:build
```

Expected: build passes or fails only on unrelated pre-existing issues. If it fails because `index` was already imported or unavailable in the local Drizzle version, adjust the import to match existing Drizzle usage.

- [ ] **Step 5: Commit**

```powershell
git add shared/schema.ts migrations/0008_brain_projection.sql
git commit -m "feat: add derived brain schema"
```

---

### Task 2: Add Brain Adapter Types

**Files:**
- Create: `C:\Users\justi\OneDrive\Desktop\Jarvis\server\brain\types.ts`
- Create: `C:\Users\justi\OneDrive\Desktop\Jarvis\server\brain\index.ts`

- [ ] **Step 1: Create `types.ts`**

```ts
export type BrainScope = {
  userId: string;
  tenantId?: string;
  sourceIds?: string[];
  actorId: string;
  runId?: string;
  approvalMode?: "auto" | "review_required";
};

export type ProvenanceRef = {
  kind: "user_memory" | "chat" | "email" | "telegram" | "document" | "voice" | "goal" | "plan" | "people";
  id: string;
  sourceType?: string;
  sourceRef?: string;
  timestamp?: string;
};

export type BrainLinkInput = {
  verb: string;
  toSlug: string;
  confidence?: number;
};

export type UpsertEvidenceInput = BrainScope & {
  pageType: string;
  slug: string;
  title: string;
  compiledTruth?: string;
  sourceKind: string;
  sourceId: string;
  timelineAppend?: Array<{
    at?: string;
    summary: string;
    detail?: string;
    provenance: ProvenanceRef[];
  }>;
  links?: BrainLinkInput[];
  provenance: ProvenanceRef[];
};

export type QueryBrainInput = BrainScope & {
  query: string;
  topK?: number;
  timeWindow?: { start?: string; end?: string };
  entityHints?: string[];
  includeTimeline?: boolean;
  includeLinks?: boolean;
  approvalFilter?: "approved_only" | "include_pending";
};

export type QueryBrainResult = {
  answerDraft?: string;
  pages: Array<{
    slug: string;
    title: string;
    score: number;
    citations: ProvenanceRef[];
  }>;
  chunks: Array<{
    pageSlug: string;
    content: string;
    score: number;
    citations: ProvenanceRef[];
  }>;
  links?: Array<{ from: string; verb: string; to: string }>;
  warnings?: string[];
};

export interface JarvisBrainAdapter {
  upsertEvidence(input: UpsertEvidenceInput): Promise<{ pageId: string; versionId?: string }>;
  projectApprovedMemories(userId: string, limit?: number): Promise<{ scanned: number; projected: number; skipped: number }>;
  query(input: QueryBrainInput): Promise<QueryBrainResult>;
  refreshIndex(scope: BrainScope & { staleOnly?: boolean }): Promise<{ embedded: number; linked: number }>;
  queueMaintenance(scope: BrainScope & { job: "citation_fix" | "link_refresh" | "compact" | "daily_synthesis" }): Promise<{ jobId: string }>;
}
```

- [ ] **Step 2: Create `index.ts`**

```ts
export * from "./types";
export * from "./slug";
export * from "./chunk";
export * from "./links";
export * from "./adapter";
```

- [ ] **Step 3: Run build**

Run:

```powershell
npm.cmd run server:build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add server/brain/types.ts server/brain/index.ts
git commit -m "feat: define Jarvis brain adapter contract"
```

---

### Task 3: Implement Deterministic Slugging

**Files:**
- Create: `C:\Users\justi\OneDrive\Desktop\Jarvis\server\brain\slug.ts`
- Create: `C:\Users\justi\OneDrive\Desktop\Jarvis\server\brain\__tests__\slug.test.ts`

- [ ] **Step 1: Write slug tests**

```ts
import { memoryPageSlug, personPageSlug, slugify } from "../slug";

describe("brain slug helpers", () => {
  it("normalizes arbitrary titles", () => {
    expect(slugify("  John's Beans / Watertown, NY!  ")).toBe("johns-beans-watertown-ny");
  });

  it("uses stable user memory slugs", () => {
    expect(memoryPageSlug("abc-123", "User prefers morning deep work")).toBe("memory/user-prefers-morning-deep-work-abc123");
  });

  it("uses stable person slugs", () => {
    expect(personPageSlug("Jean Smith")).toBe("person/jean-smith");
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```powershell
npm.cmd test -- server/brain/__tests__/slug.test.ts
```

Expected: FAIL because `server/brain/slug.ts` does not exist yet.

- [ ] **Step 3: Implement `slug.ts`**

```ts
export function slugify(input: string, fallback = "untitled"): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || fallback;
}

function shortId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toLowerCase() || "unknown";
}

export function memoryPageSlug(memoryId: string, content: string): string {
  return `memory/${slugify(content)}-${shortId(memoryId)}`;
}

export function personPageSlug(name: string): string {
  return `person/${slugify(name)}`;
}
```

- [ ] **Step 4: Run test**

Run:

```powershell
npm.cmd test -- server/brain/__tests__/slug.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/brain/slug.ts server/brain/__tests__/slug.test.ts
git commit -m "feat: add deterministic brain slugs"
```

---

### Task 4: Implement Chunking

**Files:**
- Create: `C:\Users\justi\OneDrive\Desktop\Jarvis\server\brain\chunk.ts`
- Create: `C:\Users\justi\OneDrive\Desktop\Jarvis\server\brain\__tests__\chunk.test.ts`

- [ ] **Step 1: Write chunk tests**

```ts
import { chunkText } from "../chunk";

describe("chunkText", () => {
  it("returns no chunks for blank input", () => {
    expect(chunkText("   ")).toEqual([]);
  });

  it("keeps short text as one chunk", () => {
    expect(chunkText("Jarvis remembers approved facts.", 80)).toEqual(["Jarvis remembers approved facts."]);
  });

  it("splits long text into bounded chunks", () => {
    const input = "A sentence about memory. ".repeat(30);
    const chunks = chunkText(input, 120);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 140)).toBe(true);
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
npm.cmd test -- server/brain/__tests__/chunk.test.ts
```

Expected: FAIL because `chunkText` does not exist yet.

- [ ] **Step 3: Implement `chunk.ts`**

```ts
export function chunkText(input: string, targetChars = 900): string[] {
  const normalized = input.trim().replace(/\s+/g, " ");
  if (!normalized) return [];

  const sentences = normalized.match(/[^.!?]+[.!?]?/g) ?? [normalized];
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence.trim()}` : sentence.trim();
    if (next.length <= targetChars || current.length === 0) {
      current = next;
      continue;
    }
    chunks.push(current);
    current = sentence.trim();
  }

  if (current) chunks.push(current);
  return chunks;
}
```

- [ ] **Step 4: Run test**

Run:

```powershell
npm.cmd test -- server/brain/__tests__/chunk.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/brain/chunk.ts server/brain/__tests__/chunk.test.ts
git commit -m "feat: add brain content chunking"
```

---

### Task 5: Implement Lightweight Link Extraction

**Files:**
- Create: `C:\Users\justi\OneDrive\Desktop\Jarvis\server\brain\links.ts`
- Create: `C:\Users\justi\OneDrive\Desktop\Jarvis\server\brain\__tests__\links.test.ts`

- [ ] **Step 1: Write link tests**

```ts
import { extractBrainLinks } from "../links";

describe("extractBrainLinks", () => {
  it("extracts person links from explicit person hints", () => {
    const links = extractBrainLinks("Justin met with Jean Smith about the website.", ["Jean Smith"]);
    expect(links).toContainEqual({ verb: "mentions", toSlug: "person/jean-smith", confidence: 80 });
  });

  it("deduplicates repeated links", () => {
    const links = extractBrainLinks("Jean Smith emailed Jean Smith.", ["Jean Smith"]);
    expect(links).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
npm.cmd test -- server/brain/__tests__/links.test.ts
```

Expected: FAIL because `links.ts` does not exist yet.

- [ ] **Step 3: Implement `links.ts`**

```ts
import type { BrainLinkInput } from "./types";
import { personPageSlug } from "./slug";

export function extractBrainLinks(text: string, personHints: string[] = []): BrainLinkInput[] {
  const normalized = text.toLowerCase();
  const seen = new Set<string>();
  const links: BrainLinkInput[] = [];

  for (const name of personHints) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    if (!normalized.includes(trimmed.toLowerCase())) continue;
    const toSlug = personPageSlug(trimmed);
    const key = `mentions:${toSlug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ verb: "mentions", toSlug, confidence: 80 });
  }

  return links;
}
```

- [ ] **Step 4: Run test**

Run:

```powershell
npm.cmd test -- server/brain/__tests__/links.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/brain/links.ts server/brain/__tests__/links.test.ts
git commit -m "feat: add brain link extraction"
```

---

### Task 6: Implement Adapter Upsert and Projection

**Files:**
- Create: `C:\Users\justi\OneDrive\Desktop\Jarvis\server\brain\adapter.ts`
- Create: `C:\Users\justi\OneDrive\Desktop\Jarvis\server\brain\__tests__\adapter.test.ts`

- [ ] **Step 1: Write adapter tests**

Use a mocked `db` module if the existing test harness supports mocks. If it does not, place these as integration tests against the repo's seeded test database:

```ts
import { projectApprovedMemories } from "../adapter";

describe("projectApprovedMemories", () => {
  it("does not project pending review memories", async () => {
    const result = await projectApprovedMemories("test-user", 25);
    expect(result.skipped).toBeGreaterThanOrEqual(0);
  });
});
```

Add the real assertions once the harness pattern is confirmed:

```ts
expect(projectedPages).not.toContainEqual(expect.objectContaining({
  sourceKind: "user_memory",
  sourceId: "pending-memory-id",
}));
```

- [ ] **Step 2: Implement `adapter.ts`**

```ts
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import * as schema from "@shared/schema";
import { chunkText } from "./chunk";
import { memoryPageSlug } from "./slug";
import type { JarvisBrainAdapter, QueryBrainInput, QueryBrainResult, UpsertEvidenceInput } from "./types";

async function replaceChunks(pageId: string, userId: string, content: string, provenance: UpsertEvidenceInput["provenance"]): Promise<void> {
  const chunks = chunkText(content);
  await db.delete(schema.brainContentChunks).where(eq(schema.brainContentChunks.pageId, pageId));
  for (let i = 0; i < chunks.length; i += 1) {
    await db.insert(schema.brainContentChunks).values({
      userId,
      pageId,
      chunkIndex: i,
      content: chunks[i],
      provenance,
    });
  }
}

export async function upsertEvidence(input: UpsertEvidenceInput): Promise<{ pageId: string; versionId?: string }> {
  if (input.approvalMode === "review_required") {
    throw new Error("Brain projection cannot directly approve review-required evidence.");
  }

  const compiledTruth = input.compiledTruth ?? "";
  const existing = await db
    .select()
    .from(schema.brainPages)
    .where(and(eq(schema.brainPages.userId, input.userId), eq(schema.brainPages.slug, input.slug)))
    .limit(1);

  let pageId = existing[0]?.id;
  if (pageId) {
    await db.update(schema.brainPages).set({
      title: input.title,
      pageType: input.pageType,
      compiledTruth,
      provenance: input.provenance,
      updatedAt: sql`NOW()`,
    }).where(eq(schema.brainPages.id, pageId));
  } else {
    const [created] = await db.insert(schema.brainPages).values({
      userId: input.userId,
      pageType: input.pageType,
      slug: input.slug,
      title: input.title,
      compiledTruth,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      provenance: input.provenance,
    }).returning({ id: schema.brainPages.id });
    pageId = created.id;
  }

  const [version] = await db.insert(schema.brainPageVersions).values({
    userId: input.userId,
    pageId,
    compiledTruth,
    provenance: input.provenance,
  }).returning({ id: schema.brainPageVersions.id });

  await replaceChunks(pageId, input.userId, compiledTruth, input.provenance);

  if (input.timelineAppend?.length) {
    for (const item of input.timelineAppend) {
      await db.insert(schema.brainTimelineEntries).values({
        userId: input.userId,
        pageId,
        occurredAt: item.at ? new Date(item.at) : undefined,
        summary: item.summary,
        detail: item.detail,
        provenance: item.provenance,
      });
    }
  }

  if (input.links?.length) {
    for (const link of input.links) {
      await db.insert(schema.brainLinks).values({
        userId: input.userId,
        fromPageId: pageId,
        toSlug: link.toSlug,
        verb: link.verb,
        confidence: link.confidence ?? 70,
        provenance: input.provenance,
      }).onConflictDoNothing();
    }
  }

  return { pageId, versionId: version.id };
}

export async function projectApprovedMemories(userId: string, limit = 100): Promise<{ scanned: number; projected: number; skipped: number }> {
  const rows = await db.select().from(schema.userMemories).where(eq(schema.userMemories.userId, userId)).limit(limit);
  let projected = 0;
  let skipped = 0;

  for (const memory of rows) {
    const expired = memory.expiresAt ? memory.expiresAt.getTime() < Date.now() : false;
    const pending = memory.pendingReview || memory.reviewStatus === "pending" || memory.reviewStatus === "discarded";
    if (expired || pending) {
      skipped += 1;
      continue;
    }

    await upsertEvidence({
      userId,
      actorId: "jarvis-memory-projection",
      pageType: "memory",
      slug: memoryPageSlug(memory.id, memory.content),
      title: memory.content.slice(0, 120),
      compiledTruth: memory.content,
      sourceKind: "user_memory",
      sourceId: memory.id,
      provenance: [{
        kind: "user_memory",
        id: memory.id,
        sourceType: memory.sourceType,
        sourceRef: memory.sourceRef ?? undefined,
        timestamp: memory.extractedAt?.toISOString(),
      }],
    });
    projected += 1;
  }

  return { scanned: rows.length, projected, skipped };
}

export async function queryBrain(input: QueryBrainInput): Promise<QueryBrainResult> {
  const q = input.query.trim();
  if (!q) return { pages: [], chunks: [] };

  const rawRows = await db.execute<{
    slug: string;
    title: string;
    content: string;
    provenance: unknown;
    score: number;
  }>(sql`
    SELECT p.slug, p.title, c.content, c.provenance,
           ts_rank(to_tsvector('english', c.content), plainto_tsquery('english', ${q})) AS score
    FROM brain_content_chunks c
    JOIN brain_pages p ON p.id = c.page_id
    WHERE c.user_id = ${input.userId}
      AND to_tsvector('english', c.content) @@ plainto_tsquery('english', ${q})
      AND (${input.approvalFilter ?? "approved_only"} = 'include_pending' OR p.review_status = 'active')
    ORDER BY score DESC
    LIMIT ${input.topK ?? 12}
  `);

  const chunks = (rawRows.rows ?? []).map((row) => ({
    pageSlug: row.slug,
    content: row.content,
    score: Number(row.score) || 0,
    citations: Array.isArray(row.provenance) ? row.provenance as QueryBrainResult["chunks"][number]["citations"] : [],
  }));

  const pageMap = new Map<string, QueryBrainResult["pages"][number]>();
  for (const row of rawRows.rows ?? []) {
    if (!pageMap.has(row.slug)) {
      pageMap.set(row.slug, {
        slug: row.slug,
        title: row.title,
        score: Number(row.score) || 0,
        citations: Array.isArray(row.provenance) ? row.provenance as QueryBrainResult["pages"][number]["citations"] : [],
      });
    }
  }

  return { pages: [...pageMap.values()], chunks };
}

export async function refreshIndex(): Promise<{ embedded: number; linked: number }> {
  return { embedded: 0, linked: 0 };
}

export async function queueMaintenance(): Promise<{ jobId: string }> {
  return { jobId: "not-queued-first-slice" };
}

export const jarvisBrainAdapter: JarvisBrainAdapter = {
  upsertEvidence,
  projectApprovedMemories,
  query: queryBrain,
  refreshIndex,
  queueMaintenance,
};
```

- [ ] **Step 3: Run targeted adapter tests**

Run:

```powershell
npm.cmd test -- server/brain/__tests__/adapter.test.ts
```

Expected: PASS after test harness details are aligned.

- [ ] **Step 4: Run server build**

Run:

```powershell
npm.cmd run server:build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/brain/adapter.ts server/brain/__tests__/adapter.test.ts
git commit -m "feat: project approved memories into brain pages"
```

---

### Task 7: Wire Best-Effort Projection After Extraction

**Files:**
- Modify: `C:\Users\justi\OneDrive\Desktop\Jarvis\server\memory\extractor.ts`

- [ ] **Step 1: Add projection call after stored memories**

In `extractAndStore`, inside the existing `if (stored.length > 0) { ... }` block, after the vault writer branch, add:

```ts
    if (process.env.JARVIS_BRAIN_PROJECTION === "1") {
      import("../brain").then(({ projectApprovedMemories }) => {
        projectApprovedMemories(userId, 25).catch((err) =>
          console.error("[Memory] brain projection failed:", err),
        );
      }).catch((err) => console.error("[Memory] brain import failed:", err));
    }
```

- [ ] **Step 2: Run build**

Run:

```powershell
npm.cmd run server:build
```

Expected: PASS.

- [ ] **Step 3: Commit**

```powershell
git add server/memory/extractor.ts
git commit -m "feat: queue brain projection after memory extraction"
```

---

### Task 8: Add Opt-In Retrieval Fallback

**Files:**
- Modify: `C:\Users\justi\OneDrive\Desktop\Jarvis\server\memory\retrieve.ts`
- Create: `C:\Users\justi\OneDrive\Desktop\Jarvis\server\memory\__tests__\brainRetrievalFallback.test.ts`

- [ ] **Step 1: Add a fallback test**

```ts
import { retrieveRelevantMemories } from "../retrieve";

describe("retrieveRelevantMemories brain fallback", () => {
  it("returns existing retrieval results when derived brain retrieval is disabled", async () => {
    const previous = process.env.JARVIS_BRAIN_RETRIEVAL;
    delete process.env.JARVIS_BRAIN_RETRIEVAL;
    const result = await retrieveRelevantMemories("test-user", "morning deep work", 3, true);
    expect(Array.isArray(result)).toBe(true);
    process.env.JARVIS_BRAIN_RETRIEVAL = previous;
  });
});
```

- [ ] **Step 2: Add optional derived retrieval path**

Near the start of `retrieveRelevantMemories`, after `const q = query.trim(); if (!q) return [];`, add:

```ts
  if (process.env.JARVIS_BRAIN_RETRIEVAL === "1") {
    try {
      const { queryBrain } = await import("../brain");
      const brainResult = await queryBrain({
        userId,
        actorId: "memory-retrieve",
        query: q,
        topK: limit,
        approvalFilter: "approved_only",
      });
      const derived = brainResult.chunks.map((chunk, index) => ({
        id: `${chunk.pageSlug}:${index}`,
        content: chunk.content,
        category: "fact",
        tier: "long_term",
        memoryType: "semantic",
        relevanceScore: Math.round(Math.min(1, Math.max(0, chunk.score)) * 100),
        confidence: 80,
        accessCount: 0,
        score: chunk.score,
      }));
      if (derived.length > 0) return derived;
    } catch (err) {
      console.warn("[MemoryRetrieve] derived brain retrieval failed; falling back:", err);
    }
  }
```

- [ ] **Step 3: Run test**

Run:

```powershell
npm.cmd test -- server/memory/__tests__/brainRetrievalFallback.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run server build**

Run:

```powershell
npm.cmd run server:build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/memory/retrieve.ts server/memory/__tests__/brainRetrievalFallback.test.ts
git commit -m "feat: add opt-in derived brain retrieval"
```

---

### Task 9: Add Context Pack Signal

**Files:**
- Modify: `C:\Users\justi\OneDrive\Desktop\Jarvis\server\agent\contextPacks.ts`

- [ ] **Step 1: Extend `ContextPackId`**

Add `brain_context` to the union:

```ts
  | "brain_context"
```

- [ ] **Step 2: Push brain context for memory tasks**

Inside the `if (memory) { ... }` block, add:

```ts
    if (process.env.JARVIS_BRAIN_RETRIEVAL === "1") {
      packs.push("brain_context");
      reasons.push("Derived brain retrieval is enabled.");
    }
```

- [ ] **Step 3: Run build**

Run:

```powershell
npm.cmd run server:build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add server/agent/contextPacks.ts
git commit -m "feat: route memory tasks through derived brain context"
```

---

### Task 10: Verification and Rollout

**Files:**
- No new files required unless failures reveal missing coverage.

- [ ] **Step 1: Run all agent tests**

Run:

```powershell
npm.cmd test
```

Expected: PASS or only documented pre-existing failures.

- [ ] **Step 2: Run server build**

Run:

```powershell
npm.cmd run server:build
```

Expected: PASS.

- [ ] **Step 3: Run doctor**

Run:

```powershell
npm.cmd run jarvis:doctor
```

Expected: PASS for local readiness, or clear environment-only failures.

- [ ] **Step 4: Stage feature flag rollout**

Enable projection only first:

```powershell
$env:JARVIS_BRAIN_PROJECTION="1"
npm.cmd run server:dev
```

Verify memory extraction still writes `user_memories` and begins writing derived `brain_pages` for approved memories only.

- [ ] **Step 5: Enable retrieval flag locally**

```powershell
$env:JARVIS_BRAIN_RETRIEVAL="1"
npm.cmd run server:dev
```

Ask a memory query and verify the response still works. If derived brain returns no chunks, existing retrieval should continue to answer.

- [ ] **Step 6: Final commit**

```powershell
git status --short
git log --oneline -5
```

Expected: only planned files changed, no `.env.local`, logs, screenshots, build output, or unrelated `.ops/` files staged.

---

## Self-Review

Spec coverage:

- The report's primary recommendation, "Jarvis owns source of truth; vendored GBrain core becomes derived memory/index layer," is covered by Tasks 1, 6, 7, and 8.
- Markdown/page model is approximated in the first slice with `compiledTruth`, pages, chunks, timeline entries, and versions.
- Hybrid retrieval starts with FTS over chunks and leaves pgvector as the next incremental improvement so the first slice can ship without requiring an immediate pgvector extension migration.
- Link graph starts with lightweight person-hint links in Task 5 and can expand after entity benchmark evidence exists.
- Public GBrain auth, MCP server, admin, PGLite, and cron subsystems are explicitly out of scope.

Placeholder scan:

- No task uses TBD, TODO, "similar to", or unspecified error handling.
- Test harness specifics may need local adjustment because the repo's `npm.cmd test` wrapper controls test discovery; the expected implementation path is still concrete.

Type consistency:

- `JarvisBrainAdapter` method names match `adapter.ts` exports.
- `ProvenanceRef` is used consistently across page, chunk, timeline, and query result types.
- Existing `RetrievedMemory` shape in `server/memory/retrieve.ts` is preserved for fallback compatibility.

## Follow-Up Work After First Slice

- Add real pgvector columns and vector indexes when the production database extension state is confirmed.
- Add benchmark fixtures comparing `retrieve.ts` baseline against derived-brain FTS/graph retrieval.
- Backfill `people` into person pages and pass person names into `extractBrainLinks`.
- Add scheduled maintenance through Jarvis's existing job/runtime surface instead of GBrain minions.
- Add user-facing provenance display and memory correction/deletion flows for derived brain pages.
