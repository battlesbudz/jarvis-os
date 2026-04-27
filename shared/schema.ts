import { sql } from "drizzle-orm";
import { pgTable, text, varchar, jsonb, timestamp, date, primaryKey, integer, uniqueIndex, boolean, serial, real, bigint } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

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
  // hybrid retrieval helper in server/memory/retrieve.ts. Stored as jsonb
  // so we don't require the pgvector extension; FTS handles primary recall.
  embedding: jsonb("embedding"),
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
});

// Biomimetic memory tiers — mirrors human memory architecture.
export const MEMORY_TIERS = ["working", "short_term", "long_term"] as const;
export type MemoryTier = typeof MEMORY_TIERS[number];

// Biomimetic memory types — mirrors human memory classification.
export const MEMORY_TYPES = ["episodic", "semantic", "procedural", "contextual"] as const;
export type MemoryType = typeof MEMORY_TYPES[number];

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
export const jarvisSouls = pgTable("jarvis_souls", {
  userId: varchar("user_id").notNull().primaryKey().references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull().default(""),
  manualOverride: text("manual_override"),
  generatedAt: timestamp("generated_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

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
});

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
});

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
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
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
] as const;
export type NotificationType = typeof NOTIFICATION_TYPES[number];

export const CHANNEL_NAMES = ["telegram", "whatsapp", "slack", "daemon", "discord", "in_app"] as const;
export type ChannelName = typeof CHANNEL_NAMES[number];

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
   * Examples: "claude-sonnet-4-6", "claude-haiku-4-5", "claude-opus-4-6"
   */
  preferredModel: text("preferred_model"),
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

// ── OpenClaw Build Log ────────────────────────────────────────────────────────
// Persisted record of every openclaw_build_feature call. Lets users review
// past self-improvement attempts, re-apply previous tools, or see when a
// capability was added.
export const openclawBuildLog = pgTable("openclaw_build_log", {
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
] as const;
export type IntegrationName = typeof INTEGRATION_NAMES[number];
export type IntegrationStatusValue = "healthy" | "expiring_soon" | "broken" | "unconfigured";

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

// ── Code Proposals ─────────────────────────────────────────────────────────────
// Jarvis self-inspection proposals — each row represents a proposed change to
// a source file that the user must approve or reject before any write occurs.

export const CODE_PROPOSAL_STATUSES = ["pending", "approved", "rejected"] as const;
export type CodeProposalStatus = typeof CODE_PROPOSAL_STATUSES[number];

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
