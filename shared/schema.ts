import { sql } from "drizzle-orm";
import { pgTable, text, varchar, jsonb, timestamp, date, primaryKey, integer, uniqueIndex, boolean, serial, real, bigint, index, customType } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

const vector1536 = customType<{ data: number[] | null }>({
  dataType() {
    return "vector(1536)";
  },
  toDriver(value) {
    if (!Array.isArray(value)) return null;
    return `[${value.map((entry) => Number(entry) || 0).join(",")}]`;
  },
});

export const users = pgTable("users", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password"),
  googleId: text("google_id").unique(),
  displayName: text("display_name"),
  email: text("email"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const plans = pgTable("plans", {
  userId: varchar("user_id").notNull().references(() => users.id),
  date: varchar("date").notNull(),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.date] }),
]);

export const goals = pgTable("goals", {
  userId: varchar("user_id").notNull().primaryKey().references(() => users.id),
  data: jsonb("data").notNull().default(sql`'[]'::jsonb`),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const stats = pgTable("stats", {
  userId: varchar("user_id").notNull().primaryKey().references(() => users.id),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const brainDumpInbox = pgTable("brain_dump_inbox", {
  userId: varchar("user_id").notNull().primaryKey().references(() => users.id),
  data: jsonb("data").notNull().default(sql`'[]'::jsonb`),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const energyCheckins = pgTable("energy_checkins", {
  userId: varchar("user_id").notNull().references(() => users.id),
  date: varchar("date").notNull(),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.date] }),
]);

export const chatHistory = pgTable("chat_history", {
  userId: varchar("user_id").notNull().primaryKey().references(() => users.id),
  data: jsonb("data").notNull().default(sql`'[]'::jsonb`),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const lifeContext = pgTable("life_context", {
  userId: varchar("user_id").notNull().primaryKey().references(() => users.id),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const timerSettings = pgTable("timer_settings", {
  userId: varchar("user_id").notNull().primaryKey().references(() => users.id),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const userPreferences = pgTable("user_preferences", {
  userId: varchar("user_id").notNull().primaryKey().references(() => users.id),
  data: jsonb("data").notNull().default(sql`'{}'::jsonb`),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const completionHistory = pgTable("completion_history", {
  userId: varchar("user_id").notNull().primaryKey().references(() => users.id),
  data: jsonb("data").notNull().default(sql`'[]'::jsonb`),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const blockedTasks = pgTable("blocked_tasks", {
  userId: varchar("user_id").notNull().primaryKey().references(() => users.id),
  data: jsonb("data").notNull().default(sql`'[]'::jsonb`),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const completedCalendarIds = pgTable("completed_calendar_ids", {
  userId: varchar("user_id").notNull().references(() => users.id),
  date: varchar("date").notNull(),
  data: jsonb("data").notNull().default(sql`'[]'::jsonb`),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.date] }),
]);

export const planSnapshots = pgTable("plan_snapshots", {
  userId: varchar("user_id").notNull().primaryKey().references(() => users.id),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const telegramLinks = pgTable("telegram_links", {
  userId: varchar("user_id").notNull().primaryKey().references(() => users.id),
  chatId: varchar("chat_id").notNull(),
  username: varchar("username"),
  linkedAt: timestamp("linked_at").defaultNow().notNull(),
  groupChatIds: jsonb("group_chat_ids").default(sql`'[]'::jsonb`),
});

export const telegramLinkCodes = pgTable("telegram_link_codes", {
  code: varchar("code").primaryKey(),
  userId: varchar("user_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const telegramGroupMessages = pgTable("telegram_group_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  chatId: varchar("chat_id").notNull(),
  chatTitle: varchar("chat_title"),
  fromUser: varchar("from_user"),
  text: text("text").notNull(),
  messageDate: timestamp("message_date").defaultNow().notNull(),
});

export const userOAuthTokens = pgTable("user_oauth_tokens", {
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: varchar("provider").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  expiresAt: timestamp("expires_at"),
  scopes: text("scopes"),
  accountEmail: text("account_email").notNull().default(""),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.provider, table.accountEmail] }),
]);

export const modelProviderAuthProfiles = pgTable("model_provider_auth_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: varchar("provider").notNull(),
  authType: varchar("auth_type").notNull(),
  accessTokenEncrypted: text("access_token_encrypted"),
  refreshTokenEncrypted: text("refresh_token_encrypted"),
  apiKeyEncrypted: text("api_key_encrypted"),
  expiresAt: timestamp("expires_at"),
  accountId: text("account_id"),
  email: text("email"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("model_provider_auth_profiles_user_provider_auth_type_idx")
    .on(table.userId, table.provider, table.authType),
  index("model_provider_auth_profiles_user_provider_idx")
    .on(table.userId, table.provider),
]);

export const composioConnectedAccounts = pgTable("composio_connected_accounts", {
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  toolkit: varchar("toolkit").notNull(),
  authConfigId: varchar("auth_config_id").notNull(),
  connectedAccountId: varchar("connected_account_id").notNull(),
  status: varchar("status").notNull().default("ACTIVE"),
  accountEmail: text("account_email"),
  accountName: text("account_name"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.connectedAccountId] }),
]);

export const commitments = pgTable("commitments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  content: text("content").notNull(),
  dueDate: varchar("due_date"),
  status: varchar("status").notNull().default("pending"),
  extractedAt: timestamp("extracted_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
  sourceMessage: text("source_message"),
});

export const userMemories = pgTable("user_memories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  content: text("content").notNull(),
  category: varchar("category").notNull().default("fact"),
  // Phase 4: typed memory layer with relevance / decay / source tracking.
  relevanceScore: integer("relevance_score").notNull().default(50),
  confidence: integer("confidence").notNull().default(70),
  sourceType: varchar("source_type").notNull().default("manual"),
  sourceRef: varchar("source_ref"),
  lastReferencedAt: timestamp("last_referenced_at"),
  // Cached OpenAI text-embedding-3-small vector (1536 floats) used by the
  // hybrid retrieval helper in server/memory/retrieve.ts. JSONB remains the
  // portable fallback; embeddingVector is the optional pgvector index column.
  embedding: jsonb("embedding").$type<number[] | null>(),
  embeddingVector: vector1536("embedding_vector"),
  extractedAt: timestamp("extracted_at").defaultNow().notNull(),
  // Biomimetic memory tier & type system (Phase 5).
  // tier: working (minutes) | short_term (hours/days) | long_term (permanent)
  // memory_type: episodic (events) | semantic (facts) | procedural (habits) | contextual (conversation context)
  // expires_at: nullable TTL timestamp — set for working/short_term memories; null = never expires
  // access_count: incremented each retrieval, used by scorer to surface frequently-recalled memories
  tier: varchar("tier").notNull().default("long_term"),
  memoryType: varchar("memory_type").notNull().default("semantic"),
  expiresAt: timestamp("expires_at"),
  accessCount: integer("access_count").notNull().default(0),
  // Human-in-the-loop review gate (Phase 6).
  // pending_review = true  → memory is awaiting user approval before becoming active
  // review_status: active/pending/kept/edited/superseded/corrected/stale/archived/discarded/rejected
  pendingReview: boolean("pending_review").notNull().default(false),
  reviewStatus: varchar("review_status").notNull().default("active"),
  supersedesMemoryId: varchar("supersedes_memory_id"),
  correctedByMemoryId: varchar("corrected_by_memory_id"),
  sensitivity: varchar("sensitivity").notNull().default("normal"),
  provenance: jsonb("provenance").$type<Array<{ sourceType: string; sourceRef?: string | null; sensitivity?: string; label?: string; restricted?: boolean }>>().notNull().default(sql`'[]'::jsonb`),
}, (table) => [
  index("user_memories_user_review_idx").on(table.userId, table.reviewStatus),
  index("user_memories_user_sensitivity_idx").on(table.userId, table.sensitivity),
]);

// Biomimetic memory tiers — mirrors human memory architecture.
export const MEMORY_TIERS = ["working", "short_term", "long_term"] as const;
export type MemoryTier = typeof MEMORY_TIERS[number];

// Biomimetic memory types — mirrors human memory classification.
export const MEMORY_TYPES = ["episodic", "semantic", "procedural", "contextual"] as const;
export type MemoryType = typeof MEMORY_TYPES[number];

export const MEMORY_LIFECYCLE_STATES = [
  "active",
  "pending",
  "kept",
  "edited",
  "superseded",
  "corrected",
  "stale",
  "archived",
  "discarded",
  "rejected",
] as const;
export type MemoryLifecycleState = typeof MEMORY_LIFECYCLE_STATES[number];

// Phase 4 — canonical memory categories. Stored as plain varchar so we can
// migrate forward without an enum, but the extractor + UI both clamp to this
// list (legacy categories like "personality" → "communication_style").
export const MEMORY_CATEGORIES = [
  "work_patterns",
  "communication_style",
  "energy_rhythms",
  "goals_history",
  "relationships",
  "values",
  "blockers",
  "accomplishments",
  "preferences",
  "fact",
] as const;
export type MemoryCategory = typeof MEMORY_CATEGORIES[number];

export const memoryWorkingContext = pgTable("memory_working_context", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  scopeType: varchar("scope_type").notNull(),
  scopeId: varchar("scope_id").notNull(),
  activeGoal: text("active_goal"),
  currentStep: text("current_step"),
  lastEventId: varchar("last_event_id").notNull(),
  content: text("content").notNull(),
  state: varchar("state").notNull().default("active"),
  compactedMemoryId: varchar("compacted_memory_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
}, (table) => [
  uniqueIndex("memory_working_context_user_scope_idx").on(table.userId, table.scopeType, table.scopeId),
  index("memory_working_context_user_state_expiry_idx").on(table.userId, table.state, table.expiresAt),
]);

// Phase 4 — lightweight people directory built from emails / calendars /
// chat. The agent uses it to remember names, roles, and last-seen dates
// when drafting replies or proactive nudges.
export const people = pgTable("people", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: varchar("email"),
  relationship: text("relationship"),
  notes: text("notes"),
  interactionCount: integer("interaction_count").notNull().default(0),
  lastInteractionAt: timestamp("last_interaction_at"),
  // Phase 4 — relationship intelligence: nearest upcoming shared event
  // and how many shared events sit on the calendar in the near horizon.
  nextInteractionAt: timestamp("next_interaction_at"),
  upcomingCount: integer("upcoming_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Phase 4 — JARVIS_SOUL.md per user. A single curated markdown document
// that replaces the old per-message memory dump in the coach prompt.
// Regenerated on a Sunday cadence (or on demand) from typed memories +
// life context + people + weekly insights. Optional manualOverride text
// lets the user pin extra context that survives regeneration.
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
  embeddingVector: vector1536("embedding_vector"),
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

export const jarvisSouls = pgTable("jarvis_souls", {
  userId: varchar("user_id").notNull().primaryKey().references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull().default(""),
  manualOverride: text("manual_override"),
  generatedAt: timestamp("generated_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const soulEditEvents = pgTable("soul_edit_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  target: varchar("target").notNull(),
  status: varchar("status").notNull().default("pending"),
  oldValue: text("old_value"),
  newValue: text("new_value").notNull(),
  source: varchar("source").notNull().default("chat"),
  sourceRef: text("source_ref"),
  requestedBy: varchar("requested_by"),
  approvedBy: varchar("approved_by"),
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
}, (table) => [
  index("soul_edit_events_user_status_created_idx").on(table.userId, table.status, table.createdAt),
]);

export const livingContextUpdates = pgTable("living_context_updates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  target: varchar("target").notNull(),
  path: text("path").notNull(),
  topic: text("topic").notNull(),
  learned: text("learned").notNull(),
  normalizedLearned: text("normalized_learned").notNull(),
  sourceType: varchar("source_type").notNull().default("conversation"),
  sourceRef: text("source_ref"),
  confidence: integer("confidence").notNull().default(70),
  status: varchar("status").notNull().default("needs_review"),
  fillsQuestion: text("fills_question"),
  approvalSensitive: boolean("approval_sensitive").notNull().default(true),
  notes: text("notes"),
  block: text("block").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("living_context_updates_user_target_fact_idx").on(table.userId, table.target, table.normalizedLearned),
]);

export interface WeeklyPattern {
  category: MemoryCategory | "fact";
  observation: string;
  evidence: string[];
  confidence: number;
}

// Phase 4 — Sunday pattern recognition output. The weekly agent job
// inspects last-7-days activity and writes 3-5 patterns here. High-
// confidence patterns are also promoted into user_memories so they
// influence future coaching.
export const weeklyInsights = pgTable("weekly_insights", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  weekOf: varchar("week_of").notNull(),
  patterns: jsonb("patterns").$type<WeeklyPattern[]>().notNull().default(sql`'[]'::jsonb`),
  summary: text("summary"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("weekly_insights_user_week_idx").on(table.userId, table.weekOf),
]);

export const proactiveQuestionsSent = pgTable("proactive_questions_sent", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  sourceType: varchar("source_type").notNull(),
  sourceId: varchar("source_id").notNull(),
  question: text("question").notNull(),
  sentAt: timestamp("sent_at").defaultNow(),
  answeredAt: timestamp("answered_at"),
}, (t) => ({
  userSourceUniq: uniqueIndex("proactive_questions_sent_user_source_idx").on(t.userId, t.sourceId),
}));

export const inboxRules = pgTable("inbox_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  type: varchar("type").notNull(),
  scope: varchar("scope").notNull(),
  pattern: text("pattern").notNull(),
  matchHints: jsonb("match_hints"),
  source: varchar("source").notNull(),
  matchCount: integer("match_count").default(0),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const inboxItems = pgTable("inbox_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  sourceType: varchar("source_type").notNull(),
  sourceId: varchar("source_id").notNull(),
  subject: text("subject"),
  sender: text("sender"),
  snippet: text("snippet"),
  jarvisReason: text("jarvis_reason"),
  suggestedActions: jsonb("suggested_actions"),
  status: varchar("status").default("pending"),
  dismissCount: integer("dismiss_count").default(0),
  matchedRuleId: varchar("matched_rule_id"),
  surfacedAt: timestamp("surfaced_at").defaultNow(),
  actedAt: timestamp("acted_at"),
}, (t) => [uniqueIndex("inbox_items_user_source_idx").on(t.userId, t.sourceId)]);

export const mobileAuthSessions = pgTable("mobile_auth_sessions", {
  sessionId: text("session_id").primaryKey(),
  token: text("token").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});

export const userDocuments = pgTable("user_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  mimeType: varchar("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull().default(0),
  status: varchar("status").notNull().default("processing"),
  extractedText: text("extracted_text"),
  summary: text("summary"),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
});


export const websiteCrawls = pgTable("website_crawls", {
  userId: varchar("user_id").notNull().primaryKey().references(() => users.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  status: varchar("status").notNull().default("idle"),
  pageCount: integer("page_count").notNull().default(0),
  summary: text("summary"),
  crawledAt: timestamp("crawled_at"),
});

export const chatgptImports = pgTable("chatgpt_imports", {
  userId: varchar("user_id").notNull().primaryKey().references(() => users.id),
  importedAt: timestamp("imported_at").defaultNow().notNull(),
  memoriesAdded: integer("memories_added").notNull().default(0),
});

export const proactiveScheduleLog = pgTable("proactive_schedule_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  messageType: varchar("message_type").notNull(),
  sentDate: varchar("sent_date").notNull(),
  sentAt: timestamp("sent_at").defaultNow(),
}, (t) => [
  uniqueIndex("proactive_schedule_log_uniq").on(t.userId, t.messageType, t.sentDate),
]);

export interface MomentumStepData {
  text: string;
  tactic: string;
  xp: number;
}

export const momentumSessions = pgTable("momentum_sessions", {
  userId: varchar("user_id").notNull().primaryKey().references(() => users.id),
  currentStep: integer("current_step").notNull().default(0),
  sessionDate: varchar("session_date").notNull().default(""),
  completedSteps: integer("completed_steps").notNull().default(0),
  steps: jsonb("steps").$type<MomentumStepData[]>().notNull().default(sql`'[]'::jsonb`),
  status: varchar("status").notNull().default("active"),
  lastStepAt: timestamp("last_step_at"),
});

export const morningVoiceNotes = pgTable("morning_voice_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  recordedAt: date("recorded_at").notNull(),
  transcript: text("transcript").notNull(),
  moodSignal: varchar("mood_signal").notNull().default("calm"),
  themes: jsonb("themes").notNull().default(sql`'[]'::jsonb`),
  blockers: jsonb("blockers").notNull().default(sql`'[]'::jsonb`),
  wins: jsonb("wins").notNull().default(sql`'[]'::jsonb`),
  intention: text("intention"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const emailDrafts = pgTable("email_drafts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  sourceMessageId: varchar("source_message_id"),
  fromSender: text("from_sender"),
  originalSubject: text("original_subject"),
  draftSubject: text("draft_subject").notNull(),
  draftBody: text("draft_body").notNull(),
  jarvisReason: text("jarvis_reason"),
  status: varchar("status").notNull().default("pending_approval"),
  gmailDraftId: varchar("gmail_draft_id"),
  gmailDraftUrl: text("gmail_draft_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  actedAt: timestamp("acted_at"),
});

export interface GoalTreeTask {
  id: string;
  title: string;
  description?: string;
  estimateHours?: number;
  status: "ready" | "in_progress" | "blocked" | "complete";
  dueDate?: string;
  completedAt?: string;
  injectedOnDates?: string[];
}

export interface GoalTreeMilestone {
  id: string;
  title: string;
  description?: string;
  status: "ready" | "in_progress" | "complete";
  tasks: GoalTreeTask[];
}

export interface GoalTreePhase {
  id: string;
  title: string;
  description?: string;
  status: "ready" | "in_progress" | "complete";
  milestones: GoalTreeMilestone[];
}

export interface GoalTreeData {
  phases: GoalTreePhase[];
  rationale?: string;
  generatedAt?: string;
}

export const goalTrees = pgTable("goal_trees", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  goalId: varchar("goal_id").notNull(),
  title: text("title").notNull(),
  tree: jsonb("tree").$type<GoalTreeData>().notNull().default(sql`'{"phases":[]}'::jsonb`),
  status: varchar("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const jarvisScheduledTasks = pgTable("jarvis_scheduled_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  scheduledAt: timestamp("scheduled_at").notNull(),
  recurrence: varchar("recurrence"),
  taskKind: varchar("task_kind").notNull().default("user_task"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  shellCommand: text("shell_command"),
  lastShellResult: jsonb("last_shell_result").$type<{ exitCode: number; stdout: string; stderr: string; durationMs: number; ranAt: string } | null>(),
  inProgressAt: timestamp("in_progress_at"),
  active: boolean("active").notNull().default(true),
  needsAttention: boolean("needs_attention").notNull().default(false),
  attentionQuestion: text("attention_question"),
});

// ── Workflow Engine ────────────────────────────────────────────────────────────
// Lightweight resumable multi-step plan graph. Each workflow is an ordered
// list of steps; each step maps 1-to-1 with an agentJobs row when running.

export interface WorkflowStep {
  id: string;
  title: string;
  prompt: string;
  agentType?: string;
  status: "pending" | "running" | "complete" | "failed";
  jobId?: string;
  output?: string;
  startedAt?: string;
  completedAt?: string;
}

export const agentWorkflows = pgTable("agent_workflows", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  steps: jsonb("steps").$type<WorkflowStep[]>().notNull().default(sql`'[]'::jsonb`),
  currentStepIndex: integer("current_step_index").notNull().default(0),
  // active | paused_waiting | paused | complete | failed
  status: varchar("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const agentJobs = pgTable("agent_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  agentType: varchar("agent_type").notNull(),
  title: text("title").notNull(),
  prompt: text("prompt").notNull(),
  input: jsonb("input").notNull().default(sql`'{}'::jsonb`),
  // Lifecycle: queued → running → complete → delivered  (or → failed)
  status: varchar("status").notNull().default("queued"),
  result: jsonb("result"),
  error: text("error"),
  turns: integer("turns").default(0),
  toolCallsCount: integer("tool_calls_count").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
});

/**
 * Persistent record of a build-ack event so the suspended-build reminder
 * survives rolling off the chat-history window (which only keeps 20 messages).
 *
 * One row per build intent queued.  The `reminded` flag is flipped to true
 * once coachAgent.ts has appended the one-time heads-up note, ensuring the
 * once-only guarantee holds even when the original ack is no longer visible
 * in the rolling message window.
 */
export const buildSessions = pgTable("build_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  jobId: varchar("job_id"),
  ackTimestamp: bigint("ack_timestamp", { mode: "number" }).notNull(),
  buildDescription: text("build_description").notNull(),
  reminded: boolean("reminded").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type BuildSession = typeof buildSessions.$inferSelect;

export const deliverables = pgTable("deliverables", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  jobId: varchar("job_id").references(() => agentJobs.id, { onDelete: "set null" }),
  agentType: varchar("agent_type").notNull(),
  type: varchar("type").notNull(),
  title: text("title").notNull(),
  summary: text("summary"),
  body: text("body").notNull(),
  meta: jsonb("meta").notNull().default(sql`'{}'::jsonb`),
  status: varchar("status").notNull().default("pending_approval"),
  triageStatus: varchar("triage_status").$type<"needs_attention" | "escalated" | "auto_handled" | "promoted_memory">().notNull().default("needs_attention"),
  triageNote: text("triage_note"),
  driveLink: text("drive_link"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  actedAt: timestamp("acted_at"),
});

// ── Behaviour Pack structured config types ────────────────────────────────────

/**
 * Heartbeat rules bundled with a skill pack.
 * These control when and how Jarvis is proactive during scheduled cycles.
 */
export interface PackHeartbeatRules {
  disableDuringFocusBlocks?: boolean;
  batchInterruptions?: boolean;
  quietHoursOnly?: boolean;
  suppressNotificationTypes?: string[];
}

/**
 * Tool-group preferences bundled with a skill pack.
 * Capability IDs listed under `boost` are unblocked even when channel scope
 * would normally exclude them. IDs under `suppress` are removed from the
 * active tool set regardless of other rules.
 */
export interface PackToolGroups {
  boost?: string[];
  suppress?: string[];
}

// ── Phase 5 — generic per-channel link table for non-Telegram channels.
// (telegram_links stays separate to preserve existing rows.) Channel values:
// "whatsapp" (address = E.164 phone), "slack" (address = slack user id +
// team id, scoped via metadata), "daemon" (address = daemon uuid).
export const channelLinks = pgTable("channel_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  channel: varchar("channel").notNull(),
  address: varchar("address").notNull(),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  linkedAt: timestamp("linked_at").defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at"),
}, (table) => [
  uniqueIndex("channel_links_channel_address_idx").on(table.channel, table.address),
]);

// Phase 5 — short-lived pairing codes used by WhatsApp/Slack/daemon to bind
// an external identity (phone, slack user, daemon process) to a userId.
export const channelLinkCodes = pgTable("channel_link_codes", {
  code: varchar("code").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  channel: varchar("channel").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
});

// Phase 5 — per-notification-type channel routing. Rows are keyed by
// (user, notification_type); channels is a string[] in priority order.
// Empty/missing rows mean "fall back to telegram only" (legacy behavior).
export const channelPreferences = pgTable("channel_preferences", {
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  notificationType: varchar("notification_type").notNull(),
  channels: jsonb("channels").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.notificationType] }),
]);

export const NOTIFICATION_TYPES = [
  "morning_briefing",
  "meeting_brief",
  "email_alert",
  "evening_wrap",
  "commitment_check",
  "weekly_planning",
  "approval_request",
  "nervous_system",
  "dream_insight",
  "stress_checkin",
  "ego_report",
  "general",
  "self_repair",
  "scheduled_task_result",
  "github_ci_alert",
] as const;
export type NotificationType = typeof NOTIFICATION_TYPES[number];

export const CHANNEL_NAMES = ["telegram", "whatsapp", "slack", "daemon", "discord", "in_app", "webchat"] as const;
export type ChannelName = typeof CHANNEL_NAMES[number];

/**
 * Canonical simple-origin values recognised by _notifyJobCompleteCore.
 * "discord*" is handled separately via a startsWith prefix check and is NOT
 * listed here — it matches any string that begins with "discord".
 *
 * IMPORTANT: every value added here MUST also be handled in the switch inside
 * notifyJobCompleteCore.ts.  TypeScript will produce a compile-time error on
 * the exhaustiveness assertion in that switch's default branch if you forget.
 */
export const SIMPLE_ORIGIN_CHANNELS = [
  "telegram",
  "app",
  "coach",
  "appchat",
  "voice",
  "webchat",
] as const;
export type SimpleOriginChannel = typeof SIMPLE_ORIGIN_CHANNELS[number];

// Discord OS — Phase 1: scheduled channel reports
export const discordChannelSchedules = pgTable("discord_channel_schedules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  guildId: varchar("guild_id"),
  channelId: varchar("channel_id"),
  channelName: varchar("channel_name").notNull(),
  label: varchar("label").notNull(),
  cronExpression: varchar("cron_expression").notNull().default("0 7 * * *"),
  prompt: text("prompt").notNull(),
  pipelineNext: varchar("pipeline_next"),
  lastRun: timestamp("last_run"),
  lastOutput: text("last_output"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const interactionLog = pgTable("interaction_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  channel: varchar("channel").notNull(),
  direction: varchar("direction").notNull(),
  content: text("content").notNull(),
  label: varchar("label"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Discord OS — Phase 3: Reaction-Based Approval System ─────────────────────

export const discordPendingApprovals = pgTable("discord_pending_approvals", {
  messageId: varchar("message_id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  channelId: varchar("channel_id").notNull(),
  guildId: varchar("guild_id"),
  type: varchar("type").notNull().default("custom"),
  content: text("content").notNull(),
  approveEmoji: varchar("approve_emoji").notNull().default("✅"),
  rejectEmoji: varchar("reject_emoji").notNull().default("❌"),
  onApprove: jsonb("on_approve").notNull(),
  onReject: jsonb("on_reject"),
  status: varchar("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
});

// ── Discord OS — Phase 6: Named Sub-Agents ────────────────────────────────────

/**
 * Default safe-baseline permission set for a new agent.
 * All destructive/external actions start disabled.
 */
export interface AgentPermissions {
  can_search_web: boolean;
  can_use_browser: boolean;
  can_send_emails: boolean;
  can_create_email_drafts: boolean;
  can_read_email: boolean;
  can_send_messages: boolean;
  can_access_files: boolean;
  can_take_screenshots: boolean;
  can_open_apps: boolean;
  can_call_user: boolean;
  can_use_voice: boolean;
  can_create_tasks: boolean;
  can_create_other_agents: boolean;
  can_access_global_memory: boolean;
  can_run_code: boolean;
  can_access_calendar: boolean;
}

export const DEFAULT_AGENT_PERMISSIONS: AgentPermissions = {
  can_search_web: true,
  can_use_browser: false,
  can_send_emails: false,
  can_create_email_drafts: false,
  can_read_email: false,
  can_send_messages: true,
  can_access_files: false,
  can_take_screenshots: false,
  can_open_apps: false,
  can_call_user: false,
  can_use_voice: false,
  can_create_tasks: true,
  can_create_other_agents: false,
  can_access_global_memory: false,
  can_run_code: false,
  can_access_calendar: false,
};

export type AgentMemoryScope = "agent_private" | "shared" | "global";

export const discordAgents = pgTable("discord_agents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name").notNull(),
  role: varchar("role").notNull().default("custom"),
  persona: text("persona"),
  channelId: varchar("channel_id"),
  channelName: varchar("channel_name"),
  isActive: integer("is_active").notNull().default(1),
  loopEnabled: integer("loop_enabled").notNull().default(0),
  loopIntervalMinutes: integer("loop_interval_minutes").default(60),
  loopPrompt: text("loop_prompt"),
  lastLoopRun: timestamp("last_loop_run"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // ── Multi-agent ego extension ──────────────────────────────────────────
  /** Platforms this agent operates on. Default: ["discord"] */
  platforms: jsonb("platforms").$type<string[]>().notNull().default(sql`'["discord"]'::jsonb`),
  /** Per-flag permissions. Defaults to safe baseline. */
  permissions: jsonb("permissions").$type<AgentPermissions>().notNull().default(sql`'{
    "can_search_web":true,"can_use_browser":false,"can_send_emails":false,
    "can_create_email_drafts":false,"can_read_email":false,"can_send_messages":true,
    "can_access_files":false,"can_take_screenshots":false,"can_open_apps":false,
    "can_call_user":false,"can_use_voice":false,"can_create_tasks":true,
    "can_create_other_agents":false,"can_access_global_memory":false
  }'::jsonb`),
  /** Memory isolation: agent_private (default), shared, or global */
  memoryScope: varchar("memory_scope").notNull().default("agent_private"),
  /** Whether this agent can read global user_memories */
  accessGlobalMemory: boolean("access_global_memory").notNull().default(false),
  /** Users allowed to interact. Empty = all. */
  allowedUsers: jsonb("allowed_users").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  /** Conversation/channel IDs allowed. Empty = all. */
  allowedConversations: jsonb("allowed_conversations").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  /** Private mode: only respond to allowedUsers */
  privateMode: boolean("private_mode").notNull().default(false),
  /** Map of platform → channelId[]. Extends channelId for multi-platform. */
  platformChannels: jsonb("platform_channels").$type<Record<string, string[]>>().notNull().default(sql`'{}'::jsonb`),
  /** Raw config blob for import/export */
  configJson: jsonb("config_json"),
  /** Last heartbeat check timestamp */
  lastHeartbeatAt: timestamp("last_heartbeat_at"),
  /** Set when agent is detected as stuck */
  stuckSince: timestamp("stuck_since"),
  /** Consecutive heartbeat failures */
  heartbeatFailCount: integer("heartbeat_fail_count").notNull().default(0),
  /**
   * Preferred model for this agent. When set, used instead of the global user
   * model preference. Can be overridden per-call via runNamedAgent opts.model.
   * Example: "chatgpt-codex-oauth/auto"
   */
  preferredModel: text("preferred_model"),
  /**
   * Mention patterns: plain strings or /regex/flags that trigger routing to
   * this agent from any Discord guild channel, regardless of channel assignment.
   * Evaluated before the channel-based routing (Phase 6) on every guild message.
   */
  mentionPatterns: jsonb("mention_patterns")
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
});

export type DiscordAgent = typeof discordAgents.$inferSelect;
export type InsertDiscordAgent = typeof discordAgents.$inferInsert;

// ── Agent Memory Namespace ────────────────────────────────────────────────────
// Per-agent private memories, separate from global user_memories.
// An agent with memory_scope = "agent_private" can ONLY read/write here.
// An agent with access_global_memory = true can also read user_memories.

export const agentMemories = pgTable("agent_memories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  agentId: varchar("agent_id").notNull().references(() => discordAgents.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  category: varchar("category").notNull().default("fact"),
  embedding: jsonb("embedding"),
  relevanceScore: integer("relevance_score").notNull().default(50),
  confidence: integer("confidence").notNull().default(70),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AgentMemory = typeof agentMemories.$inferSelect;

// ── Agent-to-Agent Message Bus ────────────────────────────────────────────────
// Internal structured message protocol for agent delegation and coordination.
// Messages are stored and processed asynchronously. Loop detection uses
// delegation depth tracked per (userId + taskId) chain (max depth: 5).

export const AGENT_MESSAGE_TYPES = [
  "task_request",
  "task_result",
  "clarification_needed",
  "error",
  "memory_update_request",
  "tool_request_denied",
  "final_answer",
] as const;
export type AgentMessageType = typeof AGENT_MESSAGE_TYPES[number];

export const AGENT_MESSAGE_STATUSES = ["pending", "processed", "failed"] as const;
export type AgentMessageStatus = typeof AGENT_MESSAGE_STATUSES[number];

export const agentMessages = pgTable("agent_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fromAgentId: varchar("from_agent_id").references(() => discordAgents.id, { onDelete: "set null" }),
  toAgentId: varchar("to_agent_id").notNull().references(() => discordAgents.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  messageType: varchar("message_type").$type<AgentMessageType>().notNull(),
  payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
  status: varchar("status").$type<AgentMessageStatus>().notNull().default("pending"),
  delegationDepth: integer("delegation_depth").notNull().default(0),
  taskId: varchar("task_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AgentMessage = typeof agentMessages.$inferSelect;

// ── Agent Approval Gates ──────────────────────────────────────────────────────
// Persistent record of approval gates created by agents before executing
// sensitive tools. Gates survive server restarts and are surfaced to the user
// via the mobile UI and REST API.

export const AGENT_APPROVAL_STATUSES = ["pending", "approved", "rejected", "expired"] as const;
export type AgentApprovalStatus = typeof AGENT_APPROVAL_STATUSES[number];

export const agentApprovalGates = pgTable("agent_approval_gates", {
  id: varchar("id").primaryKey(),
  agentId: varchar("agent_id").notNull().references(() => discordAgents.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  toolName: varchar("tool_name").notNull(),
  toolArgs: jsonb("tool_args").notNull().default(sql`'{}'::jsonb`),
  description: text("description").notNull(),
  status: varchar("status").$type<AgentApprovalStatus>().notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: varchar("resolved_by"),
  initiatedBy: varchar("initiated_by").notNull().default("user"),
});

export type AgentApprovalGate = typeof agentApprovalGates.$inferSelect;

// ── Per-Agent Approval Policies ───────────────────────────────────────────────
// Each named agent can have its own approval policy that overrides the global
// defaults. Scopes: "global" (use system defaults), "permissive" (auto-approve
// all reversible high-risk tools), "strict" (manual approval for everything),
// "custom" (fine-grained allowlist patterns control auto-approval).

export const AGENT_POLICY_SCOPES = ["global", "permissive", "strict", "custom"] as const;
export type AgentPolicyScope = typeof AGENT_POLICY_SCOPES[number];

export const agentApprovalPolicies = pgTable("agent_approval_policies", {
  agentId: varchar("agent_id").primaryKey().references(() => discordAgents.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  scope: varchar("scope").$type<AgentPolicyScope>().notNull().default("global"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type AgentApprovalPolicy = typeof agentApprovalPolicies.$inferSelect;

// Per-pattern allowlist rows. A "pattern" may be an exact tool name (e.g.
// "gmail_draft") or a simple wildcard suffix (e.g. "gmail_*").
// When the tool name matches any pattern for the agent's policy, it is
// auto-approved without interrupting the user.
export const agentApprovalAllowlist = pgTable("agent_approval_allowlist", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  agentId: varchar("agent_id").notNull().references(() => discordAgents.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  pattern: varchar("pattern").notNull(),
  useCount: integer("use_count").notNull().default(0),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AgentApprovalAllowlistEntry = typeof agentApprovalAllowlist.$inferSelect;

// ── Nervous System — Ambient Signal Monitoring ────────────────────────────────
// Per-user watch topics (keywords, companies, people, industries) that the
// nervous system scanner monitors every 30 minutes via web search.

export const nervousSystemWatches = pgTable("nervous_system_watches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  category: varchar("category").notNull().default("keyword"),
  active: boolean("active").notNull().default(true),
  lastCheckedAt: timestamp("last_checked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Fired signals log — each signal is a search hit scored as relevant.
// contentHash deduplicates: the same story is never surfaced twice.
export const nervousSystemSignals = pgTable("nervous_system_signals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  watchId: varchar("watch_id").references(() => nervousSystemWatches.id, { onDelete: "set null" }),
  watchLabel: text("watch_label").notNull(),
  headline: text("headline").notNull(),
  url: text("url"),
  snippet: text("snippet"),
  relevanceExplanation: text("relevance_explanation"),
  relevanceScore: integer("relevance_score").notNull().default(0),
  contentHash: varchar("content_hash").notNull(),
  deliveredAt: timestamp("delivered_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("nervous_system_signals_hash_idx").on(table.userId, table.contentHash),
]);

// ── Emotional State Engine ────────────────────────────────────────────────────
// Computed once per heartbeat cycle per user. Aggregates objective signals
// (calendar density, energy check-ins, task completion rate, late-night
// activity, message sentiment) into stress and flow scores (0–10).
// Users can also set a manual override to correct Jarvis's perception.

export const userEmotionalState = pgTable("user_emotional_state", {
  userId: varchar("user_id").notNull().primaryKey().references(() => users.id, { onDelete: "cascade" }),
  stressScore: integer("stress_score").notNull().default(0),
  flowScore: integer("flow_score").notNull().default(0),
  label: varchar("label").notNull().default("calm"),
  explanation: text("explanation"),
  signalSources: jsonb("signal_sources").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  manualOverride: varchar("manual_override"),
  manualOverrideAt: timestamp("manual_override_at"),
  computedAt: timestamp("computed_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  consecutiveHighStressCycles: integer("consecutive_high_stress_cycles").notNull().default(0),
  lastStressCheckinAt: timestamp("last_stress_checkin_at"),
  // Rolling baseline fields — populated from userEmotionalStateHistory
  baselineStress: real("baseline_stress"),
  baselineFlow: real("baseline_flow"),
  patternNote: text("pattern_note"),
});

// Historical snapshots written each heartbeat cycle — used to compute baselines.
// Retains up to 90 days of data; no active cleanup (rows are cheap).
export const userEmotionalStateHistory = pgTable("user_emotional_state_history", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  stressScore: integer("stress_score").notNull(),
  flowScore: integer("flow_score").notNull(),
  label: varchar("label").notNull(),
  dayOfWeek: integer("day_of_week").notNull(), // 0 = Sunday … 6 = Saturday (in user TZ)
  hourOfDay: integer("hour_of_day").notNull(),  // 0–23 (in user TZ)
  recordedAt: timestamp("recorded_at").notNull().defaultNow(),
});

// ── Jarvis Gut — Reflexive Anomaly Detection ─────────────────────────────────
// Fast reflex signals flagged before the full reasoning loop. Each signal
// references an optional inbox item or calendar event and carries a one-line
// explanation. The user's confirmations/dismissals feed back into future
// threshold calibration.

export const GUT_SIGNAL_TYPES = [
  "calendar_anomaly",
  "email_pattern",
  "deep_work_erosion",
  "project_drift",
  "relationship_anomaly",
] as const;
export type GutSignalType = typeof GUT_SIGNAL_TYPES[number];

export const GUT_USER_RESPONSES = ["confirmed", "dismissed", "ignored"] as const;
export type GutUserResponse = typeof GUT_USER_RESPONSES[number];

export const gutSignals = pgTable("gut_signals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  signalType: varchar("signal_type").notNull(),
  itemRef: varchar("item_ref"),
  confidenceScore: integer("confidence_score").notNull().default(50),
  explanation: text("explanation").notNull(),
  userResponse: varchar("user_response"),
  respondedAt: timestamp("responded_at"),
  deliveredInMorningBrief: boolean("delivered_in_morning_brief").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Prediction Engine — forward-looking predictions generated daily at plan-build time.
// Each row represents one prediction for a specific future window.
// Types: energy_dip, procrastination_risk, email_overdue, project_stall
export const jarvisPredictions = pgTable("jarvis_predictions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  predictionType: varchar("prediction_type").notNull(),
  targetDatetime: timestamp("target_datetime").notNull(),
  targetDate: varchar("target_date").notNull(),
  confidenceScore: integer("confidence_score").notNull().default(50),
  basisSummary: text("basis_summary").notNull(),
  humanReadable: text("human_readable").notNull(),
  actionSuggestion: text("action_suggestion"),
  observationCount: integer("observation_count").notNull().default(0),
  validated: boolean("validated"),
  validationNote: text("validation_note"),
  validatedAt: timestamp("validated_at"),
  deliveredAt: timestamp("delivered_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("jarvis_predictions_user_type_date_idx").on(table.userId, table.predictionType, table.targetDate),
]);

export type JarvisPrediction = typeof jarvisPredictions.$inferSelect;
export type InsertJarvisPrediction = typeof jarvisPredictions.$inferInsert;

// ── Gut Calibration — persisted per-user per-signal-type feedback rates ───────
// Recomputed nightly (and on-feedback) so the detector sensitivity survives
// process restarts without re-scanning the entire gutSignals history on every
// baseline build.  Gate adjustment is in confidence-score points:
//   positive → user dismisses this type often (raise the bar)
//   negative → user confirms this type often (lower the bar / more sensitive)
export const gutCalibration = pgTable("gut_calibration", {
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  signalType: varchar("signal_type").notNull(),
  confirmedCount: integer("confirmed_count").notNull().default(0),
  dismissedCount: integer("dismissed_count").notNull().default(0),
  ignoredCount: integer("ignored_count").notNull().default(0),
  confirmationRate: real("confirmation_rate"),
  gateAdjustment: integer("gate_adjustment").notNull().default(0),
  lastUpdatedAt: timestamp("last_updated_at").defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.signalType] }),
]);

export type GutCalibration = typeof gutCalibration.$inferSelect;

// Dream Cycle — nightly deep synthesis insights.
// Each row is one insight produced by a single dream run.
export const dreamInsights = pgTable("dream_insights", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  dreamDate: varchar("dream_date").notNull(),
  insightText: text("insight_text").notNull(),
  confidenceScore: integer("confidence_score").notNull().default(70),
  sourceMemoryIds: jsonb("source_memory_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  insightKind: varchar("insight_kind").$type<"insight" | "memory_candidate" | "capability_proposal">().notNull().default("insight"),
  reviewPayload: jsonb("review_payload").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  shownToUser: boolean("shown_to_user").notNull().default(false),
  deliveredAt: timestamp("delivered_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── MCP API Keys — per-user bearer tokens for the MCP server endpoint ────────
// Only the bcrypt hash is stored. The raw key is returned once on generation.
export const mcpApiKeys = pgTable("mcp_api_keys", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  keyHash: text("key_hash").notNull(),
  keyPrefix: varchar("key_prefix").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastUsedAt: timestamp("last_used_at"),
});

export type McpApiKey = typeof mcpApiKeys.$inferSelect;

// ── MCP Rate Limits — DB-backed sliding-window counters (survives restarts) ──
// bucket: "<namespace>:<key>", e.g. "auth:<keyId>" or "pre-auth:<prefix>"
// count: requests in the current window
// window_start: unix epoch milliseconds when the current window opened
export const mcpRateLimits = pgTable("mcp_rate_limits", {
  bucket: text("bucket").primaryKey(),
  count: integer("count").notNull(),
  windowStart: bigint("window_start", { mode: "number" }).notNull(),
});

export type McpRateLimit = typeof mcpRateLimits.$inferSelect;

// ── Jarvis Ego — Action Log ───────────────────────────────────────────────────
// Every significant action Jarvis takes is recorded here so the Ego analyser
// can compute completion rates, engagement rates, and relationship health.
//
// actionType values (non-exhaustive, extensible):
//   email_drafted, task_suggested, plan_built, proactive_message,
//   prediction_made, meeting_brief, evening_wrap, dream_insight
//
// outcome values:
//   pending   — user has not responded yet
//   acted_on  — user took the suggested action
//   ignored   — user dismissed or did not engage
//   completed — task/commitment was completed
//   dismissed — user explicitly dismissed
export const jarvisActionLog = pgTable("jarvis_action_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  actionType: varchar("action_type").notNull(),
  outcome: varchar("outcome").notNull().default("pending"),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Agent Build Log ───────────────────────────────────────────────────────────
// Persisted record of every build_feature call. Lets users review
// past self-improvement attempts, re-apply previous tools, or see when a
// capability was added.
export const agentBuildLog = pgTable("agent_build_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  featureName: varchar("feature_name").notNull(),
  description: text("description").notNull(),
  outputCode: text("output_code").notNull().default(""),
  success: boolean("success").notNull().default(false),
  smokeTestPassed: boolean("smoke_test_passed"),
  smokeTestArgs: jsonb("smoke_test_args"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Jarvis Ego — Weekly Reports ───────────────────────────────────────────────
// Generated each Sunday; one row per user per week. Stores the full analysis
// object and the natural-language report text that is delivered to the user.
export const egoWeeklyReports = pgTable("ego_weekly_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  weekOf: varchar("week_of").notNull(),
  analysis: jsonb("analysis").notNull().default(sql`'{}'::jsonb`),
  reportText: text("report_text").notNull().default(""),
  deliveredAt: timestamp("delivered_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("ego_weekly_reports_user_week_idx").on(table.userId, table.weekOf),
]);

// ── Pre-flight Integration Status ─────────────────────────────────────────────
// Cached health check results written by IntegrationValidator every 30 minutes
// and on server start. Each row represents one integration for one user.
// status values:
//   "healthy"        — token valid, scope confirmed
//   "expiring_soon"  — token expires within 24 hours but is still valid
//   "broken"         — token expired/revoked or missing required scope
//   "unconfigured"   — user has not linked this integration at all
export const INTEGRATION_NAMES = [
  "google",
  "outlook",
  "telegram",
  "discord",
  "slack",
  "whatsapp",
  "github",
] as const;
export type IntegrationName = typeof INTEGRATION_NAMES[number];
export type IntegrationStatusValue = "healthy" | "expiring_soon" | "broken" | "degraded" | "unconfigured";

export const integrationStatus = pgTable("integration_status", {
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  integration: varchar("integration").$type<IntegrationName>().notNull(),
  status: varchar("status").$type<IntegrationStatusValue>().notNull().default("unconfigured"),
  lastCheckedAt: timestamp("last_checked_at").defaultNow().notNull(),
  errorMessage: text("error_message"),
  expiresAt: timestamp("expires_at"),
}, (table) => [
  primaryKey({ columns: [table.userId, table.integration] }),
]);

export type IntegrationStatusRow = typeof integrationStatus.$inferSelect;

// ── Behaviour Packs — Operator-pushed instruction updates ─────────────────────
// skill_packs: versioned instruction bundles the Jarvis team can publish to all
// users without a code deploy. Each publish increments `version` and appends a
// changelog entry.
//
// user_skill_packs: per-user join table. The Ego loop writes coaching
// adjustments into `instructionOverrides`; the agent harness merges these on
// top of the base pack instructions at session start.

export interface SkillPackChangelogEntry {
  version: number;
  note: string;
  publishedAt: string; // ISO timestamp
}

export const skillPacks = pgTable("skill_packs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  version: integer("version").notNull().default(1),
  instructions: text("instructions").notNull().default(""),
  heartbeatRules: jsonb("heartbeat_rules")
    .$type<PackHeartbeatRules>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  toolGroups: jsonb("tool_groups")
    .$type<PackToolGroups>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  isStoreVisible: boolean("is_store_visible").notNull().default(false),
  publishedAt: timestamp("published_at"),
  changelog: jsonb("changelog")
    .$type<SkillPackChangelogEntry[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type SkillPack = typeof skillPacks.$inferSelect;

// ── Diagnostic Events — system-wide health and error tracking ─────────────────
// Every significant error, warning, and success milestone across the system
// emits here so DiagnosticsService can detect degradation patterns and
// auto-recover. Queried by the /api/diagnostics/* endpoints and the
// jarvis_self_diagnose agent tool.

export const DIAGNOSTIC_SUBSYSTEMS = [
  "job_queue",
  "workflow_engine",
  "agent_harness",
  "channel_registry",
  "integration",
  "heartbeat",
  "memory",
  "database",
] as const;
export type DiagnosticSubsystem = typeof DIAGNOSTIC_SUBSYSTEMS[number];

export const DIAGNOSTIC_SEVERITIES = ["info", "warning", "error", "critical"] as const;
export type DiagnosticSeverity = typeof DIAGNOSTIC_SEVERITIES[number];

export const diagnosticEvents = pgTable("diagnostic_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  subsystem: varchar("subsystem").$type<DiagnosticSubsystem>().notNull(),
  severity: varchar("severity").$type<DiagnosticSeverity>().notNull().default("info"),
  message: text("message").notNull(),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  resolved: boolean("resolved").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type DiagnosticEvent = typeof diagnosticEvents.$inferSelect;
export type InsertDiagnosticEvent = typeof diagnosticEvents.$inferInsert;

export interface EgoInstructionOverrides {
  suppressActionTypes?: string[];
  coachingNote?: string;
  customInstructions?: string;
  updatedAt?: string;
}

export const orchestrationTraces = pgTable("orchestration_traces", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  traceId: varchar("trace_id").notNull().unique(),
  userRequest: text("user_request").notNull(),
  subtasks: jsonb("subtasks").notNull().default(sql`'[]'::jsonb`),
  results: jsonb("results").notNull().default(sql`'[]'::jsonb`),
  finalAnswer: text("final_answer").notNull().default(""),
  totalRetries: integer("total_retries").notNull().default(0),
  completedAt: timestamp("completed_at"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Agent Chat Messages — permanent per-agent conversation log ─────────────────
// Stores every user / assistant exchange in a durable table with no TTL.
// Written on every chat turn so history survives session expiry and app
// reinstalls. The mobile RunModal uses GET /api/agents/:id/history to fetch
// these; it falls back to AsyncStorage for offline-first behaviour.

export const agentChatMessages = pgTable("agent_chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  agentId: varchar("agent_id").notNull().references(() => discordAgents.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: varchar("role").$type<"user" | "assistant">().notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AgentChatMessageRow = typeof agentChatMessages.$inferSelect;

// ── Agent Chat Sessions — native session resumption ───────────────────────────
// Stores server-side conversation state for named agent chats so that
// subsequent turns can resume from cached messages instead of re-injecting
// the full history from the DB. Sessions expire after 24 hours.
//
// Flow:
//   1. First user message → build full context, store in this table, return sessionId
//   2. Subsequent messages → look up sessionId, append new exchange, skip history rebuild
//   3. Session not found / expired → fall back to full history injection (logged as warning)

export interface AgentChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: unknown[];
  tool_call_id?: string;
}

export const agentChatSessions = pgTable("agent_chat_sessions", {
  sdkSessionId: varchar("sdk_session_id").primaryKey(),
  agentId: varchar("agent_id").notNull().references(() => discordAgents.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  messages: jsonb("messages").$type<AgentChatMessage[]>().notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});

export type AgentChatSession = typeof agentChatSessions.$inferSelect;

export const agentChatSessionSummaries = pgTable("agent_chat_session_summaries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sdkSessionId: varchar("sdk_session_id").notNull().references(() => agentChatSessions.sdkSessionId, { onDelete: "cascade" }),
  agentId: varchar("agent_id").notNull().references(() => discordAgents.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  summary: text("summary").notNull(),
  messageCount: integer("message_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AgentChatSessionSummary = typeof agentChatSessionSummaries.$inferSelect;

// ── Coach channel sessions ────────────────────────────────────────────────────
// Persists the per-user, per-channel sdkSessionId so conversations survive
// server restarts.  The channel server-handlers use this as a write-through
// backing store behind their in-process Maps.
export const coachChannelSessions = pgTable("coach_channel_sessions", {
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  channel: varchar("channel").notNull(),
  sdkSessionId: varchar("sdk_session_id").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.channel] }),
]);

export const userSkillPacks = pgTable("user_skill_packs", {
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  packId: varchar("pack_id").notNull().references(() => skillPacks.id, { onDelete: "cascade" }),
  appliedVersion: integer("applied_version").notNull().default(1),
  isActive: boolean("is_active").notNull().default(false),
  instructionOverrides: jsonb("instruction_overrides")
    .$type<EgoInstructionOverrides>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.packId] }),
]);

// ── System Error Log ──────────────────────────────────────────────────────────
// Persists every unhandled error from Express, agent harness, and health checks.
// Jarvis reads this table via the read_recent_errors tool to power its
// self-debugging loop.

export const systemErrorLog = pgTable("system_error_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  source: text("source").notNull(),
  level: varchar("level").notNull().default("error"),
  message: text("message").notNull(),
  stackTrace: text("stack_trace"),
  contextJson: jsonb("context_json").notNull().default(sql`'{}'::jsonb`),
  investigated: boolean("investigated").notNull().default(false),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
});

export type SystemErrorLogRow = typeof systemErrorLog.$inferSelect;
export type InsertSystemErrorLog = typeof systemErrorLog.$inferInsert;

// ── Code Proposals ─────────────────────────────────────────────────────────────
// Jarvis self-inspection proposals — each row represents a proposed change to
// a source file that the user must approve or reject before any write occurs.

export const CODE_PROPOSAL_STATUSES = ["pending", "approved", "rejected"] as const;
export type CodeProposalStatus = typeof CODE_PROPOSAL_STATUSES[number];

export interface DebugContext {
  errorMessage: string;
  stackExcerpt?: string;
  rootCauseSummary: string;
  errorLogId?: string;
}

export const codeProposals = pgTable("code_proposals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  reason: text("reason").notNull(),
  filePath: text("file_path").notNull(),
  originalContent: text("original_content").notNull(),
  proposedContent: text("proposed_content").notNull(),
  status: varchar("status").$type<CodeProposalStatus>().notNull().default("pending"),
  rejectionNote: text("rejection_note"),
  debugContext: jsonb("debug_context").$type<DebugContext>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  appliedAt: timestamp("applied_at"),
});

export type CodeProposal = typeof codeProposals.$inferSelect;
export type InsertCodeProposal = typeof codeProposals.$inferInsert;

// ── MCP Server registry ────────────────────────────────────────────────────────

/**
 * SecretRef — instead of storing a raw token, point to an env var by name.
 * credentialMode "direct"  → authToken stores the raw value (legacy default)
 * credentialMode "env-ref" → authToken is ignored; envKey names the process.env var
 */
export const MCP_CREDENTIAL_MODES = ["direct", "env-ref"] as const;
export type McpCredentialMode = typeof MCP_CREDENTIAL_MODES[number];

// ── User Skills (Task #502) ────────────────────────────────────────────────────
// Database-backed skills that users can toggle on/off. Built-in skills are
// seeded per-user on first load; custom skills are user-authored.
// Active skills are injected into Jarvis's system prompt at session start.
export const userSkills = pgTable("user_skills", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  emoji: varchar("emoji").notNull().default("⚡"),
  description: text("description").notNull(),
  instructions: text("instructions").notNull(),
  isBuiltIn: boolean("is_built_in").notNull().default(false),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type UserSkill = typeof userSkills.$inferSelect;
export type InsertUserSkill = typeof userSkills.$inferInsert;

// ── Skill Candidates (Task #872) ──────────────────────────────────────────────
// AI-generated skill proposals from the SkillCurator or LearningSynthesiser.
// Users review pending candidates and can accept, edit, or dismiss them.
// Accepted/edited candidates are written to user_skills (isActive=true).
export const skillCandidates = pgTable("skill_candidates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  triggerDescription: text("trigger_description").notNull(),
  instructionText: text("instruction_text").notNull(),
  sourceType: varchar("source_type").$type<"curator" | "synthesiser">().notNull().default("curator"),
  status: varchar("status").$type<"pending" | "accepted" | "edited" | "dismissed">().notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type SkillCandidate = typeof skillCandidates.$inferSelect;
export type InsertSkillCandidate = typeof skillCandidates.$inferInsert;

export const mcpServers = pgTable("mcp_servers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name").notNull(),
  transport: varchar("transport").notNull().default("stdio"),
  command: text("command"),
  url: text("url"),
  authToken: text("auth_token"),
  credentialMode: varchar("credential_mode").notNull().default("direct"),
  envKey: varchar("env_key"),
  enabled: boolean("enabled").notNull().default(true),
  isBuiltIn: boolean("is_built_in").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Write-budget log — persists autonomous write timestamps across restarts ────
// Each row represents one autonomous file write recorded by the circuit
// breaker. Only rows within the last 60-minute window are relevant; older
// rows are pruned opportunistically on each insert.
export const writeBudgetLog = pgTable("write_budget_log", {
  id: serial("id").primaryKey(),
  writtenAt: timestamp("written_at").defaultNow().notNull(),
});

// Single-row state table that tracks when the last write-budget warning was
// sent.  The UPDATE-based claim in safeWritePolicy.ts takes a Postgres
// row-level lock, ensuring at most one warning fires per 60-minute window
// even under concurrent writes.  The row (id=1) is seeded at startup.
export const writeBudgetWarnings = pgTable("write_budget_warnings", {
  id: integer("id").primaryKey().default(1),
  warnedAt: timestamp("warned_at").notNull().default(sql`'1970-01-01'`),
});

// Chat integration tables — used by server/integrations/chatStorage
export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull().default("New Chat"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  role: varchar("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Learning synthesis log — persists each synthesis run for history display ──
export const learningSynthesisLog = pgTable("learning_synthesis_log", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  bulletCount: integer("bullet_count").notNull().default(0),
  bullets: jsonb("bullets").notNull().default(sql`'[]'::jsonb`),
  triggeredBy: varchar("triggered_by", { length: 32 }).notNull().default("manual"),
  skipped: boolean("skipped").notNull().default(false),
  skipReason: text("skip_reason"),
});

export type LearningSynthesisLog = typeof learningSynthesisLog.$inferSelect;
export type InsertLearningSynthesisLog = typeof learningSynthesisLog.$inferInsert;

// ── Discord Confirm Tokens ─────────────────────────────────────────────────────
// Persists pending Discord action confirmation tokens across server restarts.
// One row per user; overwritten when a new token is issued.  TTL is stored in
// `expires_at` so the nightly cleanup job can prune expired rows.
export const discordConfirmTokens = pgTable("discord_confirm_tokens", {
  userId: varchar("user_id").notNull().primaryKey().references(() => users.id, { onDelete: "cascade" }),
  action: varchar("action", { length: 64 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type DiscordConfirmToken = typeof discordConfirmTokens.$inferSelect;
export type InsertDiscordConfirmToken = typeof discordConfirmTokens.$inferInsert;

// ── Web-chat invite tokens — short-lived links for sharing Jarvis access ─────
export const webchatInviteTokens = pgTable("webchat_invite_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  token: text("token").notNull().unique(),
  userId: varchar("user_id").notNull().references(() => users.id),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const GATEWAY_DEVICE_SCOPES = [
  "operator.admin",
  "operator.read",
  "operator.write",
  "operator.approvals",
  "operator.pairing",
] as const;
export type GatewayDeviceScope = typeof GATEWAY_DEVICE_SCOPES[number];

export const gatewayDevicePairingRequests = pgTable("gateway_device_pairing_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: varchar("code").notNull().unique(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  kind: varchar("kind").notNull().default("browser"),
  origin: text("origin"),
  requestedScopes: jsonb("requested_scopes").$type<GatewayDeviceScope[]>().notNull().default(sql`'[]'::jsonb`),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  status: varchar("status").$type<"pending" | "approved" | "rejected" | "expired">().notNull().default("pending"),
  deviceId: varchar("device_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  resolvedAt: timestamp("resolved_at"),
});

export const gatewayDevices = pgTable("gateway_devices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  kind: varchar("kind").notNull().default("browser"),
  tokenHash: text("token_hash").notNull().unique(),
  scopes: jsonb("scopes").$type<GatewayDeviceScope[]>().notNull().default(sql`'[]'::jsonb`),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  pairedAt: timestamp("paired_at").defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at"),
  revokedAt: timestamp("revoked_at"),
});

export const gatewayEvents = pgTable("gateway_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  type: varchar("type").notNull(),
  area: varchar("area").notNull().default("gateway"),
  severity: varchar("severity").$type<"debug" | "info" | "warning" | "error">().notNull().default("info"),
  title: text("title").notNull(),
  message: text("message"),
  subjectType: varchar("subject_type"),
  subjectId: varchar("subject_id"),
  actorKind: varchar("actor_kind"),
  actorId: varchar("actor_id"),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type GatewayEvent = typeof gatewayEvents.$inferSelect;
export type InsertGatewayEvent = typeof gatewayEvents.$inferInsert;

// ── Self-heal audit log — persists autonomous-write history across restarts ──
// ── User-Defined Custom Sub-Agents ────────────────────────────────────────────
// Users can define named, reusable sub-agents with a custom system prompt that
// is appended to one of the base sub-agent types (research, writing, planning,
// email). Custom agents are submitted as "custom_agent" jobs and resolved at
// run time by looking up this table.

export const CUSTOM_AGENT_BASE_TYPES = ["research", "writing", "planning", "email"] as const;
export type CustomAgentBaseType = typeof CUSTOM_AGENT_BASE_TYPES[number];

export const customAgents = pgTable("custom_agents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: varchar("slug").notNull(),
  description: text("description"),
  baseType: varchar("base_type").$type<CustomAgentBaseType>().notNull().default("research"),
  extraPrompt: text("extra_prompt"),
  allowedTools: jsonb("allowed_tools").$type<string[]>(),
  model: varchar("model"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("custom_agents_user_slug_idx").on(table.userId, table.slug),
]);

export const insertCustomAgentSchema = createInsertSchema(customAgents).pick({
  name: true,
  slug: true,
  description: true,
  baseType: true,
  extraPrompt: true,
  allowedTools: true,
  model: true,
});

export type InsertCustomAgent = z.infer<typeof insertCustomAgentSchema>;
export type CustomAgent = typeof customAgents.$inferSelect;

// ── Jarvis Projects — persistent 24/7 autonomous build projects ───────────────
// A project is a multi-session, goal-oriented work item that Jarvis can work on
// autonomously across many sessions, pausing for user input when needed.

export interface ProjectPlanStep {
  step_id: string;
  label: string;
  phase: string;
  status: "pending" | "running" | "complete" | "failed" | "skipped";
  acceptance_criteria?: string;
  output?: string;
  completedAt?: string;
}

export type ProjectStatus =
  | "draft"
  | "planning"
  | "building"
  | "waiting_for_input"
  | "paused"
  | "complete"
  | "failed";

export const jarvisProjects = pgTable("jarvis_projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title"),
  description: text("description"),
  goal: text("goal"),
  plan: jsonb("plan").$type<ProjectPlanStep[]>().notNull().default(sql`'[]'::jsonb`),
  currentStepIndex: integer("current_step_index").notNull().default(0),
  status: varchar("status").$type<ProjectStatus>().notNull().default("draft"),
  autonomousMode: boolean("autonomous_mode").notNull().default(false),
  nextRunAt: timestamp("next_run_at"),
  questionPending: text("question_pending"),
  questionAskedAt: timestamp("question_asked_at"),
  questionMeta: jsonb("question_meta").default(sql`'{}'::jsonb`),
  originChannel: varchar("origin_channel"),
  lastProgressAt: timestamp("last_progress_at"),
  consecutiveErrors: integer("consecutive_errors").notNull().default(0),
  workspaceDir: text("workspace_dir"),
  appFramework: varchar("app_framework"),
  devServerPort: integer("dev_server_port"),
  githubRepoUrl: text("github_repo_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type JarvisProject = typeof jarvisProjects.$inferSelect;
export type InsertJarvisProject = typeof jarvisProjects.$inferInsert;

export const jarvisProjectSessions = pgTable("jarvis_project_sessions", {
  id: serial("id").primaryKey(),
  projectId: varchar("project_id").notNull().references(() => jarvisProjects.id, { onDelete: "cascade" }),
  sessionNumber: integer("session_number").notNull().default(1),
  stepsCompleted: integer("steps_completed").notNull().default(0),
  stepLabels: jsonb("step_labels").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  durationMs: integer("duration_ms"),
  verificationRetries: integer("verification_retries").notNull().default(0),
  status: varchar("status").notNull().default("complete"),
  summary: text("summary"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type JarvisProjectSession = typeof jarvisProjectSessions.$inferSelect;

export const jarvisProjectFiles = pgTable("jarvis_project_files", {
  projectId: varchar("project_id").notNull().references(() => jarvisProjects.id, { onDelete: "cascade" }),
  filePath: text("file_path").notNull(),
  contentBase64: text("content_base64").notNull(),
  sizeBytes: integer("size_bytes").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.filePath] }),
]);

export type JarvisProjectFile = typeof jarvisProjectFiles.$inferSelect;

export const jarvisProjectArchives = pgTable("jarvis_project_archives", {
  projectId: varchar("project_id").primaryKey().references(() => jarvisProjects.id, { onDelete: "cascade" }),
  zipBase64: text("zip_base64").notNull(),
  sizeBytes: integer("size_bytes").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type JarvisProjectArchive = typeof jarvisProjectArchives.$inferSelect;

// Each row mirrors one block from server/self-heal-audit.log.  On container
// restart, selfHealAudit.ts restores the flat file from these rows so audit
// history is never lost.
export const selfHealAuditLog = pgTable("self_heal_audit_log", {
  id: serial("id").primaryKey(),
  /** ISO timestamp written at change time — matches the flat-file header. */
  timestamp: varchar("timestamp", { length: 64 }).notNull(),
  /** Relative file path from project root. */
  file: text("file").notNull(),
  reason: text("reason").notNull().default(""),
  /** 'pending' | 'passed' | 'failed' | 'error' (with optional summary suffix). */
  verified: varchar("verified", { length: 256 }).notNull().default("pending"),
  /** e.g. '+3 -2 lines' */
  changesSummary: varchar("changes_summary", { length: 256 }).notNull().default(""),
  /** The +/- diff body lines, newline-separated (without the summary line). */
  diff: text("diff").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Search-bar coordinate persistence ────────────────────────────────────────
// One row per (user_id, app_package) — stores the last known (x, y) of the
// search bar so the in-memory cache can be re-seeded after a server restart.
// discoveredResourceId is the resource-id string found by auto-discovery so
// future searches on the same app can try it directly (as a learned registry
// entry) before falling back to full heuristic scoring.
// coordinatesValid is set to false when a stale entry is detected (instead of
// deleting the row) so that discoveredResourceId survives invalidation and can
// still seed the learnedResourceIds registry on the next server restart.
export const searchBarLocations = pgTable("search_bar_locations", {
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  appPackage: varchar("app_package", { length: 256 }).notNull(),
  coordinatesX: integer("coordinates_x").notNull(),
  coordinatesY: integer("coordinates_y").notNull(),
  discoveredResourceId: varchar("discovered_resource_id", { length: 256 }),
  coordinatesValid: boolean("coordinates_valid").notNull().default(true),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.appPackage] }),
]);

export type SearchBarLocation = typeof searchBarLocations.$inferSelect;

// ── Button location training — user-guided tap memory ────────────────────────
// Each row records a screen element the user has pointed to once; the agent
// can replay the stored coordinates instead of re-running screen-understand.
export const buttonLocations = pgTable("button_locations", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** Android package name, e.g. com.instagram.android */
  appPackage: varchar("app_package", { length: 256 }).notNull(),
  /** Activity / fragment at the time of capture, e.g. com.instagram.android.activity.MainTabActivity */
  screenContext: varchar("screen_context", { length: 256 }).notNull().default(""),
  /** Human-readable label the user (or agent) used to name this button */
  elementLabel: text("element_label").notNull(),
  /** Center-x from the accessibility node bounds at capture time */
  coordinatesX: integer("coordinates_x").notNull(),
  /** Center-y from the accessibility node bounds at capture time */
  coordinatesY: integer("coordinates_y").notNull(),
  /** 64-bit average-hash of the screenshot (hex) for UI-change detection */
  screenshotHash: varchar("screenshot_hash", { length: 256 }),
  /** Truncated base64 prefix of the training screenshot (first 200 chars) — visual reference only */
  screenshotPath: text("screenshot_path"),
  /** 0.0–1.0 confidence; starts at 0.5, bumped on confirm, drops on deny */
  confidence: real("confidence").notNull().default(0.5),
  lastConfirmedAt: timestamp("last_confirmed_at"),
  /** Flagged true when a tap fails to find a recognisable element at stored coords */
  stale: boolean("stale").notNull().default(false),
  /** Number of consecutive non-confirmed taps; resets to 0 on confirm; at ≥ 3 the entry is marked stale */
  failCount: integer("fail_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ButtonLocation = typeof buttonLocations.$inferSelect;
export type InsertButtonLocation = typeof buttonLocations.$inferInsert;

// ── Tournament Mode — multi-agent competitive answer selection ─────────────────
// Each row records a tournament run: N agents ran the same task, a judge scored
// them, and the winner was returned to the user. The full outputs array lets the
// user retrieve runners-up on request via the run_tournament tool.

export interface TournamentOutput {
  agentIndex: number;
  approach: string;
  body: string;
}

export interface TournamentScore {
  agentIndex: number;
  score: number;
  reasoning: string;
}

export const tournamentRuns = pgTable("tournament_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  task: text("task").notNull(),
  agentType: varchar("agent_type").notNull(),
  numAgents: integer("num_agents").notNull().default(3),
  outputs: jsonb("outputs").$type<TournamentOutput[]>().notNull().default(sql`'[]'::jsonb`),
  scores: jsonb("scores").$type<TournamentScore[]>().notNull().default(sql`'[]'::jsonb`),
  /** Approach label of the winning agent (e.g. "structured-analytical"). */
  winnerId: text("winner_id").notNull().default(""),
  judgeCriteria: text("judge_criteria"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type TournamentRun = typeof tournamentRuns.$inferSelect;

// ── Knowledge Vault ────────────────────────────────────────────────────────────
// Structured wiki pages that Jarvis writes and updates automatically.
// Pages are organized by category and regenerated on a schedule or after
// new memories arrive. The user never writes these — Jarvis is the author.

export const VAULT_SLUGS = ["about-you", "projects", "people", "patterns", "decisions"] as const;
export type VaultSlug = typeof VAULT_SLUGS[number];

export const VAULT_PAGE_TYPES = ["core", "entity", "concept", "query"] as const;
export type VaultPageType = typeof VAULT_PAGE_TYPES[number];

export const knowledgeVaultPages = pgTable("knowledge_vault_pages", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  pageType: varchar("page_type").notNull().default("core"),
  tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  crossRefs: jsonb("cross_refs").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  archivedAt: timestamp("archived_at"),
  lastAccessedAt: timestamp("last_accessed_at"),
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("vault_user_slug_idx").on(table.userId, table.slug),
]);

export type KnowledgeVaultPage = typeof knowledgeVaultPages.$inferSelect;

export const wikiLintLog = pgTable("wiki_lint_log", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  ranAt: timestamp("ran_at").defaultNow().notNull(),
  pagesScanned: integer("pages_scanned").notNull().default(0),
  pagesUpdated: integer("pages_updated").notNull().default(0),
  pagesArchived: integer("pages_archived").notNull().default(0),
  contradictionsFixed: integer("contradictions_fixed").notNull().default(0),
  crossLinksAdded: integer("cross_links_added").notNull().default(0),
  summary: text("summary").notNull().default(""),
});

export type WikiLintLog = typeof wikiLintLog.$inferSelect;

// ── Transcript Jobs ────────────────────────────────────────────────────────────
// Tracks async Supadata transcript jobs for long videos (3+ hours) where the
// cloud AI generation takes 5–10 minutes. Rows are created when Supadata returns
// a 202 async job response. The background poller updates them when complete.

export const transcriptJobs = pgTable("transcript_jobs", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  videoId: text("video_id").notNull(),
  supadataJobId: text("supadata_job_id").notNull(),
  status: text("status").notNull().default("pending"),
  result: text("result"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type TranscriptJob = typeof transcriptJobs.$inferSelect;

// ── Capability Gaps ────────────────────────────────────────────────────────────
// Records interactions where Jarvis deflected or apologised without completing
// the user's request — indicating a genuine capability gap. Accumulated during
// the week and analysed by the Sunday self-improvement cycle.

export const capabilityGaps = pgTable("capability_gaps", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  userMessage: text("user_message").notNull(),
  agentReplySnippet: text("agent_reply_snippet"),
  // "deflection" | "apology_only" | "no_tool_for_request" | "job_failure"
  detectedReason: varchar("detected_reason").notNull(),
  channel: varchar("channel"),
  // "chat" (default) | "job" — where the gap was detected
  source: varchar("source").default("chat"),
  addressed: boolean("addressed").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export type CapabilityGap = typeof capabilityGaps.$inferSelect;
export type InsertCapabilityGap = typeof capabilityGaps.$inferInsert;
