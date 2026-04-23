var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// shared/schema.ts
var schema_exports = {};
__export(schema_exports, {
  CHANNEL_NAMES: () => CHANNEL_NAMES,
  MEMORY_CATEGORIES: () => MEMORY_CATEGORIES,
  NOTIFICATION_TYPES: () => NOTIFICATION_TYPES,
  agentJobs: () => agentJobs,
  blockedTasks: () => blockedTasks,
  brainDumpInbox: () => brainDumpInbox,
  channelLinkCodes: () => channelLinkCodes,
  channelLinks: () => channelLinks,
  channelPreferences: () => channelPreferences,
  chatHistory: () => chatHistory,
  chatgptImports: () => chatgptImports,
  commitments: () => commitments,
  completedCalendarIds: () => completedCalendarIds,
  completionHistory: () => completionHistory,
  deliverables: () => deliverables,
  emailDrafts: () => emailDrafts,
  energyCheckins: () => energyCheckins,
  goalTrees: () => goalTrees,
  goals: () => goals,
  inboxItems: () => inboxItems,
  inboxRules: () => inboxRules,
  insertUserSchema: () => insertUserSchema,
  interactionLog: () => interactionLog,
  jarvisSouls: () => jarvisSouls,
  lifeContext: () => lifeContext,
  mobileAuthSessions: () => mobileAuthSessions,
  momentumSessions: () => momentumSessions,
  morningVoiceNotes: () => morningVoiceNotes,
  people: () => people,
  planSnapshots: () => planSnapshots,
  plans: () => plans,
  proactiveQuestionsSent: () => proactiveQuestionsSent,
  proactiveScheduleLog: () => proactiveScheduleLog,
  stats: () => stats,
  telegramGroupMessages: () => telegramGroupMessages,
  telegramLinkCodes: () => telegramLinkCodes,
  telegramLinks: () => telegramLinks,
  timerSettings: () => timerSettings,
  userDocuments: () => userDocuments,
  userMemories: () => userMemories,
  userPreferences: () => userPreferences,
  users: () => users,
  weeklyInsights: () => weeklyInsights
});
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, jsonb, timestamp, date, primaryKey, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
var users, insertUserSchema, plans, goals, stats, brainDumpInbox, energyCheckins, chatHistory, lifeContext, timerSettings, userPreferences, completionHistory, blockedTasks, completedCalendarIds, planSnapshots, telegramLinks, telegramLinkCodes, telegramGroupMessages, commitments, userMemories, MEMORY_CATEGORIES, people, jarvisSouls, weeklyInsights, proactiveQuestionsSent, inboxRules, inboxItems, mobileAuthSessions, userDocuments, chatgptImports, proactiveScheduleLog, momentumSessions, morningVoiceNotes, emailDrafts, goalTrees, agentJobs, deliverables, channelLinks, channelLinkCodes, channelPreferences, NOTIFICATION_TYPES, CHANNEL_NAMES, interactionLog;
var init_schema = __esm({
  "shared/schema.ts"() {
    "use strict";
    users = pgTable("users", {
      id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
      username: text("username").notNull().unique(),
      password: text("password"),
      googleId: text("google_id").unique(),
      displayName: text("display_name"),
      createdAt: timestamp("created_at").defaultNow().notNull()
    });
    insertUserSchema = createInsertSchema(users).pick({
      username: true,
      password: true
    });
    plans = pgTable("plans", {
      userId: varchar("user_id").notNull().references(() => users.id),
      date: varchar("date").notNull(),
      data: jsonb("data").notNull(),
      updatedAt: timestamp("updated_at").defaultNow()
    }, (table) => [
      primaryKey({ columns: [table.userId, table.date] })
    ]);
    goals = pgTable("goals", {
      userId: varchar("user_id").notNull().primaryKey().references(() => users.id),
      data: jsonb("data").notNull().default(sql`'[]'::jsonb`),
      updatedAt: timestamp("updated_at").defaultNow()
    });
    stats = pgTable("stats", {
      userId: varchar("user_id").notNull().primaryKey().references(() => users.id),
      data: jsonb("data").notNull(),
      updatedAt: timestamp("updated_at").defaultNow()
    });
    brainDumpInbox = pgTable("brain_dump_inbox", {
      userId: varchar("user_id").notNull().primaryKey().references(() => users.id),
      data: jsonb("data").notNull().default(sql`'[]'::jsonb`),
      updatedAt: timestamp("updated_at").defaultNow()
    });
    energyCheckins = pgTable("energy_checkins", {
      userId: varchar("user_id").notNull().references(() => users.id),
      date: varchar("date").notNull(),
      data: jsonb("data").notNull(),
      updatedAt: timestamp("updated_at").defaultNow()
    }, (table) => [
      primaryKey({ columns: [table.userId, table.date] })
    ]);
    chatHistory = pgTable("chat_history", {
      userId: varchar("user_id").notNull().primaryKey().references(() => users.id),
      data: jsonb("data").notNull().default(sql`'[]'::jsonb`),
      updatedAt: timestamp("updated_at").defaultNow()
    });
    lifeContext = pgTable("life_context", {
      userId: varchar("user_id").notNull().primaryKey().references(() => users.id),
      data: jsonb("data").notNull(),
      updatedAt: timestamp("updated_at").defaultNow()
    });
    timerSettings = pgTable("timer_settings", {
      userId: varchar("user_id").notNull().primaryKey().references(() => users.id),
      data: jsonb("data").notNull(),
      updatedAt: timestamp("updated_at").defaultNow()
    });
    userPreferences = pgTable("user_preferences", {
      userId: varchar("user_id").notNull().primaryKey().references(() => users.id),
      data: jsonb("data").notNull().default(sql`'{}'::jsonb`),
      updatedAt: timestamp("updated_at").defaultNow()
    });
    completionHistory = pgTable("completion_history", {
      userId: varchar("user_id").notNull().primaryKey().references(() => users.id),
      data: jsonb("data").notNull().default(sql`'[]'::jsonb`),
      updatedAt: timestamp("updated_at").defaultNow()
    });
    blockedTasks = pgTable("blocked_tasks", {
      userId: varchar("user_id").notNull().primaryKey().references(() => users.id),
      data: jsonb("data").notNull().default(sql`'[]'::jsonb`),
      updatedAt: timestamp("updated_at").defaultNow()
    });
    completedCalendarIds = pgTable("completed_calendar_ids", {
      userId: varchar("user_id").notNull().references(() => users.id),
      date: varchar("date").notNull(),
      data: jsonb("data").notNull().default(sql`'[]'::jsonb`),
      updatedAt: timestamp("updated_at").defaultNow()
    }, (table) => [
      primaryKey({ columns: [table.userId, table.date] })
    ]);
    planSnapshots = pgTable("plan_snapshots", {
      userId: varchar("user_id").notNull().primaryKey().references(() => users.id),
      data: jsonb("data").notNull(),
      updatedAt: timestamp("updated_at").defaultNow()
    });
    telegramLinks = pgTable("telegram_links", {
      userId: varchar("user_id").notNull().primaryKey().references(() => users.id),
      chatId: varchar("chat_id").notNull(),
      username: varchar("username"),
      linkedAt: timestamp("linked_at").defaultNow().notNull(),
      groupChatIds: jsonb("group_chat_ids").default(sql`'[]'::jsonb`)
    });
    telegramLinkCodes = pgTable("telegram_link_codes", {
      code: varchar("code").primaryKey(),
      userId: varchar("user_id").notNull(),
      createdAt: timestamp("created_at").defaultNow().notNull()
    });
    telegramGroupMessages = pgTable("telegram_group_messages", {
      id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
      userId: varchar("user_id").notNull().references(() => users.id),
      chatId: varchar("chat_id").notNull(),
      chatTitle: varchar("chat_title"),
      fromUser: varchar("from_user"),
      text: text("text").notNull(),
      messageDate: timestamp("message_date").defaultNow().notNull()
    });
    commitments = pgTable("commitments", {
      id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
      userId: varchar("user_id").notNull().references(() => users.id),
      content: text("content").notNull(),
      dueDate: varchar("due_date"),
      status: varchar("status").notNull().default("pending"),
      extractedAt: timestamp("extracted_at").defaultNow().notNull(),
      resolvedAt: timestamp("resolved_at"),
      sourceMessage: text("source_message")
    });
    userMemories = pgTable("user_memories", {
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
      extractedAt: timestamp("extracted_at").defaultNow().notNull()
    });
    MEMORY_CATEGORIES = [
      "work_patterns",
      "communication_style",
      "energy_rhythms",
      "goals_history",
      "relationships",
      "values",
      "blockers",
      "accomplishments",
      "preferences",
      "fact"
    ];
    people = pgTable("people", {
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
      updatedAt: timestamp("updated_at").defaultNow().notNull()
    });
    jarvisSouls = pgTable("jarvis_souls", {
      userId: varchar("user_id").notNull().primaryKey().references(() => users.id, { onDelete: "cascade" }),
      content: text("content").notNull().default(""),
      manualOverride: text("manual_override"),
      generatedAt: timestamp("generated_at"),
      updatedAt: timestamp("updated_at").defaultNow().notNull()
    });
    weeklyInsights = pgTable("weekly_insights", {
      id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
      userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
      weekOf: varchar("week_of").notNull(),
      patterns: jsonb("patterns").$type().notNull().default(sql`'[]'::jsonb`),
      summary: text("summary"),
      createdAt: timestamp("created_at").defaultNow().notNull()
    }, (table) => [
      uniqueIndex("weekly_insights_user_week_idx").on(table.userId, table.weekOf)
    ]);
    proactiveQuestionsSent = pgTable("proactive_questions_sent", {
      id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
      userId: varchar("user_id").notNull().references(() => users.id),
      sourceType: varchar("source_type").notNull(),
      sourceId: varchar("source_id").notNull(),
      question: text("question").notNull(),
      sentAt: timestamp("sent_at").defaultNow(),
      answeredAt: timestamp("answered_at")
    });
    inboxRules = pgTable("inbox_rules", {
      id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
      userId: varchar("user_id").notNull().references(() => users.id),
      type: varchar("type").notNull(),
      scope: varchar("scope").notNull(),
      pattern: text("pattern").notNull(),
      matchHints: jsonb("match_hints"),
      source: varchar("source").notNull(),
      matchCount: varchar("match_count").default("0"),
      active: varchar("active").default("true"),
      createdAt: timestamp("created_at").defaultNow(),
      updatedAt: timestamp("updated_at").defaultNow()
    });
    inboxItems = pgTable("inbox_items", {
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
      dismissCount: varchar("dismiss_count").default("0"),
      matchedRuleId: varchar("matched_rule_id"),
      surfacedAt: timestamp("surfaced_at").defaultNow(),
      actedAt: timestamp("acted_at")
    });
    mobileAuthSessions = pgTable("mobile_auth_sessions", {
      sessionId: text("session_id").primaryKey(),
      token: text("token").notNull(),
      expiresAt: timestamp("expires_at").notNull()
    });
    userDocuments = pgTable("user_documents", {
      id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
      userId: varchar("user_id").notNull().references(() => users.id),
      name: text("name").notNull(),
      mimeType: varchar("mime_type").notNull(),
      sizeBytes: integer("size_bytes").notNull().default(0),
      status: varchar("status").notNull().default("processing"),
      extractedText: text("extracted_text"),
      summary: text("summary"),
      uploadedAt: timestamp("uploaded_at").defaultNow().notNull()
    });
    chatgptImports = pgTable("chatgpt_imports", {
      userId: varchar("user_id").notNull().primaryKey().references(() => users.id),
      importedAt: timestamp("imported_at").defaultNow().notNull(),
      memoriesAdded: integer("memories_added").notNull().default(0)
    });
    proactiveScheduleLog = pgTable("proactive_schedule_log", {
      id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
      userId: varchar("user_id").notNull().references(() => users.id),
      messageType: varchar("message_type").notNull(),
      sentDate: varchar("sent_date").notNull(),
      sentAt: timestamp("sent_at").defaultNow()
    });
    momentumSessions = pgTable("momentum_sessions", {
      userId: varchar("user_id").notNull().primaryKey().references(() => users.id),
      currentStep: integer("current_step").notNull().default(0),
      sessionDate: varchar("session_date").notNull().default(""),
      completedSteps: integer("completed_steps").notNull().default(0),
      steps: jsonb("steps").$type().notNull().default(sql`'[]'::jsonb`),
      status: varchar("status").notNull().default("active"),
      lastStepAt: timestamp("last_step_at")
    });
    morningVoiceNotes = pgTable("morning_voice_notes", {
      id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
      userId: varchar("user_id").notNull().references(() => users.id),
      recordedAt: date("recorded_at").notNull(),
      transcript: text("transcript").notNull(),
      moodSignal: varchar("mood_signal").notNull().default("calm"),
      themes: jsonb("themes").notNull().default(sql`'[]'::jsonb`),
      blockers: jsonb("blockers").notNull().default(sql`'[]'::jsonb`),
      wins: jsonb("wins").notNull().default(sql`'[]'::jsonb`),
      intention: text("intention"),
      createdAt: timestamp("created_at").defaultNow().notNull()
    });
    emailDrafts = pgTable("email_drafts", {
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
      actedAt: timestamp("acted_at")
    });
    goalTrees = pgTable("goal_trees", {
      id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
      userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
      goalId: varchar("goal_id").notNull(),
      title: text("title").notNull(),
      tree: jsonb("tree").$type().notNull().default(sql`'{"phases":[]}'::jsonb`),
      status: varchar("status").notNull().default("active"),
      createdAt: timestamp("created_at").defaultNow().notNull(),
      updatedAt: timestamp("updated_at").defaultNow().notNull()
    });
    agentJobs = pgTable("agent_jobs", {
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
      completedAt: timestamp("completed_at")
    });
    deliverables = pgTable("deliverables", {
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
      createdAt: timestamp("created_at").defaultNow().notNull(),
      actedAt: timestamp("acted_at")
    });
    channelLinks = pgTable("channel_links", {
      id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
      userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
      channel: varchar("channel").notNull(),
      address: varchar("address").notNull(),
      metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
      linkedAt: timestamp("linked_at").defaultNow().notNull(),
      lastSeenAt: timestamp("last_seen_at")
    }, (table) => [
      uniqueIndex("channel_links_channel_address_idx").on(table.channel, table.address)
    ]);
    channelLinkCodes = pgTable("channel_link_codes", {
      code: varchar("code").primaryKey(),
      userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
      channel: varchar("channel").notNull(),
      createdAt: timestamp("created_at").defaultNow().notNull(),
      expiresAt: timestamp("expires_at")
    });
    channelPreferences = pgTable("channel_preferences", {
      userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
      notificationType: varchar("notification_type").notNull(),
      channels: jsonb("channels").$type().notNull().default(sql`'[]'::jsonb`),
      updatedAt: timestamp("updated_at").defaultNow().notNull()
    }, (table) => [
      primaryKey({ columns: [table.userId, table.notificationType] })
    ]);
    NOTIFICATION_TYPES = [
      "morning_briefing",
      "meeting_brief",
      "email_alert",
      "evening_wrap",
      "commitment_check",
      "weekly_planning",
      "approval_request",
      "general"
    ];
    CHANNEL_NAMES = ["telegram", "whatsapp", "slack", "daemon", "discord"];
    interactionLog = pgTable("interaction_log", {
      id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
      userId: varchar("user_id").notNull().references(() => users.id),
      channel: varchar("channel").notNull(),
      direction: varchar("direction").notNull(),
      content: text("content").notNull(),
      label: varchar("label"),
      createdAt: timestamp("created_at").defaultNow().notNull()
    });
  }
});

// server/db.ts
var db_exports = {};
__export(db_exports, {
  db: () => db,
  ensureTablesExist: () => ensureTablesExist
});
import { drizzle } from "drizzle-orm/node-postgres";
import { sql as sql2 } from "drizzle-orm";
import pg from "pg";
async function ensureTablesExist() {
  try {
    await db.execute(sql2`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        username TEXT NOT NULL UNIQUE,
        password TEXT,
        google_id TEXT UNIQUE,
        display_name TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql2`ALTER TABLE users ALTER COLUMN password DROP NOT NULL`).catch(() => {
    });
    await db.execute(sql2`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE`).catch(() => {
    });
    await db.execute(sql2`ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT`).catch(() => {
    });
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS plans (
        user_id VARCHAR NOT NULL REFERENCES users(id),
        date VARCHAR NOT NULL,
        data JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (user_id, date)
      )
    `);
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS goals (
        user_id VARCHAR NOT NULL PRIMARY KEY REFERENCES users(id),
        data JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS stats (
        user_id VARCHAR NOT NULL PRIMARY KEY REFERENCES users(id),
        data JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS brain_dump_inbox (
        user_id VARCHAR NOT NULL PRIMARY KEY REFERENCES users(id),
        data JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS energy_checkins (
        user_id VARCHAR NOT NULL REFERENCES users(id),
        date VARCHAR NOT NULL,
        data JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (user_id, date)
      )
    `);
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS chat_history (
        user_id VARCHAR NOT NULL PRIMARY KEY REFERENCES users(id),
        data JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS life_context (
        user_id VARCHAR NOT NULL PRIMARY KEY REFERENCES users(id),
        data JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS timer_settings (
        user_id VARCHAR NOT NULL PRIMARY KEY REFERENCES users(id),
        data JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id VARCHAR NOT NULL PRIMARY KEY REFERENCES users(id),
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS completion_history (
        user_id VARCHAR NOT NULL PRIMARY KEY REFERENCES users(id),
        data JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS blocked_tasks (
        user_id VARCHAR NOT NULL PRIMARY KEY REFERENCES users(id),
        data JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS completed_calendar_ids (
        user_id VARCHAR NOT NULL REFERENCES users(id),
        date VARCHAR NOT NULL,
        data JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (user_id, date)
      )
    `);
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS plan_snapshots (
        user_id VARCHAR NOT NULL PRIMARY KEY REFERENCES users(id),
        data JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS commitments (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id),
        content TEXT NOT NULL,
        due_date VARCHAR,
        status VARCHAR NOT NULL DEFAULT 'pending',
        extracted_at TIMESTAMP NOT NULL DEFAULT NOW(),
        resolved_at TIMESTAMP,
        source_message TEXT
      )
    `);
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS user_memories (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id),
        content TEXT NOT NULL,
        category VARCHAR NOT NULL DEFAULT 'fact',
        extracted_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql2`ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS relevance_score INTEGER NOT NULL DEFAULT 50`).catch(() => {
    });
    await db.execute(sql2`ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS confidence INTEGER NOT NULL DEFAULT 70`).catch(() => {
    });
    await db.execute(sql2`ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS source_type VARCHAR NOT NULL DEFAULT 'manual'`).catch(() => {
    });
    await db.execute(sql2`ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS source_ref VARCHAR`).catch(() => {
    });
    await db.execute(sql2`ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS last_referenced_at TIMESTAMP`).catch(() => {
    });
    await db.execute(sql2`ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS embedding JSONB`).catch(() => {
    });
    await db.execute(sql2`CREATE INDEX IF NOT EXISTS user_memories_fts_idx ON user_memories USING gin(to_tsvector('english', content))`).catch(() => {
    });
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS people (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        email VARCHAR,
        relationship TEXT,
        notes TEXT,
        interaction_count INTEGER NOT NULL DEFAULT 0,
        last_interaction_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql2`CREATE INDEX IF NOT EXISTS people_user_idx ON people(user_id)`).catch(() => {
    });
    await db.execute(sql2`ALTER TABLE people ADD COLUMN IF NOT EXISTS next_interaction_at TIMESTAMP`).catch(() => {
    });
    await db.execute(sql2`ALTER TABLE people ADD COLUMN IF NOT EXISTS upcoming_count INTEGER NOT NULL DEFAULT 0`).catch(() => {
    });
    await db.execute(sql2`CREATE UNIQUE INDEX IF NOT EXISTS weekly_insights_user_week_idx ON weekly_insights(user_id, week_of)`).catch(() => {
    });
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS jarvis_souls (
        user_id VARCHAR PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL DEFAULT '',
        manual_override TEXT,
        generated_at TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS weekly_insights (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        week_of VARCHAR NOT NULL,
        patterns JSONB NOT NULL DEFAULT '[]'::jsonb,
        summary TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql2`CREATE INDEX IF NOT EXISTS weekly_insights_user_week_idx ON weekly_insights(user_id, week_of)`).catch(() => {
    });
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS integration_owner (
        owner_user_id VARCHAR NOT NULL PRIMARY KEY REFERENCES users(id),
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS user_oauth_tokens (
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider VARCHAR NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        expires_at TIMESTAMP,
        scopes TEXT,
        account_email TEXT,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, provider)
      )
    `);
    await db.execute(sql2`
      UPDATE user_oauth_tokens SET account_email = '' WHERE account_email IS NULL
    `).catch(() => {
    });
    await db.execute(sql2`
      ALTER TABLE user_oauth_tokens DROP CONSTRAINT IF EXISTS user_oauth_tokens_pkey
    `).catch(() => {
    });
    await db.execute(sql2`
      ALTER TABLE user_oauth_tokens ALTER COLUMN account_email SET DEFAULT ''
    `).catch(() => {
    });
    await db.execute(sql2`
      ALTER TABLE user_oauth_tokens ALTER COLUMN account_email SET NOT NULL
    `).catch(() => {
    });
    await db.execute(sql2`
      ALTER TABLE user_oauth_tokens ADD CONSTRAINT user_oauth_tokens_pkey PRIMARY KEY (user_id, provider, account_email)
    `).catch(() => {
    });
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS telegram_links (
        user_id VARCHAR NOT NULL PRIMARY KEY REFERENCES users(id),
        chat_id VARCHAR NOT NULL,
        username VARCHAR,
        linked_at TIMESTAMP NOT NULL DEFAULT NOW(),
        group_chat_ids JSONB DEFAULT '[]'::jsonb
      )
    `);
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS telegram_link_codes (
        code VARCHAR PRIMARY KEY,
        user_id VARCHAR NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS telegram_group_messages (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id),
        chat_id VARCHAR NOT NULL,
        chat_title VARCHAR,
        from_user VARCHAR,
        text TEXT NOT NULL,
        message_date TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS proactive_questions_sent (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id),
        source_type VARCHAR NOT NULL,
        source_id VARCHAR NOT NULL,
        question TEXT NOT NULL,
        sent_at TIMESTAMP DEFAULT NOW(),
        answered_at TIMESTAMP
      )
    `);
    await db.execute(sql2`
      CREATE UNIQUE INDEX IF NOT EXISTS proactive_questions_user_source_idx
        ON proactive_questions_sent (user_id, source_type, source_id)
    `).catch(() => {
    });
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS mobile_auth_sessions (
        session_id TEXT PRIMARY KEY,
        token TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL
      )
    `);
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS morning_voice_notes (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id),
        recorded_at DATE NOT NULL,
        transcript TEXT NOT NULL,
        mood_signal VARCHAR NOT NULL DEFAULT 'calm'
          CHECK (mood_signal IN ('calm', 'energized', 'stressed', 'overwhelmed', 'uncertain')),
        themes JSONB NOT NULL DEFAULT '[]'::jsonb,
        blockers JSONB NOT NULL DEFAULT '[]'::jsonb,
        wins JSONB NOT NULL DEFAULT '[]'::jsonb,
        intention TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, recorded_at)
      )
    `);
    await db.execute(sql2`ALTER TABLE morning_voice_notes ALTER COLUMN recorded_at TYPE DATE USING recorded_at::DATE`).catch(() => {
    });
    await db.execute(sql2`ALTER TABLE morning_voice_notes ADD CONSTRAINT morning_voice_notes_mood_check CHECK (mood_signal IN ('calm', 'energized', 'stressed', 'overwhelmed', 'uncertain'))`).catch(() => {
    });
    await db.execute(sql2`ALTER TABLE morning_voice_notes ADD CONSTRAINT morning_voice_notes_user_date_unique UNIQUE (user_id, recorded_at)`).catch(() => {
    });
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS chatgpt_imports (
        "userId" VARCHAR PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        "importedAt" TIMESTAMP DEFAULT NOW(),
        "memoriesAdded" INTEGER DEFAULT 0
      )
    `);
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS inbox_rules (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR NOT NULL DEFAULT 'suppress',
        scope VARCHAR NOT NULL DEFAULT 'all',
        pattern TEXT NOT NULL,
        "matchHints" JSONB NOT NULL DEFAULT '{}'::jsonb,
        active VARCHAR NOT NULL DEFAULT 'true',
        "matchCount" VARCHAR NOT NULL DEFAULT '0',
        "dismissCount" VARCHAR NOT NULL DEFAULT '0',
        source VARCHAR NOT NULL DEFAULT 'user',
        "createdAt" TIMESTAMP DEFAULT NOW(),
        "updatedAt" TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS inbox_items (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "sourceType" VARCHAR NOT NULL,
        "sourceId" VARCHAR NOT NULL,
        subject TEXT,
        sender TEXT,
        snippet TEXT,
        "jarvisReason" TEXT,
        "suggestedActions" JSONB NOT NULL DEFAULT '[]'::jsonb,
        "matchedRuleId" VARCHAR,
        status VARCHAR NOT NULL DEFAULT 'pending',
        "actedAt" TIMESTAMP,
        "dismissCount" VARCHAR NOT NULL DEFAULT '0',
        "createdAt" TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS proactive_schedule_log (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        message_type VARCHAR NOT NULL,
        sent_date VARCHAR NOT NULL,
        sent_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS momentum_sessions (
        user_id VARCHAR PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        current_step INTEGER NOT NULL DEFAULT 0,
        session_date VARCHAR NOT NULL DEFAULT '',
        completed_steps INTEGER NOT NULL DEFAULT 0,
        steps JSONB NOT NULL DEFAULT '[]'::jsonb,
        status VARCHAR NOT NULL DEFAULT 'active',
        last_step_at TIMESTAMP
      )
    `);
    await db.execute(sql2`
      ALTER TABLE momentum_sessions
        ADD COLUMN IF NOT EXISTS status VARCHAR NOT NULL DEFAULT 'active'
    `);
    await db.execute(sql2`
      CREATE UNIQUE INDEX IF NOT EXISTS proactive_schedule_log_uniq
        ON proactive_schedule_log (user_id, message_type, sent_date)
    `);
    await db.execute(sql2`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'chatgpt_imports' AND column_name = 'userId'
        ) THEN
          ALTER TABLE chatgpt_imports RENAME COLUMN "userId" TO user_id;
        END IF;
      END$$
    `);
    await db.execute(sql2`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'chatgpt_imports' AND column_name = 'importedAt'
        ) THEN
          ALTER TABLE chatgpt_imports RENAME COLUMN "importedAt" TO imported_at;
        END IF;
      END$$
    `);
    await db.execute(sql2`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'chatgpt_imports' AND column_name = 'memoriesAdded'
        ) THEN
          ALTER TABLE chatgpt_imports RENAME COLUMN "memoriesAdded" TO memories_added;
        END IF;
      END$$
    `);
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS user_documents (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        mime_type VARCHAR NOT NULL,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        status VARCHAR NOT NULL DEFAULT 'processing',
        extracted_text TEXT,
        summary TEXT,
        uploaded_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS email_drafts (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source_message_id VARCHAR,
        from_sender TEXT,
        original_subject TEXT,
        draft_subject TEXT NOT NULL,
        draft_body TEXT NOT NULL,
        jarvis_reason TEXT,
        status VARCHAR NOT NULL DEFAULT 'pending_approval',
        gmail_draft_id VARCHAR,
        gmail_draft_url TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        acted_at TIMESTAMP
      )
    `);
    await db.execute(sql2`
      CREATE INDEX IF NOT EXISTS email_drafts_user_status_idx
        ON email_drafts (user_id, status, created_at DESC)
    `).catch(() => {
    });
    await db.execute(sql2`
      CREATE UNIQUE INDEX IF NOT EXISTS email_drafts_user_msg_uniq
        ON email_drafts (user_id, source_message_id)
        WHERE source_message_id IS NOT NULL
    `).catch(() => {
    });
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS interaction_log (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        channel VARCHAR NOT NULL,
        direction VARCHAR NOT NULL,
        content TEXT NOT NULL,
        label VARCHAR,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql2`
      CREATE INDEX IF NOT EXISTS interaction_log_user_created_idx
        ON interaction_log (user_id, created_at DESC)
    `).catch(() => {
    });
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS goal_trees (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        goal_id VARCHAR NOT NULL,
        title TEXT NOT NULL,
        tree JSONB NOT NULL DEFAULT '{"phases":[]}'::jsonb,
        status VARCHAR NOT NULL DEFAULT 'active',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql2`
      CREATE UNIQUE INDEX IF NOT EXISTS goal_trees_user_goal_uniq
        ON goal_trees (user_id, goal_id)
    `).catch(() => {
    });
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS agent_jobs (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        agent_type VARCHAR NOT NULL,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        input JSONB NOT NULL DEFAULT '{}'::jsonb,
        status VARCHAR NOT NULL DEFAULT 'queued',
        result JSONB,
        error TEXT,
        turns INTEGER DEFAULT 0,
        tool_calls_count INTEGER DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        started_at TIMESTAMP,
        completed_at TIMESTAMP
      )
    `);
    await db.execute(sql2`
      CREATE INDEX IF NOT EXISTS agent_jobs_status_created_idx
        ON agent_jobs (status, created_at)
    `).catch(() => {
    });
    await db.execute(sql2`
      CREATE INDEX IF NOT EXISTS agent_jobs_user_status_idx
        ON agent_jobs (user_id, status, created_at DESC)
    `).catch(() => {
    });
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS deliverables (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        job_id VARCHAR REFERENCES agent_jobs(id) ON DELETE SET NULL,
        agent_type VARCHAR NOT NULL,
        type VARCHAR NOT NULL,
        title TEXT NOT NULL,
        summary TEXT,
        body TEXT NOT NULL,
        meta JSONB NOT NULL DEFAULT '{}'::jsonb,
        status VARCHAR NOT NULL DEFAULT 'pending_approval',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        acted_at TIMESTAMP
      )
    `);
    await db.execute(sql2`
      CREATE INDEX IF NOT EXISTS deliverables_user_status_idx
        ON deliverables (user_id, status, created_at DESC)
    `).catch(() => {
    });
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS channel_links (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        channel VARCHAR NOT NULL,
        address VARCHAR NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        linked_at TIMESTAMP NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMP
      )
    `);
    await db.execute(sql2`
      CREATE UNIQUE INDEX IF NOT EXISTS channel_links_channel_address_idx
        ON channel_links (channel, address)
    `).catch(() => {
    });
    await db.execute(sql2`
      CREATE INDEX IF NOT EXISTS channel_links_user_idx
        ON channel_links (user_id, channel)
    `).catch(() => {
    });
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS channel_link_codes (
        code VARCHAR PRIMARY KEY,
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        channel VARCHAR NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMP
      )
    `);
    await db.execute(sql2`
      CREATE INDEX IF NOT EXISTS channel_link_codes_channel_expires_idx
        ON channel_link_codes (channel, expires_at)
    `).catch(() => {
    });
    await db.execute(sql2`
      CREATE TABLE IF NOT EXISTS channel_preferences (
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        notification_type VARCHAR NOT NULL,
        channels JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, notification_type)
      )
    `);
    console.log("Database tables verified");
  } catch (error) {
    console.error("Failed to ensure database tables exist:", error);
    throw error;
  }
}
var pool, db;
var init_db = __esm({
  "server/db.ts"() {
    "use strict";
    init_schema();
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set");
    }
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL
    });
    db = drizzle(pool, { schema: schema_exports });
  }
});

// server/documentProcessor.ts
import OpenAI from "openai";
import { eq, desc } from "drizzle-orm";
async function extractFromPdfWithPdfjs(buffer) {
  const { pathToFileURL } = await import("url");
  const { resolve: resolve4 } = await import("path");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const workerPath = resolve4("./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
  const uint8 = new Uint8Array(buffer);
  const loadingTask = pdfjs.getDocument({ data: uint8, useSystemFonts: true });
  const pdf = await loadingTask.promise;
  let fullText = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.filter((item) => "str" in item).map((item) => item.str).join(" ");
    fullText += pageText + "\n";
  }
  return fullText.trim();
}
async function extractFromPdfWithPdfParse(buffer) {
  const pdfParse = (await import("pdf-parse")).default;
  const data = await pdfParse(buffer);
  return data.text || "";
}
async function extractFromPdf(buffer) {
  let text2 = "";
  try {
    text2 = await extractFromPdfWithPdfjs(buffer);
  } catch (err) {
    console.warn("[Docs] pdfjs-dist failed, falling back to pdf-parse:", err instanceof Error ? err.message : err);
  }
  if (!text2) {
    console.log("[Docs] pdfjs-dist returned empty text, falling back to pdf-parse");
    try {
      text2 = await extractFromPdfWithPdfParse(buffer);
    } catch (err) {
      console.warn("[Docs] pdf-parse also failed:", err instanceof Error ? err.message : err);
    }
  }
  if (!text2.trim()) {
    throw new Error("Could not extract text from PDF. The file may be encrypted, image-only, or in an unsupported format.");
  }
  return text2;
}
async function extractFromDocx(buffer) {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value || "";
}
async function extractFromImage(buffer, mimeType) {
  const base64 = buffer.toString("base64");
  const dataUrl = `data:${mimeType};base64,${base64}`;
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: dataUrl, detail: "high" }
          },
          {
            type: "text",
            text: "Extract all text from this image. Return only the text content, preserving structure as much as possible. If there is no text, describe what you see concisely."
          }
        ]
      }
    ],
    max_tokens: 4096
  });
  return response.choices[0]?.message?.content || "";
}
async function summarizeText(name, text2) {
  const input = text2.slice(0, MAX_SUMMARY_INPUT_CHARS);
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You are a document summarizer. Given content from a document, produce a dense, structured summary that captures the key information an AI assistant would need to answer questions about it. Include: main topics, key facts, names/entities, dates, action items, and any important details. Be thorough but concise. Output under 600 words.`
      },
      {
        role: "user",
        content: `Document name: "${name}"

Content:
${input}`
      }
    ],
    temperature: 0.2,
    max_tokens: 1e3
  });
  return response.choices[0]?.message?.content || text2.slice(0, 3e3);
}
async function processDocument(userId2, documentId, name, mimeType, buffer) {
  try {
    let extractedText = "";
    if (mimeType === "application/pdf") {
      extractedText = await extractFromPdf(buffer);
    } else if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || mimeType === "application/msword") {
      extractedText = await extractFromDocx(buffer);
    } else if (mimeType.startsWith("text/") || mimeType === "application/json") {
      extractedText = buffer.toString("utf-8");
    } else if (mimeType.startsWith("image/")) {
      extractedText = await extractFromImage(buffer, mimeType);
    } else {
      extractedText = buffer.toString("utf-8");
    }
    extractedText = extractedText.replace(/\r\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim().slice(0, MAX_EXTRACTED_CHARS);
    const needsSummary = extractedText.length > 6e3;
    const summary = needsSummary ? await summarizeText(name, extractedText) : null;
    await db.update(userDocuments).set({ status: "ready", extractedText, summary }).where(eq(userDocuments.id, documentId));
    console.log(`[Docs] Processed "${name}" \u2014 ${extractedText.length} chars${needsSummary ? ", summarized" : ""}`);
  } catch (err) {
    console.error(`[Docs] Error processing "${name}":`, err);
    await db.update(userDocuments).set({
      status: "error",
      summary: `Failed to extract text: ${err instanceof Error ? err.message : "Unknown error"}`
    }).where(eq(userDocuments.id, documentId));
  }
}
async function getUserDocumentContext(userId2) {
  const docs = await db.select().from(userDocuments).where(eq(userDocuments.userId, userId2)).orderBy(desc(userDocuments.uploadedAt)).limit(MAX_DOCS_PER_USER);
  const readyDocs = docs.filter((d) => d.status === "ready" && (d.extractedText || d.summary));
  if (readyDocs.length === 0) return "";
  const sections = readyDocs.map((doc) => {
    const content = doc.summary || (doc.extractedText?.slice(0, 5e3) ?? "");
    return `### ${doc.name}
${content}`;
  });
  return `
## My Documents & Knowledge Base
The user has uploaded the following documents. Refer to this content when answering questions \u2014 treat it as authoritative information about them or their business.

${sections.join("\n\n")}`;
}
var openai, MAX_DOCS_PER_USER, MAX_EXTRACTED_CHARS, MAX_SUMMARY_INPUT_CHARS, SUPPORTED_MIME_TYPES, SUPPORTED_EXTENSIONS;
var init_documentProcessor = __esm({
  "server/documentProcessor.ts"() {
    "use strict";
    init_db();
    init_schema();
    openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
    });
    MAX_DOCS_PER_USER = 10;
    MAX_EXTRACTED_CHARS = 8e4;
    MAX_SUMMARY_INPUT_CHARS = 6e4;
    SUPPORTED_MIME_TYPES = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
      "text/plain",
      "text/markdown",
      "text/csv",
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif"
    ];
    SUPPORTED_EXTENSIONS = [".pdf", ".docx", ".doc", ".txt", ".md", ".csv", ".jpg", ".jpeg", ".png", ".webp", ".gif"];
  }
});

// server/memory/categories.ts
function normalizeCategory(raw) {
  if (!raw) return "fact";
  const lower = raw.trim().toLowerCase();
  if (MEMORY_CATEGORIES.includes(lower)) {
    return lower;
  }
  return LEGACY_TO_CANONICAL[lower] || "fact";
}
var LEGACY_TO_CANONICAL, CATEGORY_LABELS;
var init_categories = __esm({
  "server/memory/categories.ts"() {
    "use strict";
    init_schema();
    LEGACY_TO_CANONICAL = {
      personality: "communication_style",
      work_style: "work_patterns",
      pattern: "work_patterns",
      accomplishment: "accomplishments",
      achievement: "accomplishments",
      goal: "goals_history",
      goal_discovered: "goals_history",
      relationship: "relationships",
      preference: "preferences"
    };
    CATEGORY_LABELS = {
      work_patterns: "Work Patterns",
      communication_style: "Communication Style",
      energy_rhythms: "Energy & Rhythms",
      goals_history: "Goals (history)",
      relationships: "Key People",
      values: "Values & Motivations",
      blockers: "Blockers & Frictions",
      accomplishments: "Wins & Accomplishments",
      preferences: "Preferences",
      fact: "Other Facts"
    };
  }
});

// server/memory/soul.ts
var soul_exports = {};
__export(soul_exports, {
  getSoul: () => getSoul,
  getSoulPromptBlock: () => getSoulPromptBlock,
  markSoulStale: () => markSoulStale,
  regenerateSoul: () => regenerateSoul,
  setManualOverride: () => setManualOverride,
  setSoulContent: () => setSoulContent,
  touchReferencedMemories: () => touchReferencedMemories
});
import { eq as eq2, desc as desc2, and, inArray } from "drizzle-orm";
function isStale(generatedAt) {
  if (!generatedAt) return true;
  return Date.now() - generatedAt.getTime() > SOUL_TTL_MS;
}
function readLifeContextData(value) {
  if (!value || typeof value !== "object") return null;
  const obj = value;
  const out = {};
  for (const k of ["priorityGoal", "upcomingDeadline", "improvementArea", "currentBlocker", "freeText"]) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return Object.keys(out).length > 0 ? out : null;
}
async function buildSoulMarkdown(userId2) {
  const [memoriesRows, lifeRows, peopleRows, insightRows] = await Promise.all([
    db.select().from(userMemories).where(eq2(userMemories.userId, userId2)).orderBy(desc2(userMemories.relevanceScore), desc2(userMemories.confidence), desc2(userMemories.extractedAt)).limit(120),
    db.select().from(lifeContext).where(eq2(lifeContext.userId, userId2)).limit(1),
    db.select().from(people).where(eq2(people.userId, userId2)).orderBy(desc2(people.lastInteractionAt)).limit(15),
    db.select().from(weeklyInsights).where(eq2(weeklyInsights.userId, userId2)).orderBy(desc2(weeklyInsights.createdAt)).limit(1)
  ]);
  const grouped = /* @__PURE__ */ new Map();
  for (const m of memoriesRows) {
    const cat = normalizeCategory(m.category);
    const arr = grouped.get(cat) || [];
    if (arr.length < 8) arr.push(m.content);
    grouped.set(cat, arr);
  }
  const sections = [];
  sections.push("# JARVIS SOUL");
  sections.push("_Auto-generated profile of the user. Regenerated weekly from memories, life context, and observed patterns._");
  const lc = lifeRows[0] ? readLifeContextData(lifeRows[0].data) : null;
  if (lc) {
    sections.push("## Current Life Context");
    if (lc.priorityGoal) sections.push(`- **Top priority:** ${lc.priorityGoal}`);
    if (lc.upcomingDeadline) sections.push(`- **Upcoming deadline:** ${lc.upcomingDeadline}`);
    if (lc.improvementArea) sections.push(`- **Improvement area:** ${lc.improvementArea}`);
    if (lc.currentBlocker) sections.push(`- **Current blocker:** ${lc.currentBlocker}`);
    if (lc.freeText) sections.push(`- ${lc.freeText}`);
  }
  const orderedCats = [
    "values",
    "communication_style",
    "work_patterns",
    "energy_rhythms",
    "goals_history",
    "blockers",
    "preferences",
    "accomplishments",
    "relationships",
    "fact"
  ];
  for (const cat of orderedCats) {
    const items = grouped.get(cat);
    if (!items || items.length === 0) continue;
    sections.push(`## ${CATEGORY_LABELS[cat]}`);
    for (const item of items) sections.push(`- ${item}`);
  }
  if (peopleRows.length > 0) {
    sections.push("## People in your life");
    for (const p of peopleRows) {
      const role = p.relationship ? ` \u2014 ${p.relationship}` : "";
      const note = p.notes ? ` (${p.notes})` : "";
      sections.push(`- **${p.name}**${role}${note}`);
    }
  }
  const latestInsight = insightRows[0];
  if (latestInsight) {
    const patterns = Array.isArray(latestInsight.patterns) ? latestInsight.patterns : [];
    if (patterns.length > 0) {
      sections.push(`## Patterns observed (week of ${latestInsight.weekOf})`);
      for (const p of patterns) {
        const conf = typeof p.confidence === "number" ? ` _(c=${p.confidence})_` : "";
        sections.push(`- ${p.observation}${conf}`);
      }
      if (latestInsight.summary) {
        sections.push(`
_${latestInsight.summary}_`);
      }
    }
  }
  return sections.join("\n");
}
async function regenerateSoul(userId2) {
  const content = await buildSoulMarkdown(userId2);
  const now = /* @__PURE__ */ new Date();
  const inserted = await db.insert(jarvisSouls).values({ userId: userId2, content, generatedAt: now, updatedAt: now }).onConflictDoUpdate({
    target: jarvisSouls.userId,
    set: { content, generatedAt: now, updatedAt: now }
  }).returning();
  const row = inserted[0];
  console.log(`[Soul] regenerated for user ${userId2} (${content.length} chars)`);
  return {
    content: row?.content ?? content,
    manualOverride: row?.manualOverride ?? null,
    generatedAt: row?.generatedAt ?? now,
    updatedAt: row?.updatedAt ?? now
  };
}
async function getSoul(userId2, opts) {
  const [existing] = await db.select().from(jarvisSouls).where(eq2(jarvisSouls.userId, userId2)).limit(1);
  if (!existing || opts?.forceFresh || isStale(existing.generatedAt) || !existing.content.trim()) {
    const fresh = await regenerateSoul(userId2);
    return {
      content: fresh.content,
      manualOverride: existing?.manualOverride ?? fresh.manualOverride,
      generatedAt: fresh.generatedAt,
      updatedAt: fresh.updatedAt
    };
  }
  return {
    content: existing.content,
    manualOverride: existing.manualOverride,
    generatedAt: existing.generatedAt,
    updatedAt: existing.updatedAt
  };
}
async function setSoulContent(userId2, content) {
  const trimmed = content.trim();
  const now = /* @__PURE__ */ new Date();
  await db.insert(jarvisSouls).values({ userId: userId2, content: trimmed, manualOverride: null, generatedAt: now, updatedAt: now }).onConflictDoUpdate({
    target: jarvisSouls.userId,
    set: { content: trimmed, manualOverride: null, generatedAt: now, updatedAt: now }
  });
}
async function setManualOverride(userId2, override) {
  const trimmed = override?.trim() || null;
  const now = /* @__PURE__ */ new Date();
  await db.insert(jarvisSouls).values({ userId: userId2, content: "", manualOverride: trimmed, updatedAt: now }).onConflictDoUpdate({
    target: jarvisSouls.userId,
    set: { manualOverride: trimmed, updatedAt: now }
  });
}
async function markSoulStale(userId2) {
  await db.update(jarvisSouls).set({ generatedAt: null }).where(eq2(jarvisSouls.userId, userId2));
}
async function getSoulPromptBlock(userId2) {
  try {
    const soul = await getSoul(userId2);
    const parts = [];
    if (soul.content.trim()) parts.push(soul.content.trim());
    if (soul.manualOverride && soul.manualOverride.trim()) {
      parts.push(`
## User-pinned context
${soul.manualOverride.trim()}`);
    }
    return parts.length > 0 ? `
${parts.join("\n")}
` : "";
  } catch (err) {
    console.error("[Soul] getSoulPromptBlock failed:", err);
    return "";
  }
}
async function touchReferencedMemories(userId2, ids) {
  if (ids.length === 0) return;
  try {
    await db.update(userMemories).set({ lastReferencedAt: /* @__PURE__ */ new Date() }).where(and(eq2(userMemories.userId, userId2), inArray(userMemories.id, ids)));
  } catch (err) {
    console.error("[Soul] touchReferencedMemories failed:", err);
  }
}
var SOUL_TTL_MS;
var init_soul = __esm({
  "server/memory/soul.ts"() {
    "use strict";
    init_db();
    init_schema();
    init_categories();
    SOUL_TTL_MS = 7 * 24 * 60 * 60 * 1e3;
  }
});

// server/memory/retrieve.ts
var retrieve_exports = {};
__export(retrieve_exports, {
  backfillEmbedding: () => backfillEmbedding,
  embedText: () => embedText,
  retrieveRelevantMemories: () => retrieveRelevantMemories
});
import { sql as sql3 } from "drizzle-orm";
import OpenAI2 from "openai";
async function embedText(text2) {
  const trimmed = text2.trim();
  if (!trimmed) return null;
  try {
    const res = await openai2.embeddings.create({
      model: EMBED_MODEL,
      input: trimmed.slice(0, 8e3)
    });
    const v = res.data[0]?.embedding;
    return Array.isArray(v) ? v : null;
  } catch (err) {
    console.error("[MemoryRetrieve] embedText failed:", err);
    return null;
  }
}
async function backfillEmbedding(memoryId, content) {
  const v = await embedText(content);
  if (!v) return;
  try {
    await db.execute(sql3`UPDATE user_memories SET embedding = ${JSON.stringify(v)}::jsonb WHERE id = ${memoryId}`);
  } catch (err) {
    console.error("[MemoryRetrieve] backfillEmbedding failed:", err);
  }
}
function cosine(a, b) {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
async function retrieveRelevantMemories(userId2, query, limit = 12) {
  const q = query.trim();
  if (!q) return [];
  const queryVec = await embedText(q);
  const rows = await db.execute(sql3`
    SELECT id, content, category, relevance_score, confidence, embedding,
           ts_rank(to_tsvector('english', content), plainto_tsquery('english', ${q})) AS fts_rank
    FROM user_memories
    WHERE user_id = ${userId2}
    ORDER BY fts_rank DESC NULLS LAST, relevance_score DESC
    LIMIT 60
  `);
  const scored = (rows.rows ?? []).map((r) => {
    const ftsRank = Math.min(1, Number(r.fts_rank) || 0);
    const rel = Math.max(0, Math.min(100, Number(r.relevance_score) || 0)) / 100;
    let semantic = 0;
    if (queryVec && Array.isArray(r.embedding) && r.embedding.length > 0) {
      semantic = Math.max(0, Math.min(1, (cosine(queryVec, r.embedding) + 1) / 2));
    }
    const score = 0.4 * ftsRank + 0.4 * semantic + 0.2 * rel;
    return {
      id: r.id,
      content: r.content,
      category: r.category,
      relevanceScore: Number(r.relevance_score) || 0,
      confidence: Number(r.confidence) || 0,
      score
    };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.filter((s) => s.score > 0).slice(0, limit);
}
var openai2, EMBED_MODEL;
var init_retrieve = __esm({
  "server/memory/retrieve.ts"() {
    "use strict";
    init_db();
    openai2 = new OpenAI2({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
    });
    EMBED_MODEL = "text-embedding-3-small";
  }
});

// server/memory/promptContext.ts
var promptContext_exports = {};
__export(promptContext_exports, {
  EMPTY_AI_CONTEXT: () => EMPTY_AI_CONTEXT,
  buildAiContextSections: () => buildAiContextSections
});
import { sql as sql4 } from "drizzle-orm";
async function buildAiContextSections(userId2, seedQuery) {
  if (!userId2) return EMPTY_AI_CONTEXT;
  const out = { ...EMPTY_AI_CONTEXT };
  try {
    const soulText = await getSoulPromptBlock(userId2);
    if (soulText && soulText.trim().length > 0) {
      out.soulSection = `

What I know about this person (JARVIS Soul):
${soulText.trim()}
`;
    }
  } catch (err) {
    console.error("[promptContext] soul load failed", err);
  }
  try {
    const rows = await db.execute(sql4`
      SELECT patterns, summary FROM weekly_insights
      WHERE user_id = ${userId2}
      ORDER BY created_at DESC LIMIT 1
    `);
    const row = rows.rows?.[0];
    if (row) {
      const patterns = Array.isArray(row.patterns) ? row.patterns : [];
      const top = patterns.slice(0, 3).map((p) => `- ${p.observation || p.summary || JSON.stringify(p)}`).join("\n");
      if (top || row.summary) {
        out.patternSection = `

Recent weekly patterns I've noticed:
${row.summary ? row.summary + "\n" : ""}${top}
`;
      }
    }
  } catch (err) {
    console.error("[promptContext] patterns load failed", err);
  }
  try {
    const trimmed = (seedQuery || "").trim();
    if (trimmed.length > 0) {
      const mems = await retrieveRelevantMemories(userId2, trimmed, 6);
      if (mems.length > 0) {
        out.memorySection = `

Relevant memories:
` + mems.map((m) => `- [${m.category}] ${m.content}`).join("\n") + `
`;
      }
    }
  } catch (err) {
    console.error("[promptContext] retrieve failed", err);
  }
  return out;
}
var EMPTY_AI_CONTEXT;
var init_promptContext = __esm({
  "server/memory/promptContext.ts"() {
    "use strict";
    init_db();
    init_soul();
    init_retrieve();
    EMPTY_AI_CONTEXT = {
      soulSection: "",
      patternSection: "",
      memorySection: ""
    };
  }
});

// server/ai.ts
import OpenAI3 from "openai";
async function resizeTask(req) {
  const { taskTitle, taskDescription, detailLevel, direction, history } = req;
  const completedTasks = history.filter((h) => h.completed).map((h) => h.title);
  const skippedTasks = history.filter((h) => !h.completed).map((h) => h.title);
  const historyContext = completedTasks.length > 0 || skippedTasks.length > 0 ? `
Recent history for context:
- Tasks they completed recently: ${completedTasks.slice(0, 5).join(", ") || "none"}
- Tasks they left undone recently: ${skippedTasks.slice(0, 5).join(", ") || "none"}
Use this to calibrate step size. If they tend to skip tasks, make steps more approachable and concrete. If they complete everything easily, steps can be slightly more ambitious.` : "";
  let directionPrompt;
  if (direction === "smaller") {
    const stepCounts = {
      1: "2-3 broad steps",
      2: "3-4 clear steps",
      3: "4-6 specific steps",
      4: "6-8 detailed steps",
      5: "8-12 very small, immediately actionable micro-steps"
    };
    directionPrompt = `Break this task into ${stepCounts[detailLevel] || "4-6 steps"}. Each step should be concrete and actionable \u2014 something you can do right now without thinking about what it means. For higher detail levels, break steps into the smallest possible actions (e.g., "open laptop" rather than "start working").`;
  } else {
    directionPrompt = `Combine or simplify this task into ${detailLevel <= 2 ? "1 single clear action" : "1-2 higher-level actions"}. Make it feel less overwhelming by framing it as one focused activity instead of multiple separate things.`;
  }
  const prompt = `You help people who struggle with getting started on tasks. Your job is to resize tasks to make them more manageable.

Task: "${taskTitle}"${taskDescription ? `
Context: ${taskDescription}` : ""}
${historyContext}

${directionPrompt}

Rules:
- Start each step with a verb (action word)
- Keep language simple and encouraging
- No numbering, just the step text
- Each step should take no more than 5-15 minutes
- Make steps feel easy to start \u2014 low friction, low intimidation

Return ONLY a JSON object with a "steps" array of strings. No other text.`;
  const response = await openai3.chat.completions.create({
    model: "gpt-5-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    max_completion_tokens: 8192
  });
  const content = response.choices[0]?.message?.content || '{"steps":[]}';
  try {
    const parsed = JSON.parse(content);
    return { steps: Array.isArray(parsed.steps) ? parsed.steps : [] };
  } catch {
    return { steps: [] };
  }
}
async function unblockTask(req) {
  const { taskTitle, taskDescription, blockerType, skipDays } = req;
  const blockerGuide = {
    too_big: "Identify the single smallest possible first action \u2014 something takeable in under 5 minutes \u2014 and describe it concretely.",
    bad_timing: "Suggest a specific time block or trigger today when this task would fit naturally.",
    need_info: "Identify exactly what information is missing and one specific place to find it.",
    low_energy: "Either shrink the scope dramatically to a version doable in 10 minutes, or identify the one upcoming time today when energy will be higher.",
    unknown: "Ask one clarifying question that would help identify the real blocker, then give a default starting action."
  };
  const prompt = `You help people overcome mental blocks on tasks. Be direct, specific, and practical. No pep talk.

Task: "${taskTitle}"${taskDescription ? `
Context: ${taskDescription}` : ""}
Days carried without completing: ${skipDays}
What the person says is blocking them: ${blockerType.replace("_", " ")}

${blockerGuide[blockerType] || blockerGuide.unknown}

Write 2-3 sentences max. Focus on one concrete next action, not general advice. Make it feel achievable right now.

Return ONLY a JSON object: {"suggestion": "your 2-3 sentence response"}`;
  const response = await openai3.chat.completions.create({
    model: "gpt-5-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    max_completion_tokens: 512
  });
  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
    return { suggestion: parsed.suggestion || "Try starting with just one minute on this task \u2014 set a timer and begin." };
  } catch {
    return { suggestion: "Try starting with just one minute on this task \u2014 set a timer and begin." };
  }
}
async function generateSmartPlan(req) {
  const { goals: goals2, history, dayOfWeek, lifeContext: lifeContext2, gmailItems, energyCheckin, existingTasks, carriedOverTasks, blockedTasks: blockedTasks2 } = req;
  const completedTasks = history.filter((h) => h.completed);
  const skippedTasks = history.filter((h) => !h.completed);
  const energyFocusText = energyCheckin ? `
Morning Check-in (Today's state):
- Energy Level: ${energyCheckin.energy}/5
- Focus Quality: ${energyCheckin.focus}
${energyCheckin.energy <= 2 ? "The user has low energy today. Keep the plan very light, focusing only on essential or low-effort tasks." : ""}
${energyCheckin.focus === "Low" ? "The user is feeling foggy. Break tasks into even smaller, more manageable steps if possible, or avoid high-complexity deep work." : ""}` : "";
  const goalsText = goals2.length > 0 ? goals2.map((g) => `- [id:${g.id}] ${g.title} (${g.category}): ${g.current}/${g.target} ${g.unit}`).join("\n") : "No specific goals set yet.";
  const historyText = history.length > 0 ? `Completed ${completedTasks.length} of ${history.length} tasks in the last 7 days.
Tasks completed: ${completedTasks.map((h) => h.title).slice(0, 8).join(", ") || "none"}
Tasks left undone: ${skippedTasks.map((h) => h.title).slice(0, 8).join(", ") || "none"}
${skippedTasks.length > completedTasks.length ? "This person tends to skip more tasks than they complete \u2014 keep today's plan lighter and more approachable." : ""}
${completedTasks.length > skippedTasks.length ? "This person is on a good streak \u2014 maintain momentum with a balanced plan." : ""}` : "No history yet \u2014 create a balanced starter plan.";
  const lifeCtxSectionRaw = lifeContext2 ? `
About this person:
` + (lifeContext2.priorityGoal ? `- Current priority: ${lifeContext2.priorityGoal}
` : "") + (lifeContext2.upcomingDeadline ? `- Upcoming deadline: ${lifeContext2.upcomingDeadline}
` : "") + (lifeContext2.improvementArea ? `- Wants to improve: ${lifeContext2.improvementArea}
` : "") + (lifeContext2.currentBlocker ? `- Known blocker: ${lifeContext2.currentBlocker}
` : "") + (lifeContext2.freeText ? `- Additional context: ${lifeContext2.freeText}` : "") : "";
  const gmailSection = gmailItems && gmailItems.length > 0 ? `
Recent email signals (possible commitments/deadlines):
` + gmailItems.slice(0, 8).map((i) => `- "${i.subject}": ${i.snippet}`).join("\n") : "";
  const existingTasksSection = existingTasks && existingTasks.length > 0 ? `
User-committed tasks (MUST include ALL of these in the plan \u2014 you may refine the wording for clarity but do not drop or skip any):
` + existingTasks.map((t) => `- ${t.title}${t.description ? `: ${t.description}` : ""}`).join("\n") + `
These count toward your task total. Add goal-aligned tasks to reach 5-8 total.` : "";
  const carriedOverSection = carriedOverTasks && carriedOverTasks.length > 0 ? `
Carried-over tasks (incomplete from previous days \u2014 MUST include all of them; consider breaking into a smaller first step if they've been skipped multiple days):
` + carriedOverTasks.map((t) => `- ${t.title} (${t.category}, skipped ${t.skipDays} day${t.skipDays > 1 ? "s" : ""})`).join("\n") : "";
  const blockedSection = blockedTasks2 && blockedTasks2.length > 0 ? `
Chronically stuck tasks (skipped 2+ days in a row \u2014 do NOT just repeat them verbatim; instead include a concrete "prepare to tackle" micro-task or a broken-down first step):
` + blockedTasks2.map((t) => `- "${t.title}" (stuck ${t.skipDays} days${t.blockerType ? `, blocker: ${t.blockerType.replace("_", " ")}` : ""})`).join("\n") : "";
  const { buildAiContextSections: buildAiContextSections2 } = await Promise.resolve().then(() => (init_promptContext(), promptContext_exports));
  const seedQuery = [
    lifeContext2?.priorityGoal,
    lifeContext2?.improvementArea,
    ...goals2.slice(0, 3).map((g) => g.title)
  ].filter(Boolean).join(" \u2022 ");
  const { soulSection, patternSection, memorySection } = await buildAiContextSections2(req.userId, seedQuery);
  const prompt = `You create personalized daily task plans for people. Today is ${dayOfWeek}.${soulSection}${patternSection}${memorySection}

User's goals:
${goalsText}

Recent activity:
${historyText}${energyFocusText}${soulSection ? "" : lifeCtxSectionRaw}${gmailSection}${existingTasksSection}${carriedOverSection}${blockedSection}

Create a daily plan with 5-8 tasks. For each task provide:
- title: short, action-oriented task name
- category: one of "calendar", "fitness", "finance", "career", "personal", "social"
- priority: "high", "medium", or "low"
- time: suggested time like "7:00 AM", "9:30 AM", etc.
- description: one-line helpful context
- goalId: (optional) the id from the goals list above (e.g. "id:abc123") if this task directly works toward that specific goal \u2014 omit for general tasks

Rules:
- Align tasks with the user's goals
- When a task directly advances a specific goal (e.g. a fitness task for a running goal), set goalId to that goal's id (the value in [id:...])
- If they've been skipping fitness tasks, make fitness tasks easier/shorter
- If they've been completing everything, add one slightly challenging stretch task
- Include at least one personal/wellness task
- On weekends (Saturday/Sunday), lean more toward personal and social tasks
- Keep task names concise and starting with a verb
- Also include an "insight" \u2014 a brief motivational or strategic observation about their patterns

Return ONLY a JSON object with "tasks" array and "insight" string. No other text.`;
  const response = await openai3.chat.completions.create({
    model: "gpt-5-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    max_completion_tokens: 8192
  });
  const content = response.choices[0]?.message?.content || '{"tasks":[],"insight":""}';
  try {
    const parsed = JSON.parse(content);
    return {
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      insight: parsed.insight || "Start small, stay consistent."
    };
  } catch {
    return { tasks: [], insight: "Start small, stay consistent." };
  }
}
var openai3;
var init_ai = __esm({
  "server/ai.ts"() {
    "use strict";
    openai3 = new OpenAI3({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
    });
  }
});

// server/integrations/googleCalendar.ts
import { google } from "googleapis";
async function getProjectAccessToken() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY ? "repl " + process.env.REPL_IDENTITY : process.env.WEB_REPL_RENEWAL ? "depl " + process.env.WEB_REPL_RENEWAL : null;
  if (!xReplitToken) throw new Error("X-Replit-Token not available");
  const connectionSettings = await fetch(
    "https://" + hostname + "/api/v2/connection?include_secrets=true&connector_names=google-calendar",
    { headers: { Accept: "application/json", "X-Replit-Token": xReplitToken } }
  ).then((res) => res.json()).then((data) => data.items?.[0]);
  const accessToken = connectionSettings?.settings?.access_token || connectionSettings?.settings?.oauth?.credentials?.access_token;
  if (!accessToken) throw new Error("Google Calendar not connected");
  return accessToken;
}
function buildCalendarClient(accessToken) {
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.calendar({ version: "v3", auth: oauth2Client });
}
async function getGoogleCalendarEvents(date2, startTime, endTime, userAccessToken) {
  const accessToken = userAccessToken ?? await getProjectAccessToken();
  const calendar = buildCalendarClient(accessToken);
  const startOfDay = startTime ? new Date(startTime) : /* @__PURE__ */ new Date(date2 + "T00:00:00Z");
  const endOfDay = endTime ? new Date(endTime) : /* @__PURE__ */ new Date(date2 + "T23:59:59Z");
  const calList = await calendar.calendarList.list({ minAccessRole: "reader" });
  const calendarIds = (calList.data.items || []).filter((c) => !c.deleted).map((c) => c.id).filter(Boolean);
  console.log(`[Calendar] Found ${calendarIds.length} calendar(s) for token. Querying ${startOfDay.toISOString()} \u2192 ${endOfDay.toISOString()}`);
  const allEvents = [];
  const seenIds = /* @__PURE__ */ new Set();
  await Promise.all(
    calendarIds.map(async (calId) => {
      try {
        const res = await calendar.events.list({
          calendarId: calId,
          timeMin: startOfDay.toISOString(),
          timeMax: endOfDay.toISOString(),
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 20
        });
        const items = res.data.items || [];
        console.log(`[Calendar] Cal "${calId}": ${items.length} event(s)`);
        items.filter((e) => e.summary && !seenIds.has(e.id || "")).forEach((e) => {
          seenIds.add(e.id || "");
          const attendees = (e.attendees || []).filter((a) => a.email).map((a) => ({
            email: String(a.email),
            displayName: a.displayName || void 0,
            organizer: !!a.organizer,
            self: !!a.self
          }));
          allEvents.push({
            id: e.id || String(Math.random()),
            title: e.summary || "Event",
            start: e.start?.dateTime || e.start?.date || date2,
            end: e.end?.dateTime || e.end?.date || date2,
            description: e.description || void 0,
            location: e.location || void 0,
            attendees: attendees.length > 0 ? attendees : void 0
          });
        });
      } catch (err) {
        console.error(`[Calendar] Error fetching events for cal "${calId}":`, err?.message || err);
      }
    })
  );
  allEvents.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  return allEvents;
}
async function checkGoogleCalendarConnection(userAccessToken) {
  try {
    if (userAccessToken) return true;
    await getProjectAccessToken();
    return true;
  } catch {
    return false;
  }
}
async function createGoogleCalendarEvent(accessToken, event) {
  const calendar = buildCalendarClient(accessToken);
  const startDt = event.start.includes("T") ? event.start : event.start + "T00:00:00Z";
  const endDt = event.end.includes("T") ? event.end : event.end + "T01:00:00Z";
  const res = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: event.title,
      description: event.description || void 0,
      location: event.location || void 0,
      start: { dateTime: startDt },
      end: { dateTime: endDt }
    }
  });
  return { id: res.data.id || "", htmlLink: res.data.htmlLink || "" };
}
var init_googleCalendar = __esm({
  "server/integrations/googleCalendar.ts"() {
    "use strict";
  }
});

// server/integrations/outlook.ts
var outlook_exports = {};
__export(outlook_exports, {
  checkOutlookConnection: () => checkOutlookConnection,
  createOutlookCalendarEvent: () => createOutlookCalendarEvent,
  getOutlookCalendarEvents: () => getOutlookCalendarEvents,
  getRecentOutlookEmails: () => getRecentOutlookEmails,
  sendOutlookEmail: () => sendOutlookEmail
});
import { Client } from "@microsoft/microsoft-graph-client";
function ensureUtc(dateTime) {
  if (/Z$|[+-]\d{2}:\d{2}$/.test(dateTime)) return dateTime;
  return dateTime + "Z";
}
async function getProjectAccessToken2() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY ? "repl " + process.env.REPL_IDENTITY : process.env.WEB_REPL_RENEWAL ? "depl " + process.env.WEB_REPL_RENEWAL : null;
  if (!xReplitToken) throw new Error("X-Replit-Token not available");
  const connectionSettings = await fetch(
    "https://" + hostname + "/api/v2/connection?include_secrets=true&connector_names=outlook",
    { headers: { Accept: "application/json", "X-Replit-Token": xReplitToken } }
  ).then((res) => res.json()).then((data) => data.items?.[0]);
  const accessToken = connectionSettings?.settings?.access_token || connectionSettings?.settings?.oauth?.credentials?.access_token;
  if (!accessToken) throw new Error("Outlook not connected");
  return accessToken;
}
function buildOutlookClient(accessToken) {
  return Client.initWithMiddleware({
    authProvider: { getAccessToken: async () => accessToken }
  });
}
async function getOutlookCalendarEvents(date2, startTime, endTime, userAccessToken) {
  const accessToken = userAccessToken ?? await getProjectAccessToken2();
  const client = buildOutlookClient(accessToken);
  const startOfDay = startTime ? new Date(startTime).toISOString() : (/* @__PURE__ */ new Date(date2 + "T00:00:00")).toISOString();
  const endOfDay = endTime ? new Date(endTime).toISOString() : (/* @__PURE__ */ new Date(date2 + "T23:59:59")).toISOString();
  const res = await client.api("/me/calendarView").query({ startDateTime: startOfDay, endDateTime: endOfDay }).header("Prefer", 'outlook.timezone="UTC"').select("id,subject,start,end,body,location").orderby("start/dateTime").top(20).get();
  const items = res.value || [];
  return items.map((e) => ({
    id: e.id || String(Math.random()),
    title: e.subject || "Event",
    start: e.start?.dateTime ? ensureUtc(e.start.dateTime) : date2,
    end: e.end?.dateTime ? ensureUtc(e.end.dateTime) : date2,
    description: e.body?.content ? e.body.content.replace(/<[^>]+>/g, "").trim().slice(0, 120) : void 0,
    location: e.location?.displayName || void 0
  }));
}
async function checkOutlookConnection(userAccessToken) {
  try {
    if (userAccessToken) return true;
    await getProjectAccessToken2();
    return true;
  } catch {
    return false;
  }
}
async function createOutlookCalendarEvent(userAccessToken, event) {
  const client = buildOutlookClient(userAccessToken);
  const startDt = event.start.includes("T") ? ensureUtc(event.start) : event.start + "T00:00:00Z";
  const endDt = event.end.includes("T") ? ensureUtc(event.end) : event.end + "T01:00:00Z";
  const body = {
    subject: event.title,
    start: { dateTime: startDt.slice(0, 19), timeZone: "UTC" },
    end: { dateTime: endDt.slice(0, 19), timeZone: "UTC" }
  };
  if (event.description) body.body = { contentType: "text", content: event.description };
  if (event.location) body.location = { displayName: event.location };
  const res = await client.api("/me/events").post(body);
  return { id: res.id || "" };
}
async function sendOutlookEmail(userAccessToken, to, subject, body) {
  const client = buildOutlookClient(userAccessToken);
  await client.api("/me/sendMail").post({
    message: {
      subject,
      body: { contentType: "text", content: body },
      toRecipients: [{ emailAddress: { address: to } }]
    },
    saveToSentItems: true
  });
}
async function getRecentOutlookEmails(userAccessToken, count = 10) {
  const client = buildOutlookClient(userAccessToken);
  const res = await client.api("/me/messages").select("id,subject,from,bodyPreview,receivedDateTime,isRead").orderby("receivedDateTime desc").top(Math.min(count, 25)).get();
  const items = res.value || [];
  return items.map((m) => ({
    id: m.id || "",
    subject: m.subject || "(no subject)",
    from: m.from?.emailAddress?.address || "unknown",
    snippet: (m.bodyPreview || "").slice(0, 150),
    date: m.receivedDateTime || "",
    isRead: !!m.isRead
  }));
}
var init_outlook = __esm({
  "server/integrations/outlook.ts"() {
    "use strict";
  }
});

// server/integrations/gmailClient.ts
import { google as google2 } from "googleapis";
async function getProjectAccessToken3() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY ? "repl " + process.env.REPL_IDENTITY : process.env.WEB_REPL_RENEWAL ? "depl " + process.env.WEB_REPL_RENEWAL : null;
  if (!xReplitToken) throw new Error("X-Replit-Token not available");
  const connectionSettings = await fetch(
    "https://" + hostname + "/api/v2/connection?include_secrets=true&connector_names=google-mail",
    { headers: { Accept: "application/json", "X-Replit-Token": xReplitToken } }
  ).then((res) => res.json()).then((data) => data.items?.[0]);
  const accessToken = connectionSettings?.settings?.access_token || connectionSettings?.settings?.oauth?.credentials?.access_token;
  if (!accessToken) throw new Error("Gmail not connected");
  return accessToken;
}
async function getGmailClient(userAccessToken) {
  const accessToken = userAccessToken ?? await getProjectAccessToken3();
  const oauth2Client = new google2.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google2.gmail({ version: "v1", auth: oauth2Client });
}
var init_gmailClient = __esm({
  "server/integrations/gmailClient.ts"() {
    "use strict";
  }
});

// server/integrations/gmail.ts
var gmail_exports = {};
__export(gmail_exports, {
  checkGmailConnection: () => checkGmailConnection,
  createGmailDraft: () => createGmailDraft,
  getEmailsSince: () => getEmailsSince,
  getRecentEmailCommitments: () => getRecentEmailCommitments,
  getStarredFollowUpEmails: () => getStarredFollowUpEmails,
  gmailModifyMessage: () => gmailModifyMessage,
  sendGmailEmail: () => sendGmailEmail
});
import { Buffer as Buffer2 } from "node:buffer";
async function createGmailDraft(userAccessToken, to, subject, body) {
  const gmail = await getGmailClient(userAccessToken);
  const messageParts = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    body
  ].join("\r\n");
  const encodedMessage = Buffer2.from(messageParts).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const res = await gmail.users.drafts.create({
    userId: "me",
    requestBody: {
      message: {
        raw: encodedMessage
      }
    }
  });
  const draftId = res.data.id || "";
  const messageId = res.data.message?.id || "";
  const gmailUrl = `https://mail.google.com/mail/#drafts/${messageId}`;
  return { draftId, gmailUrl };
}
async function getEmailsSince(sinceMs, userAccessToken) {
  try {
    const gmail = await getGmailClient(userAccessToken);
    const sinceSeconds = Math.floor(sinceMs / 1e3);
    const listRes = await gmail.users.messages.list({
      userId: "me",
      q: `in:inbox -from:me after:${sinceSeconds}`,
      maxResults: 20
    });
    const messages = listRes.data.messages || [];
    if (messages.length === 0) return [];
    const results = [];
    const BATCH_SIZE = 10;
    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const batch = messages.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (msg) => {
          if (!msg.id) return null;
          try {
            const detail = await gmail.users.messages.get({
              userId: "me",
              id: msg.id,
              format: "metadata",
              metadataHeaders: ["Subject", "From", "Date"]
            });
            const headers = detail.data.payload?.headers || [];
            const subject = headers.find((h) => h.name === "Subject")?.value || "(no subject)";
            const from = headers.find((h) => h.name === "From")?.value || "unknown";
            const snippet = (detail.data.snippet || "").slice(0, 200);
            const receivedAt = parseInt(detail.data.internalDate || "0", 10);
            const labelIds = detail.data.labelIds || [];
            if (labelIds.includes("SENT") || labelIds.includes("DRAFT")) return null;
            return { messageId: msg.id, subject, from, snippet, receivedAt };
          } catch {
            return null;
          }
        })
      );
      for (const r of batchResults) {
        if (r) results.push(r);
      }
    }
    return results;
  } catch (err) {
    console.error("[Gmail] getEmailsSince error:", err);
    return [];
  }
}
async function checkGmailConnection(userAccessToken) {
  try {
    await getGmailClient(userAccessToken);
    return true;
  } catch {
    return false;
  }
}
async function getRecentEmailCommitments(days = 7, userAccessToken) {
  try {
    const gmail = await getGmailClient(userAccessToken);
    const afterDate = /* @__PURE__ */ new Date();
    afterDate.setDate(afterDate.getDate() - days);
    const afterDateStr = afterDate.toISOString().slice(0, 10).replace(/-/g, "/");
    const listRes = await gmail.users.messages.list({
      userId: "me",
      q: `after:${afterDateStr}`,
      maxResults: 100
    });
    const messages = (listRes.data.messages || []).slice(0, 100);
    const results = [];
    const BATCH_SIZE = 10;
    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const batch = messages.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (msg) => {
          if (!msg.id) return null;
          try {
            const detail = await gmail.users.messages.get({
              userId: "me",
              id: msg.id,
              format: "metadata",
              metadataHeaders: ["Subject", "Date", "From"]
            });
            const headers = detail.data.payload?.headers || [];
            const subject = headers.find((h) => h.name === "Subject")?.value || "(no subject)";
            const date2 = headers.find((h) => h.name === "Date")?.value || "";
            const from = headers.find((h) => h.name === "From")?.value || "";
            const snippet = (detail.data.snippet || "").slice(0, 150);
            const labelIds = detail.data.labelIds || [];
            const labels = labelIds.map((id) => LABEL_NAMES[id] || id);
            return { id: msg.id, subject, snippet, date: date2, from, labels };
          } catch {
            return null;
          }
        })
      );
      for (const r of batchResults) {
        if (r) results.push(r);
      }
    }
    return results;
  } catch (err) {
    console.error("[Gmail] getRecentEmailCommitments error:", err);
    return [];
  }
}
async function getStarredFollowUpEmails(userAccessToken, minAgeDays = 3) {
  try {
    const gmail = await getGmailClient(userAccessToken);
    const fourteenDaysAgo = Math.floor((Date.now() - 14 * 24 * 60 * 60 * 1e3) / 1e3);
    const listRes = await gmail.users.messages.list({
      userId: "me",
      q: `in:inbox (is:starred OR is:important) -from:me after:${fourteenDaysAgo}`,
      maxResults: 20
    });
    const messages = listRes.data.messages || [];
    if (messages.length === 0) return [];
    const results = [];
    const nowMs = Date.now();
    const minAgeMs = minAgeDays * 24 * 60 * 60 * 1e3;
    const BATCH_SIZE = 10;
    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const batch = messages.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (msg) => {
          if (!msg.id) return null;
          try {
            const detail = await gmail.users.messages.get({
              userId: "me",
              id: msg.id,
              format: "metadata",
              metadataHeaders: ["Subject", "From", "Date"]
            });
            const headers = detail.data.payload?.headers || [];
            const subject = headers.find((h) => h.name === "Subject")?.value || "(no subject)";
            const from = headers.find((h) => h.name === "From")?.value || "unknown";
            const snippet = (detail.data.snippet || "").slice(0, 200);
            const receivedAt = parseInt(detail.data.internalDate || "0", 10);
            const labelIds = detail.data.labelIds || [];
            if (!labelIds.includes("INBOX")) return null;
            if (labelIds.includes("SENT") || labelIds.includes("DRAFT")) return null;
            const ageMs = nowMs - receivedAt;
            if (ageMs < minAgeMs) return null;
            const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1e3));
            return { messageId: msg.id, subject, from, snippet, receivedAt, ageDays };
          } catch {
            return null;
          }
        })
      );
      for (const r of batchResults) {
        if (r) results.push(r);
      }
    }
    results.sort((a, b) => a.receivedAt - b.receivedAt);
    return results;
  } catch (err) {
    console.error("[Gmail] getStarredFollowUpEmails error:", err);
    return [];
  }
}
async function gmailModifyMessage(messageId, addLabelIds, removeLabelIds, userAccessToken) {
  const gmail = await getGmailClient(userAccessToken);
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: {
      addLabelIds: addLabelIds.length > 0 ? addLabelIds : void 0,
      removeLabelIds: removeLabelIds.length > 0 ? removeLabelIds : void 0
    }
  });
}
async function sendGmailEmail(userAccessToken, to, subject, body) {
  const gmail = await getGmailClient(userAccessToken);
  const messageParts = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    body
  ].join("\r\n");
  const encodedMessage = Buffer2.from(messageParts).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: encodedMessage }
  });
  return { messageId: res.data.id || "" };
}
var LABEL_NAMES;
var init_gmail = __esm({
  "server/integrations/gmail.ts"() {
    "use strict";
    init_gmailClient();
    LABEL_NAMES = {
      STARRED: "\u2B50 Starred",
      INBOX: "Inbox",
      IMPORTANT: "Important",
      CATEGORY_PERSONAL: "Personal",
      CATEGORY_UPDATES: "Updates",
      CATEGORY_PROMOTIONS: "Promotions",
      CATEGORY_SOCIAL: "Social",
      CATEGORY_FORUMS: "Forums",
      SENT: "Sent",
      DRAFT: "Draft"
    };
  }
});

// server/integrations/slack.ts
async function slackApi(endpoint, accessToken, params = {}) {
  const url = new URL(`https://slack.com/api/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Slack API error (${endpoint}): ${data.error || "unknown"}`);
  }
  return data;
}
async function resolveUserNames(accessToken, userIds) {
  const unique = [...new Set(userIds)];
  const nameMap = {};
  await Promise.all(
    unique.map(async (uid) => {
      try {
        const data = await slackApi("users.info", accessToken, { user: uid });
        const u = data.user;
        nameMap[uid] = u?.profile?.display_name || u?.real_name || u?.name || uid;
      } catch {
        nameMap[uid] = uid;
      }
    })
  );
  return nameMap;
}
async function getSlackMessages(accessToken) {
  const sevenDaysAgo = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1e3) / 1e3);
  const convData = await slackApi("conversations.list", accessToken, {
    types: "public_channel,private_channel,im,mpim",
    exclude_archived: "true",
    limit: "200"
  });
  const conversations = convData.channels || [];
  const withActivity = conversations.filter((c) => c.updated && c.updated > sevenDaysAgo).sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 5);
  if (withActivity.length === 0) return [];
  const allMessages = [];
  const userIdsToResolve = [];
  await Promise.all(
    withActivity.map(async (conv) => {
      try {
        const histData = await slackApi("conversations.history", accessToken, {
          channel: conv.id,
          oldest: sevenDaysAgo.toString(),
          limit: "30"
        });
        const msgs = histData.messages || [];
        for (const msg of msgs) {
          if (msg.bot_id) continue;
          if (msg.subtype && msg.subtype !== "me_message") continue;
          if (!msg.text || !msg.text.trim()) continue;
          if (!msg.ts) continue;
          const ts = parseFloat(msg.ts);
          if (ts < sevenDaysAgo) continue;
          if (msg.user) userIdsToResolve.push(msg.user);
          const channelType = conv.is_im ? "dm" : conv.is_group || conv.is_mpim ? "group" : "channel";
          allMessages.push({
            channel: conv.name || conv.id,
            channelType,
            user: msg.user || "unknown",
            text: msg.text.slice(0, 500),
            timestamp: new Date(ts * 1e3).toISOString()
          });
        }
      } catch (err) {
        console.error(`Failed to fetch history for channel ${conv.id}:`, err);
      }
    })
  );
  const nameMap = await resolveUserNames(accessToken, userIdsToResolve);
  for (const msg of allMessages) {
    if (nameMap[msg.user]) {
      msg.user = nameMap[msg.user];
    }
  }
  allMessages.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return allMessages;
}
var init_slack = __esm({
  "server/integrations/slack.ts"() {
    "use strict";
  }
});

// server/auth.ts
import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { eq as eq3 } from "drizzle-orm";
import crypto from "crypto";
function getJwtSecret() {
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }
  const generated = crypto.randomBytes(32).toString("hex");
  process.env.JWT_SECRET = generated;
  console.log("Generated JWT_SECRET (set JWT_SECRET env var for persistent tokens across restarts)");
  return generated;
}
function generateToken(userId2) {
  return jwt.sign({ userId: userId2 }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}
function authMiddleware(req, res, next) {
  if (req.path.startsWith("/api/auth/")) {
    return next();
  }
  if (req.path === "/api/oauth/google/callback" || req.path === "/api/oauth/microsoft/callback") {
    return next();
  }
  if (!req.path.startsWith("/api/")) {
    return next();
  }
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }
  try {
    const token = authHeader.slice(7);
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
var JWT_SECRET, TOKEN_EXPIRY, authRouter;
var init_auth = __esm({
  "server/auth.ts"() {
    "use strict";
    init_db();
    init_schema();
    JWT_SECRET = getJwtSecret();
    TOKEN_EXPIRY = "30d";
    authRouter = Router();
    authRouter.post("/register", async (req, res) => {
      try {
        const { username, password } = req.body;
        if (!username || !password) {
          return res.status(400).json({ error: "Username and password are required" });
        }
        if (username.length < 3) {
          return res.status(400).json({ error: "Username must be at least 3 characters" });
        }
        if (password.length < 6) {
          return res.status(400).json({ error: "Password must be at least 6 characters" });
        }
        const existing = await db.select().from(users).where(eq3(users.username, username)).limit(1);
        if (existing.length > 0) {
          return res.status(409).json({ error: "Username already taken" });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const [user] = await db.insert(users).values({
          username,
          password: hashedPassword
        }).returning();
        const token = generateToken(user.id);
        res.status(201).json({
          token,
          userId: user.id,
          username: user.username
        });
      } catch (error) {
        console.error("Registration error:", error);
        res.status(500).json({ error: "Failed to create account" });
      }
    });
    authRouter.post("/login", async (req, res) => {
      try {
        const { username, password } = req.body;
        if (!username || !password) {
          return res.status(400).json({ error: "Username and password are required" });
        }
        const [user] = await db.select().from(users).where(eq3(users.username, username)).limit(1);
        if (!user) {
          return res.status(401).json({ error: "Invalid username or password" });
        }
        if (!user.password) {
          return res.status(401).json({ error: "This account uses Google Sign-In" });
        }
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) {
          return res.status(401).json({ error: "Invalid username or password" });
        }
        const token = generateToken(user.id);
        res.json({
          token,
          userId: user.id,
          username: user.username
        });
      } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ error: "Failed to log in" });
      }
    });
    authRouter.post("/google", async (req, res) => {
      try {
        const { idToken, accessToken } = req.body;
        if (!idToken && !accessToken) {
          return res.status(400).json({ error: "ID token or access token is required" });
        }
        let googleUser;
        if (idToken) {
          const tokenInfoRes = await fetch(
            `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`
          );
          if (!tokenInfoRes.ok) {
            return res.status(401).json({ error: "Invalid Google ID token" });
          }
          const tokenInfo = await tokenInfoRes.json();
          if (tokenInfo.error_description) {
            return res.status(401).json({ error: "Invalid Google ID token" });
          }
          const validClientIds = [
            process.env.GOOGLE_WEB_CLIENT_ID,
            process.env.GOOGLE_IOS_CLIENT_ID,
            process.env.GOOGLE_ANDROID_CLIENT_ID
          ].filter(Boolean);
          if (validClientIds.length > 0 && tokenInfo.aud && !validClientIds.includes(tokenInfo.aud)) {
            return res.status(401).json({ error: "Token audience mismatch" });
          }
          if (!tokenInfo.sub) {
            return res.status(401).json({ error: "Could not retrieve Google user info" });
          }
          googleUser = { id: tokenInfo.sub, name: tokenInfo.name, email: tokenInfo.email };
        } else {
          const userInfoRes = await fetch(
            `https://www.googleapis.com/userinfo/v2/me`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (!userInfoRes.ok) {
            return res.status(401).json({ error: "Invalid Google access token" });
          }
          const info = await userInfoRes.json();
          if (!info.id) {
            return res.status(401).json({ error: "Could not retrieve Google user info" });
          }
          googleUser = info;
        }
        if (!googleUser.id) {
          return res.status(401).json({ error: "Could not retrieve Google user info" });
        }
        const existing = await db.select().from(users).where(eq3(users.googleId, googleUser.id)).limit(1);
        let user;
        if (existing.length > 0) {
          user = existing[0];
          if (googleUser.name && googleUser.name !== user.displayName) {
            await db.update(users).set({ displayName: googleUser.name }).where(eq3(users.id, user.id));
            user = { ...user, displayName: googleUser.name };
          }
        } else {
          const username = googleUser.email ? googleUser.email.split("@")[0] : `google_${googleUser.id.slice(0, 8)}`;
          let uniqueUsername = username;
          const existingUsername = await db.select().from(users).where(eq3(users.username, username)).limit(1);
          if (existingUsername.length > 0) {
            uniqueUsername = `${username}_${Date.now().toString(36)}`;
          }
          const [newUser] = await db.insert(users).values({
            username: uniqueUsername,
            googleId: googleUser.id,
            displayName: googleUser.name || uniqueUsername
          }).returning();
          user = newUser;
        }
        const token = generateToken(user.id);
        res.json({
          token,
          userId: user.id,
          username: user.displayName || user.username
        });
      } catch (error) {
        console.error("Google auth error:", error);
        res.status(500).json({ error: "Failed to authenticate with Google" });
      }
    });
    authRouter.get("/me", async (req, res) => {
      try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith("Bearer ")) {
          return res.status(401).json({ error: "No token provided" });
        }
        const token = authHeader.slice(7);
        const payload = jwt.verify(token, JWT_SECRET);
        const [user] = await db.select({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          createdAt: users.createdAt
        }).from(users).where(eq3(users.id, payload.userId)).limit(1);
        if (!user) {
          return res.status(401).json({ error: "User not found" });
        }
        res.json({
          userId: user.id,
          username: user.displayName || user.username
        });
      } catch (error) {
        return res.status(401).json({ error: "Invalid token" });
      }
    });
  }
});

// server/mobileAuthRoutes.ts
import { Router as Router2 } from "express";
import { eq as eq4, lt } from "drizzle-orm";
function getCallbackUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.get("host") || "";
  return `${proto}://${host}/api/auth/mobile/callback`;
}
function successHtml(token) {
  const encodedToken = encodeURIComponent(token);
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Signed In \u2014 GamePlan</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f0f0f; color: #fff;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; padding: 20px;
    }
    .card { text-align: center; max-width: 340px; }
    .icon { font-size: 56px; margin-bottom: 20px; }
    h2 { font-size: 22px; font-weight: 700; margin-bottom: 10px; }
    p { color: #888; font-size: 15px; line-height: 1.5; }
    .dots { display: inline-flex; gap: 6px; margin-top: 24px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #6366f1;
           animation: pulse 1.2s ease-in-out infinite; }
    .dot:nth-child(2) { animation-delay: 0.2s; }
    .dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes pulse { 0%,80%,100% { opacity: 0.3; } 40% { opacity: 1; } }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">\u2705</div>
    <h2>Signed in successfully</h2>
    <p>Taking you back to GamePlan...</p>
    <div class="dots">
      <div class="dot"></div>
      <div class="dot"></div>
      <div class="dot"></div>
    </div>
  </div>
  <script>
    try {
      window.location.href = 'gameplan://auth/complete?token=${encodedToken}';
    } catch(e) {}
  </script>
</body>
</html>`;
}
function errorHtml(message) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Error \u2014 GamePlan</title>
  <style>
    body { font-family: sans-serif; background: #0f0f0f; color: #fff;
           display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { text-align: center; padding: 40px; }
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size:48px;margin-bottom:16px">\u274C</div>
    <h2>Sign-in Failed</h2>
    <p style="color:#888;margin-top:8px">${message}</p>
    <p style="color:#555;margin-top:20px;font-size:13px">You can close this tab and try again.</p>
  </div>
</body>
</html>`;
}
var mobileAuthRouter;
var init_mobileAuthRoutes = __esm({
  "server/mobileAuthRoutes.ts"() {
    "use strict";
    init_db();
    init_schema();
    init_auth();
    mobileAuthRouter = Router2();
    mobileAuthRouter.get("/start", (req, res) => {
      const { session_id } = req.query;
      if (!session_id) return res.status(400).json({ error: "session_id required" });
      const clientId = process.env.GOOGLE_WEB_CLIENT_ID;
      if (!clientId) return res.status(500).json({ error: "Google OAuth not configured" });
      const callbackUrl = getCallbackUrl(req);
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: callbackUrl,
        response_type: "code",
        scope: "openid email profile",
        state: session_id,
        access_type: "offline",
        prompt: "select_account"
      });
      res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
    });
    mobileAuthRouter.get("/callback", async (req, res) => {
      const { code, state: session_id, error } = req.query;
      if (error || !code || !session_id) {
        return res.send(errorHtml(error || "Sign-in was cancelled."));
      }
      const clientId = process.env.GOOGLE_WEB_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        return res.send(errorHtml("OAuth credentials not configured on the server."));
      }
      const callbackUrl = getCallbackUrl(req);
      try {
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: callbackUrl,
            grant_type: "authorization_code"
          })
        });
        const tokenData = await tokenRes.json();
        if (!tokenData.id_token && !tokenData.access_token) {
          console.error("Mobile auth token exchange failed:", tokenData);
          return res.send(errorHtml("Failed to exchange authorization code. Please try again."));
        }
        let googleUser;
        if (tokenData.id_token) {
          const infoRes = await fetch(
            `https://oauth2.googleapis.com/tokeninfo?id_token=${tokenData.id_token}`
          );
          const info = await infoRes.json();
          if (!info.sub) return res.send(errorHtml("Could not retrieve Google user info."));
          googleUser = { id: info.sub, name: info.name, email: info.email };
        } else {
          const infoRes = await fetch("https://www.googleapis.com/userinfo/v2/me", {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
          });
          const info = await infoRes.json();
          if (!info.id) return res.send(errorHtml("Could not retrieve Google user info."));
          googleUser = { id: info.id, name: info.name, email: info.email };
        }
        const existing = await db.select().from(users).where(eq4(users.googleId, googleUser.id)).limit(1);
        let user;
        if (existing.length > 0) {
          user = existing[0];
        } else {
          const base = googleUser.email ? googleUser.email.split("@")[0] : `google_${googleUser.id.slice(0, 8)}`;
          let uniqueUsername = base;
          const existingUsername = await db.select().from(users).where(eq4(users.username, base)).limit(1);
          if (existingUsername.length > 0) uniqueUsername = `${base}_${Date.now().toString(36)}`;
          const [newUser] = await db.insert(users).values({
            username: uniqueUsername,
            googleId: googleUser.id,
            displayName: googleUser.name || uniqueUsername
          }).returning();
          user = newUser;
        }
        const token = generateToken(user.id);
        const expiresAt = new Date(Date.now() + 10 * 60 * 1e3);
        await db.insert(mobileAuthSessions).values({
          sessionId: session_id,
          token,
          expiresAt
        }).onConflictDoUpdate({
          target: mobileAuthSessions.sessionId,
          set: { token, expiresAt }
        });
        return res.send(successHtml(token));
      } catch (err) {
        console.error("Mobile auth callback error:", err);
        return res.send(errorHtml("An unexpected error occurred. Please try again."));
      }
    });
    mobileAuthRouter.get("/poll", async (req, res) => {
      const { session_id } = req.query;
      if (!session_id) return res.status(400).json({ error: "session_id required" });
      try {
        await db.delete(mobileAuthSessions).where(lt(mobileAuthSessions.expiresAt, /* @__PURE__ */ new Date()));
        const rows = await db.select().from(mobileAuthSessions).where(eq4(mobileAuthSessions.sessionId, session_id)).limit(1);
        if (rows.length === 0) {
          return res.status(404).json({ ready: false });
        }
        const session = rows[0];
        await db.delete(mobileAuthSessions).where(eq4(mobileAuthSessions.sessionId, session_id));
        return res.json({ ready: true, token: session.token });
      } catch (err) {
        console.error("Mobile auth poll error:", err);
        return res.status(500).json({ ready: false, error: "Internal error" });
      }
    });
  }
});

// server/goalScheduler.ts
var goalScheduler_exports = {};
__export(goalScheduler_exports, {
  getInjectableGoalTasks: () => getInjectableGoalTasks,
  markTasksInjected: () => markTasksInjected,
  markTreeTaskComplete: () => markTreeTaskComplete
});
import { eq as eq5, and as and2 } from "drizzle-orm";
function isTaskActionable(t) {
  return t.status === "ready" || t.status === "in_progress";
}
function nextActionableTasksFromTree(tree) {
  const out = [];
  outer: for (const phase of tree.phases) {
    if (phase.status === "complete") continue;
    for (const ms of phase.milestones) {
      if (ms.status === "complete") continue;
      for (const t of ms.tasks) {
        if (isTaskActionable(t)) {
          out.push(t);
          if (out.length >= 3) break outer;
        }
      }
      if (out.length > 0) break;
    }
    if (out.length > 0) break;
  }
  return out;
}
async function recentCompletionRate(userId2) {
  try {
    const [row] = await db.select({ data: completionHistory.data }).from(completionHistory).where(eq5(completionHistory.userId, userId2)).limit(1);
    const arr = row?.data || [];
    if (arr.length === 0) return 1;
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1e3;
    const recent = arr.filter((h) => {
      if (!h.date) return false;
      return new Date(h.date).getTime() >= sevenDaysAgo;
    });
    if (recent.length === 0) return 1;
    const done = recent.filter((h) => h.completed).length;
    return done / recent.length;
  } catch {
    return 1;
  }
}
async function getInjectableGoalTasks(userId2, dateKey) {
  const trees = await db.select().from(goalTrees).where(and2(eq5(goalTrees.userId, userId2), eq5(goalTrees.status, "active")));
  if (trees.length === 0) return [];
  const rate = await recentCompletionRate(userId2);
  const dailyCap = rate < 0.5 ? 1 : 3;
  const candidates = [];
  for (const row of trees) {
    const tree = row.tree || { phases: [] };
    const next = nextActionableTasksFromTree(tree);
    for (const t of next) {
      if (Array.isArray(t.injectedOnDates) && t.injectedOnDates.includes(dateKey)) continue;
      let phaseId = "";
      let milestoneId = "";
      for (const ph of tree.phases) {
        const ms = ph.milestones.find((m) => m.tasks.some((tt) => tt.id === t.id));
        if (ms) {
          phaseId = ph.id;
          milestoneId = ms.id;
          break;
        }
      }
      candidates.push({
        goalTreeId: row.id,
        goalTitle: row.title,
        phaseId,
        milestoneId,
        taskId: t.id,
        title: t.title,
        description: t.description,
        estimateHours: t.estimateHours
      });
      if (candidates.length >= dailyCap) break;
    }
    if (candidates.length >= dailyCap) break;
  }
  return candidates;
}
async function markTasksInjected(userId2, picks, dateKey) {
  if (picks.length === 0) return;
  const byTree = /* @__PURE__ */ new Map();
  for (const p of picks) {
    const list = byTree.get(p.goalTreeId) || [];
    list.push(p);
    byTree.set(p.goalTreeId, list);
  }
  for (const [treeId, items] of byTree.entries()) {
    const [row] = await db.select().from(goalTrees).where(and2(eq5(goalTrees.id, treeId), eq5(goalTrees.userId, userId2))).limit(1);
    if (!row) continue;
    const tree = row.tree || { phases: [] };
    const ids = new Set(items.map((i) => i.taskId));
    let mutated = false;
    for (const ph of tree.phases) {
      for (const ms of ph.milestones) {
        for (const t of ms.tasks) {
          if (ids.has(t.id)) {
            const dates = Array.isArray(t.injectedOnDates) ? t.injectedOnDates : [];
            if (!dates.includes(dateKey)) {
              t.injectedOnDates = [...dates, dateKey];
              mutated = true;
            }
            if (t.status === "ready") {
              t.status = "in_progress";
              mutated = true;
            }
          }
        }
      }
    }
    if (mutated) {
      await db.update(goalTrees).set({ tree, updatedAt: /* @__PURE__ */ new Date() }).where(eq5(goalTrees.id, treeId));
    }
  }
}
async function markTreeTaskComplete(userId2, goalTreeId, taskId) {
  const [row] = await db.select().from(goalTrees).where(and2(eq5(goalTrees.id, goalTreeId), eq5(goalTrees.userId, userId2))).limit(1);
  if (!row) return;
  const tree = row.tree || { phases: [] };
  let mutated = false;
  for (const ph of tree.phases) {
    for (const ms of ph.milestones) {
      for (const t of ms.tasks) {
        if (t.id === taskId && t.status !== "complete") {
          t.status = "complete";
          t.completedAt = (/* @__PURE__ */ new Date()).toISOString();
          mutated = true;
        }
      }
      const allDone = ms.tasks.length > 0 && ms.tasks.every((t) => t.status === "complete");
      if (allDone && ms.status !== "complete") {
        ms.status = "complete";
        mutated = true;
      } else if (ms.status !== "complete" && ms.tasks.some((t) => t.status === "complete" || t.status === "in_progress")) {
        if (ms.status !== "in_progress") {
          ms.status = "in_progress";
          mutated = true;
        }
      }
    }
    const phaseDone = ph.milestones.length > 0 && ph.milestones.every((m) => m.status === "complete");
    if (phaseDone && ph.status !== "complete") {
      ph.status = "complete";
      mutated = true;
    } else if (ph.status !== "complete" && ph.milestones.some((m) => m.status === "complete" || m.status === "in_progress")) {
      if (ph.status !== "in_progress") {
        ph.status = "in_progress";
        mutated = true;
      }
    }
  }
  const activePhase = tree.phases.find((p) => p.status !== "complete");
  if (activePhase) {
    const activeMs = activePhase.milestones.find((m) => m.status !== "complete");
    if (activeMs) {
      for (const t of activeMs.tasks) {
        if (t.status === "blocked") {
          t.status = "ready";
          mutated = true;
        }
      }
    }
  }
  if (mutated) {
    await db.update(goalTrees).set({ tree, updatedAt: /* @__PURE__ */ new Date() }).where(eq5(goalTrees.id, goalTreeId));
  }
}
var init_goalScheduler = __esm({
  "server/goalScheduler.ts"() {
    "use strict";
    init_db();
    init_schema();
  }
});

// server/agent/harness.ts
import OpenAI4 from "openai";
function toOpenAITool(t) {
  return {
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }
  };
}
async function runStreamingTurn(params) {
  const stream = await openai4.chat.completions.create({
    model: params.model,
    messages: params.messages,
    tools: params.openAITools,
    tool_choice: params.openAITools ? params.toolChoice : void 0,
    max_completion_tokens: params.maxCompletionTokens,
    stream: true
  });
  let textContent = "";
  const textChunks = [];
  const toolCallAccum = /* @__PURE__ */ new Map();
  let finishReason = null;
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    const fr = chunk.choices[0]?.finish_reason;
    if (fr) finishReason = fr;
    if (delta?.content) {
      textContent += delta.content;
      textChunks.push(delta.content);
    }
    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index;
        if (!toolCallAccum.has(idx)) {
          toolCallAccum.set(idx, { id: "", name: "", args: "" });
        }
        const acc = toolCallAccum.get(idx);
        if (tc.id) acc.id += tc.id;
        if (tc.function?.name) acc.name += tc.function.name;
        if (tc.function?.arguments) acc.args += tc.function.arguments;
      }
    }
  }
  const toolCallList = Array.from(toolCallAccum.entries()).sort(([a], [b]) => a - b).map(([, acc]) => ({
    id: acc.id,
    type: "function",
    function: { name: acc.name, arguments: acc.args }
  }));
  return { textContent, textChunks, toolCallList, finishReason };
}
async function runAgent(opts) {
  const {
    model = "gpt-5-mini",
    tools,
    context,
    maxTurns = 6,
    maxCompletionTokens = 2e3,
    toolChoice = "auto",
    onToken
  } = opts;
  const channel = context.channel || "Agent";
  const toolMap = new Map(tools.map((t) => [t.name, t]));
  const openAITools = tools.length > 0 ? tools.map(toOpenAITool) : void 0;
  const messages = [
    ...opts.messages
  ];
  const toolCalls = [];
  let lastFinish = null;
  let reply = "";
  for (let turn = 0; turn < maxTurns; turn++) {
    let msgContent = null;
    let msgToolCalls;
    if (!onToken) {
      const completion = await openai4.chat.completions.create({
        model,
        messages,
        tools: openAITools,
        tool_choice: openAITools ? toolChoice : void 0,
        max_completion_tokens: maxCompletionTokens
      });
      const choice = completion.choices[0];
      lastFinish = choice?.finish_reason || null;
      const msg = choice?.message;
      console.log(
        `[${channel}/Agent] turn=${turn} finish=${lastFinish} tool_calls=${msg?.tool_calls?.length || 0}`
      );
      if (!msg) break;
      msgContent = msg.content ?? null;
      msgToolCalls = msg.tool_calls ?? void 0;
    } else {
      const streamResult = await runStreamingTurn({
        model,
        messages,
        openAITools,
        toolChoice,
        maxCompletionTokens
      });
      lastFinish = streamResult.finishReason;
      console.log(
        `[${channel}/Agent] turn=${turn} (streaming) finish=${lastFinish} tool_calls=${streamResult.toolCallList.length}`
      );
      msgContent = streamResult.textContent || null;
      msgToolCalls = streamResult.toolCallList.length > 0 ? streamResult.toolCallList : void 0;
      if (!msgToolCalls && streamResult.textChunks.length > 0) {
        for (const chunk of streamResult.textChunks) {
          onToken(chunk);
        }
      }
    }
    if (msgToolCalls && msgToolCalls.length > 0) {
      const assistantMsg = {
        role: "assistant",
        content: msgContent,
        tool_calls: msgToolCalls
      };
      messages.push(assistantMsg);
      const results = await Promise.all(
        msgToolCalls.map(async (tc) => {
          const start = Date.now();
          const tool = toolMap.get(tc.function.name);
          let parsedArgs = {};
          try {
            const raw = JSON.parse(tc.function.arguments || "{}");
            if (raw && typeof raw === "object")
              parsedArgs = raw;
          } catch {
            parsedArgs = {};
          }
          if (!tool) {
            const result = {
              ok: false,
              content: `Unknown tool: ${tc.function.name}`,
              label: "Unknown tool"
            };
            toolCalls.push({
              name: tc.function.name,
              args: parsedArgs,
              result,
              durationMs: Date.now() - start
            });
            return { tc, content: result.content };
          }
          try {
            const result = await tool.execute(parsedArgs, context);
            toolCalls.push({
              name: tc.function.name,
              args: parsedArgs,
              result,
              durationMs: Date.now() - start
            });
            console.log(
              `[${channel}/Agent] tool=${tc.function.name} ok=${result.ok}${result.label ? ` label="${result.label}"` : ""} ${Date.now() - start}ms`
            );
            return { tc, content: result.content };
          } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            const result = {
              ok: false,
              content: `Tool ${tc.function.name} threw: ${detail}`,
              label: "Tool error",
              detail
            };
            toolCalls.push({
              name: tc.function.name,
              args: parsedArgs,
              result,
              durationMs: Date.now() - start
            });
            console.error(
              `[${channel}/Agent] tool=${tc.function.name} threw:`,
              err
            );
            return { tc, content: result.content };
          }
        })
      );
      for (const { tc, content } of results) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content
        });
      }
      continue;
    }
    reply = msgContent || "";
    return { reply, turns: turn + 1, toolCalls, finishReason: lastFinish, messages };
  }
  console.warn(`[${channel}/Agent] hit maxTurns=${maxTurns}, forcing final answer`);
  try {
    if (onToken) {
      const streamResult = await runStreamingTurn({
        model,
        messages,
        openAITools: void 0,
        // no tools — force text reply
        toolChoice: "none",
        maxCompletionTokens
      });
      reply = streamResult.textContent;
      lastFinish = streamResult.finishReason;
      for (const chunk of streamResult.textChunks) {
        onToken(chunk);
      }
    } else {
      const final = await openai4.chat.completions.create({
        model,
        messages,
        max_completion_tokens: maxCompletionTokens
      });
      reply = final.choices[0]?.message?.content || "";
      lastFinish = final.choices[0]?.finish_reason || lastFinish;
    }
  } catch (err) {
    console.error(`[${channel}/Agent] final-answer call failed:`, err);
  }
  return { reply, turns: maxTurns, toolCalls, finishReason: lastFinish, messages };
}
var openai4;
var init_harness = __esm({
  "server/agent/harness.ts"() {
    "use strict";
    openai4 = new OpenAI4({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
    });
  }
});

// server/integrations/search.ts
async function tavilySearch(query, maxResults = 5) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY not set");
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "basic",
      max_results: maxResults,
      include_answer: true
    })
  });
  if (!res.ok) {
    const text2 = await res.text();
    throw new Error(`Tavily error ${res.status}: ${text2}`);
  }
  return res.json();
}
function formatSearchResults(result) {
  const parts = [];
  if (result.answer) parts.push(`Summary: ${result.answer}`);
  for (const r of result.results) {
    parts.push(`- ${r.title} (${r.url})
  ${r.content.slice(0, 300)}`);
  }
  return parts.join("\n\n");
}
var init_search = __esm({
  "server/integrations/search.ts"() {
    "use strict";
  }
});

// server/agent/tools/webSearch.ts
function emptyTavilyResult(answer) {
  return { answer, results: [] };
}
var webSearchTool, researchTopicTool;
var init_webSearch = __esm({
  "server/agent/tools/webSearch.ts"() {
    "use strict";
    init_search();
    webSearchTool = {
      name: "search_web",
      description: "Search the web for current information \u2014 news, weather, prices, recent events, product info, anything requiring up-to-date data. Returns a short answer plus the top results.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to search for" }
        },
        required: ["query"]
      },
      async execute(args, ctx) {
        if (!process.env.TAVILY_API_KEY) {
          return { ok: false, content: "Web search is not configured.", label: "Search unavailable" };
        }
        const query = String(args.query || "");
        try {
          const results = await tavilySearch(query);
          const formatted = formatSearchResults(results);
          console.log(`[${ctx.channel || "Agent"}] search_web "${query}" \u2192 ${results.results?.length || 0} results`);
          return {
            ok: true,
            content: formatted || "No results found.",
            label: `Web search: ${query}`,
            detail: formatted
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const label = msg.includes("401") || msg.includes("403") ? "Search auth failed" : msg.includes("429") ? "Search rate limited" : msg.includes("timeout") || msg.includes("ETIMEDOUT") ? "Search timed out" : "Search failed";
          return { ok: false, content: `${label}: ${msg}`, label, detail: msg };
        }
      }
    };
    researchTopicTool = {
      name: "research_topic",
      description: "Do deeper research on a topic by running 2-4 related web searches and synthesizing the findings. Use this when the user wants a briefing, summary, or 'look into X for me' \u2014 not for quick lookups (use search_web for those). Returns aggregated raw results which you should summarize for the user.",
      parameters: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description: "The main topic or question to research"
          },
          sub_queries: {
            type: "array",
            items: { type: "string" },
            description: "2-4 specific search queries that together cover the topic. If omitted, the topic itself is searched."
          }
        },
        required: ["topic"]
      },
      async execute(args, ctx) {
        if (!process.env.TAVILY_API_KEY) {
          return { ok: false, content: "Research is not available \u2014 web search is not configured.", label: "Research unavailable" };
        }
        const topic = String(args.topic || "");
        const subQueriesRaw = args.sub_queries;
        const queries = Array.isArray(subQueriesRaw) && subQueriesRaw.length > 0 ? subQueriesRaw.slice(0, 4).map((q) => String(q)) : [topic];
        try {
          const results = await Promise.all(
            queries.map(
              (q) => tavilySearch(q, 4).catch((err) => {
                const msg = err instanceof Error ? err.message : String(err);
                return emptyTavilyResult(`(search failed: ${msg})`);
              })
            )
          );
          const sections = queries.map((q, i) => {
            const formatted = formatSearchResults(results[i]);
            return `### Query: ${q}
${formatted || "(no results)"}`;
          });
          const aggregated = `Research findings on: ${topic}

` + sections.join("\n\n");
          console.log(`[${ctx.channel || "Agent"}] research_topic "${topic}" \u2014 ${queries.length} sub-queries`);
          return {
            ok: true,
            content: aggregated,
            label: `Researched: ${topic}`,
            detail: `Ran ${queries.length} search${queries.length === 1 ? "" : "es"}`
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { ok: false, content: `Research failed: ${msg}`, label: "Research failed", detail: msg };
        }
      }
    };
  }
});

// server/agent/tools/gmailActions.ts
var ACTION_MAP, ACTIONS, gmailActionTool, gmailDraftTool;
var init_gmailActions = __esm({
  "server/agent/tools/gmailActions.ts"() {
    "use strict";
    init_gmail();
    ACTION_MAP = {
      star: { add: ["STARRED"], remove: [] },
      unstar: { add: [], remove: ["STARRED"] },
      archive: { add: [], remove: ["INBOX"] },
      mark_read: { add: [], remove: ["UNREAD"] },
      mark_unread: { add: ["UNREAD"], remove: [] },
      spam: { add: ["SPAM"], remove: ["INBOX"] },
      trash: { add: ["TRASH"], remove: ["INBOX"] }
    };
    ACTIONS = Object.keys(ACTION_MAP);
    gmailActionTool = {
      name: "gmail_action",
      description: "Perform a label/state action on a Gmail email shown in the system context. Use the message id from [id:...] in the email list. Valid actions: star, unstar, archive, mark_read, mark_unread, spam, trash. Use create_gmail_draft for composing replies.",
      parameters: {
        type: "object",
        properties: {
          message_id: { type: "string", description: "Gmail message ID from [id:...]" },
          action: {
            type: "string",
            enum: ACTIONS,
            description: "The action to perform"
          }
        },
        required: ["message_id", "action"]
      },
      async execute(args, ctx) {
        if (!ctx.googleAccessToken) {
          return {
            ok: false,
            content: "Gmail is not connected. Ask the user to connect their Google account first.",
            label: "Gmail not connected"
          };
        }
        const a = args;
        const messageId = String(a.message_id || "");
        const action = String(a.action || "");
        if (!messageId || !action) {
          return { ok: false, content: "message_id and action are required.", label: "Missing args" };
        }
        const knownIds = ctx.state?.gmailMessageIds || [];
        if (knownIds.length > 0 && !knownIds.includes(messageId)) {
          return {
            ok: false,
            content: `Message ID "${messageId}" is not in the current email list. Use a valid id from [id:...] in the system context.`,
            label: "Unknown message id"
          };
        }
        const mapping = ACTION_MAP[action];
        if (!mapping) {
          return { ok: false, content: `Unknown action: ${action}`, label: "Unknown gmail action" };
        }
        try {
          await gmailModifyMessage(messageId, mapping.add, mapping.remove, ctx.googleAccessToken);
          return {
            ok: true,
            content: `Successfully performed "${action}" on the email.`,
            label: `Email ${action}`,
            detail: messageId
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { ok: false, content: `Gmail action failed: ${msg}`, label: "Gmail action failed", detail: msg };
        }
      }
    };
    gmailDraftTool = {
      name: "create_gmail_draft",
      description: "Create a Gmail draft (does NOT send it). Use this when the user asks to draft, reply to, or compose an email. The user can review and send it from Gmail. Returns the draft URL.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email address (one address)" },
          subject: { type: "string", description: "Email subject line" },
          body: { type: "string", description: "Email body (plain text, line breaks preserved)" }
        },
        required: ["to", "subject", "body"]
      },
      async execute(args, ctx) {
        if (!ctx.googleAccessToken) {
          return {
            ok: false,
            content: "Gmail is not connected. Ask the user to connect their Google account first.",
            label: "Gmail not connected"
          };
        }
        const a = args;
        const to = String(a.to || "").trim();
        const subject = String(a.subject || "").trim();
        const body = String(a.body || "");
        if (!to || !subject || !body.trim()) {
          return { ok: false, content: "to, subject, and body are all required.", label: "Missing draft fields" };
        }
        try {
          const draft = await createGmailDraft(ctx.googleAccessToken, to, subject, body);
          console.log(`[${ctx.channel || "Agent"}] create_gmail_draft to=${to} subject="${subject.slice(0, 60)}" id=${draft.draftId}`);
          return {
            ok: true,
            content: `Drafted email to ${to} (subject: "${subject}"). Review/send: ${draft.gmailUrl}`,
            label: `Drafted email to ${to}`,
            detail: draft.gmailUrl
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { ok: false, content: `Draft creation failed: ${msg}`, label: "Draft failed", detail: msg };
        }
      }
    };
  }
});

// server/integrations/telegram.ts
var telegram_exports = {};
__export(telegram_exports, {
  answerCallbackQuery: () => answerCallbackQuery,
  deleteWebhook: () => deleteWebhook,
  downloadTelegramFile: () => downloadTelegramFile,
  downloadTelegramFileBuffer: () => downloadTelegramFileBuffer,
  getTelegramBotUsername: () => getTelegramBotUsername,
  getUpdates: () => getUpdates,
  getWebhookSecret: () => getWebhookSecret,
  isTelegramConfigured: () => isTelegramConfigured,
  logTelegramStatus: () => logTelegramStatus,
  sendMessage: () => sendMessage,
  sendMessageWithButtons: () => sendMessageWithButtons,
  sendTelegramDocument: () => sendTelegramDocument,
  setWebhook: () => setWebhook,
  verifyWebhookSecret: () => verifyWebhookSecret
});
import crypto2 from "crypto";
function generateWebhookSecret() {
  if (process.env.TELEGRAM_WEBHOOK_SECRET) return process.env.TELEGRAM_WEBHOOK_SECRET;
  const secret = crypto2.randomBytes(32).toString("hex");
  process.env.TELEGRAM_WEBHOOK_SECRET = secret;
  return secret;
}
function getWebhookSecret() {
  if (!webhookSecret) {
    webhookSecret = generateWebhookSecret();
  }
  return webhookSecret;
}
function verifyWebhookSecret(headerValue) {
  if (!webhookSecret) return false;
  return headerValue === webhookSecret;
}
async function sendMessage(chatId, text2, replyMarkup) {
  if (!BOT_TOKEN) return;
  const body = { chat_id: chatId, text: text2 };
  if (replyMarkup) body.reply_markup = replyMarkup;
  const res = await fetch(`${BASE}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const errBody = await res.text();
    console.error("Telegram sendMessage error:", errBody);
  }
}
async function sendTelegramDocument(chatId, filename, content, caption, mimeType = "text/markdown") {
  if (!BOT_TOKEN) return false;
  try {
    const buf = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    const form = new FormData();
    form.append("chat_id", chatId);
    if (caption) form.append("caption", caption.slice(0, 1024));
    form.append("document", new Blob([buf], { type: mimeType }), filename);
    const res = await fetch(`${BASE}/sendDocument`, { method: "POST", body: form });
    if (!res.ok) {
      console.error("Telegram sendDocument error:", await res.text());
      return false;
    }
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Telegram sendDocument threw:", msg);
    return false;
  }
}
async function sendMessageWithButtons(chatId, text2, buttons) {
  return sendMessage(chatId, text2, {
    inline_keyboard: [buttons]
  });
}
async function answerCallbackQuery(callbackQueryId, text2) {
  if (!BOT_TOKEN) return;
  try {
    await fetch(`${BASE}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text: text2 || "" })
    });
  } catch {
  }
}
async function setWebhook(webhookUrl) {
  if (!BOT_TOKEN) return;
  const res = await fetch(`${BASE}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      allowed_updates: ["message", "my_chat_member", "callback_query"]
    })
  });
  const data = await res.json();
  if (data.ok) {
    console.log("[Telegram] Webhook set successfully:", webhookUrl);
  } else {
    throw new Error(`Failed to set Telegram webhook: ${JSON.stringify(data)}`);
  }
}
function isTelegramConfigured() {
  return !!BOT_TOKEN;
}
async function deleteWebhook() {
  if (!BOT_TOKEN) return;
  try {
    const res = await fetch(`${BASE}/deleteWebhook`, { method: "POST" });
    const data = await res.json();
    console.log("[Telegram] Webhook cleared before polling:", data.ok ? "ok" : "failed");
  } catch {
  }
}
async function downloadTelegramFile(fileId) {
  if (!BOT_TOKEN) return null;
  try {
    const infoRes = await fetch(`${BASE}/getFile?file_id=${fileId}`);
    if (!infoRes.ok) return null;
    const info = await infoRes.json();
    if (!info.ok || !info.result?.file_path) return null;
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${info.result.file_path}`;
    const fileRes = await fetch(fileUrl);
    if (!fileRes.ok) return null;
    const buffer = await fileRes.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const ext = info.result.file_path.split(".").pop()?.toLowerCase() || "jpg";
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    return `data:${mime};base64,${base64}`;
  } catch {
    return null;
  }
}
async function downloadTelegramFileBuffer(fileId) {
  if (!BOT_TOKEN) return null;
  try {
    const infoRes = await fetch(`${BASE}/getFile?file_id=${fileId}`);
    if (!infoRes.ok) return null;
    const info = await infoRes.json();
    if (!info.ok || !info.result?.file_path) return null;
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${info.result.file_path}`;
    const fileRes = await fetch(fileUrl);
    if (!fileRes.ok) return null;
    const arrayBuf = await fileRes.arrayBuffer();
    const ext = info.result.file_path.split(".").pop()?.toLowerCase() || "ogg";
    return { buffer: Buffer.from(arrayBuf), ext };
  } catch {
    return null;
  }
}
async function getUpdates(offset) {
  if (!BOT_TOKEN) return [];
  try {
    const res = await fetch(
      `${BASE}/getUpdates?offset=${offset}&timeout=5&limit=100&allowed_updates=["message","my_chat_member","callback_query"]`
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.ok ? data.result || [] : [];
  } catch {
    return [];
  }
}
function logTelegramStatus() {
  if (BOT_TOKEN) {
    console.log("Telegram: configured \u2713");
  } else {
    console.log("Telegram: not configured (set TELEGRAM_BOT_TOKEN in Replit Secrets)");
  }
}
async function getTelegramBotUsername() {
  if (_cachedBotUsername) return _cachedBotUsername;
  if (!BOT_TOKEN) return null;
  try {
    const res = await fetch(`${BASE}/getMe`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.ok && data.result?.username) {
      _cachedBotUsername = data.result.username;
      return _cachedBotUsername;
    }
    return null;
  } catch {
    return null;
  }
}
var BOT_TOKEN, BASE, webhookSecret, _cachedBotUsername;
var init_telegram = __esm({
  "server/integrations/telegram.ts"() {
    "use strict";
    BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;
    webhookSecret = null;
    _cachedBotUsername = null;
  }
});

// server/interactionLog.ts
import { eq as eq6, desc as desc3, gte, and as and3 } from "drizzle-orm";
async function logInteraction(userId2, channel, direction, content, label) {
  try {
    await db.insert(interactionLog).values({
      userId: userId2,
      channel,
      direction,
      content,
      label: label || null
    });
  } catch (err) {
    console.error("[InteractionLog] Failed to log interaction:", err);
  }
}
async function getRecentInteractions(userId2, limit = 20, withinHours = 48) {
  try {
    const since = new Date(Date.now() - withinHours * 60 * 60 * 1e3);
    return await db.select().from(interactionLog).where(
      and3(
        eq6(interactionLog.userId, userId2),
        gte(interactionLog.createdAt, since)
      )
    ).orderBy(desc3(interactionLog.createdAt)).limit(limit);
  } catch (err) {
    console.error("[InteractionLog] Failed to fetch interactions:", err);
    return [];
  }
}
function formatInteractionTimeline(interactions) {
  if (interactions.length === 0) return "";
  const sorted = [...interactions].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  const lines = sorted.map((row) => {
    const ts = new Date(row.createdAt).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    });
    const date2 = new Date(row.createdAt).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric"
    });
    let channelLabel;
    if (row.channel === "app_chat") {
      channelLabel = "App";
    } else if (row.channel === "telegram") {
      channelLabel = "Telegram";
    } else {
      channelLabel = row.label ? `Notification \u2013 ${row.label}` : "Notification";
    }
    const who = row.direction === "inbound" ? "User" : `Jarvis (${channelLabel})`;
    const labelTag = row.channel !== "notification" && row.label ? ` [${row.label}]` : "";
    const displayContent = row.content.length > DISPLAY_TRUNCATE_LENGTH ? row.content.slice(0, DISPLAY_TRUNCATE_LENGTH) + "\u2026" : row.content;
    return `[${date2} ${ts}] ${who}${labelTag}: ${displayContent}`;
  });
  return `
## Recent Cross-Channel Activity (last 48 hours)
This shows everything that happened between you and the user across all channels \u2014 app conversations, Telegram messages, and any notifications you sent. Use this to understand the full context before responding.
${lines.join("\n")}`;
}
var DISPLAY_TRUNCATE_LENGTH;
var init_interactionLog = __esm({
  "server/interactionLog.ts"() {
    "use strict";
    init_db();
    init_schema();
    DISPLAY_TRUNCATE_LENGTH = 1200;
  }
});

// server/channels/registry.ts
import { eq as eq7, and as and4 } from "drizzle-orm";
function registerChannel(channel) {
  channels.set(channel.name, channel);
}
function listChannels() {
  return Array.from(channels.values());
}
async function getActiveChannelsFor(userId2, notificationType) {
  try {
    const rows = await db.select().from(channelPreferences).where(and4(
      eq7(channelPreferences.userId, userId2),
      eq7(channelPreferences.notificationType, notificationType)
    )).limit(1);
    const prefs = rows[0]?.channels;
    if (prefs && prefs.length > 0) return prefs;
  } catch (err) {
    console.error("[channels] preference lookup failed:", err);
  }
  return DEFAULT_FALLBACK;
}
async function getAllPreferences(userId2) {
  const out = {};
  try {
    const rows = await db.select().from(channelPreferences).where(eq7(channelPreferences.userId, userId2));
    for (const r of rows) {
      out[r.notificationType] = r.channels || [];
    }
  } catch (err) {
    console.error("[channels] getAllPreferences failed:", err);
  }
  return out;
}
async function setPreference(userId2, notificationType, selected) {
  await db.insert(channelPreferences).values({ userId: userId2, notificationType, channels: selected, updatedAt: /* @__PURE__ */ new Date() }).onConflictDoUpdate({
    target: [channelPreferences.userId, channelPreferences.notificationType],
    set: { channels: selected, updatedAt: /* @__PURE__ */ new Date() }
  });
}
async function trySendOnChannel(userId2, name, text2, opts, notificationType) {
  const ch = channels.get(name);
  if (!ch) return { channel: name, result: { ok: false, error: "channel not registered" } };
  if (!ch.isConfigured()) return { channel: name, result: { ok: false, error: "channel not configured" } };
  if (!await ch.isLinkedFor(userId2)) return { channel: name, result: { ok: false, error: "user not linked" } };
  try {
    const result = await ch.sendMessage(userId2, text2, { ...opts, notificationType });
    if (result.ok) logInteraction(userId2, name, "outbound", text2).catch(() => {
    });
    return { channel: name, result };
  } catch (err) {
    console.error(`[channels] ${name} send failed:`, err);
    return { channel: name, result: { ok: false, error: String(err) } };
  }
}
async function notifyUser(userId2, notificationType, text2, opts = {}) {
  const targets = await getActiveChannelsFor(userId2, notificationType);
  const results = await Promise.all(
    targets.map((name) => trySendOnChannel(userId2, name, text2, opts, notificationType))
  );
  if (results.some((r) => r.result.ok)) return results;
  const tried = new Set(targets);
  const fallbackOrder = [
    "telegram",
    ...listChannels().map((c) => c.name).filter((n) => n !== "telegram")
  ];
  for (const name of fallbackOrder) {
    if (tried.has(name)) continue;
    tried.add(name);
    const r = await trySendOnChannel(userId2, name, text2, opts, notificationType);
    results.push(r);
    if (r.result.ok) {
      console.warn(`[channels] notifyUser fallback delivered via ${name} after preferred targets [${targets.join(",")}] failed for user ${userId2}`);
      return results;
    }
  }
  return results;
}
var channels, DEFAULT_FALLBACK;
var init_registry = __esm({
  "server/channels/registry.ts"() {
    "use strict";
    init_db();
    init_schema();
    init_interactionLog();
    channels = /* @__PURE__ */ new Map();
    DEFAULT_FALLBACK = ["telegram"];
  }
});

// server/momentumCoach.ts
import { eq as eq8, and as and5, lt as lt2 } from "drizzle-orm";
import OpenAI5 from "openai";
async function generateMomentumSteps(_userId, context) {
  const incompleteTasks = (context.tasks || []).filter((t) => !t.completed);
  const taskList = incompleteTasks.slice(0, 5).map((t) => t.title).join(", ") || "no specific tasks planned";
  const goalsText = (context.goals || []).slice(0, 3).map((g) => `${g.title} (${g.current || 0}/${g.target})`).join(", ") || "none set";
  const streak = context.stats?.streak || 0;
  const completedToday = (context.tasks || []).filter((t) => t.completed).length;
  const prompt = `You are designing a 4-step momentum sequence for someone with ADHD who has task aversion right now.

Their situation:
- Today's tasks: ${taskList}
- Goals: ${goalsText}
- Streak: ${streak} days
- Completed today: ${completedToday} tasks
- Date: ${context.dateKey}

Design 4 escalating micro-tasks. Step 1 must be TINY \u2014 a single physical action that takes under 60 seconds and removes all friction (e.g., "Just open your email and glance at the subject lines \u2014 don't reply to anything"). Each step is slightly larger than the last.

Each step must use a specific ADHD tactic:
- Step 1: Implementation intention ("When you sit down, just... [specific physical action]")
- Step 2: Identity framing ("You're someone who... one quick thing to prove it")
- Step 3: Social contrast or streak leverage ("Yesterday/this week you did X... let's match it with one thing")
- Step 4: Momentum statement ("You're already rolling \u2014 just one more and you can call it a win")

Respond with a JSON array of 4 objects: [{ "text": "message to send", "tactic": "implementation_intention|identity_framing|social_contrast|momentum" }, ...]
Keep each text under 2 sentences. Plain text only \u2014 no markdown, no asterisks.`;
  try {
    const resp = await openai5.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: "You are an ADHD productivity coach. Respond with valid JSON only." },
        { role: "user", content: prompt }
      ],
      max_completion_tokens: 800
    });
    const raw = resp.choices[0]?.message?.content || "[]";
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed) || parsed.length < 4) throw new Error("bad shape");
    const xpPerStep = [5, 10, 15, 20];
    return parsed.slice(0, 4).map((s, i) => ({
      text: typeof s.text === "string" ? s.text : String(s.text),
      tactic: typeof s.tactic === "string" ? s.tactic : "momentum",
      xp: xpPerStep[i]
    }));
  } catch (err) {
    console.error("[Momentum] Failed to generate steps:", err);
    return [
      { text: "When you sit down right now, just open your task list \u2014 don't do anything yet, just look.", tactic: "implementation_intention", xp: 5 },
      { text: "You're someone who follows through. Pick the smallest task on that list and spend just 5 minutes on it.", tactic: "identity_framing", xp: 10 },
      { text: "You've already done 2 things \u2014 that's momentum. One more task and you'll have a real streak going.", tactic: "social_contrast", xp: 15 },
      { text: "You're rolling now. One final thing and you can close your laptop knowing today counted.", tactic: "momentum", xp: 20 }
    ];
  }
}
async function startMomentumSession(userId2, chatId, context) {
  const steps = await generateMomentumSteps(userId2, context);
  await db.insert(momentumSessions).values({
    userId: userId2,
    currentStep: 0,
    sessionDate: context.dateKey,
    completedSteps: 0,
    steps,
    status: "active",
    lastStepAt: /* @__PURE__ */ new Date()
  }).onConflictDoUpdate({
    target: momentumSessions.userId,
    set: {
      currentStep: 0,
      sessionDate: context.dateKey,
      completedSteps: 0,
      steps,
      status: "active",
      lastStepAt: /* @__PURE__ */ new Date()
    }
  });
  const step = steps[0];
  await sendMessageWithButtons(chatId, `Jarvis here. ${step.text}`, [
    { text: "\u2705 Done", callback_data: `momentum_done:${userId2}:0` }
  ]);
  console.log(`[Momentum] Session started for user ${userId2}, step 0`);
}
async function handleMomentumDone(userId2, chatId, stepIndex) {
  const rows = await db.select().from(momentumSessions).where(eq8(momentumSessions.userId, userId2)).limit(1);
  if (rows.length === 0) return;
  const session = rows[0];
  if (session.status === "expired") {
    await sendMessage(chatId, "That session already expired \u2014 start fresh tomorrow.");
    return;
  }
  const steps = session.steps;
  if (stepIndex >= steps.length) return;
  if (session.currentStep !== stepIndex) return;
  const completedStep = steps[stepIndex];
  const xpEarned = completedStep.xp;
  await awardXp(userId2, xpEarned);
  const nextStep = stepIndex + 1;
  const newCompletedSteps = (session.completedSteps || 0) + 1;
  const isFinished = nextStep >= steps.length;
  await db.update(momentumSessions).set({
    currentStep: nextStep,
    completedSteps: newCompletedSteps,
    status: isFinished ? "completed" : "active",
    lastStepAt: /* @__PURE__ */ new Date()
  }).where(eq8(momentumSessions.userId, userId2));
  const ackMessages = {
    implementation_intention: `Done \u2014 +${xpEarned} XP. That first step is always the hardest.`,
    identity_framing: `Locked in \u2014 +${xpEarned} XP. That's exactly who you are.`,
    social_contrast: `Nice \u2014 +${xpEarned} XP. Momentum is real now.`,
    momentum: `That's it \u2014 +${xpEarned} XP. Today counts.`
  };
  const ack = ackMessages[completedStep.tactic] ?? `+${xpEarned} XP. Keep going.`;
  await sendMessage(chatId, ack);
  if (isFinished) {
    const totalXp = steps.reduce((sum, s) => sum + s.xp, 0);
    await sendMessage(chatId, `Full sequence complete \u2014 ${totalXp} XP earned today. That's a win.`);
    return;
  }
  setTimeout(async () => {
    try {
      const freshRows = await db.select().from(momentumSessions).where(eq8(momentumSessions.userId, userId2)).limit(1);
      if (freshRows.length === 0 || freshRows[0].currentStep !== nextStep) return;
      const freshSession = freshRows[0];
      if (freshSession.status !== "active") return;
      const lastStepTime = freshSession.lastStepAt ? new Date(freshSession.lastStepAt) : /* @__PURE__ */ new Date();
      if (Date.now() - lastStepTime.getTime() > SESSION_TIMEOUT_MS) {
        await expireSession(userId2, chatId);
        return;
      }
      const nextStepData = freshSession.steps[nextStep];
      await sendMessageWithButtons(chatId, nextStepData.text, [
        { text: "\u2705 Done", callback_data: `momentum_done:${userId2}:${nextStep}` }
      ]);
      console.log(`[Momentum] Sent step ${nextStep} to user ${userId2}`);
    } catch (err) {
      console.error("[Momentum] Error sending next step:", err);
    }
  }, STEP_DELAY_MS);
}
async function expireSession(userId2, chatId) {
  await db.update(momentumSessions).set({ status: "expired" }).where(eq8(momentumSessions.userId, userId2));
  await sendMessage(chatId, "No worries \u2014 we'll pick it back up tomorrow.");
  console.log(`[Momentum] Session expired for user ${userId2}`);
}
async function awardXp(userId2, amount) {
  try {
    const rows = await db.select().from(stats).where(eq8(stats.userId, userId2)).limit(1);
    if (rows.length === 0) return;
    const data = rows[0].data ?? {};
    const currentXp = Number(data.xp ?? 0);
    await db.update(stats).set({ data: { ...data, xp: currentXp + amount }, updatedAt: /* @__PURE__ */ new Date() }).where(eq8(stats.userId, userId2));
  } catch (err) {
    console.error("[Momentum] Failed to award XP:", err);
  }
}
async function hasMomentumSessionToday(userId2, dateKey) {
  const rows = await db.select({ sessionDate: momentumSessions.sessionDate }).from(momentumSessions).where(eq8(momentumSessions.userId, userId2)).limit(1);
  return rows.length > 0 && rows[0].sessionDate === dateKey;
}
async function expireStaleMomentumSessions() {
  try {
    const cutoff = new Date(Date.now() - SESSION_TIMEOUT_MS);
    const staleSessions = await db.select().from(momentumSessions).where(
      and5(
        eq8(momentumSessions.status, "active"),
        lt2(momentumSessions.lastStepAt, cutoff)
      )
    );
    for (const session of staleSessions) {
      const links = await db.select({ chatId: telegramLinks.chatId }).from(telegramLinks).where(eq8(telegramLinks.userId, session.userId)).limit(1);
      await db.update(momentumSessions).set({ status: "expired" }).where(eq8(momentumSessions.userId, session.userId));
      if (links.length > 0) {
        await sendMessage(links[0].chatId, "No worries \u2014 we'll pick it back up tomorrow.").catch(() => {
        });
      }
      console.log(`[Momentum] Sweep expired session for user ${session.userId}`);
    }
  } catch (err) {
    console.error("[Momentum] Error in expiry sweep:", err);
  }
}
function startMomentumExpiryScheduler() {
  setInterval(() => {
    expireStaleMomentumSessions().catch(
      (err) => console.error("[Momentum] Expiry scheduler error:", err)
    );
  }, 5 * 60 * 1e3);
  console.log("[Momentum] Expiry scheduler started (5-min interval)");
}
var openai5, SESSION_TIMEOUT_MS, STEP_DELAY_MS;
var init_momentumCoach = __esm({
  "server/momentumCoach.ts"() {
    "use strict";
    init_db();
    init_schema();
    init_telegram();
    openai5 = new OpenAI5({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
    });
    SESSION_TIMEOUT_MS = 30 * 60 * 1e3;
    STEP_DELAY_MS = 3 * 60 * 1e3;
  }
});

// server/userTokenStore.ts
var userTokenStore_exports = {};
__export(userTokenStore_exports, {
  deleteUserToken: () => deleteUserToken,
  getUserOAuthStatus: () => getUserOAuthStatus,
  getUserToken: () => getUserToken,
  getUserTokens: () => getUserTokens,
  getValidGoogleToken: () => getValidGoogleToken,
  getValidGoogleTokens: () => getValidGoogleTokens,
  getValidMicrosoftToken: () => getValidMicrosoftToken,
  refreshGoogleToken: () => refreshGoogleToken,
  refreshMicrosoftToken: () => refreshMicrosoftToken,
  saveUserToken: () => saveUserToken
});
import { sql as sql5 } from "drizzle-orm";
async function saveUserToken(token) {
  await db.execute(sql5`
    INSERT INTO user_oauth_tokens
      (user_id, provider, access_token, refresh_token, expires_at, scopes, account_email, updated_at)
    VALUES
      (${token.userId}, ${token.provider}, ${token.accessToken},
       ${token.refreshToken ?? null}, ${token.expiresAt ?? null},
       ${token.scopes ?? null}, ${token.accountEmail}, NOW())
    ON CONFLICT (user_id, provider, account_email) DO UPDATE SET
      access_token = EXCLUDED.access_token,
      refresh_token = COALESCE(EXCLUDED.refresh_token, user_oauth_tokens.refresh_token),
      expires_at = EXCLUDED.expires_at,
      scopes = EXCLUDED.scopes,
      updated_at = NOW()
  `);
}
async function getUserToken(userId2, provider) {
  const rows = await db.execute(sql5`
    SELECT user_id, provider, access_token, refresh_token, expires_at, scopes, account_email
    FROM user_oauth_tokens
    WHERE user_id = ${userId2} AND provider = ${provider}
    LIMIT 1
  `);
  const row = rows.rows?.[0] ?? (Array.isArray(rows) ? rows[0] : null);
  if (!row) return null;
  return {
    userId: row.user_id,
    provider: row.provider,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    scopes: row.scopes,
    accountEmail: row.account_email ?? ""
  };
}
async function getUserTokens(userId2, provider) {
  const rows = await db.execute(sql5`
    SELECT user_id, provider, access_token, refresh_token, expires_at, scopes, account_email
    FROM user_oauth_tokens
    WHERE user_id = ${userId2} AND provider = ${provider}
  `);
  const items = rows.rows ?? (Array.isArray(rows) ? rows : []);
  return items.map((row) => ({
    userId: row.user_id,
    provider: row.provider,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    scopes: row.scopes,
    accountEmail: row.account_email ?? ""
  }));
}
async function deleteUserToken(userId2, provider, accountEmail) {
  if (accountEmail) {
    await db.execute(sql5`
      DELETE FROM user_oauth_tokens WHERE user_id = ${userId2} AND provider = ${provider} AND account_email = ${accountEmail}
    `);
  } else {
    await db.execute(sql5`
      DELETE FROM user_oauth_tokens WHERE user_id = ${userId2} AND provider = ${provider}
    `);
  }
}
async function getUserOAuthStatus(userId2) {
  const rows = await db.execute(sql5`
    SELECT provider, account_email, expires_at, scopes FROM user_oauth_tokens WHERE user_id = ${userId2}
  `);
  const result = {
    google: { connected: false, accounts: [] },
    microsoft: { connected: false, accounts: [] },
    slack: { connected: false, accounts: [] }
  };
  const items = rows.rows ?? (Array.isArray(rows) ? rows : []);
  for (const row of items) {
    if (!result[row.provider]) {
      result[row.provider] = { connected: false, accounts: [] };
    }
    result[row.provider].connected = true;
    result[row.provider].email = row.account_email || void 0;
    result[row.provider].accounts.push({ email: row.account_email || "", scopes: row.scopes || void 0 });
  }
  return result;
}
async function refreshGoogleToken(token) {
  if (!token.refreshToken) return null;
  const clientId = process.env.GOOGLE_WEB_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: token.refreshToken,
        grant_type: "refresh_token"
      })
    });
    const data = await res.json();
    if (!data.access_token) return null;
    const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1e3) : null;
    const updated = {
      ...token,
      accessToken: data.access_token,
      expiresAt
    };
    await saveUserToken(updated);
    return updated;
  } catch {
    return null;
  }
}
async function getValidGoogleToken(userId2) {
  const token = await getUserToken(userId2, "google");
  if (!token) return null;
  if (token.expiresAt && token.expiresAt.getTime() < Date.now() + 6e4) {
    const refreshed = await refreshGoogleToken(token);
    return refreshed?.accessToken ?? null;
  }
  return token.accessToken;
}
async function getValidGoogleTokens(userId2) {
  const tokens = await getUserTokens(userId2, "google");
  const accessTokens = [];
  for (const token of tokens) {
    if (token.expiresAt && token.expiresAt.getTime() < Date.now() + 6e4) {
      const refreshed = await refreshGoogleToken(token);
      if (refreshed?.accessToken) accessTokens.push(refreshed.accessToken);
    } else {
      accessTokens.push(token.accessToken);
    }
  }
  return accessTokens;
}
async function refreshMicrosoftToken(token) {
  if (!token.refreshToken) return null;
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  try {
    const res = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: token.refreshToken,
        grant_type: "refresh_token",
        scope: "offline_access Calendars.ReadWrite Mail.ReadWrite Mail.Send User.Read"
      })
    });
    const data = await res.json();
    if (!data.access_token) return null;
    const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1e3) : null;
    const updated = {
      ...token,
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? token.refreshToken,
      expiresAt
    };
    await saveUserToken(updated);
    return updated;
  } catch {
    return null;
  }
}
async function getValidMicrosoftToken(userId2) {
  const token = await getUserToken(userId2, "microsoft");
  if (!token) return null;
  if (token.expiresAt && token.expiresAt.getTime() < Date.now() + 6e4) {
    const refreshed = await refreshMicrosoftToken(token);
    return refreshed?.accessToken ?? null;
  }
  return token.accessToken;
}
var init_userTokenStore = __esm({
  "server/userTokenStore.ts"() {
    "use strict";
    init_db();
  }
});

// server/memory/extractor.ts
var extractor_exports = {};
__export(extractor_exports, {
  MEMORY_CATEGORIES: () => MEMORY_CATEGORIES,
  extractAndStore: () => extractAndStore
});
import { eq as eq9, desc as desc4 } from "drizzle-orm";
import OpenAI6 from "openai";
function normalizeForDedup(s) {
  return s.trim().toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ");
}
function clampInt(value, min, max, fallback) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}
function parseExtraction(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "memories" in parsed) {
      const m = parsed.memories;
      if (Array.isArray(m)) return m;
    }
    if (Array.isArray(parsed)) return parsed;
  } catch {
  }
  return [];
}
async function extractAndStore(input) {
  const { userId: userId2, source, sourceType, sourceRef, contextHint, maxNew = 3 } = input;
  if (!source.trim()) return [];
  let stored = [];
  try {
    const existingRows = await db.select({ content: userMemories.content }).from(userMemories).where(eq9(userMemories.userId, userId2)).orderBy(desc4(userMemories.extractedAt)).limit(150);
    const existingMemories = existingRows.map((r) => r.content);
    const seen = new Set(existingMemories.map(normalizeForDedup));
    const existingList = existingMemories.length > 0 ? `
Existing memories (DO NOT duplicate or rephrase these):
${existingMemories.slice(0, 80).map((m) => `- ${m}`).join("\n")}` : "";
    const contextNote = contextHint ? `
Context: ${contextHint}` : "";
    const prompt = `You extract durable profile facts about a single user from one source.
Output JSON: { "memories": [{"content": string, "category": one-of-categories, "confidence": 0-100}] }

Categories (pick ONE per memory):
- work_patterns       \u2014 when/how they focus, schedule habits, tools, deep-work timing
- communication_style \u2014 humor, energy, decision style, message length preference
- energy_rhythms      \u2014 peak/low hours, sleep, exercise timing, recovery rituals
- goals_history       \u2014 goals stated or inferred over time, including past goals
- relationships       \u2014 specific named people (family, teammates, partners)
- values              \u2014 what they care about deeply, what motivates them
- blockers            \u2014 recurring frictions, fears, procrastination triggers
- accomplishments     \u2014 concrete wins, milestones reached
- preferences         \u2014 explicit preferences (meeting times, channels)
- fact                \u2014 anything else durable and specific

Rules:
- Only extract facts that are SPECIFIC, DURABLE, and not already captured.
- Skip emotional venting, one-off events, or generic statements.
- Confidence: 90+ user stated explicitly; 70-89 strongly implied; 50-69 plausible inference.
- Skip anything below 50.
- Return at most ${maxNew} new memories.${contextNote}
${existingList}

Source (${sourceType}):
${source.slice(0, 6e3)}

Return { "memories": [] } if nothing new and high-confidence was learned.`;
    const response = await openai6.chat.completions.create({
      model: "gpt-5-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_completion_tokens: 500
    });
    const content = response.choices[0]?.message?.content || '{"memories":[]}';
    const raw = parseExtraction(content).slice(0, maxNew);
    for (const r of raw) {
      if (typeof r.content !== "string") continue;
      const text2 = r.content.trim();
      if (!text2) continue;
      const norm = normalizeForDedup(text2);
      if (seen.has(norm)) continue;
      const category = normalizeCategory(typeof r.category === "string" ? r.category : null);
      const confidence = clampInt(r.confidence, 0, 100, 70);
      if (confidence < 50) continue;
      let embedding = null;
      try {
        const { embedText: embedText2 } = await Promise.resolve().then(() => (init_retrieve(), retrieve_exports));
        embedding = await embedText2(text2);
      } catch (embedErr) {
        console.error("[Memory] embed on insert failed:", embedErr);
      }
      await db.insert(userMemories).values({
        userId: userId2,
        content: text2,
        category,
        confidence,
        relevanceScore: 50,
        sourceType,
        sourceRef: sourceRef || null,
        embedding: embedding ?? void 0
      });
      seen.add(norm);
      stored.push({ content: text2, category, confidence });
      console.log(`[Memory] +${sourceType} [${category} c=${confidence}${embedding ? " e" : ""}] ${text2.slice(0, 70)}`);
    }
  } catch (err) {
    console.error("[Memory] extract failed:", err);
  }
  if (stored.length > 0) {
    markSoulStale(userId2).catch((err) => console.error("[Memory] markSoulStale:", err));
  }
  return stored;
}
var openai6;
var init_extractor = __esm({
  "server/memory/extractor.ts"() {
    "use strict";
    init_db();
    init_schema();
    init_categories();
    init_soul();
    openai6 = new OpenAI6({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
    });
  }
});

// server/daemon/bridge.ts
var bridge_exports = {};
__export(bridge_exports, {
  DEFAULT_ANDROID_DAEMON_PERMISSIONS: () => DEFAULT_ANDROID_DAEMON_PERMISSIONS,
  DEFAULT_DAEMON_PERMISSIONS: () => DEFAULT_DAEMON_PERMISSIONS,
  closeUserDaemon: () => closeUserDaemon,
  createDaemonPairingCode: () => createDaemonPairingCode,
  generatePairingCode: () => generatePairingCode,
  getAndroidDaemonPermissions: () => getAndroidDaemonPermissions,
  getDaemonDeviceMeta: () => getDaemonDeviceMeta,
  getDaemonPermissions: () => getDaemonPermissions,
  getOpAuditLog: () => getOpAuditLog,
  getRecentPhoneNotifications: () => getRecentPhoneNotifications,
  isAndroidDaemonActionAllowed: () => isAndroidDaemonActionAllowed,
  isAndroidDaemonActive: () => isAndroidDaemonActive,
  isDaemonActionAllowed: () => isDaemonActionAllowed,
  isUserPaired: () => isUserPaired,
  listPairedUsers: () => listPairedUsers,
  pingDaemon: () => pingDaemon,
  sendDaemonOp: () => sendDaemonOp,
  setAndroidDaemonPermissions: () => setAndroidDaemonPermissions,
  setDaemonPermissions: () => setDaemonPermissions,
  startDaemonBridge: () => startDaemonBridge
});
import { WebSocketServer, WebSocket } from "ws";
import { eq as eq10, and as and6, sql as sql6 } from "drizzle-orm";
import { randomBytes, createHash } from "crypto";
function getRecentPhoneNotifications(userId2, limit = 20) {
  const arr = userNotifications.get(userId2) || [];
  return arr.slice(0, limit);
}
function nextOpId() {
  opCounter += 1;
  return `op_${Date.now().toString(36)}_${opCounter}`;
}
function isUserPaired(userId2) {
  const sock = userSockets.get(userId2);
  return !!(sock && sock.readyState === WebSocket.OPEN);
}
function listPairedUsers() {
  return [...userSockets.keys()];
}
function closeUserDaemon(userId2) {
  const sock = userSockets.get(userId2);
  if (!sock) return false;
  try {
    sock.close(4004, "unlinked by user");
  } catch {
  }
  userSockets.delete(userId2);
  const pending = pendingByUser.get(userId2);
  if (pending) {
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, error: "daemon unlinked" });
      pending.delete(id);
    }
  }
  return true;
}
async function findUserDaemonRow(userId2) {
  const rows = await db.select().from(channelLinks).where(and6(eq10(channelLinks.userId, userId2), eq10(channelLinks.channel, "daemon")));
  if (rows.length === 0) return null;
  const real = rows.find((r) => !r.address.startsWith("pending_"));
  return real || rows[0];
}
async function getDaemonDeviceMeta(userId2) {
  try {
    const row = await findUserDaemonRow(userId2);
    const meta = row?.metadata || null;
    return {
      hostname: meta?.hostname || null,
      platform: meta?.platform || null
    };
  } catch {
    return { hostname: null, platform: null };
  }
}
async function getDaemonPermissions(userId2) {
  try {
    const row = await findUserDaemonRow(userId2);
    const meta = row?.metadata || null;
    const stored = meta?.permissions;
    if (stored && typeof stored === "object") {
      return { ...DEFAULT_DAEMON_PERMISSIONS, ...stored };
    }
  } catch (err) {
    console.error("[daemon] getDaemonPermissions failed:", err);
  }
  return { ...DEFAULT_DAEMON_PERMISSIONS };
}
async function setDaemonPermissions(userId2, perms) {
  const merged = { ...DEFAULT_DAEMON_PERMISSIONS, ...perms };
  try {
    const row = await findUserDaemonRow(userId2);
    const meta = row?.metadata || {};
    meta.permissions = merged;
    if (row) {
      await db.update(channelLinks).set({ metadata: meta }).where(eq10(channelLinks.id, row.id));
    } else {
      await db.insert(channelLinks).values({
        userId: userId2,
        channel: "daemon",
        address: `pending_${userId2}`,
        metadata: meta,
        lastSeenAt: /* @__PURE__ */ new Date()
      }).onConflictDoNothing();
    }
  } catch (err) {
    console.error("[daemon] setDaemonPermissions failed:", err);
  }
  return merged;
}
async function isDaemonActionAllowed(userId2, action) {
  const perms = await getDaemonPermissions(userId2);
  return !!perms[action];
}
async function getAndroidDaemonPermissions(userId2) {
  try {
    const row = await findUserDaemonRow(userId2);
    const meta = row?.metadata || null;
    const stored = meta?.android_permissions;
    if (stored && typeof stored === "object") {
      return { ...DEFAULT_ANDROID_DAEMON_PERMISSIONS, ...stored };
    }
  } catch (err) {
    console.error("[daemon] getAndroidDaemonPermissions failed:", err);
  }
  return { ...DEFAULT_ANDROID_DAEMON_PERMISSIONS };
}
async function setAndroidDaemonPermissions(userId2, perms) {
  const merged = { ...DEFAULT_ANDROID_DAEMON_PERMISSIONS, ...perms };
  try {
    const row = await findUserDaemonRow(userId2);
    const meta = row?.metadata || {};
    meta.android_permissions = merged;
    if (row) {
      await db.update(channelLinks).set({ metadata: meta }).where(eq10(channelLinks.id, row.id));
    } else {
      await db.insert(channelLinks).values({
        userId: userId2,
        channel: "daemon",
        address: `pending_android_${userId2}`,
        metadata: meta,
        lastSeenAt: /* @__PURE__ */ new Date()
      }).onConflictDoNothing();
    }
  } catch (err) {
    console.error("[daemon] setAndroidDaemonPermissions failed:", err);
  }
  return merged;
}
async function isAndroidDaemonActionAllowed(userId2, action) {
  const perms = await getAndroidDaemonPermissions(userId2);
  return !!perms[action];
}
async function isAndroidDaemonActive(userId2) {
  if (!isUserPaired(userId2)) return false;
  try {
    const row = await findUserDaemonRow(userId2);
    const meta = row?.metadata || null;
    return meta?.platform === "android";
  } catch {
    return false;
  }
}
function recordAuditEntry(userId2, entry) {
  let arr = opAuditLog.get(userId2);
  if (!arr) {
    arr = [];
    opAuditLog.set(userId2, arr);
  }
  arr.push(entry);
  if (arr.length > MAX_AUDIT_ENTRIES) arr.splice(0, arr.length - MAX_AUDIT_ENTRIES);
}
function getOpAuditLog(userId2) {
  return opAuditLog.get(userId2) || [];
}
async function pingDaemon(userId2, timeoutMs = 5e3) {
  return sendDaemonOp(userId2, { type: "ping" }, timeoutMs);
}
async function validateOpForPlatform(userId2, op) {
  if (op.type === "ping") return null;
  const isAndroid = await isAndroidDaemonActive(userId2);
  const isAndroidOp = op.type.startsWith("android_");
  if (isAndroidOp && !isAndroid) {
    return { ok: false, error: `Op '${op.type}' requires an Android daemon, but the connected daemon is a desktop daemon.` };
  }
  if (!isAndroidOp && isAndroid && op.type !== "notify") {
    return { ok: false, error: `Op '${op.type}' is a desktop-only op, but the connected daemon is Android. Use android_* ops instead.` };
  }
  return null;
}
async function sendDaemonOp(userId2, op, timeoutMs = 15e3) {
  const sock = userSockets.get(userId2);
  if (!sock || sock.readyState !== WebSocket.OPEN) {
    console.log(`[daemon] op SKIPPED \u2014 daemon not connected userId=${userId2} op=${op.type}`);
    return { ok: false, error: "daemon not connected" };
  }
  const platformErr = await validateOpForPlatform(userId2, op);
  if (platformErr) return platformErr;
  console.log(`[daemon] op SENT userId=${userId2} op=${op.type}`, "packageName" in op ? `pkg=${op.packageName}` : "");
  const sentAt = Date.now();
  return new Promise((resolve4) => {
    const id = nextOpId();
    const timer = setTimeout(() => {
      const map = pendingByUser.get(userId2);
      map?.delete(id);
      console.log(`[daemon] op TIMEOUT userId=${userId2} op=${op.type}`);
      const durationMs = Date.now() - sentAt;
      recordAuditEntry(userId2, { ts: sentAt, type: op.type, ok: false, error: "timeout", durationMs });
      resolve4({ ok: false, error: "daemon timeout" });
    }, timeoutMs);
    let userMap = pendingByUser.get(userId2);
    if (!userMap) {
      userMap = /* @__PURE__ */ new Map();
      pendingByUser.set(userId2, userMap);
    }
    userMap.set(id, {
      resolve: (result) => {
        const durationMs = Date.now() - sentAt;
        if (op.type === "ping") {
          console.log(`[daemon] ping RTT ${durationMs}ms userId=${userId2} ok=${result.ok}`, result.ok ? "" : `err=${result.error}`);
        } else {
          console.log(`[daemon] op RESULT userId=${userId2} op=${op.type} ok=${result.ok}`, result.ok ? "" : `err=${result.error}`);
        }
        recordAuditEntry(userId2, { ts: sentAt, type: op.type, ok: result.ok, error: result.error, durationMs });
        resolve4(result);
      },
      timer
    });
    try {
      sock.send(JSON.stringify({ type: "op", id, op }));
    } catch (err) {
      clearTimeout(timer);
      userMap.delete(id);
      const durationMs = Date.now() - sentAt;
      recordAuditEntry(userId2, { ts: sentAt, type: op.type, ok: false, error: String(err), durationMs });
      resolve4({ ok: false, error: String(err) });
    }
  });
}
function generatePairingCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
async function createDaemonPairingCode(userId2) {
  const code = generatePairingCode();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1e3);
  await db.insert(channelLinkCodes).values({
    code,
    userId: userId2,
    channel: "daemon",
    expiresAt
  });
  return code;
}
async function consumePairingCode(code) {
  try {
    const rows = await db.select().from(channelLinkCodes).where(and6(eq10(channelLinkCodes.code, code), eq10(channelLinkCodes.channel, "daemon"))).limit(1);
    const row = rows[0];
    if (!row) return null;
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
      await db.delete(channelLinkCodes).where(eq10(channelLinkCodes.code, code));
      return null;
    }
    await db.delete(channelLinkCodes).where(eq10(channelLinkCodes.code, code));
    return row.userId;
  } catch (err) {
    console.error("[daemon] consumePairingCode failed:", err);
    return null;
  }
}
async function recordDaemonLink(userId2, daemonId, meta) {
  try {
    const existing = await db.select().from(channelLinks).where(and6(eq10(channelLinks.userId, userId2), eq10(channelLinks.channel, "daemon")));
    const mergedMeta = { ...meta };
    for (const row of existing) {
      const prior = row.metadata || {};
      if (prior.permissions && !mergedMeta.permissions) {
        mergedMeta.permissions = prior.permissions;
      }
      if (prior.android_permissions && !mergedMeta.android_permissions) {
        mergedMeta.android_permissions = prior.android_permissions;
      }
    }
    if (existing.length > 0) {
      await db.delete(channelLinks).where(and6(eq10(channelLinks.userId, userId2), eq10(channelLinks.channel, "daemon")));
    }
    await db.insert(channelLinks).values({
      userId: userId2,
      channel: "daemon",
      address: daemonId,
      metadata: mergedMeta,
      lastSeenAt: /* @__PURE__ */ new Date()
    }).onConflictDoUpdate({
      target: [channelLinks.channel, channelLinks.address],
      set: { userId: userId2, metadata: mergedMeta, lastSeenAt: /* @__PURE__ */ new Date() }
    });
  } catch (err) {
    console.error("[daemon] recordDaemonLink failed:", err);
  }
}
function startDaemonBridge(server) {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    if (!req.url || !req.url.startsWith("/api/daemon/ws")) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
  wss.on("connection", (ws) => {
    let pairedUserId = null;
    let pairTimeout = setTimeout(() => {
      if (!pairedUserId) {
        try {
          ws.close(4001, "pairing timeout");
        } catch {
        }
      }
    }, 3e4);
    ws.on("message", async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        try {
          ws.send(JSON.stringify({ type: "error", error: "invalid json" }));
        } catch {
        }
        return;
      }
      const m = msg;
      if (m.type === "reconnect") {
        const rm = m;
        if (!rm.daemonId || !rm.reconnectSecret) {
          try {
            ws.send(JSON.stringify({ type: "hello", ok: false, error: "daemonId and reconnectSecret are required" }));
          } catch {
          }
          return;
        }
        try {
          const rows = await db.select().from(channelLinks).where(and6(eq10(channelLinks.address, rm.daemonId), eq10(channelLinks.channel, "daemon"))).limit(1);
          const row = rows[0];
          if (!row) {
            try {
              ws.send(JSON.stringify({ type: "hello", ok: false, error: "unknown daemonId \u2014 please re-pair" }));
            } catch {
            }
            ws.close(4002, "unknown daemonId");
            return;
          }
          const storedMeta = row.metadata || {};
          const storedHash = storedMeta.reconnectSecretHash;
          if (!storedHash) {
            try {
              ws.send(JSON.stringify({ type: "hello", ok: false, error: "legacy pair record \u2014 please re-pair" }));
            } catch {
            }
            ws.close(4002, "legacy record");
            return;
          }
          const providedHash = createHash("sha256").update(rm.reconnectSecret).digest("hex");
          if (providedHash !== storedHash) {
            try {
              ws.send(JSON.stringify({ type: "hello", ok: false, error: "invalid reconnect secret \u2014 please re-pair" }));
            } catch {
            }
            ws.close(4001, "bad secret");
            return;
          }
          pairedUserId = row.userId;
          if (pairTimeout) {
            clearTimeout(pairTimeout);
            pairTimeout = null;
          }
          if (rm.hostname) storedMeta.hostname = rm.hostname;
          if (rm.platform) storedMeta.platform = rm.platform;
          await db.update(channelLinks).set({ metadata: storedMeta, lastSeenAt: /* @__PURE__ */ new Date() }).where(eq10(channelLinks.id, row.id));
          const prior = userSockets.get(pairedUserId);
          if (prior && prior !== ws) {
            try {
              prior.close(4003, "replaced by new daemon");
            } catch {
            }
          }
          userSockets.set(pairedUserId, ws);
          const hello = { type: "hello", ok: true, userId: pairedUserId };
          try {
            ws.send(JSON.stringify(hello));
          } catch {
          }
          console.log(`[daemon] reconnected userId=${pairedUserId} daemonId=${rm.daemonId}`);
        } catch (err) {
          console.error("[daemon] reconnect lookup failed:", err);
          try {
            ws.send(JSON.stringify({ type: "hello", ok: false, error: "reconnect failed" }));
          } catch {
          }
        }
        return;
      }
      if (m.type === "pair") {
        const userId2 = await consumePairingCode(m.code);
        if (!userId2) {
          const reply = { type: "hello", ok: false, error: "invalid or expired code" };
          try {
            ws.send(JSON.stringify(reply));
          } catch {
          }
          ws.close(4002, "invalid code");
          return;
        }
        pairedUserId = userId2;
        if (pairTimeout) {
          clearTimeout(pairTimeout);
          pairTimeout = null;
        }
        const daemonId = randomBytes(16).toString("hex");
        const reconnectSecret = randomBytes(32).toString("hex");
        const reconnectSecretHash = createHash("sha256").update(reconnectSecret).digest("hex");
        await recordDaemonLink(userId2, daemonId, {
          hostname: m.hostname || "unknown",
          platform: m.platform || "desktop",
          reconnectSecretHash
        });
        const prior = userSockets.get(userId2);
        if (prior && prior !== ws) {
          try {
            prior.close(4003, "replaced by new daemon");
          } catch {
          }
        }
        userSockets.set(userId2, ws);
        const hello = { type: "hello", ok: true, userId: userId2, daemonId, reconnectSecret };
        try {
          ws.send(JSON.stringify(hello));
        } catch {
        }
        console.log(`[daemon] paired userId=${userId2} hostname=${m.hostname || "unknown"} platform=${m.platform || "desktop"}`);
        return;
      }
      if (m.type === "ping") {
        try {
          ws.send(JSON.stringify({ type: "pong" }));
        } catch {
        }
        return;
      }
      if (m.type === "notification_event" && pairedUserId) {
        const ne = m;
        if (ne.notification && typeof ne.notification === "object") {
          const arr = userNotifications.get(pairedUserId) || [];
          arr.unshift(ne.notification);
          while (arr.length > MAX_NOTIFS_PER_USER) arr.pop();
          userNotifications.set(pairedUserId, arr);
        }
        return;
      }
      if (m.type === "result" && pairedUserId) {
        const userMap = pendingByUser.get(pairedUserId);
        const pending = userMap?.get(m.id);
        if (pending) {
          clearTimeout(pending.timer);
          userMap.delete(m.id);
          pending.resolve({ ok: m.ok, data: m.data, error: m.error });
        }
        db.update(channelLinks).set({ lastSeenAt: /* @__PURE__ */ new Date() }).where(and6(eq10(channelLinks.userId, pairedUserId), eq10(channelLinks.channel, "daemon"))).catch((err) => console.error("[daemon] last_seen update failed:", err));
      }
    });
    const keepalive = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.ping();
        } catch {
        }
      }
    }, 2e4);
    ws.on("close", () => {
      clearInterval(keepalive);
      if (pairedUserId && userSockets.get(pairedUserId) === ws) {
        userSockets.delete(pairedUserId);
        console.log(`[daemon] disconnected userId=${pairedUserId}`);
      }
      if (pairTimeout) {
        clearTimeout(pairTimeout);
        pairTimeout = null;
      }
      if (pairedUserId) {
        const userMap = pendingByUser.get(pairedUserId);
        if (userMap) {
          for (const [id, pending] of userMap) {
            clearTimeout(pending.timer);
            pending.resolve({ ok: false, error: "daemon disconnected" });
            userMap.delete(id);
          }
        }
      }
    });
    ws.on("error", (err) => {
      console.error("[daemon] socket error:", err);
    });
  });
  console.log("[daemon] WebSocket bridge mounted at /api/daemon/ws");
  const cleanup = setInterval(() => {
    db.delete(channelLinkCodes).where(and6(eq10(channelLinkCodes.channel, "daemon"), sql6`${channelLinkCodes.expiresAt} < NOW()`)).catch((err) => console.error("[daemon] code cleanup failed:", err));
  }, 5 * 60 * 1e3);
  cleanup.unref();
}
var userNotifications, MAX_NOTIFS_PER_USER, userSockets, pendingByUser, opCounter, DEFAULT_DAEMON_PERMISSIONS, DEFAULT_ANDROID_DAEMON_PERMISSIONS, opAuditLog, MAX_AUDIT_ENTRIES;
var init_bridge = __esm({
  "server/daemon/bridge.ts"() {
    "use strict";
    init_db();
    init_schema();
    userNotifications = /* @__PURE__ */ new Map();
    MAX_NOTIFS_PER_USER = 60;
    userSockets = /* @__PURE__ */ new Map();
    pendingByUser = /* @__PURE__ */ new Map();
    opCounter = 0;
    DEFAULT_DAEMON_PERMISSIONS = {
      shell: false,
      file_write: false,
      notify: true,
      file_read: true,
      file_list: true
    };
    DEFAULT_ANDROID_DAEMON_PERMISSIONS = {
      android_screenshot: true,
      android_read_screen: true,
      android_open_app: true,
      android_browse: true,
      android_file_list: true,
      android_file_read: false,
      android_tap_type: false
    };
    opAuditLog = /* @__PURE__ */ new Map();
    MAX_AUDIT_ENTRIES = 20;
  }
});

// server/channels/coachAgent.ts
import { eq as eq11, and as and7, desc as desc5 } from "drizzle-orm";
async function runCoachAgent(input) {
  const { userId: userId2, userText, channelName, imageUrl, onToken } = input;
  const channelLower = channelName.toLowerCase();
  let userGoals = [];
  let userStats = {};
  let userLifeContext = null;
  let userCommitments = [];
  let chatMessages = [];
  let gmailItems = [];
  let calendarEvents = [];
  let gmailConnected = false;
  let googleAccessToken = null;
  const [goalsRow, statsRow, lcRow, chatRow, commitmentsRows, googleTokens, prefsRow, recentInteractionsResult] = await Promise.allSettled([
    db.select().from(goals).where(eq11(goals.userId, userId2)).limit(1),
    db.select().from(stats).where(eq11(stats.userId, userId2)).limit(1),
    db.select().from(lifeContext).where(eq11(lifeContext.userId, userId2)).limit(1),
    db.select().from(chatHistory).where(eq11(chatHistory.userId, userId2)).limit(1),
    db.select().from(commitments).where(and7(eq11(commitments.userId, userId2), eq11(commitments.status, "pending"))).orderBy(desc5(commitments.extractedAt)).limit(10),
    getValidGoogleTokens(userId2),
    db.select().from(userPreferences).where(eq11(userPreferences.userId, userId2)).limit(1),
    getRecentInteractions(userId2, 20)
  ]);
  logInteraction(userId2, channelLower, "inbound", userText || "[image]").catch(() => {
  });
  let userTimezone = "America/New_York";
  if (goalsRow.status === "fulfilled") userGoals = goalsRow.value[0]?.data || [];
  if (statsRow.status === "fulfilled") userStats = statsRow.value[0]?.data || {};
  if (lcRow.status === "fulfilled") userLifeContext = lcRow.value[0]?.data || null;
  if (chatRow.status === "fulfilled") chatMessages = chatRow.value[0]?.data || [];
  if (commitmentsRows.status === "fulfilled") userCommitments = commitmentsRows.value;
  if (prefsRow.status === "fulfilled") {
    const prefs = prefsRow.value[0]?.data || {};
    if (prefs.timezone) userTimezone = prefs.timezone;
  }
  const localForDateKey = new Date((/* @__PURE__ */ new Date()).toLocaleString("en-US", { timeZone: userTimezone }));
  const dateKey = `${localForDateKey.getFullYear()}-${String(localForDateKey.getMonth() + 1).padStart(2, "0")}-${String(localForDateKey.getDate()).padStart(2, "0")}`;
  let todayPlan = null;
  try {
    const planRows = await db.select().from(plans).where(and7(eq11(plans.userId, userId2), eq11(plans.date, dateKey))).limit(1);
    todayPlan = planRows[0]?.data || null;
  } catch (err) {
    console.error("[coach] plan fetch failed:", err);
  }
  if (googleTokens.status === "fulfilled" && googleTokens.value.length > 0) {
    gmailConnected = true;
    const tokens = googleTokens.value;
    googleAccessToken = tokens[0];
    const [emailResult, ...calResults] = await Promise.allSettled([
      getRecentEmailCommitments(14, tokens[0]),
      ...tokens.map((t) => getGoogleCalendarEvents(dateKey, void 0, void 0, t))
    ]);
    if (emailResult.status === "fulfilled") gmailItems = emailResult.value;
    const seenEventIds = /* @__PURE__ */ new Set();
    for (const calResult of calResults) {
      if (calResult.status === "fulfilled") {
        for (const ev of calResult.value) {
          if (!seenEventIds.has(ev.id)) {
            seenEventIds.add(ev.id);
            calendarEvents.push(ev);
          }
        }
      }
    }
  }
  const recentMessages = chatMessages.slice(0, 10).reverse();
  const now = /* @__PURE__ */ new Date();
  const dayOfWeek = now.toLocaleDateString("en-US", { weekday: "long" });
  const dateStr = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const goalsText = userGoals.length > 0 ? userGoals.map((g) => `- ${g.title} (${g.category}): ${g.current}/${g.target} ${g.unit}`).join("\n") : "No goals set";
  const commitmentsText = userCommitments.length > 0 ? userCommitments.map((c) => `- [id:${c.id}] "${c.content}"${c.dueDate ? ` (due ${c.dueDate})` : ""}`).join("\n") : "";
  const calendarText = calendarEvents.length > 0 ? calendarEvents.slice(0, 8).map((e) => `- ${e.time ? e.time + ": " : ""}${e.title}`).join("\n") : "";
  const gmailSection = gmailItems.length > 0 ? `## Recent Emails (last 14 days)
` + gmailItems.slice(0, 100).map((i) => `- [id:${i.id}] From: ${i.from || "unknown"} | "${i.subject}" \u2014 ${i.snippet}`).join("\n") : gmailConnected ? `## Recent Emails
Gmail is connected but no emails found.` : `## Recent Emails
Gmail not connected.`;
  const recentInteractions = recentInteractionsResult.status === "fulfilled" ? recentInteractionsResult.value : [];
  const crossChannelSection = formatInteractionTimeline(recentInteractions);
  const soulBlock = await getSoulPromptBlock(userId2);
  const formatHint = FORMAT_HINTS[channelName] || FORMAT_HINTS.Telegram;
  const daemonPaired = isUserPaired(userId2);
  const androidActive = daemonPaired ? await isAndroidDaemonActive(userId2) : false;
  const daemonSection = daemonPaired ? androidActive ? "## Connected Devices\n- Android device daemon is ACTIVE. You can open apps (android_open_app), take screenshots (android_screenshot), read the screen (android_read_screen), browse URLs (android_browse), list/read files on the device (android_file_list/android_file_read). Tap/type/swipe actions are available when user enables them. Proactively mention Android capabilities when relevant." : "## Connected Devices\n- Desktop daemon is ACTIVE. You can run shell commands, send desktop notifications, and read/write files in the user's workspace." : "## Android Daemon Setup Guidance (no daemon paired)\nIf the user asks how to install or set up the Android daemon, give them these steps:\n1. In the Jarvis app \u2192 Profile \u2192 Connected Channels \u2192 Android Device \u2192 tap Pair to get an 8-character code.\n2. Build the APK: open android-daemon/ in Android Studio \u2192 Build \u2192 Generate Signed Bundle/APK \u2192 APK \u2192 debug. Or run `gradle wrapper --gradle-version 8.4` then `./gradlew assembleDebug` from the android-daemon/ directory.\n3. Transfer the APK to the Android phone and install it (Settings \u2192 Apps \u2192 Special app access \u2192 Install unknown apps \u2192 allow your file manager).\n4. Open the app \u2192 enter the server URL + the 8-character code \u2192 tap Connect.\n5. Grant the two permissions the app requests: Accessibility Service (Settings \u2192 Accessibility \u2192 Jarvis Daemon \u2192 enable) and All Files Access.\n6. The app stays connected in the background and reconnects automatically after reboots or Wi-Fi drops.";
  const systemPrompt = `You are GamePlan Coach Jarvis \u2014 a sharp, supportive personal productivity coach. ${formatHint}

Today is ${dayOfWeek}, ${dateStr}. User's timezone: ${userTimezone}.
${crossChannelSection}

${soulBlock}

## User Profile
- Streak: ${userStats.streak || 0} days
- Total completed: ${userStats.totalCompleted || 0}
- XP: ${userStats.xp || 0}

## Active Goals
${goalsText}
${commitmentsText ? `
## Open Commitments
${commitmentsText}` : ""}
${calendarText ? `
## Today's Calendar
${calendarText}` : ""}

${gmailSection}
${userLifeContext?.priorityGoal ? `
## Context
- Priority: ${userLifeContext.priorityGoal}` : ""}
${daemonSection ? `
${daemonSection}` : ""}

You can manage tasks, commitments, and analyze patterns via the manage_tasks tool. You can act on emails via the gmail_action tool. You can run safe shell commands, send desktop notifications, or read/write files in the user's workspace via the daemon_action tool when a desktop daemon is paired. When an Android device daemon is paired, use android_* actions to control the phone \u2014 open apps, browse, screenshot, read the screen, and access files. Always confirm with the user before tap/type/swipe actions. Use these proactively when the user asks to do something \u2014 don't just describe what you'd do. Respond in the same language the user writes in.`;
  const userMessageContent = imageUrl ? [
    { type: "text", text: userText || "What do you see in this image?" },
    { type: "image_url", image_url: { url: imageUrl } }
  ] : userText;
  const baseMessages = [
    { role: "system", content: systemPrompt },
    ...recentMessages.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content
    })),
    { role: "user", content: userMessageContent }
  ];
  const agentCtx = {
    userId: userId2,
    channel: channelName,
    googleAccessToken: googleAccessToken || void 0,
    state: {
      dateKey,
      todayPlan,
      gmailMessageIds: gmailItems.map((i) => i.id).filter((id) => !!id),
      pendingAttachments: []
    }
  };
  const agentResult = await runAgent({
    model: "gpt-5-mini",
    messages: baseMessages,
    tools: telegramCoachTools({ hasGoogle: !!googleAccessToken }),
    context: agentCtx,
    maxTurns: 6,
    maxCompletionTokens: 2e3,
    onToken
  });
  console.log(`[${channelName}] coach agent \u2014 turns=${agentResult.turns}, tools=${agentResult.toolCalls.length}, finish=${agentResult.finishReason}`);
  const reply = agentResult.reply || "Sorry, I couldn't generate a response right now.";
  const attachments = agentCtx.state.pendingAttachments || [];
  const userMsg = { id: Date.now().toString(), role: "user", content: userText };
  const assistantMsg = { id: (Date.now() + 1).toString(), role: "assistant", content: reply };
  const updatedChat = [assistantMsg, userMsg, ...chatMessages].slice(0, 100);
  try {
    await db.insert(chatHistory).values({ userId: userId2, data: updatedChat }).onConflictDoUpdate({
      target: chatHistory.userId,
      set: { data: updatedChat, updatedAt: /* @__PURE__ */ new Date() }
    });
  } catch (err) {
    console.error("[coach] chat history persist failed:", err);
  }
  return { reply, attachments };
}
var FORMAT_HINTS;
var init_coachAgent = __esm({
  "server/channels/coachAgent.ts"() {
    "use strict";
    init_db();
    init_schema();
    init_harness();
    init_tools();
    init_userTokenStore();
    init_gmail();
    init_googleCalendar();
    init_interactionLog();
    init_soul();
    init_bridge();
    FORMAT_HINTS = {
      Telegram: "You're responding via Telegram. Keep messages SHORT (2-4 sentences). Plain text, no markdown headers.",
      WhatsApp: "You're responding via WhatsApp. Keep messages SHORT (2-4 sentences). Plain text. WhatsApp supports *bold*, _italic_, `code` only \u2014 no markdown headers.",
      Slack: "You're responding via Slack DM. Keep messages SHORT (2-4 sentences). Use Slack mrkdwn (*bold*, _italic_, `code`, > quote). No markdown headers.",
      Daemon: "You're responding to a desktop daemon. Plain text only. The user sees the reply as a desktop notification \u2014 keep it under 2 sentences when possible.",
      Discord: "You're responding via Discord DM. Keep messages SHORT (2-4 sentences). Discord renders standard markdown: **bold**, _italic_, `code`, ```blocks```. No oversized headers."
    };
  }
});

// server/discord/workspace.ts
import {
  ChannelType
} from "discord.js";
import { eq as eq12, and as and8 } from "drizzle-orm";
function classifyTopic(text2) {
  const lower = text2.toLowerCase();
  let best = { key: "thinking", score: 0 };
  for (const topic of WORKSPACE_TOPICS) {
    let score = 0;
    for (const kw of topic.keywords) {
      if (lower.includes(kw)) score++;
    }
    if (score > best.score) {
      best = { key: topic.key, score };
    }
  }
  return best.key;
}
async function setupWorkspace(client, userId2, guildId) {
  try {
    const guild = await client.guilds.fetch(guildId);
    const existingCat = guild.channels.cache.find(
      (ch) => ch.type === ChannelType.GuildCategory && ch.name === "\u{1F9E0} Jarvis Workspace"
    );
    let category;
    if (existingCat) {
      category = existingCat;
    } else {
      category = await guild.channels.create({
        name: "\u{1F9E0} Jarvis Workspace",
        type: ChannelType.GuildCategory
      });
    }
    const channelIds = {};
    for (const topic of WORKSPACE_TOPICS) {
      const channelName = `${topic.emoji}${topic.name}`;
      const existing = guild.channels.cache.find(
        (ch) => ch.type === ChannelType.GuildText && ch.parentId === category.id && ch.name === `${topic.emoji}${topic.name}`
      );
      if (existing) {
        channelIds[topic.key] = existing.id;
      } else {
        const created = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: category.id,
          topic: topic.description
        });
        channelIds[topic.key] = created.id;
        await created.send(
          `**${topic.emoji} ${topic.name.charAt(0).toUpperCase() + topic.name.slice(1)}**
${topic.description}

_Jarvis will post relevant updates here and you can ask me anything in this topic._`
        ).catch(() => {
        });
      }
    }
    const workspace = {
      guildId,
      guildName: guild.name,
      categoryId: category.id,
      channels: channelIds
    };
    const rows = await db.select().from(channelLinks).where(and8(eq12(channelLinks.userId, userId2), eq12(channelLinks.channel, "discord"))).limit(1);
    if (rows.length > 0) {
      const existing = rows[0].metadata || {};
      await db.update(channelLinks).set({ metadata: { ...existing, workspace } }).where(and8(eq12(channelLinks.userId, userId2), eq12(channelLinks.channel, "discord")));
    }
    return { ok: true, workspace };
  } catch (err) {
    console.error("[Workspace] setup failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
async function postToTopicChannel(client, workspace, topicKey, text2) {
  const channelId = workspace.channels[topicKey] ?? workspace.channels["thinking"];
  if (!channelId) return false;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return false;
    const chunks = splitIntoChunks(text2, 1900);
    for (const chunk of chunks) {
      await channel.send(chunk);
    }
    return true;
  } catch (err) {
    console.error("[Workspace] postToTopicChannel failed:", err);
    return false;
  }
}
function splitIntoChunks(text2, maxLen) {
  if (text2.length <= maxLen) return [text2];
  const chunks = [];
  while (text2.length > 0) {
    let cut = maxLen;
    if (text2.length > maxLen) {
      const nl = text2.lastIndexOf("\n", maxLen);
      if (nl > maxLen * 0.5) cut = nl + 1;
    }
    chunks.push(text2.slice(0, cut));
    text2 = text2.slice(cut);
  }
  return chunks;
}
function getTopicForChannel(workspace, channelId) {
  if (!workspace) return null;
  for (const [key, id] of Object.entries(workspace.channels)) {
    if (id === channelId) {
      return WORKSPACE_TOPICS.find((t) => t.key === key) ?? null;
    }
  }
  return null;
}
var WORKSPACE_TOPICS;
var init_workspace = __esm({
  "server/discord/workspace.ts"() {
    "use strict";
    init_db();
    init_schema();
    WORKSPACE_TOPICS = [
      {
        key: "tasks",
        emoji: "\u{1F4CB}",
        name: "tasks",
        description: "Daily plans, tasks, morning briefings, and to-do tracking.",
        keywords: ["task", "todo", "plan", "morning", "schedule", "reminder", "deadline", "priority", "checklist", "habit"]
      },
      {
        key: "finance",
        emoji: "\u{1F4B0}",
        name: "finance",
        description: "Money, budgets, expenses, investments, and financial goals.",
        keywords: ["money", "finance", "budget", "expense", "income", "invest", "savings", "cost", "revenue", "profit", "debt", "credit", "bank", "tax", "salary", "payment"]
      },
      {
        key: "ideas",
        emoji: "\u{1F4A1}",
        name: "ideas",
        description: "App ideas, product concepts, creative sparks, and feature brainstorms.",
        keywords: ["idea", "app", "product", "feature", "build", "startup", "prototype", "design", "concept", "innovation", "saas", "tool", "software"]
      },
      {
        key: "business",
        emoji: "\u{1F4BC}",
        name: "business",
        description: "Work, clients, business strategy, goals, and professional growth.",
        keywords: ["business", "client", "work", "project", "meeting", "strategy", "goal", "company", "sales", "marketing", "partnership", "pitch", "contract", "team"]
      },
      {
        key: "personal",
        emoji: "\u{1F331}",
        name: "personal",
        description: "Health, relationships, personal growth, and life balance.",
        keywords: ["health", "sleep", "exercise", "workout", "relationship", "family", "friend", "personal", "mindset", "stress", "energy", "mental", "wellness", "habit", "life"]
      },
      {
        key: "thinking",
        emoji: "\u{1F9E0}",
        name: "thinking",
        description: "Jarvis reflections, long-form planning, and strategic thinking logs.",
        keywords: ["reflect", "think", "insight", "analysis", "review", "retrospective", "learn", "pattern", "observation"]
      }
    ];
  }
});

// server/replit_integrations/audio/client.ts
var client_exports = {};
__export(client_exports, {
  convertToWav: () => convertToWav,
  detectAudioFormat: () => detectAudioFormat,
  ensureCompatibleFormat: () => ensureCompatibleFormat,
  openai: () => openai7,
  speechToText: () => speechToText,
  speechToTextStream: () => speechToTextStream,
  textToSpeech: () => textToSpeech,
  textToSpeechStream: () => textToSpeechStream,
  voiceChat: () => voiceChat,
  voiceChatStream: () => voiceChatStream
});
import OpenAI7, { toFile } from "openai";
import { Buffer as Buffer3 } from "node:buffer";
import { spawn } from "child_process";
import { writeFile, unlink, readFile } from "fs/promises";
import { randomUUID } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
function detectAudioFormat(buffer) {
  if (buffer.length < 12) return "unknown";
  if (buffer[0] === 82 && buffer[1] === 73 && buffer[2] === 70 && buffer[3] === 70) {
    return "wav";
  }
  if (buffer[0] === 26 && buffer[1] === 69 && buffer[2] === 223 && buffer[3] === 163) {
    return "webm";
  }
  if (buffer[0] === 255 && (buffer[1] === 251 || buffer[1] === 250 || buffer[1] === 243) || buffer[0] === 73 && buffer[1] === 68 && buffer[2] === 51) {
    return "mp3";
  }
  if (buffer[4] === 102 && buffer[5] === 116 && buffer[6] === 121 && buffer[7] === 112) {
    return "mp4";
  }
  if (buffer[0] === 79 && buffer[1] === 103 && buffer[2] === 103 && buffer[3] === 83) {
    return "ogg";
  }
  return "unknown";
}
async function convertToWav(audioBuffer) {
  const inputPath = join(tmpdir(), `input-${randomUUID()}`);
  const outputPath = join(tmpdir(), `output-${randomUUID()}.wav`);
  try {
    await writeFile(inputPath, audioBuffer);
    await new Promise((resolve4, reject) => {
      const ffmpeg = spawn("ffmpeg", [
        "-i",
        inputPath,
        "-vn",
        // Extract audio only (ignore video track)
        "-f",
        "wav",
        "-ar",
        "16000",
        // 16kHz sample rate (good for speech)
        "-ac",
        "1",
        // Mono
        "-acodec",
        "pcm_s16le",
        "-y",
        // Overwrite output
        outputPath
      ]);
      ffmpeg.stderr.on("data", () => {
      });
      ffmpeg.on("close", (code) => {
        if (code === 0) resolve4();
        else reject(new Error(`ffmpeg exited with code ${code}`));
      });
      ffmpeg.on("error", reject);
    });
    return await readFile(outputPath);
  } finally {
    await unlink(inputPath).catch(() => {
    });
    await unlink(outputPath).catch(() => {
    });
  }
}
async function ensureCompatibleFormat(audioBuffer) {
  const detected = detectAudioFormat(audioBuffer);
  if (detected === "wav") return { buffer: audioBuffer, format: "wav" };
  if (detected === "mp3") return { buffer: audioBuffer, format: "mp3" };
  const wavBuffer = await convertToWav(audioBuffer);
  return { buffer: wavBuffer, format: "wav" };
}
async function voiceChat(audioBuffer, voice = "alloy", inputFormat = "wav", outputFormat = "mp3") {
  const audioBase64 = audioBuffer.toString("base64");
  const response = await openai7.chat.completions.create({
    model: "gpt-audio",
    modalities: ["text", "audio"],
    audio: { voice, format: outputFormat },
    messages: [{
      role: "user",
      content: [
        { type: "input_audio", input_audio: { data: audioBase64, format: inputFormat } }
      ]
    }]
  });
  const message = response.choices[0]?.message;
  const transcript = message?.audio?.transcript || message?.content || "";
  const audioData = message?.audio?.data ?? "";
  return {
    transcript,
    audioResponse: Buffer3.from(audioData, "base64")
  };
}
async function voiceChatStream(audioBuffer, voice = "alloy", inputFormat = "wav") {
  const audioBase64 = audioBuffer.toString("base64");
  const stream = await openai7.chat.completions.create({
    model: "gpt-audio",
    modalities: ["text", "audio"],
    audio: { voice, format: "pcm16" },
    messages: [{
      role: "user",
      content: [
        { type: "input_audio", input_audio: { data: audioBase64, format: inputFormat } }
      ]
    }],
    stream: true
  });
  return (async function* () {
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta?.audio?.transcript) {
        yield { type: "transcript", data: delta.audio.transcript };
      }
      if (delta?.audio?.data) {
        yield { type: "audio", data: delta.audio.data };
      }
    }
  })();
}
async function textToSpeech(text2, voice = "alloy", format = "mp3") {
  const response = await openai7.chat.completions.create({
    model: "gpt-audio",
    modalities: ["text", "audio"],
    audio: { voice, format },
    messages: [
      { role: "system", content: "You are an assistant that performs text-to-speech. Repeat the user's text exactly as written, with no additions, commentary, or modifications." },
      { role: "user", content: text2 }
    ]
  });
  const audioData = response.choices[0]?.message?.audio?.data ?? "";
  return Buffer3.from(audioData, "base64");
}
async function textToSpeechStream(text2, voice = "alloy") {
  const stream = await openai7.chat.completions.create({
    model: "gpt-audio",
    modalities: ["text", "audio"],
    audio: { voice, format: "pcm16" },
    messages: [
      { role: "system", content: "You are an assistant that performs text-to-speech." },
      { role: "user", content: `Repeat the following text verbatim: ${text2}` }
    ],
    stream: true
  });
  return (async function* () {
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta?.audio?.data) {
        yield delta.audio.data;
      }
    }
  })();
}
async function speechToText(audioBuffer, format = "wav") {
  const ext = format === "unknown" ? "wav" : format;
  const file = await toFile(audioBuffer, `audio.${ext}`);
  const response = await openai7.audio.transcriptions.create({
    file,
    model: "gpt-4o-mini-transcribe"
  });
  return response.text;
}
async function speechToTextStream(audioBuffer, format = "wav") {
  const ext = format === "unknown" ? "wav" : format;
  const file = await toFile(audioBuffer, `audio.${ext}`);
  const stream = await openai7.audio.transcriptions.create({
    file,
    model: "gpt-4o-mini-transcribe",
    stream: true
  });
  return (async function* () {
    for await (const event of stream) {
      if (event.type === "transcript.text.delta") {
        yield event.delta;
      }
    }
  })();
}
var openai7;
var init_client = __esm({
  "server/replit_integrations/audio/client.ts"() {
    "use strict";
    openai7 = new OpenAI7({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
    });
  }
});

// server/discord/manager.ts
import { Client as Client3, GatewayIntentBits, Events, Partials } from "discord.js";
import { eq as eq13, and as and9 } from "drizzle-orm";
function generateCode(len = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < len; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
async function lookupLink(userId2) {
  try {
    const rows = await db.select().from(channelLinks).where(and9(eq13(channelLinks.userId, userId2), eq13(channelLinks.channel, "discord"))).limit(1);
    const row = rows[0];
    if (!row) return null;
    return { address: row.address, meta: row.metadata || {} };
  } catch (err) {
    console.error("[DiscordManager] link lookup failed:", err);
    return null;
  }
}
async function lookupUserByDiscordId(discordUserId) {
  try {
    const rows = await db.select().from(channelLinks).where(and9(eq13(channelLinks.channel, "discord"), eq13(channelLinks.address, discordUserId))).limit(1);
    const row = rows[0];
    if (!row) return null;
    return { userId: row.userId, meta: row.metadata || {} };
  } catch (err) {
    console.error("[DiscordManager] reverse lookup failed:", err);
    return null;
  }
}
function buildMessageHandler(botOwnerId, client) {
  return async (message) => {
    if (message.author.bot) return;
    const isDM = message.channel.isDMBased();
    const discordUserId = message.author.id;
    const discordUsername = message.author.tag || message.author.username;
    if (!isDM) {
      const link = await lookupLink(botOwnerId);
      if (!link) return;
      if (link.address !== discordUserId) return;
      const allowed = link.meta.allowlistedGuilds || [];
      const guildId = message.guild?.id ?? "";
      const channelId = message.channelId;
      const guildEntry = allowed.find((g) => g.guildId === guildId && g.channelId === channelId);
      if (!guildEntry) return;
      if (guildEntry.requireMention) {
        const botId = client.user?.id;
        const mentioned = message.mentions.users.has(botId ?? "");
        if (!mentioned) return;
      }
    }
    const pairedUser = await lookupUserByDiscordId(discordUserId);
    if (!pairedUser || pairedUser.userId !== botOwnerId) {
      let code = null;
      for (const [c, rec] of pairingCodes) {
        if (rec.botOwnerId === botOwnerId && rec.discordUserId === discordUserId && rec.expiresAt > Date.now()) {
          code = c;
          break;
        }
      }
      if (!code) {
        code = generateCode(6);
        pairingCodes.set(code, {
          botOwnerId,
          discordUserId,
          discordDmChannelId: message.channelId,
          discordUsername,
          expiresAt: Date.now() + 60 * 60 * 1e3
        });
      }
      await message.reply(
        `\u{1F44B} Hey! I'm Jarvis, your AI productivity coach.

To link this Discord account, use **either** of these:

**Option A \u2014 in the app:** Profile \u2192 Connected Channels \u2192 Discord \u2192 enter code
**Option B \u2014 via Telegram:** Send \`approve ${code}\` to your Jarvis Telegram bot

Your pairing code: \`\`\`${code}\`\`\`
Valid for 1 hour. Message me again once linked!`
      ).catch((err) => console.error("[DiscordManager] reply failed:", err));
      return;
    }
    const userId2 = pairedUser.userId;
    db.update(channelLinks).set({ lastSeenAt: /* @__PURE__ */ new Date() }).where(and9(eq13(channelLinks.userId, userId2), eq13(channelLinks.channel, "discord"))).catch(() => {
    });
    let userText = message.content?.trim() || "";
    const audioAtt = [...message.attachments.values()].find(
      (a) => a.contentType?.startsWith("audio/") || a.contentType?.startsWith("video/")
    );
    if (audioAtt && !userText) {
      let typingMsg = null;
      try {
        typingMsg = await message.channel.send("\u{1F3A4} Transcribing voice message\u2026");
        const resp = await fetch(audioAtt.url);
        const arrBuf = await resp.arrayBuffer();
        const buf = Buffer.from(arrBuf);
        const { speechToText: speechToText2, detectAudioFormat: detectAudioFormat2 } = await Promise.resolve().then(() => (init_client(), client_exports));
        const format = detectAudioFormat2(buf);
        const transcript = await speechToText2(buf, format);
        if (!transcript?.trim()) {
          await typingMsg.edit("Sorry, I couldn't make out that voice message \u2014 could you type it out?");
          return;
        }
        userText = transcript.trim();
        const preview = userText.length > 100 ? userText.slice(0, 100) + "\u2026" : userText;
        await typingMsg.edit(`\u{1F3A4} *"${preview}"*`);
      } catch (err) {
        console.error("[DiscordManager] voice transcription failed:", err);
        if (typingMsg) await typingMsg.edit("Sorry, transcription failed \u2014 please type your message.").catch(() => {
        });
        return;
      }
    }
    if (!userText) return;
    const link2 = await lookupLink(botOwnerId);
    const workspace = link2?.meta.workspace;
    const topicForChannel = getTopicForChannel(workspace, message.channelId);
    const channelLabel = topicForChannel ? `Discord #${topicForChannel.emoji}${topicForChannel.name}` : "Discord";
    const topicContext = topicForChannel ? `

[Workspace channel: ${topicForChannel.emoji} ${topicForChannel.name.charAt(0).toUpperCase() + topicForChannel.name.slice(1)}. ${topicForChannel.description} Keep your response focused on this life area unless the user explicitly asks about something else.]` : "";
    let placeholder = null;
    try {
      placeholder = await message.channel.send("_Thinking\u2026_");
    } catch {
    }
    let streamBuf = "";
    let lastEditAt = 0;
    const STREAM_INTERVAL = 900;
    const onToken = (chunk) => {
      streamBuf += chunk;
      const now = Date.now();
      if (placeholder && now - lastEditAt >= STREAM_INTERVAL && streamBuf.length > 0) {
        placeholder.edit(streamBuf + " \u258C").catch(() => {
        });
        lastEditAt = now;
      }
    };
    try {
      const result = await runCoachAgent({
        userId: userId2,
        userText: topicContext ? userText + topicContext : userText,
        channelName: channelLabel,
        onToken
      });
      const reply = result.reply || "Sorry, I couldn't generate a response right now.";
      if (placeholder) {
        await editOrSendLong(placeholder, reply);
      } else {
        await sendLong(message.channel, reply);
      }
    } catch (err) {
      console.error("[DiscordManager] runCoachAgent failed:", err);
      if (placeholder) {
        await placeholder.edit("Sorry, something went wrong \u2014 please try again.").catch(() => {
        });
      }
    }
  };
}
async function editOrSendLong(msg, text2) {
  const chunks = splitIntoChunks2(text2, 1900);
  await msg.edit(chunks[0]).catch(() => {
  });
  for (let i = 1; i < chunks.length; i++) {
    await msg.channel.send(chunks[i]).catch(() => {
    });
  }
}
async function sendLong(channel, text2) {
  const chunks = splitIntoChunks2(text2, 1900);
  for (const chunk of chunks) {
    await channel.send(chunk).catch(() => {
    });
  }
}
function splitIntoChunks2(text2, maxLen) {
  if (text2.length <= maxLen) return [text2];
  const chunks = [];
  while (text2.length > 0) {
    let cut = maxLen;
    if (text2.length > maxLen) {
      const nl = text2.lastIndexOf("\n", maxLen);
      if (nl > maxLen * 0.5) cut = nl + 1;
    }
    chunks.push(text2.slice(0, cut));
    text2 = text2.slice(cut);
  }
  return chunks;
}
async function startUserBot(userId2, botToken) {
  stopUserBot(userId2);
  const client = new Client3({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.DirectMessageReactions
    ],
    partials: [Partials.Channel, Partials.Message]
  });
  client.once(Events.ClientReady, (c) => {
    console.log(`[DiscordManager] Bot ready for user ${userId2}: ${c.user.tag}`);
  });
  client.on(Events.MessageCreate, buildMessageHandler(userId2, client));
  client.on(Events.Error, (err) => {
    console.error(`[DiscordManager] Client error for user ${userId2}:`, err.message);
  });
  botClients.set(userId2, client);
  try {
    await client.login(botToken);
  } catch (err) {
    console.error(`[DiscordManager] Login failed for user ${userId2}:`, err);
    botClients.delete(userId2);
    throw err;
  }
}
function stopUserBot(userId2) {
  const client = botClients.get(userId2);
  if (client) {
    client.destroy();
    botClients.delete(userId2);
    console.log(`[DiscordManager] Bot stopped for user ${userId2}`);
  }
}
function getBotStatus(userId2) {
  const client = botClients.get(userId2);
  if (!client) return "stopped";
  return client.isReady() ? "running" : "stopped";
}
async function bootAllBots() {
  try {
    const { db: _db } = await Promise.resolve().then(() => (init_db(), db_exports));
    const { sql: sql20 } = await import("drizzle-orm");
    const rows = await _db.execute(
      sql20`SELECT user_id, access_token FROM user_oauth_tokens WHERE provider = 'discord_bot'`
    );
    const items = rows.rows ?? (Array.isArray(rows) ? rows : []);
    let started = 0;
    for (const row of items) {
      try {
        await startUserBot(row.user_id, row.access_token);
        started++;
      } catch {
      }
    }
    console.log(`[DiscordManager] Booted ${started}/${items.length} Discord bot(s)`);
  } catch (err) {
    console.error("[DiscordManager] bootAllBots failed:", err);
  }
}
async function completePairing(userId2, code) {
  const rec = pairingCodes.get(code.toUpperCase());
  if (!rec) return { ok: false, error: "Invalid or expired pairing code." };
  if (rec.expiresAt < Date.now()) {
    pairingCodes.delete(code.toUpperCase());
    return { ok: false, error: "Pairing code has expired." };
  }
  if (rec.botOwnerId !== userId2) {
    return { ok: false, error: "This pairing code belongs to a different account." };
  }
  try {
    const meta = {
      discordUsername: rec.discordUsername,
      dmChannelId: rec.discordDmChannelId,
      allowlistedGuilds: []
    };
    await db.delete(channelLinks).where(
      and9(eq13(channelLinks.userId, userId2), eq13(channelLinks.channel, "discord"))
    );
    await db.delete(channelLinks).where(
      and9(eq13(channelLinks.channel, "discord"), eq13(channelLinks.address, rec.discordUserId))
    );
    await db.insert(channelLinks).values({
      userId: userId2,
      channel: "discord",
      address: rec.discordUserId,
      metadata: meta,
      linkedAt: /* @__PURE__ */ new Date()
    });
  } catch (err) {
    console.error("[DiscordManager] completePairing DB write failed:", err);
    return { ok: false, error: "Database error \u2014 please try again." };
  }
  pairingCodes.delete(code.toUpperCase());
  const client = botClients.get(userId2);
  if (client) {
    try {
      const dmChannel = await client.channels.fetch(rec.discordDmChannelId);
      if (dmChannel && dmChannel.send) {
        await dmChannel.send(
          "\u2705 Your Discord account is now linked to Jarvis! You can chat with me directly here anytime."
        );
      }
    } catch {
    }
  }
  return { ok: true, discordUsername: rec.discordUsername };
}
async function sendToDiscordUser(userId2, text2) {
  const client = botClients.get(userId2);
  if (!client || !client.isReady()) return false;
  const link = await lookupLink(userId2);
  if (!link) return false;
  let dmChannelId = link.meta.dmChannelId;
  const discordUserId = link.address;
  try {
    if (!dmChannelId) {
      const discordUser = await client.users.fetch(discordUserId);
      const dm = await discordUser.createDM();
      dmChannelId = dm.id;
      await db.update(channelLinks).set({ metadata: { ...link.meta, dmChannelId } }).where(and9(eq13(channelLinks.userId, userId2), eq13(channelLinks.channel, "discord")));
    }
    const channel = await client.channels.fetch(dmChannelId);
    if (!channel) return false;
    const chunks = splitIntoChunks2(text2, 1900);
    for (const chunk of chunks) {
      await channel.send(chunk);
    }
    return true;
  } catch (err) {
    console.error(`[DiscordManager] sendToDiscordUser failed for ${userId2}:`, err);
    return false;
  }
}
function getGuildsForUser(userId2) {
  const client = botClients.get(userId2);
  if (!client || !client.isReady()) return [];
  return client.guilds.cache.map((g) => ({ id: g.id, name: g.name, icon: g.iconURL() }));
}
async function getChannelsForGuild(userId2, guildId) {
  const client = botClients.get(userId2);
  if (!client || !client.isReady()) return [];
  try {
    const guild = await client.guilds.fetch(guildId);
    const channels2 = await guild.channels.fetch();
    return channels2.filter((ch) => !!ch && ch.isTextBased && ch.isTextBased()).map((ch) => ({ id: ch.id, name: ch.name, type: ch.type.toString() }));
  } catch {
    return [];
  }
}
async function setupDiscordWorkspace(userId2, guildId) {
  const client = botClients.get(userId2);
  if (!client || !client.isReady()) {
    return { ok: false, error: "Discord bot is not running. Make sure your bot token is saved and the bot is in the server." };
  }
  return setupWorkspace(client, userId2, guildId);
}
async function postToDiscordWorkspace(userId2, topicKey, text2) {
  const client = botClients.get(userId2);
  if (!client || !client.isReady()) return false;
  const link = await lookupLink(userId2);
  const workspace = link?.meta.workspace;
  if (!workspace) return false;
  return postToTopicChannel(client, workspace, topicKey, text2);
}
var botClients, pairingCodes;
var init_manager = __esm({
  "server/discord/manager.ts"() {
    "use strict";
    init_db();
    init_schema();
    init_coachAgent();
    init_workspace();
    init_workspace();
    botClients = /* @__PURE__ */ new Map();
    pairingCodes = /* @__PURE__ */ new Map();
    setInterval(() => {
      const now = Date.now();
      for (const [code, rec] of pairingCodes) {
        if (rec.expiresAt < now) pairingCodes.delete(code);
      }
    }, 5 * 60 * 1e3);
  }
});

// server/inboxRules.ts
var inboxRules_exports = {};
__export(inboxRules_exports, {
  createRuleFromText: () => createRuleFromText,
  getUserInboxRules: () => getUserInboxRules,
  learnFromDismissal: () => learnFromDismissal,
  matchItemAgainstRules: () => matchItemAgainstRules
});
import { eq as eq14, and as and10 } from "drizzle-orm";
import OpenAI8 from "openai";
function normalizeForMatch(text2) {
  return (text2 || "").toLowerCase().trim();
}
function extractDomain(email) {
  const match = email.match(/@([a-zA-Z0-9.-]+)/);
  return match ? match[1].toLowerCase() : "";
}
function doesRuleMatch(rule, senderNorm, senderDomain, subjectNorm, snippetNorm, locationNorm, allText) {
  const hints = rule.matchHints || {};
  if (hints.domains && hints.domains.length > 0) {
    for (const d of hints.domains) {
      if (senderDomain.includes(d.toLowerCase())) return true;
    }
  }
  if (hints.senders && hints.senders.length > 0) {
    for (const s of hints.senders) {
      if (senderNorm.includes(s.toLowerCase())) return true;
    }
  }
  if (hints.subjectKeywords && hints.subjectKeywords.length > 0) {
    for (const kw of hints.subjectKeywords) {
      if (subjectNorm.includes(kw.toLowerCase()) || snippetNorm.includes(kw.toLowerCase())) return true;
    }
  }
  if (hints.locationKeywords && hints.locationKeywords.length > 0) {
    for (const lk of hints.locationKeywords) {
      if (locationNorm.includes(lk.toLowerCase()) || allText.includes(lk.toLowerCase())) return true;
    }
  }
  const patternWords = rule.pattern.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !["from", "any", "all", "the", "about", "with", "that", "this"].includes(w));
  if (patternWords.length > 0) {
    const matchedWords = patternWords.filter((w) => allText.includes(w));
    if (matchedWords.length >= Math.ceil(patternWords.length * 0.6)) return true;
  }
  return false;
}
function incrementMatchCount(rule) {
  db.update(inboxRules).set({
    matchCount: String(parseInt(rule.matchCount || "0") + 1),
    updatedAt: /* @__PURE__ */ new Date()
  }).where(eq14(inboxRules.id, rule.id)).catch(() => {
  });
}
function matchItemAgainstRules(item, rules) {
  const senderNorm = normalizeForMatch(item.sender || "");
  const subjectNorm = normalizeForMatch(item.subject || "");
  const snippetNorm = normalizeForMatch(item.snippet || "");
  const locationNorm = normalizeForMatch(item.location || "");
  const senderDomain = item.sender ? extractDomain(item.sender) : "";
  const allText = `${senderNorm} ${subjectNorm} ${snippetNorm} ${locationNorm}`;
  const activeRules = rules.filter(
    (r) => r.active !== "false" && (r.scope === "both" || r.scope === item.sourceType)
  );
  const suppressRules = activeRules.filter((r) => r.type === "suppress");
  const surfaceRules = activeRules.filter((r) => r.type === "surface");
  for (const rule of suppressRules) {
    if (doesRuleMatch(rule, senderNorm, senderDomain, subjectNorm, snippetNorm, locationNorm, allText)) {
      incrementMatchCount(rule);
      return { verdict: "suppress", matchedRuleId: rule.id };
    }
  }
  for (const rule of surfaceRules) {
    if (doesRuleMatch(rule, senderNorm, senderDomain, subjectNorm, snippetNorm, locationNorm, allText)) {
      incrementMatchCount(rule);
      return { verdict: "surface", matchedRuleId: rule.id };
    }
  }
  return { verdict: "default" };
}
async function getUserInboxRules(userId2) {
  return db.select().from(inboxRules).where(eq14(inboxRules.userId, userId2));
}
async function learnFromDismissal(userId2, itemId, telegramChatId) {
  const [item] = await db.select().from(inboxItems).where(and10(eq14(inboxItems.id, itemId), eq14(inboxItems.userId, userId2)));
  if (!item) return { learned: false };
  if (item.sourceType !== "email") return { learned: false };
  const newCount = String(parseInt(item.dismissCount || "0") + 1);
  await db.update(inboxItems).set({ dismissCount: newCount, status: "dismissed", actedAt: /* @__PURE__ */ new Date() }).where(eq14(inboxItems.id, itemId));
  const senderDomain = item.sender ? extractDomain(item.sender) : "";
  if (!senderDomain) return { learned: false };
  const dismissed = await db.select().from(inboxItems).where(
    and10(
      eq14(inboxItems.userId, userId2),
      eq14(inboxItems.status, "dismissed")
    )
  );
  const domainDismissals = dismissed.filter(
    (d) => d.sender && extractDomain(d.sender) === senderDomain
  ).length;
  if (domainDismissals >= 3) {
    const existing = await db.select().from(inboxRules).where(
      and10(
        eq14(inboxRules.userId, userId2),
        eq14(inboxRules.type, "suppress"),
        eq14(inboxRules.source, "learned")
      )
    );
    const alreadyHas = existing.some((r) => {
      const hints = r.matchHints || {};
      return hints.domains?.includes(senderDomain);
    });
    if (!alreadyHas) {
      const ruleName = `Auto: suppress ${senderDomain}`;
      await db.insert(inboxRules).values({
        userId: userId2,
        type: "suppress",
        scope: "email",
        pattern: ruleName,
        matchHints: { domains: [senderDomain] },
        source: "learned"
      });
      console.log(`[InboxRules] Learned suppress rule for ${senderDomain} (user ${userId2})`);
      if (telegramChatId) {
        try {
          const { sendMessage: sendMessage2 } = await Promise.resolve().then(() => (init_telegram(), telegram_exports));
          await sendMessage2(
            telegramChatId,
            `\u{1F9E0} I've learned to stop surfacing emails from ${senderDomain} \u2014 you've dismissed them ${domainDismissals} times. You can review or remove this rule in your Inbox Rules settings.`
          );
        } catch {
        }
      }
      return { learned: true, ruleName };
    }
  }
  return { learned: false };
}
async function createRuleFromText(userId2, text2, type, scope) {
  let matchHints = {};
  try {
    const response = await openai8.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        {
          role: "system",
          content: `Extract matching hints from this inbox rule description. Return JSON only:
{ "senders": [], "subjectKeywords": [], "domains": [], "locationKeywords": [] }

Examples:
- "suppress Replit notifications" \u2192 { "senders": ["replit"], "subjectKeywords": ["replit"], "domains": ["replit.com"], "locationKeywords": [] }
- "always surface New York events" \u2192 { "senders": [], "subjectKeywords": ["new york"], "domains": [], "locationKeywords": ["new york", "nyc", "manhattan"] }
- "suppress newsletters" \u2192 { "senders": [], "subjectKeywords": ["newsletter", "unsubscribe"], "domains": [], "locationKeywords": [] }`
        },
        { role: "user", content: text2 }
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 300
    });
    const content = response.choices[0]?.message?.content || "{}";
    matchHints = JSON.parse(content);
  } catch (err) {
    console.error("[InboxRules] Failed to extract match hints:", err);
  }
  const [rule] = await db.insert(inboxRules).values({
    userId: userId2,
    type,
    scope,
    pattern: text2,
    matchHints,
    source: "user"
  }).returning();
  return rule;
}
var openai8;
var init_inboxRules = __esm({
  "server/inboxRules.ts"() {
    "use strict";
    init_db();
    init_schema();
    openai8 = new OpenAI8({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
    });
  }
});

// server/telegramRoutes.ts
var telegramRoutes_exports = {};
__export(telegramRoutes_exports, {
  computePatternInsights: () => computePatternInsights,
  getPlansForDateRange: () => getPlansForDateRange,
  registerTelegramRoutes: () => registerTelegramRoutes,
  registerTelegramWebhook: () => registerTelegramWebhook,
  runProactiveStartupCatchup: () => runProactiveStartupCatchup,
  startEmailAlertScanner: () => startEmailAlertScanner,
  startMeetingBriefScanner: () => startMeetingBriefScanner,
  startProactiveScheduler: () => startProactiveScheduler,
  startTelegramPolling: () => startTelegramPolling
});
import { eq as eq15, and as and11, desc as desc6, sql as sql9, gte as gte2, lte } from "drizzle-orm";
import OpenAI9 from "openai";
function generateLinkCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
async function handleCoachReply(userId2, chatId, userText, imageUrl) {
  try {
    const { reply, attachments } = await runCoachAgent({
      userId: userId2,
      userText,
      channelName: "Telegram",
      imageUrl
    });
    let textReply = reply;
    if (attachments.length > 0 && textReply && textReply.trim()) {
      try {
        await sendMessage(chatId, textReply);
      } catch (sendErr) {
        console.error("[Telegram] failed to send text before attachment:", sendErr);
      }
      logInteraction(userId2, "telegram", "outbound", textReply).catch(() => {
      });
      textReply = "";
    }
    for (const att of attachments) {
      if (att.kind === "document") {
        const ok = await sendTelegramDocument(chatId, att.filename, att.content, att.caption, att.mimeType);
        console.log(`[Telegram] Delivered attachment ${att.filename} ok=${ok}`);
      }
    }
    if (textReply && textReply.trim()) {
      await sendMessage(chatId, textReply);
      logInteraction(userId2, "telegram", "outbound", textReply).catch(() => {
      });
    }
    extractProfileFromTelegram(userId2, userText).catch((err) => {
      console.error("[Profile] Telegram extraction error:", err);
    });
    return;
  } catch (error) {
    console.error("Error handling Telegram coach reply:", error);
    await sendMessage(chatId, "Sorry, I encountered an error. Please try again.");
    return;
  }
}
async function isReplyToProactiveQuestion(userText, question) {
  try {
    const response = await openai9.chat.completions.create({
      model: "gpt-5-mini",
      messages: [{
        role: "user",
        content: `Is the following user message a reply to (or related to) this question? Only answer "yes" or "no".

Question that was asked: "${question}"
User's message: "${userText}"

Answer (yes/no):`
      }],
      max_completion_tokens: 10
    });
    const answer = (response.choices[0]?.message?.content || "").trim().toLowerCase();
    return answer.startsWith("yes");
  } catch {
    return false;
  }
}
async function extractProfileFromTelegram(userId2, userText) {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1e3);
    const unanswered = await db.select().from(proactiveQuestionsSent).where(
      and11(
        eq15(proactiveQuestionsSent.userId, userId2),
        sql9`${proactiveQuestionsSent.answeredAt} IS NULL`,
        sql9`${proactiveQuestionsSent.sentAt} > ${twentyFourHoursAgo}`
      )
    ).orderBy(desc6(proactiveQuestionsSent.sentAt)).limit(1);
    let contextHint;
    if (unanswered.length > 0) {
      const mostRecent = unanswered[0];
      const isReply = await isReplyToProactiveQuestion(userText, mostRecent.question);
      if (isReply) {
        await db.update(proactiveQuestionsSent).set({ answeredAt: /* @__PURE__ */ new Date() }).where(eq15(proactiveQuestionsSent.id, mostRecent.id));
        contextHint = `User is answering proactive question: "${mostRecent.question}"`;
        console.log(`[Profile] Marked proactive question as answered: ${mostRecent.id}`);
      }
    }
    await extractAndStore({
      userId: userId2,
      source: userText,
      sourceType: "telegram",
      contextHint
    });
  } catch (err) {
    console.error("[Profile/Telegram] Extraction error:", err);
  }
}
async function handleCallbackQuery(callbackQuery) {
  const queryId = callbackQuery.id;
  const data = callbackQuery.data || "";
  const chatId = callbackQuery.message?.chat?.id?.toString();
  if (!chatId) {
    await answerCallbackQuery(queryId);
    return;
  }
  if (data.startsWith("momentum_done:")) {
    const parts = data.split(":");
    const claimedUserId = parts[1] ?? "";
    const stepIndex = parseInt(parts[2] ?? "0", 10);
    const links = await db.select({ userId: telegramLinks.userId }).from(telegramLinks).where(eq15(telegramLinks.chatId, chatId)).limit(1);
    if (links.length === 0 || links[0].userId !== claimedUserId) {
      await answerCallbackQuery(queryId, "Session not found \u2014 please re-link your account.");
      console.warn(`[Momentum] Ownership mismatch: claimed=${claimedUserId}, actual=${links[0]?.userId ?? "none"}, chatId=${chatId}`);
      return;
    }
    await answerCallbackQuery(queryId, "Got it! +XP incoming...");
    await handleMomentumDone(claimedUserId, chatId, stepIndex);
    return;
  }
  await answerCallbackQuery(queryId);
}
async function processUpdate(update) {
  try {
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query).catch(
        (err) => console.error("[Telegram] callback_query error:", err)
      );
      return;
    }
    if (update.my_chat_member) {
      const chatMember = update.my_chat_member;
      const chat = chatMember.chat;
      const status = chatMember.new_chat_member?.status;
      if ((chat.type === "group" || chat.type === "supergroup") && (status === "member" || status === "administrator")) {
        const fromUserId = chatMember.from?.id?.toString();
        if (fromUserId) {
          try {
            const link = await db.select().from(telegramLinks).where(
              sql9`${telegramLinks.chatId} = ${fromUserId}`
            ).limit(1);
            if (link[0]) {
              const currentGroups = link[0].groupChatIds || [];
              const chatIdStr = chat.id.toString();
              if (!currentGroups.includes(chatIdStr)) {
                currentGroups.push(chatIdStr);
                await db.update(telegramLinks).set({ groupChatIds: currentGroups }).where(eq15(telegramLinks.userId, link[0].userId));
              }
            }
          } catch (err) {
            console.error("Error handling group join:", err);
          }
        }
      }
      return;
    }
    const message = update.message;
    if (!message) return;
    if (!message.text && !message.photo && !message.document && !message.voice && !message.audio && !message.video_note) return;
    const chatId = message.chat.id.toString();
    const chatType = message.chat.type;
    let imageUrl;
    let text2 = message.text?.trim() || message.caption?.trim() || "";
    if (message.photo) {
      const largest = message.photo[message.photo.length - 1];
      const downloaded = await downloadTelegramFile(largest.file_id).catch(() => null);
      if (downloaded) imageUrl = downloaded;
    } else if (message.document && message.document.mime_type?.startsWith("image/")) {
      const downloaded = await downloadTelegramFile(message.document.file_id).catch(() => null);
      if (downloaded) imageUrl = downloaded;
    }
    let audioFileId = message.voice?.file_id || message.audio?.file_id || message.video_note?.file_id;
    if (!audioFileId && message.document && message.document.mime_type?.startsWith("audio/")) {
      audioFileId = message.document.file_id;
    }
    if (audioFileId && !text2) {
      try {
        const file = await downloadTelegramFileBuffer(audioFileId);
        if (!file) {
          await sendMessage(chatId, "Sorry, I couldn't download that voice message. Could you try again or type it out?");
          return;
        }
        const { speechToText: speechToText2, detectAudioFormat: detectAudioFormat2 } = await Promise.resolve().then(() => (init_client(), client_exports));
        const format = detectAudioFormat2(file.buffer);
        const transcript = await speechToText2(file.buffer, format);
        if (!transcript || !transcript.trim()) {
          await sendMessage(chatId, "Sorry, I couldn't make out what you said. Could you try again or type it out?");
          return;
        }
        text2 = transcript.trim();
        const preview = text2.length > 100 ? text2.slice(0, 100) + "..." : text2;
        await sendMessage(chatId, `(\u{1F3A4} Voice: "${preview}")`);
      } catch (err) {
        console.error("[Telegram] Voice transcription failed:", err);
        await sendMessage(chatId, "Sorry, I couldn't understand that voice message. Could you try again or type it out?");
        return;
      }
    }
    if (!text2 && !imageUrl) return;
    if (chatType === "group" || chatType === "supergroup") {
      if (!text2) return;
      try {
        const links = await db.select().from(telegramLinks).where(
          sql9`${telegramLinks.groupChatIds}::jsonb @> ${JSON.stringify([chatId])}::jsonb`
        );
        for (const link of links) {
          await db.insert(telegramGroupMessages).values({
            userId: link.userId,
            chatId,
            chatTitle: message.chat.title || "",
            fromUser: message.from?.first_name || message.from?.username || "Unknown",
            text: text2.slice(0, 500),
            messageDate: new Date(message.date * 1e3)
          });
        }
      } catch (err) {
        console.error("Error storing group message:", err);
      }
      return;
    }
    if (text2.startsWith("/start ") || text2.length === 6 && /^[A-Z0-9]+$/.test(text2)) {
      const code = text2.startsWith("/start ") ? text2.slice(7).trim() : text2;
      try {
        const codeRows = await db.select().from(telegramLinkCodes).where(eq15(telegramLinkCodes.code, code));
        if (codeRows.length === 0) {
          await sendMessage(chatId, "Invalid or expired link code. Please generate a new one from the app.");
          return;
        }
        const { userId: userId2 } = codeRows[0];
        const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1e3);
        if (codeRows[0].createdAt < thirtyMinAgo) {
          await db.delete(telegramLinkCodes).where(eq15(telegramLinkCodes.code, code));
          await sendMessage(chatId, "This link code has expired. Please ask Jarvis to connect Telegram again or use Profile \u2192 Connections to get a new one.");
          return;
        }
        await db.delete(telegramLinks).where(
          and11(eq15(telegramLinks.chatId, chatId), sql9`${telegramLinks.userId} != ${userId2}`)
        );
        await db.insert(telegramLinks).values({ userId: userId2, chatId, username: message.from?.username || message.from?.first_name || null }).onConflictDoUpdate({
          target: telegramLinks.userId,
          set: { chatId, username: message.from?.username || message.from?.first_name || null, linkedAt: /* @__PURE__ */ new Date() }
        });
        await db.delete(telegramLinkCodes).where(eq15(telegramLinkCodes.code, code));
        await sendMessage(chatId, "\u2705 You're connected to GamePlan! Jarvis will send you morning check-ins and you can chat anytime right here.");
        console.log(`[Telegram] Linked user ${userId2} to chat ${chatId}`);
      } catch (err) {
        console.error("Error linking Telegram:", err);
        await sendMessage(chatId, "Something went wrong linking your account. Please try again.");
      }
      return;
    }
    if (text2 === "/start") {
      await sendMessage(chatId, "Welcome to GamePlan Coach! To connect your account, generate a link code from the GamePlan app (Profile \u2192 Connected Apps \u2192 Telegram), then send it here.");
      return;
    }
    try {
      const link = await db.select().from(telegramLinks).where(eq15(telegramLinks.chatId, chatId)).limit(1);
      if (link.length === 0) {
        await sendMessage(chatId, "Your Telegram isn't linked to a GamePlan account yet. Open the app, go to Profile > Connected Apps > Telegram, and send the link code here.");
        return;
      }
      const approveMatch = text2?.match(/^(?:approve|pair\s+discord)\s+([A-Z0-9]{6})$/i);
      if (approveMatch) {
        const pairCode = approveMatch[1].toUpperCase();
        const pairResult = await completePairing(link[0].userId, pairCode).catch((e) => ({ ok: false, error: String(e) }));
        if (pairResult.ok) {
          await sendMessage(chatId, `\u2705 Discord account linked${pairResult.discordUsername ? ` as ${pairResult.discordUsername}` : ""}! You can now chat with Jarvis directly from Discord.`);
        } else {
          await sendMessage(chatId, `\u274C Discord pairing failed: ${pairResult.error || "Invalid or expired code \u2014 please DM your Discord bot to get a fresh code."}`);
        }
        return;
      }
      await handleCoachReply(link[0].userId, chatId, text2, imageUrl);
    } catch (err) {
      console.error("Error handling Telegram message:", err);
      await sendMessage(chatId, "Sorry, something went wrong. Please try again.");
    }
  } catch (error) {
    console.error("Telegram processUpdate error:", error);
  }
}
async function startTelegramPolling() {
  if (!isTelegramConfigured()) return;
  if (pollingActive) return;
  pollingActive = true;
  console.log("[Telegram] Polling started (dev mode \u2014 webhook not modified)");
  const poll = async () => {
    if (!pollingActive) return;
    try {
      const updates = await getUpdates(pollingOffset);
      for (const update of updates) {
        await processUpdate(update);
        pollingOffset = update.update_id + 1;
      }
    } catch (err) {
      console.error("[Telegram] Polling error:", err);
    }
    setTimeout(poll, 2e3);
  };
  poll();
}
function registerTelegramWebhook(app2) {
  app2.post("/api/telegram/webhook", async (req, res) => {
    res.sendStatus(200);
    await processUpdate(req.body);
  });
}
function registerTelegramRoutes(app2) {
  app2.post("/api/telegram/link-code", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      if (!isTelegramConfigured()) {
        return res.status(400).json({ error: "Telegram bot not configured. Add TELEGRAM_BOT_TOKEN to secrets." });
      }
      const code = generateLinkCode();
      await db.insert(telegramLinkCodes).values({ code, userId: userId2 });
      res.json({ code });
    } catch (error) {
      console.error("Error generating link code:", error);
      res.status(500).json({ error: "Failed to generate link code" });
    }
  });
  app2.get("/api/telegram/status", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const link = await db.select().from(telegramLinks).where(eq15(telegramLinks.userId, userId2)).limit(1);
      if (link.length === 0) {
        return res.json({ connected: false, username: null, configured: isTelegramConfigured() });
      }
      res.json({
        connected: true,
        username: link[0].username,
        configured: isTelegramConfigured()
      });
    } catch (error) {
      console.error("Error getting Telegram status:", error);
      res.status(500).json({ error: "Failed to get status" });
    }
  });
  app2.delete("/api/telegram/disconnect", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      await db.delete(telegramLinks).where(eq15(telegramLinks.userId, userId2));
      res.json({ success: true });
    } catch (error) {
      console.error("Error disconnecting Telegram:", error);
      res.status(500).json({ error: "Failed to disconnect" });
    }
  });
  app2.get("/api/telegram/messages", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const link = await db.select().from(telegramLinks).where(eq15(telegramLinks.userId, userId2)).limit(1);
      if (link.length === 0) {
        return res.json({ connected: false, messages: [] });
      }
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1e3);
      const messages = await db.select().from(telegramGroupMessages).where(and11(
        eq15(telegramGroupMessages.userId, userId2),
        gte2(telegramGroupMessages.messageDate, sevenDaysAgo)
      )).orderBy(desc6(telegramGroupMessages.messageDate)).limit(50);
      res.json({
        connected: true,
        messages: messages.map((m) => ({
          chatTitle: m.chatTitle,
          fromUser: m.fromUser,
          text: m.text,
          timestamp: m.messageDate.toISOString()
        }))
      });
    } catch (error) {
      console.error("Error getting Telegram messages:", error);
      res.status(500).json({ error: "Failed to get messages" });
    }
  });
  app2.post("/api/telegram/notify", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const { type, message: msgText } = req.body;
      if (!msgText) return res.status(400).json({ error: "message is required" });
      const link = await db.select().from(telegramLinks).where(eq15(telegramLinks.userId, userId2)).limit(1);
      if (link.length === 0) {
        return res.json({ sent: false, reason: "Not linked" });
      }
      await sendMessage(link[0].chatId, msgText);
      res.json({ sent: true });
    } catch (error) {
      console.error("Error sending Telegram notification:", error);
      res.status(500).json({ error: "Failed to send notification" });
    }
  });
}
async function getCommitmentsForUser(userId2) {
  try {
    return await db.select().from(commitments).where(and11(eq15(commitments.userId, userId2), eq15(commitments.status, "pending"))).orderBy(desc6(commitments.extractedAt)).limit(20);
  } catch {
    return [];
  }
}
async function getPlansForDateRange(userId2, startDate, endDate) {
  try {
    const rows = await db.select().from(plans).where(and11(
      eq15(plans.userId, userId2),
      gte2(plans.date, startDate),
      lte(plans.date, endDate)
    ));
    return rows.map((r) => ({
      date: r.date,
      tasks: r.data?.tasks || []
    }));
  } catch {
    return [];
  }
}
function computePatternInsights(plans2, commitments2) {
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayStats = {};
  for (const d of dayNames) dayStats[d] = { planned: 0, completed: 0, days: 0 };
  const categoryStats = {};
  let totalPlanned = 0;
  let totalCompleted = 0;
  const dailyCounts = [];
  const streakBreakDays = {};
  for (const d of dayNames) streakBreakDays[d] = 0;
  for (const plan of plans2) {
    const dayOfWeek = dayNames[(/* @__PURE__ */ new Date(plan.date + "T12:00:00")).getDay()];
    const planned = plan.tasks.length;
    const completed = plan.tasks.filter((t) => t.completed).length;
    dayStats[dayOfWeek].planned += planned;
    dayStats[dayOfWeek].completed += completed;
    dayStats[dayOfWeek].days += 1;
    totalPlanned += planned;
    totalCompleted += completed;
    dailyCounts.push({ date: plan.date, planned, completed });
    for (const task of plan.tasks) {
      const cat = task.category || "uncategorized";
      if (!categoryStats[cat]) categoryStats[cat] = { planned: 0, completed: 0 };
      categoryStats[cat].planned += 1;
      if (task.completed) categoryStats[cat].completed += 1;
    }
  }
  const sortedDays = dailyCounts.sort((a, b) => a.date.localeCompare(b.date));
  const planDates = new Set(sortedDays.map((d) => d.date));
  if (sortedDays.length >= 2) {
    const firstDate = /* @__PURE__ */ new Date(sortedDays[0].date + "T12:00:00");
    const lastDate = /* @__PURE__ */ new Date(sortedDays[sortedDays.length - 1].date + "T12:00:00");
    const allDatesInRange = [];
    for (let d = new Date(firstDate); d <= lastDate; d.setDate(d.getDate() + 1)) {
      const dk = d.toISOString().slice(0, 10);
      const existing = sortedDays.find((s) => s.date === dk);
      allDatesInRange.push(existing || { date: dk, planned: 0, completed: 0 });
    }
    let prevActive = false;
    for (const day of allDatesInRange) {
      const rate = day.planned > 0 ? day.completed / day.planned : 0;
      const isActiveDay = rate >= 0.5 && day.planned > 0;
      if (prevActive && !isActiveDay) {
        const dayOfWeek = dayNames[(/* @__PURE__ */ new Date(day.date + "T12:00:00")).getDay()];
        streakBreakDays[dayOfWeek] += 1;
      }
      prevActive = isActiveDay;
    }
  }
  let stats2 = `BEHAVIORAL DATA (${plans2.length} days analyzed):

`;
  stats2 += `Overall: ${totalCompleted}/${totalPlanned} tasks completed (${totalPlanned > 0 ? Math.round(totalCompleted / totalPlanned * 100) : 0}%)
`;
  stats2 += `Avg tasks planned per day: ${plans2.length > 0 ? (totalPlanned / plans2.length).toFixed(1) : "0"}

`;
  stats2 += `Day-of-week completion rates:
`;
  for (const day of dayNames) {
    const s = dayStats[day];
    if (s.days === 0) continue;
    const rate = s.planned > 0 ? Math.round(s.completed / s.planned * 100) : 0;
    stats2 += `  ${day}: ${rate}% (${s.completed}/${s.planned} across ${s.days} day${s.days > 1 ? "s" : ""})
`;
  }
  const catEntries = Object.entries(categoryStats).filter(([_, v]) => v.planned >= 2);
  if (catEntries.length > 0) {
    stats2 += `
Category completion rates:
`;
    for (const [cat, v] of catEntries) {
      stats2 += `  ${cat}: ${Math.round(v.completed / v.planned * 100)}% (${v.completed}/${v.planned})
`;
    }
  }
  const breakEntries = Object.entries(streakBreakDays).filter(([_, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (breakEntries.length > 0) {
    stats2 += `
Streak break days (days where momentum dropped):
`;
    for (const [day, count] of breakEntries) {
      stats2 += `  ${day}: ${count} break${count > 1 ? "s" : ""}
`;
    }
  }
  if (commitments2 && commitments2.length > 0) {
    const resolved = commitments2.filter((c) => c.status === "done").length;
    const expired = commitments2.filter((c) => c.status === "expired").length;
    const pending = commitments2.filter((c) => c.status === "pending").length;
    const total = commitments2.length;
    stats2 += `
Commitment follow-through:
`;
    stats2 += `  Resolved: ${resolved}/${total} (${Math.round(resolved / total * 100)}%)
`;
    if (expired > 0) stats2 += `  Expired: ${expired}/${total}
`;
    if (pending > 0) stats2 += `  Still pending: ${pending}
`;
  }
  return stats2;
}
async function generateProactiveMessage(type, context) {
  const now = /* @__PURE__ */ new Date();
  const dayName = now.toLocaleDateString("en-US", { weekday: "long" });
  const dateFull = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const allTasks = context.tasks || [];
  const incompleteTasks = allTasks.filter((t) => !t.completed);
  const completedTasks = allTasks.filter((t) => t.completed);
  const goalsText = (context.goals || []).slice(0, 3).map((g) => `${g.title} (${g.current || 0}/${g.target} ${g.unit})`).join(", ") || "none set";
  const commitmentList = (context.commitments || []).slice(0, 5).map((c) => `"${c.content}"${c.dueDate ? ` due ${c.dueDate}` : ""}`).join(", ") || "none";
  let prompt = "";
  if (type === "morning") {
    const dueToday = (context.commitments || []).filter((c) => c.dueDate === context.dateKey);
    const overdue = (context.commitments || []).filter((c) => c.dueDate && c.dueDate < context.dateKey);
    const tomorrow = /* @__PURE__ */ new Date(context.dateKey + "T12:00:00");
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowKey = tomorrow.toISOString().slice(0, 10);
    const dueTomorrow = (context.commitments || []).filter((c) => c.dueDate === tomorrowKey);
    prompt = `Today is ${dayName}, ${dateFull}. User has ${incompleteTasks.length} task(s) planned.
Tasks: ${incompleteTasks.map((t) => t.title).join(", ") || "none planned"}
Goals: ${goalsText}
Due today: ${dueToday.map((c) => `"${c.content}"`).join(", ") || "none"}
Overdue: ${overdue.map((c) => `"${c.content}"`).join(", ") || "none"}
Due TOMORROW: ${dueTomorrow.map((c) => `"${c.content}"`).join(", ") || "none"}
Streak: ${context.stats?.streak || 0} days

Write a sharp, energizing morning check-in (3-4 sentences). Be specific to their actual tasks/goals. No generic phrases like "Good morning!" Start with something direct. If there are items due tomorrow, give a heads-up so they can plan ahead.`;
  } else if (type === "commitment_check") {
    const dueToday = (context.commitments || []).filter((c) => c.dueDate === context.dateKey);
    const overdue = (context.commitments || []).filter((c) => c.dueDate && c.dueDate < context.dateKey);
    if (dueToday.length === 0 && overdue.length === 0) return null;
    prompt = `Today is ${dayName}, ${dateFull}.
Due today: ${dueToday.map((c) => `"${c.content}"`).join(", ") || "none"}
Overdue: ${overdue.map((c) => `"${c.content}" (${c.dueDate})`).join(", ") || "none"}

Write a brief mid-day accountability check-in (2-3 sentences). Direct, no lecture. Ask what progress has been made on the specific items.`;
  } else if (type === "evening") {
    const tomorrow = /* @__PURE__ */ new Date(context.dateKey + "T12:00:00");
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowKey = tomorrow.toISOString().slice(0, 10);
    const dueTomorrow = (context.commitments || []).filter((c) => c.dueDate === tomorrowKey);
    prompt = `Today is ${dayName}, ${dateFull}.
Completed: ${completedTasks.length}/${allTasks.length} tasks
Remaining: ${incompleteTasks.slice(0, 3).map((t) => t.title).join(", ") || "none"}
Open commitments: ${commitmentList}
Due TOMORROW: ${dueTomorrow.map((c) => `"${c.content}"`).join(", ") || "none"}
Streak: ${context.stats?.streak || 0} days

Write a concise evening recap (3-4 sentences). Acknowledge what was done, note what's still open. If there are items due tomorrow, specifically call them out so the user can plan tonight. End with something forward-looking. No platitudes.`;
  } else if (type === "weekly" || type === "weekly_planning") {
    const userId2 = context.userId;
    if (userId2) {
      const endDate = context.dateKey || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      const anchorDate = /* @__PURE__ */ new Date(endDate + "T12:00:00");
      const startOfWeekDate = new Date(anchorDate);
      startOfWeekDate.setDate(startOfWeekDate.getDate() - 6);
      const startDate = startOfWeekDate.toISOString().slice(0, 10);
      const weekPlans = await getPlansForDateRange(userId2, startDate, endDate);
      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      let dayByDay = "";
      let weekCompleted = 0;
      let weekPlanned = 0;
      const categoryBreakdown = {};
      const droppedCategories = {};
      for (let i = 0; i < 7; i++) {
        const d = new Date(startOfWeekDate);
        d.setDate(d.getDate() + i);
        const dk = d.toISOString().slice(0, 10);
        const dayName2 = dayNames[d.getDay()];
        const plan = weekPlans.find((p) => p.date === dk);
        if (plan && plan.tasks.length > 0) {
          const done = plan.tasks.filter((t) => t.completed).length;
          const total = plan.tasks.length;
          weekCompleted += done;
          weekPlanned += total;
          dayByDay += `  ${dayName2}: ${done}/${total} completed
`;
          for (const task of plan.tasks) {
            const cat = task.category || "general";
            if (!categoryBreakdown[cat]) categoryBreakdown[cat] = { done: 0, total: 0 };
            categoryBreakdown[cat].total += 1;
            if (task.completed) {
              categoryBreakdown[cat].done += 1;
            } else {
              droppedCategories[cat] = (droppedCategories[cat] || 0) + 1;
            }
          }
        } else {
          dayByDay += `  ${dayName2}: no plan
`;
        }
      }
      const weekRate = weekPlanned > 0 ? Math.round(weekCompleted / weekPlanned * 100) : 0;
      const catSummary = Object.entries(categoryBreakdown).map(([cat, v]) => `  ${cat}: ${v.done}/${v.total} (${Math.round(v.done / v.total * 100)}%)`).join("\n");
      const droppedTypeEntries = Object.entries(droppedCategories).sort((a, b) => b[1] - a[1]);
      const droppedSummary = droppedTypeEntries.length > 0 ? `Top dropped task types: ${droppedTypeEntries.slice(0, 5).map(([cat, count]) => `${cat} (${count})`).join(", ")}` : "No incomplete tasks this week";
      const allWeekCommitments = await db.select().from(commitments).where(eq15(commitments.userId, userId2)).limit(200);
      const weekDueCommitments = allWeekCommitments.filter(
        (c) => c.dueDate && c.dueDate >= startDate && c.dueDate <= endDate
      );
      const weekDueDone = weekDueCommitments.filter((c) => c.status === "done").length;
      const weekDueExpired = weekDueCommitments.filter((c) => c.status === "expired").length;
      const weekDueUnresolved = weekDueCommitments.filter((c) => c.status === "pending").length;
      const weekDueTotal = weekDueCommitments.length;
      const commitmentRate = weekDueTotal > 0 ? Math.round(weekDueDone / weekDueTotal * 100) : 0;
      let goalDeltaText = "";
      try {
        const goalsData = context.goals || [];
        if (goalsData.length > 0) {
          const statsHistory = context.stats?.goalHistory;
          const goalDeltas = goalsData.map((g) => {
            const current = g.current || 0;
            let baseline = current;
            if (statsHistory) {
              const priorEntries = statsHistory.filter((h) => h.goalId === g.id && h.date && h.date <= startDate).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
              if (priorEntries.length > 0) baseline = priorEntries[0].value || 0;
            }
            if (baseline === current && g.previousValue !== void 0) baseline = g.previousValue;
            const delta = current - baseline;
            const deltaStr = delta > 0 ? `+${delta}` : delta === 0 ? "no change" : `${delta}`;
            return `  ${g.title}: ${current}/${g.target} ${g.unit} (${deltaStr} this week)`;
          });
          goalDeltaText = goalDeltas.join("\n");
        }
      } catch {
      }
      if (!goalDeltaText) goalDeltaText = goalsText;
      let patternSection = "";
      try {
        const thirtyDaysAgoDate = new Date(anchorDate);
        thirtyDaysAgoDate.setDate(thirtyDaysAgoDate.getDate() - 30);
        const thirtyDayStart = thirtyDaysAgoDate.toISOString().slice(0, 10);
        const allPlans = await getPlansForDateRange(userId2, thirtyDayStart, endDate);
        const allCommitmentsRaw = await db.select().from(commitments).where(eq15(commitments.userId, userId2)).limit(200);
        const scopedCommitments30d = allCommitmentsRaw.filter(
          (c) => c.dueDate && c.dueDate >= thirtyDayStart && c.dueDate <= endDate || c.extractedAt && c.extractedAt >= new Date(thirtyDayStart) && c.extractedAt <= /* @__PURE__ */ new Date(endDate + "T23:59:59") || c.resolvedAt && c.resolvedAt >= new Date(thirtyDayStart) && c.resolvedAt <= /* @__PURE__ */ new Date(endDate + "T23:59:59")
        );
        if (allPlans.length >= 7) {
          patternSection = computePatternInsights(allPlans, scopedCommitments30d);
        }
      } catch {
      }
      prompt = `WEEKLY PLANNING SESSION \u2014 Sunday Review

Day-by-day this week:
${dayByDay}
Week completion rate: ${weekRate}% (${weekCompleted}/${weekPlanned})
${catSummary ? `Category breakdown:
${catSummary}` : ""}
${droppedSummary}
Commitments due this week: ${weekDueTotal > 0 ? `${commitmentRate}% follow-through (${weekDueDone} resolved / ${weekDueTotal} due)${weekDueExpired > 0 ? ` | ${weekDueExpired} expired` : ""}${weekDueUnresolved > 0 ? ` | ${weekDueUnresolved} still unresolved` : ""}` : "none due this week"}

Streak: ${context.stats?.streak || 0} days | XP: ${context.stats?.xp || 0}
Goal progress (this week):
${goalDeltaText}
Open commitments: ${commitmentList}

${patternSection ? `PATTERN DATA (30 days):
${patternSection}` : ""}

Write a comprehensive weekly planning session. Structure it as:
1. WEEK RECAP \u2014 what happened day-by-day, what the overall trend was, honest assessment
2. GOAL CHECK \u2014 how goals moved (or didn't)
3. CARRY FORWARD \u2014 what dropped tasks or commitments should carry into next week
4. INTENTIONS \u2014 3 specific, actionable intentions for next week based on what you see in the data
${patternSection ? '5. PATTERNS \u2014 include the top 2-3 behavioral observations from the 30-day pattern data. Name each pattern (e.g. "Friday drop-off", "Health task avoidance"). Be specific with numbers.' : ""}

Use line breaks between sections for readability. Plain text, no markdown. Be direct and honest. This is allowed to be thorough (8-15 sentences total).`;
    } else {
      prompt = `Weekly review.
Streak: ${context.stats?.streak || 0} days | XP: ${context.stats?.xp || 0}
Goals: ${goalsText}
Open commitments: ${commitmentList}

Write a sharp weekly summary (3-4 sentences). What's the trend? What needs focus next week? Be honest and direct.`;
    }
  }
  if (!prompt) return null;
  const isWeeklyPlanning = type === "weekly" || type === "weekly_planning";
  try {
    const resp = await openai9.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        {
          role: "system",
          content: isWeeklyPlanning ? "You are GamePlan Coach Jarvis \u2014 a direct, sharp, ADHD-friendly productivity coach. Messages go via Telegram. This is the weekly planning session \u2014 you are allowed to be comprehensive (8-15 sentences). Use line breaks between sections for readability. Plain text only, no markdown, no bullet points, no asterisks." : "You are GamePlan Coach Jarvis \u2014 a direct, sharp, ADHD-friendly productivity coach. Messages go via Telegram. Keep it SHORT (3-4 sentences max). Plain text only, no markdown, no bullet points."
        },
        { role: "user", content: prompt }
      ],
      max_completion_tokens: isWeeklyPlanning ? 4e3 : 2e3
    });
    return resp.choices[0]?.message?.content || null;
  } catch (err) {
    console.error("[Proactive] AI generation failed:", err);
    return null;
  }
}
async function hasAlreadySent(userId2, messageType, dateKey) {
  try {
    const rows = await db.select({ id: proactiveScheduleLog.id }).from(proactiveScheduleLog).where(
      and11(
        eq15(proactiveScheduleLog.userId, userId2),
        eq15(proactiveScheduleLog.messageType, messageType),
        eq15(proactiveScheduleLog.sentDate, dateKey)
      )
    ).limit(1);
    return rows.length > 0;
  } catch {
    return false;
  }
}
async function markAsSent(userId2, messageType, dateKey) {
  try {
    await db.insert(proactiveScheduleLog).values({ userId: userId2, messageType, sentDate: dateKey }).catch(() => {
    });
  } catch {
  }
}
async function getProactiveEligibleUsers() {
  const [tgRows, chRows, prefRows] = await Promise.all([
    db.select({ userId: telegramLinks.userId, chatId: telegramLinks.chatId }).from(telegramLinks),
    db.select({ userId: channelLinks.userId }).from(channelLinks),
    db.select({ userId: channelPreferences.userId }).from(channelPreferences)
  ]);
  const chatIdByUser = /* @__PURE__ */ new Map();
  for (const r of tgRows) chatIdByUser.set(r.userId, r.chatId);
  const userIds = /* @__PURE__ */ new Set();
  for (const r of tgRows) userIds.add(r.userId);
  for (const r of chRows) userIds.add(r.userId);
  for (const r of prefRows) userIds.add(r.userId);
  return Array.from(userIds).map((userId2) => ({ userId: userId2, chatId: chatIdByUser.get(userId2) }));
}
async function sendScheduledMessage(link, schedule, dateKey, timezone) {
  if (schedule.type === "followup_check") {
    const tokens = await getValidGoogleTokens(link.userId).catch(() => []);
    if (!tokens || tokens.length === 0) return;
    const token = tokens[0];
    const starredEmails = await getStarredFollowUpEmails(token, 3);
    if (starredEmails.length === 0) return;
    const emailList = starredEmails.slice(0, 10).map((e) => {
      const senderName = e.from.replace(/<.*>/, "").trim() || e.from;
      return `${senderName} (${e.ageDays}d) \u2014 "${e.subject}"`;
    }).join("\n");
    const msg = `\u{1F4EC} ${starredEmails.length} starred/important email${starredEmails.length === 1 ? "" : "s"} sitting >3 days:

${emailList}

Still relevant? Reply, archive, or unstar anything you've handled.`;
    console.log(`[Proactive] Sending followup_check to user ${link.userId} (${timezone})`);
    await notifyUser(link.userId, "general", msg);
    logInteraction(link.userId, "notification", "outbound", msg, "followup_check").catch(() => {
    });
    return;
  }
  const [goalsRow, planRow, statsRow] = await Promise.allSettled([
    db.select().from(goals).where(eq15(goals.userId, link.userId)).limit(1),
    db.select().from(plans).where(and11(eq15(plans.userId, link.userId), eq15(plans.date, dateKey))).limit(1),
    db.select().from(stats).where(eq15(stats.userId, link.userId)).limit(1)
  ]);
  const userGoals = goalsRow.status === "fulfilled" ? goalsRow.value[0]?.data || [] : [];
  const todayPlan = planRow.status === "fulfilled" ? planRow.value[0]?.data : null;
  const userStats = statsRow.status === "fulfilled" ? statsRow.value[0]?.data || {} : {};
  const tasks = todayPlan?.tasks || [];
  if (schedule.type === "momentum_nudge") {
    if (!link.chatId) return;
    const alreadyHasSession = await hasMomentumSessionToday(link.userId, dateKey);
    if (alreadyHasSession) return;
    console.log(`[Proactive] Sending momentum_nudge to user ${link.userId} (${timezone})`);
    await startMomentumSession(link.userId, link.chatId, {
      tasks,
      goals: userGoals,
      stats: userStats,
      dateKey
    });
    logInteraction(link.userId, "notification", "outbound", "[Momentum coaching session started]", "momentum_nudge").catch(() => {
    });
    return;
  }
  const commitments2 = await getCommitmentsForUser(link.userId);
  const message = await generateProactiveMessage(schedule.type, {
    tasks,
    goals: userGoals,
    commitments: commitments2,
    stats: userStats,
    dateKey,
    userId: link.userId
  });
  if (message) {
    console.log(`[Proactive] Sending ${schedule.type} to user ${link.userId} (${timezone})`);
    if (schedule.type === "morning") {
      try {
        const existingPrefs = await db.select({ data: userPreferences.data }).from(userPreferences).where(eq15(userPreferences.userId, link.userId));
        const currentPrefs = existingPrefs[0]?.data || {};
        await db.insert(userPreferences).values({
          userId: link.userId,
          data: { ...currentPrefs, morningBrief: { date: dateKey, text: message } }
        }).onConflictDoUpdate({
          target: [userPreferences.userId],
          set: { data: { ...currentPrefs, morningBrief: { date: dateKey, text: message } }, updatedAt: /* @__PURE__ */ new Date() }
        });
      } catch (e) {
        console.error("[Proactive] Failed to save morning brief:", e);
      }
    }
    const typeMap = {
      morning: "morning_briefing",
      commitment_check: "commitment_check",
      weekly_planning: "weekly_planning",
      followup_check: "general",
      momentum_nudge: "general"
    };
    const notifType = typeMap[schedule.type] || "general";
    await notifyUser(link.userId, notifType, message);
    logInteraction(link.userId, "notification", "outbound", message, schedule.type).catch(() => {
    });
  }
}
async function runProactiveStartupCatchup() {
  try {
    const links = await getProactiveEligibleUsers();
    if (links.length === 0) return;
    const allPrefs = await db.select().from(userPreferences);
    const prefsMap = {};
    for (const p of allPrefs) prefsMap[p.userId] = p.data || {};
    const now = /* @__PURE__ */ new Date();
    for (const link of links) {
      const timezone = prefsMap[link.userId]?.timezone || "America/New_York";
      const localDate = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
      const localHour2 = localDate.getHours();
      const localDay = localDate.getDay();
      const yr = localDate.getFullYear();
      const mo = String(localDate.getMonth() + 1).padStart(2, "0");
      const dy = String(localDate.getDate()).padStart(2, "0");
      const dateKey = `${yr}-${mo}-${dy}`;
      for (const schedule of PROACTIVE_SCHEDULE) {
        if (schedule.type === "weekly_planning" && localDay !== (schedule.dayOfWeek ?? -1)) continue;
        const scheduleMinutesFromMidnight = schedule.hour * 60 + schedule.minute;
        const currentMinutesFromMidnight = localHour2 * 60 + localDate.getMinutes();
        const minutesSinceScheduled = currentMinutesFromMidnight - scheduleMinutesFromMidnight;
        if (minutesSinceScheduled < 0 || minutesSinceScheduled > 120) continue;
        const alreadySent = await hasAlreadySent(link.userId, schedule.type, dateKey);
        if (alreadySent) continue;
        await markAsSent(link.userId, schedule.type, dateKey);
        console.log(`[Proactive] Catchup: sending missed ${schedule.type} to user ${link.userId}`);
        try {
          await sendScheduledMessage(link, schedule, dateKey, timezone);
        } catch (err) {
          console.error(`[Proactive] Catchup error for ${link.userId}:`, err);
        }
      }
    }
  } catch (err) {
    console.error("[Proactive] Startup catchup error:", err);
  }
}
async function startProactiveScheduler() {
  setInterval(async () => {
    const now = /* @__PURE__ */ new Date();
    try {
      const links = await getProactiveEligibleUsers();
      if (links.length === 0) return;
      const allPrefs = await db.select().from(userPreferences);
      const prefsMap = {};
      for (const p of allPrefs) prefsMap[p.userId] = p.data || {};
      for (const link of links) {
        const timezone = prefsMap[link.userId]?.timezone || "America/New_York";
        const localDate = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
        const localHour2 = localDate.getHours();
        const localMinute = localDate.getMinutes();
        const localDay = localDate.getDay();
        const yr = localDate.getFullYear();
        const mo = String(localDate.getMonth() + 1).padStart(2, "0");
        const dy = String(localDate.getDate()).padStart(2, "0");
        const dateKey = `${yr}-${mo}-${dy}`;
        for (const schedule of PROACTIVE_SCHEDULE) {
          if (localHour2 !== schedule.hour || localMinute !== schedule.minute) continue;
          if (schedule.type === "weekly_planning" && localDay !== (schedule.dayOfWeek ?? -1)) continue;
          const alreadySent = await hasAlreadySent(link.userId, schedule.type, dateKey);
          if (alreadySent) continue;
          await markAsSent(link.userId, schedule.type, dateKey);
          try {
            await sendScheduledMessage(link, schedule, dateKey, timezone);
          } catch (err) {
            console.error(`[Proactive] Error for user ${link.userId}:`, err);
          }
        }
      }
    } catch (err) {
      console.error("[Proactive] Scheduler error:", err);
    }
  }, 60 * 1e3);
  console.log("Proactive scheduler started (channel-agnostic)");
}
async function startMeetingBriefScanner() {
  if (!isTelegramConfigured()) return;
  const SCAN_INTERVAL_MS = 5 * 60 * 1e3;
  const sentBriefs = /* @__PURE__ */ new Set();
  const runScan = async () => {
    try {
      const links = await db.select().from(telegramLinks);
      if (links.length === 0) return;
      const allPrefs = await db.select().from(userPreferences);
      const prefsMap = {};
      for (const p of allPrefs) prefsMap[p.userId] = p.data || {};
      const now = /* @__PURE__ */ new Date();
      const utcDateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const oldKeys = Array.from(sentBriefs).filter((k) => !k.includes(utcDateKey));
      for (const k of oldKeys) sentBriefs.delete(k);
      for (const link of links) {
        try {
          const tokens = await getValidGoogleTokens(link.userId).catch(() => []);
          if (!tokens || tokens.length === 0) continue;
          const token = tokens[0];
          const timezone = prefsMap[link.userId]?.timezone || "America/New_York";
          const localDate = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
          const localDateStr = `${localDate.getFullYear()}-${String(localDate.getMonth() + 1).padStart(2, "0")}-${String(localDate.getDate()).padStart(2, "0")}`;
          const events = await getGoogleCalendarEvents(localDateStr, void 0, void 0, token);
          if (events.length === 0) continue;
          const nowMs = now.getTime();
          for (const event of events) {
            const eventStart = new Date(event.start).getTime();
            const minutesUntil = (eventStart - nowMs) / (60 * 1e3);
            if (minutesUntil < 10 || minutesUntil > 20) continue;
            const briefKey = `${link.userId}-${event.id}-${localDateStr}`;
            if (sentBriefs.has(briefKey)) continue;
            sentBriefs.add(briefKey);
            let relevantEmails = [];
            try {
              const titleWords = event.title.split(/[\s,\-—]+/).filter((w) => w.length > 3).map((w) => w.toLowerCase());
              if (titleWords.length > 0) {
                const recentEmails = await getEmailsSince(Date.now() - 7 * 24 * 60 * 60 * 1e3, token);
                relevantEmails = recentEmails.filter((e) => {
                  const subjectLower = e.subject.toLowerCase();
                  return titleWords.some((w) => subjectLower.includes(w));
                }).slice(0, 3).map((e) => {
                  const senderName = e.from.replace(/<.*>/, "").trim() || e.from;
                  return `"${e.subject}" from ${senderName}`;
                });
              }
            } catch {
            }
            const eventTime = new Date(event.start).toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
              hour12: true
            });
            let briefPrompt = `Upcoming meeting in ~15 minutes:
Event: "${event.title}"
Time: ${eventTime}
${event.location ? `Location: ${event.location}` : ""}
${event.description ? `Description: ${event.description.slice(0, 300)}` : ""}
${relevantEmails.length > 0 ? `
Related recent emails:
${relevantEmails.map((e) => `- ${e}`).join("\n")}` : ""}

Write a sharp 2-3 sentence meeting prep brief. Include what the meeting is about, highlight any relevant email context if provided, and end with one clear action item or thing to focus on. Be direct, no fluff.`;
            try {
              const resp = await openai9.chat.completions.create({
                model: "gpt-5-mini",
                messages: [
                  {
                    role: "system",
                    content: "You are GamePlan Coach Jarvis \u2014 a direct, sharp productivity coach. You send pre-meeting prep briefs via Telegram. Keep it SHORT (2-3 sentences). Plain text only, no markdown, no bullet points."
                  },
                  { role: "user", content: briefPrompt }
                ],
                max_completion_tokens: 1500
              });
              const briefMessage = resp.choices[0]?.message?.content;
              if (briefMessage) {
                const header = `\u{1F4C5} Meeting in ~15 min: ${event.title} (${eventTime})${event.location ? `
\u{1F4CD} ${event.location}` : ""}`;
                const fullMsg = `${header}

${briefMessage}`;
                console.log(`[MeetingBrief] Sending brief for "${event.title}" to user ${link.userId}`);
                await notifyUser(link.userId, "meeting_brief", fullMsg);
                logInteraction(link.userId, "notification", "outbound", fullMsg, "meeting_brief").catch(() => {
                });
              }
            } catch (err) {
              console.error(`[MeetingBrief] AI generation failed for "${event.title}":`, err);
            }
          }
        } catch (err) {
          console.error(`[MeetingBrief] Error for user ${link.userId}:`, err);
        }
      }
    } catch (err) {
      console.error("[MeetingBrief] Scanner error:", err);
    }
  };
  setTimeout(runScan, 10 * 1e3);
  setInterval(runScan, SCAN_INTERVAL_MS);
  console.log("Meeting brief scanner started (5-min interval)");
}
async function startEmailAlertScanner() {
  const SCAN_INTERVAL_MS = 30 * 60 * 1e3;
  const runScan = async () => {
    try {
      const links = await getProactiveEligibleUsers();
      if (links.length === 0) return;
      const allPrefs = await db.select().from(userPreferences);
      const prefsMap = {};
      for (const p of allPrefs) prefsMap[p.userId] = p.data || {};
      for (const link of links) {
        const prefs = prefsMap[link.userId] || {};
        if (prefs.emailAlertsEnabled === false) continue;
        const tokens = await getValidGoogleTokens(link.userId).catch(() => []);
        if (!tokens || tokens.length === 0) continue;
        const token = tokens[0];
        const sinceMs = prefs.lastEmailScanAt ? Number(prefs.lastEmailScanAt) : Date.now() - SCAN_INTERVAL_MS;
        const nowMs = Date.now();
        const newPrefs = { ...prefs, lastEmailScanAt: nowMs };
        await db.insert(userPreferences).values({ userId: link.userId, data: newPrefs }).onConflictDoUpdate({
          target: userPreferences.userId,
          set: { data: newPrefs, updatedAt: /* @__PURE__ */ new Date() }
        });
        const emails = await getEmailsSince(sinceMs, token);
        if (emails.length === 0) continue;
        console.log(`[EmailAlert] ${emails.length} new email(s) for user ${link.userId}, classifying...`);
        const { getUserInboxRules: getUserInboxRules2, matchItemAgainstRules: matchItemAgainstRules2 } = await Promise.resolve().then(() => (init_inboxRules(), inboxRules_exports));
        const userRules = await getUserInboxRules2(link.userId);
        const filteredEmails = [];
        const autoSurfaced = [];
        for (const email of emails) {
          const result = matchItemAgainstRules2(
            {
              sourceType: "email",
              sourceId: email.messageId || "",
              sender: email.from,
              subject: email.subject,
              snippet: email.snippet
            },
            userRules
          );
          if (result.verdict === "suppress") {
            console.log(`[EmailAlert] Suppressed "${email.subject}" by rule ${result.matchedRuleId}`);
            continue;
          }
          if (result.verdict === "surface") {
            autoSurfaced.push({ email, ruleId: result.matchedRuleId, reason: "Matched your surface rule" });
            continue;
          }
          filteredEmails.push(email);
        }
        for (const { email, ruleId, reason } of autoSurfaced) {
          const suggestedActions = email.messageId ? [
            { label: "Archive", actionType: "archive" },
            { label: "Star", actionType: "mark_important" },
            { label: "Save as Task", actionType: "save_as_task" },
            { label: "Dismiss", actionType: "dismiss" }
          ] : [
            { label: "Save as Task", actionType: "save_as_task" },
            { label: "Dismiss", actionType: "dismiss" }
          ];
          try {
            await db.insert(inboxItems).values({
              userId: link.userId,
              sourceType: "email",
              sourceId: email.messageId ? `gmail:${email.messageId}` : `gmail:${email.subject}`,
              subject: email.subject,
              sender: email.from,
              snippet: email.snippet,
              jarvisReason: reason,
              suggestedActions,
              matchedRuleId: ruleId || null
            });
          } catch {
          }
          const senderName = email.from.replace(/<.*>/, "").trim() || email.from;
          const msg = `\u{1F4E7} Surfaced for you:
From: ${senderName}
"${email.subject}"

${email.snippet.slice(0, 150)}${email.snippet.length > 150 ? "..." : ""}

Jarvis: ${reason}`;
          await notifyUser(link.userId, "email_alert", msg);
          logInteraction(link.userId, "notification", "outbound", msg, "email_surfaced").catch(() => {
          });
        }
        if (filteredEmails.length === 0) continue;
        const emailList = filteredEmails.map(
          (e, i) => `${i}. From: ${e.from}
   Subject: "${e.subject}"
   Preview: ${e.snippet}`
        ).join("\n\n");
        let flagged = [];
        try {
          const classification = await openai9.chat.completions.create({
            model: "gpt-5-mini",
            messages: [
              {
                role: "system",
                content: `You review emails and decide which need IMMEDIATE user attention. Alert = true ONLY for:
- Urgent reply needed from a real person they know
- Deadline TODAY or TOMORROW explicitly mentioned
- Meeting cancelled, moved, or significantly changed
- Time-sensitive action required today
- Important client/boss/colleague needing a response soon

Alert = false for:
- Newsletters, marketing, promotions, sales
- Automated notifications, receipts, shipping updates
- Social media notifications
- No-reply or automated senders
- General FYI or informational emails

Return ONLY a JSON array of flagged emails (only include alert=true ones):
[{"index": 0, "reason": "brief reason why this is urgent"}]
Return [] if nothing is urgent.`
              },
              {
                role: "user",
                content: `Emails received in the last 30 minutes:

${emailList}`
              }
            ],
            max_completion_tokens: 2e3
          });
          const raw = classification.choices[0]?.message?.content || "[]";
          const jsonMatch = raw.match(/\[[\s\S]*\]/);
          if (jsonMatch) flagged = JSON.parse(jsonMatch[0]);
        } catch (err) {
          console.error("[EmailAlert] Classification failed:", err);
          continue;
        }
        for (const flag of flagged) {
          const email = filteredEmails[flag.index];
          if (!email) continue;
          const senderName = email.from.replace(/<.*>/, "").trim() || email.from;
          const suggestedActions = email.messageId ? [
            { label: "Archive", actionType: "archive" },
            { label: "Save as Task", actionType: "save_as_task" },
            { label: "Dismiss", actionType: "dismiss" }
          ] : [
            { label: "Save as Task", actionType: "save_as_task" },
            { label: "Dismiss", actionType: "dismiss" }
          ];
          try {
            await db.insert(inboxItems).values({
              userId: link.userId,
              sourceType: "email",
              sourceId: email.messageId ? `gmail:${email.messageId}` : `gmail:${email.subject}`,
              subject: email.subject,
              sender: email.from,
              snippet: email.snippet,
              jarvisReason: flag.reason,
              suggestedActions
            });
          } catch {
          }
          const msg = `\u{1F4E7} Email needs your attention:
From: ${senderName}
"${email.subject}"

${email.snippet.slice(0, 150)}${email.snippet.length > 150 ? "..." : ""}

Jarvis: ${flag.reason}`;
          await notifyUser(link.userId, "email_alert", msg);
          logInteraction(link.userId, "notification", "outbound", msg, "email_alert").catch(() => {
          });
          console.log(`[EmailAlert] Alerted user ${link.userId}: "${email.subject}"`);
        }
      }
    } catch (err) {
      console.error("[EmailAlert] Scanner error:", err);
    }
  };
  setInterval(runScan, SCAN_INTERVAL_MS);
  console.log("Email alert scanner started (30-min interval)");
}
var openai9, pollingOffset, pollingActive, PROACTIVE_SCHEDULE;
var init_telegramRoutes = __esm({
  "server/telegramRoutes.ts"() {
    "use strict";
    init_db();
    init_schema();
    init_telegram();
    init_registry();
    init_momentumCoach();
    init_gmail();
    init_googleCalendar();
    init_userTokenStore();
    init_interactionLog();
    init_extractor();
    init_coachAgent();
    init_manager();
    openai9 = new OpenAI9({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
    });
    pollingOffset = 0;
    pollingActive = false;
    PROACTIVE_SCHEDULE = [
      { type: "morning", hour: 8, minute: 0 },
      { type: "commitment_check", hour: 10, minute: 0 },
      { type: "followup_check", hour: 12, minute: 0 },
      { type: "momentum_nudge", hour: 14, minute: 0 },
      { type: "weekly_planning", dayOfWeek: 0, hour: 19, minute: 0 }
    ];
  }
});

// server/agent/tools/manageTasks.ts
import { and as and12, eq as eq16, desc as desc7 } from "drizzle-orm";
async function loadPatternHelpers() {
  const mod = await Promise.resolve().then(() => (init_telegramRoutes(), telegramRoutes_exports));
  return {
    getPlansForDateRange: mod.getPlansForDateRange,
    computePatternInsights: mod.computePatternInsights
  };
}
var manageTasksTool;
var init_manageTasks = __esm({
  "server/agent/tools/manageTasks.ts"() {
    "use strict";
    init_db();
    init_schema();
    manageTasksTool = {
      name: "manage_tasks",
      description: "Manage today's plan and the user's commitments. Use this to add tasks to today's plan, add commitments, complete commitments, list current items, or analyze 30-day behavioral patterns.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: [
              "add_plan_task",
              "add_commitment",
              "complete_commitment",
              "list_tasks",
              "analyze_patterns"
            ]
          },
          title: { type: "string", description: "Task title (add_plan_task)" },
          content: { type: "string", description: "Commitment content (add_commitment)" },
          due_date: { type: "string", description: "YYYY-MM-DD (add_commitment, optional)" },
          commitment_id: { type: "string", description: "ID from [id:...] (complete_commitment)" }
        },
        required: ["action"]
      },
      async execute(args, ctx) {
        const userId2 = ctx.userId;
        const dateKey = ctx.state?.dateKey || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
        const a = args;
        try {
          switch (a.action) {
            case "add_plan_task": {
              if (!a.title) {
                return { ok: false, content: "Error: title is required for add_plan_task", label: "Missing title" };
              }
              const todayPlan = ctx.state?.todayPlan ?? null;
              const tasks = todayPlan?.tasks ? [...todayPlan.tasks] : [];
              const newTask = {
                id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                title: a.title,
                completed: false
              };
              tasks.push(newTask);
              const planData = todayPlan ? { ...todayPlan, tasks } : { tasks };
              await db.insert(plans).values({ userId: userId2, date: dateKey, data: planData }).onConflictDoUpdate({
                target: [plans.userId, plans.date],
                set: { data: planData, updatedAt: /* @__PURE__ */ new Date() }
              });
              if (ctx.state) ctx.state.todayPlan = planData;
              return {
                ok: true,
                content: `Added "${a.title}" to today's plan. Today now has ${tasks.length} task(s).`,
                label: "Task added",
                detail: a.title
              };
            }
            case "add_commitment": {
              if (!a.content) {
                return { ok: false, content: "Error: content is required for add_commitment", label: "Missing content" };
              }
              await db.insert(commitments).values({
                userId: userId2,
                content: a.content,
                dueDate: a.due_date || null,
                sourceMessage: `Added via ${ctx.channel || "agent"}`
              });
              return {
                ok: true,
                content: `Added commitment: "${a.content}"${a.due_date ? ` (due ${a.due_date})` : ""}`,
                label: "Commitment added",
                detail: a.content
              };
            }
            case "complete_commitment": {
              if (!a.commitment_id) {
                return { ok: false, content: "Error: commitment_id is required for complete_commitment", label: "Missing id" };
              }
              const updated = await db.update(commitments).set({ status: "done", resolvedAt: /* @__PURE__ */ new Date() }).where(
                and12(
                  eq16(commitments.id, a.commitment_id),
                  eq16(commitments.userId, userId2),
                  eq16(commitments.status, "pending")
                )
              ).returning({ id: commitments.id });
              if (updated.length === 0) {
                return {
                  ok: false,
                  content: `No pending commitment found with id "${a.commitment_id}".`,
                  label: "Commitment not found"
                };
              }
              return {
                ok: true,
                content: `Marked commitment as done (id: ${a.commitment_id}).`,
                label: "Commitment completed",
                detail: a.commitment_id
              };
            }
            case "list_tasks": {
              const todayPlan = ctx.state?.todayPlan ?? null;
              const planTasks = todayPlan?.tasks ?? [];
              const pendingCommitments = await db.select().from(commitments).where(and12(eq16(commitments.userId, userId2), eq16(commitments.status, "pending"))).orderBy(desc7(commitments.extractedAt)).limit(10);
              let listing = "";
              listing += planTasks.length > 0 ? "Today's Plan:\n" + planTasks.map((t) => `- ${t.completed ? "\u2705" : "\u2B1C"} ${t.title}`).join("\n") : "Today's Plan: No tasks yet.";
              listing += "\n\n";
              listing += pendingCommitments.length > 0 ? "Open Commitments:\n" + pendingCommitments.map((c) => `- [id:${c.id}] "${c.content}"${c.dueDate ? ` (due ${c.dueDate})` : ""}`).join("\n") : "Open Commitments: None.";
              return { ok: true, content: listing, label: "Listed tasks" };
            }
            case "analyze_patterns": {
              const helpers = await loadPatternHelpers().catch(() => null);
              if (!helpers || !helpers.getPlansForDateRange || !helpers.computePatternInsights) {
                return { ok: false, content: "Pattern analysis temporarily unavailable.", label: "Pattern analysis unavailable" };
              }
              const today = /* @__PURE__ */ new Date();
              const startDate = new Date(today);
              startDate.setDate(startDate.getDate() - 30);
              const start = startDate.toISOString().slice(0, 10);
              const end = today.toISOString().slice(0, 10);
              const plans2 = await helpers.getPlansForDateRange(userId2, start, end);
              if (plans2.length < 3) {
                return { ok: true, content: "Not enough data yet for pattern analysis (need at least a few days).", label: "Not enough data" };
              }
              const allCommitments = await db.select().from(commitments).where(eq16(commitments.userId, userId2)).limit(200);
              const startDt = new Date(start);
              const endDt = /* @__PURE__ */ new Date(end + "T23:59:59");
              const scopedCommitments = allCommitments.filter(
                (c) => c.dueDate && c.dueDate >= start && c.dueDate <= end || c.extractedAt && c.extractedAt >= startDt && c.extractedAt <= endDt || c.resolvedAt && c.resolvedAt >= startDt && c.resolvedAt <= endDt
              );
              const patternData = helpers.computePatternInsights(plans2, scopedCommitments);
              return {
                ok: true,
                content: `Behavioral pattern data from the last 30 days. Analyze it and give the user 3-5 sharp, specific observations naming each pattern with numbers.

${patternData}`,
                label: "Pattern analysis"
              };
            }
            default:
              return { ok: false, content: `Unknown action: ${a.action}`, label: "Unknown action" };
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            ok: false,
            content: `manage_tasks failed: ${msg}`,
            label: "manage_tasks failed",
            detail: msg
          };
        }
      }
    };
  }
});

// server/agent/tools/documents.ts
import { eq as eq17, and as and13, desc as desc8 } from "drizzle-orm";
var createDocumentTool, listDocumentsTool, readDocumentTool;
var init_documents = __esm({
  "server/agent/tools/documents.ts"() {
    "use strict";
    init_db();
    init_schema();
    createDocumentTool = {
      name: "create_document",
      description: "Create a new text/markdown document in the user's GamePlan document library. Use this to draft notes, briefs, summaries, plans, or any longer-form content the user asks for. The user can review, edit, and reference these later. Returns the new document id.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short descriptive title for the document" },
          content: { type: "string", description: "Full document body in markdown" },
          summary: { type: "string", description: "One-sentence summary (optional but recommended)" }
        },
        required: ["name", "content"]
      },
      async execute(args, ctx) {
        const a = args;
        const name = String(a.name || "").trim().slice(0, 200);
        const content = String(a.content || "");
        const summary = a.summary ? String(a.summary).slice(0, 500) : null;
        if (!name) return { ok: false, content: "Document name is required.", label: "Missing name" };
        if (!content.trim()) return { ok: false, content: "Document content cannot be empty.", label: "Empty content" };
        try {
          const inserted = await db.insert(userDocuments).values({
            userId: ctx.userId,
            name,
            mimeType: "text/markdown",
            sizeBytes: Buffer.byteLength(content, "utf8"),
            status: "ready",
            extractedText: content,
            summary
          }).returning({ id: userDocuments.id });
          const docId = inserted[0]?.id || "";
          console.log(`[${ctx.channel || "Agent"}] create_document id=${docId} name="${name}" bytes=${Buffer.byteLength(content, "utf8")}`);
          const pending = ctx.state.pendingAttachments ||= [];
          const safeFilename = name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) + ".md";
          pending.push({
            kind: "document",
            documentId: docId,
            filename: safeFilename,
            content,
            caption: summary || name,
            mimeType: "text/markdown"
          });
          return {
            ok: true,
            content: `Created document "${name}" (id: ${docId}). It is saved in the user's Documents library and queued to be delivered on this channel.`,
            label: `Created document: ${name}`,
            detail: docId
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { ok: false, content: `Failed to create document: ${msg}`, label: "Document create failed", detail: msg };
        }
      }
    };
    listDocumentsTool = {
      name: "list_documents",
      description: "List the user's recent documents (name, id, summary, uploaded date). Use this when the user asks 'what documents do I have' or before reading or updating a specific one.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max documents to return (default 20)" }
        }
      },
      async execute(args, ctx) {
        const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);
        try {
          const rows = await db.select({
            id: userDocuments.id,
            name: userDocuments.name,
            summary: userDocuments.summary,
            uploadedAt: userDocuments.uploadedAt,
            status: userDocuments.status,
            sizeBytes: userDocuments.sizeBytes
          }).from(userDocuments).where(eq17(userDocuments.userId, ctx.userId)).orderBy(desc8(userDocuments.uploadedAt)).limit(limit);
          if (rows.length === 0) {
            return { ok: true, content: "The user has no documents yet.", label: "No documents" };
          }
          const formatted = rows.map((r) => `- [id:${r.id}] "${r.name}" \u2014 ${r.summary || "(no summary)"} (${r.status}, ${r.sizeBytes} bytes)`).join("\n");
          return {
            ok: true,
            content: `User has ${rows.length} document(s):
${formatted}`,
            label: `Listed ${rows.length} document(s)`
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { ok: false, content: `Failed to list documents: ${msg}`, label: "List failed" };
        }
      }
    };
    readDocumentTool = {
      name: "read_document",
      description: "Read the full content of a document by id. Use this when the user references a specific document or you need to update one.",
      parameters: {
        type: "object",
        properties: {
          document_id: { type: "string", description: "Document ID from [id:...] in list_documents output" }
        },
        required: ["document_id"]
      },
      async execute(args, ctx) {
        const documentId = String(args.document_id || "");
        if (!documentId) {
          return { ok: false, content: "document_id is required.", label: "Missing id" };
        }
        try {
          const rows = await db.select().from(userDocuments).where(and13(eq17(userDocuments.userId, ctx.userId), eq17(userDocuments.id, documentId))).limit(1);
          if (rows.length === 0) {
            return { ok: false, content: `No document found with id "${documentId}".`, label: "Document not found" };
          }
          const doc = rows[0];
          const body = (doc.extractedText || "").slice(0, 12e3);
          return {
            ok: true,
            content: `Document "${doc.name}" (id: ${doc.id}, ${doc.mimeType}):

${body}`,
            label: `Read document: ${doc.name}`
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { ok: false, content: `Failed to read document: ${msg}`, label: "Read failed" };
        }
      }
    };
  }
});

// server/integrations/googleDrive.ts
import { google as google3 } from "googleapis";
import { Readable } from "node:stream";
function buildDriveClient(accessToken) {
  const oauth2Client = new google3.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google3.drive({ version: "v3", auth: oauth2Client });
}
async function ensureJarvisFolder(accessToken) {
  const drive = buildDriveClient(accessToken);
  const list = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and name='${JARVIS_FOLDER_NAME}' and trashed=false`,
    fields: "files(id,name)",
    spaces: "drive",
    pageSize: 1
  });
  const existing = list.data.files?.[0];
  if (existing?.id) return existing.id;
  const created = await drive.files.create({
    requestBody: {
      name: JARVIS_FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder"
    },
    fields: "id"
  });
  if (!created.data.id) throw new Error("Failed to create Jarvis folder");
  return created.data.id;
}
async function createDriveTextFile(accessToken, name, body, options = {}) {
  const drive = buildDriveClient(accessToken);
  const folderId = await ensureJarvisFolder(accessToken);
  const sourceMime = options.mimeType || "text/markdown";
  const targetMime = options.convertToDoc ? "application/vnd.google-apps.document" : sourceMime;
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: targetMime,
      parents: [folderId]
    },
    media: {
      mimeType: sourceMime,
      body: Readable.from([body])
    },
    fields: "id,name,mimeType,webViewLink",
    supportsAllDrives: false
  });
  if (!res.data.id) throw new Error("Drive file create returned no id");
  return {
    fileId: res.data.id,
    name: res.data.name || name,
    mimeType: res.data.mimeType || targetMime,
    webViewLink: res.data.webViewLink || `https://drive.google.com/file/d/${res.data.id}/view`
  };
}
async function listJarvisDriveFiles(accessToken, limit = 25) {
  const drive = buildDriveClient(accessToken);
  const folderId = await ensureJarvisFolder(accessToken);
  const list = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: "files(id,name,mimeType,modifiedTime,webViewLink)",
    orderBy: "modifiedTime desc",
    pageSize: Math.min(limit, 100)
  });
  return (list.data.files || []).map((f) => ({
    id: f.id || "",
    name: f.name || "",
    mimeType: f.mimeType || "",
    modifiedTime: f.modifiedTime || void 0,
    webViewLink: f.webViewLink || void 0
  }));
}
async function readDriveFile(accessToken, fileId) {
  const drive = buildDriveClient(accessToken);
  const meta = await drive.files.get({
    fileId,
    fields: "id,name,mimeType"
  });
  const mimeType = meta.data.mimeType || "text/plain";
  const name = meta.data.name || "file";
  if (mimeType.startsWith("application/vnd.google-apps.")) {
    const exportMime = mimeType === "application/vnd.google-apps.document" ? "text/plain" : mimeType === "application/vnd.google-apps.spreadsheet" ? "text/csv" : "text/plain";
    const res2 = await drive.files.export(
      { fileId, mimeType: exportMime },
      { responseType: "text" }
    );
    return { name, mimeType, content: String(res2.data || "") };
  }
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "text" }
  );
  return { name, mimeType, content: String(res.data || "") };
}
var JARVIS_FOLDER_NAME;
var init_googleDrive = __esm({
  "server/integrations/googleDrive.ts"() {
    "use strict";
    JARVIS_FOLDER_NAME = "Jarvis Workspace";
  }
});

// server/agent/tools/googleDriveTools.ts
function noDrive() {
  return {
    ok: false,
    content: "Google Drive is not available \u2014 the user needs to reconnect their Google account from the Profile screen so Jarvis can request the drive.file scope.",
    label: "Drive not connected"
  };
}
function parseDriveFileId(input) {
  const s = input.trim();
  if (!s) return null;
  if (/^[A-Za-z0-9_-]{20,}$/.test(s)) return s;
  const dMatch = s.match(/\/d\/([A-Za-z0-9_-]{20,})/);
  if (dMatch) return dMatch[1];
  try {
    const url = new URL(s);
    const idParam = url.searchParams.get("id");
    if (idParam && /^[A-Za-z0-9_-]{20,}$/.test(idParam)) return idParam;
  } catch {
  }
  return null;
}
var driveCreateFileTool, driveListFilesTool, driveReadFileTool;
var init_googleDriveTools = __esm({
  "server/agent/tools/googleDriveTools.ts"() {
    "use strict";
    init_googleDrive();
    driveCreateFileTool = {
      name: "drive_create_file",
      description: "Create a new file in the user's Google Drive inside the 'Jarvis' folder (created automatically). Use this for content the user wants saved to Drive \u2014 meeting notes, briefs, plans, etc. Set as_google_doc=true to save as an editable Google Doc; otherwise it's saved as markdown.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "File name (without extension; one will be added if needed)" },
          content: { type: "string", description: "File body text/markdown" },
          as_google_doc: {
            type: "boolean",
            description: "If true, convert to an editable Google Doc. If false (default), save as a .md file."
          }
        },
        required: ["name", "content"]
      },
      async execute(args, ctx) {
        if (!ctx.googleAccessToken) return noDrive();
        const a = args;
        let name = String(a.name || "").trim().slice(0, 200) || "Untitled";
        const asDoc = !!a.as_google_doc;
        if (!asDoc && !/\.[a-zA-Z0-9]{1,8}$/.test(name)) name += ".md";
        try {
          const file = await createDriveTextFile(ctx.googleAccessToken, name, String(a.content || ""), {
            convertToDoc: asDoc
          });
          console.log(`[${ctx.channel || "Agent"}] drive_create_file name="${name}" asDoc=${asDoc} id=${file.fileId}`);
          return {
            ok: true,
            content: `Saved to Google Drive: "${file.name}" \u2014 ${file.webViewLink}`,
            label: `Saved to Drive: ${file.name}`,
            detail: file.webViewLink
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const insufficientScope = /insufficient|scope|permission/i.test(msg);
          return {
            ok: false,
            content: insufficientScope ? "Drive write failed \u2014 the user's Google connection is missing the drive.file scope. Ask them to reconnect Google in the Profile screen." : `Drive write failed: ${msg}`,
            label: "Drive write failed",
            detail: msg
          };
        }
      }
    };
    driveListFilesTool = {
      name: "drive_list_files",
      description: "List files Jarvis has previously saved to the user's Google Drive (in the Jarvis folder).",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max files to return (default 20)" }
        }
      },
      async execute(args, ctx) {
        if (!ctx.googleAccessToken) return noDrive();
        const limit = Number(args.limit) || 20;
        try {
          const files = await listJarvisDriveFiles(ctx.googleAccessToken, limit);
          if (files.length === 0) {
            return { ok: true, content: "No files in the Jarvis Drive folder yet.", label: "Drive: 0 files" };
          }
          const formatted = files.map((f) => `- [id:${f.id}] "${f.name}" (${f.mimeType})${f.modifiedTime ? ` modified ${f.modifiedTime}` : ""}`).join("\n");
          return {
            ok: true,
            content: `Files in Jarvis Drive folder:
${formatted}`,
            label: `Drive: ${files.length} files`
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { ok: false, content: `Drive list failed: ${msg}`, label: "Drive list failed" };
        }
      }
    };
    driveReadFileTool = {
      name: "drive_read_file",
      description: "Read the contents of a Drive file by id or by full Drive URL (e.g. https://drive.google.com/file/d/<id>/view or a Google Doc URL). Returns up to ~12k characters.",
      parameters: {
        type: "object",
        properties: {
          file_id: { type: "string", description: "Drive file ID from drive_list_files (preferred when known)" },
          url: { type: "string", description: "Full Drive/Docs URL \u2014 id will be parsed from it" }
        }
      },
      async execute(args, ctx) {
        if (!ctx.googleAccessToken) return noDrive();
        const a = args;
        const raw = a.file_id && a.file_id.trim() || a.url && a.url.trim() || "";
        if (!raw) {
          return { ok: false, content: "Either file_id or url is required.", label: "Missing id" };
        }
        const id = parseDriveFileId(raw);
        if (!id) {
          return {
            ok: false,
            content: `Could not parse a Drive file id from "${raw}". Pass either a bare id or a Drive URL.`,
            label: "Invalid Drive id/url"
          };
        }
        try {
          const f = await readDriveFile(ctx.googleAccessToken, id);
          const body = f.content.slice(0, 12e3);
          return {
            ok: true,
            content: `File "${f.name}" (${f.mimeType}):

${body}`,
            label: `Read Drive file: ${f.name}`
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { ok: false, content: `Drive read failed: ${msg}`, label: "Drive read failed", detail: msg };
        }
      }
    };
  }
});

// server/agent/tools/calendar.ts
function todayInTZ(tz = "Europe/London") {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(/* @__PURE__ */ new Date());
}
function addDays(dateStr, n) {
  const d = /* @__PURE__ */ new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
var fetchCalendarTool;
var init_calendar = __esm({
  "server/agent/tools/calendar.ts"() {
    "use strict";
    init_googleCalendar();
    fetchCalendarTool = {
      name: "fetch_calendar",
      description: "Fetch the user's Google Calendar events for a given day or date range. Use this whenever the user asks about meetings, schedule, availability, or what's coming up. Returns events grouped by day with title, start/end, location, and attendees.",
      parameters: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description: "ISO date YYYY-MM-DD. Defaults to today (Europe/London) if omitted."
          },
          days: {
            type: "number",
            description: "How many consecutive days starting from `date` to fetch. Default 1 (single day). Max 14."
          }
        }
      },
      async execute(args, ctx) {
        if (!ctx.googleAccessToken) {
          return {
            ok: false,
            content: "User has not connected Google Calendar. Ask them to connect Google in Settings.",
            label: "Calendar not connected"
          };
        }
        const a = args;
        const startDate = String(a.date || todayInTZ()).slice(0, 10);
        const days = Math.min(Math.max(Number(a.days) || 1, 1), 14);
        try {
          const blocks = [];
          let totalEvents = 0;
          for (let i = 0; i < days; i++) {
            const d = addDays(startDate, i);
            const events = await getGoogleCalendarEvents(d, void 0, void 0, ctx.googleAccessToken);
            totalEvents += events.length;
            if (events.length === 0) {
              blocks.push(`### ${d}
(no events)`);
              continue;
            }
            const lines = events.map((e) => {
              const loc = e.location ? ` @ ${e.location}` : "";
              return `- ${e.start}${e.end ? `\u2013${e.end}` : ""}: ${e.title || "(no title)"}${loc}`;
            });
            blocks.push(`### ${d}
${lines.join("\n")}`);
          }
          ctx.state.lastCalendarFetch = { startDate, days, totalEvents, fetchedAt: Date.now() };
          return {
            ok: true,
            content: `Calendar (${days} day${days === 1 ? "" : "s"} from ${startDate}, ${totalEvents} event${totalEvents === 1 ? "" : "s"}):

${blocks.join("\n\n")}`,
            label: `Fetched calendar: ${days}d, ${totalEvents} event${totalEvents === 1 ? "" : "s"}`
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[${ctx.channel || "Agent"}] fetch_calendar failed:`, msg);
          return { ok: false, content: `Calendar fetch failed: ${msg}`, label: "Calendar fetch failed", detail: msg };
        }
      }
    };
  }
});

// server/agent/tools/spawnSubagent.ts
var spawnSubagentTool;
var init_spawnSubagent = __esm({
  "server/agent/tools/spawnSubagent.ts"() {
    "use strict";
    init_jobQueue();
    init_subagents();
    spawnSubagentTool = {
      name: "spawn_subagent",
      description: "Spawn a background sub-agent that works while the user is away. Use this for tasks that take real time and produce a deliverable the user can review later \u2014 research briefs, longer documents, structured plans, or email drafts. The job runs asynchronously; the user will see the result in their Inbox under Deliverables. Do NOT use this for quick lookups (use search_web), for editing today's plan (use manage_tasks), or for things that need an immediate answer.",
      parameters: {
        type: "object",
        properties: {
          agent_type: {
            type: "string",
            enum: SUB_AGENT_TYPES,
            description: "research = web research brief; writing = longer document/note/memo; planning = phased action plan for a project; email = draft a single outbound email reply."
          },
          title: {
            type: "string",
            description: "Short label shown in the user's Inbox (\u226480 chars)."
          },
          prompt: {
            type: "string",
            description: "The full instruction for the sub-agent. Include enough context that it can work without asking follow-up questions \u2014 the user is not in this conversation. For email type, name the recipient and what the email is about."
          }
        },
        required: ["agent_type", "title", "prompt"]
      },
      async execute(args, ctx) {
        const a = args;
        const agentType = String(a.agent_type || "");
        const title = String(a.title || "").trim();
        const prompt = String(a.prompt || "").trim();
        if (!SUB_AGENT_TYPES.includes(agentType)) {
          return {
            ok: false,
            content: `Invalid agent_type "${agentType}". Use one of: ${SUB_AGENT_TYPES.join(", ")}.`,
            label: "Bad agent_type"
          };
        }
        if (!title) return { ok: false, content: "title is required.", label: "Missing title" };
        if (!prompt) return { ok: false, content: "prompt is required.", label: "Missing prompt" };
        try {
          const jobId = await submitAgentJob({
            userId: ctx.userId,
            agentType,
            title,
            prompt
          });
          console.log(`[${ctx.channel || "Agent"}] spawn_subagent type=${agentType} job=${jobId} title="${title.slice(0, 60)}"`);
          return {
            ok: true,
            content: `Queued a ${agentType} sub-agent (job ${jobId}). It will run in the background and the result will appear in the user's Inbox under Deliverables.`,
            label: `Spawned ${agentType} sub-agent`,
            detail: jobId
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { ok: false, content: `Failed to queue sub-agent: ${msg}`, label: "Queue failed", detail: msg };
        }
      }
    };
  }
});

// server/agent/tools/daemon.ts
function isDesktopAction(value) {
  return DESKTOP_ACTIONS.includes(value);
}
function isAndroidAction(value) {
  return ANDROID_ACTIONS.includes(value);
}
function androidPermKey(action) {
  if (action === "android_screenshot") return "android_screenshot";
  if (action === "android_read_screen") return "android_read_screen";
  if (action === "android_open_app") return "android_open_app";
  if (action === "android_browse") return "android_browse";
  if (action === "android_file_list") return "android_file_list";
  if (action === "android_file_read") return "android_file_read";
  if (action === "android_tap" || action === "android_type" || action === "android_swipe" || action === "android_press_key") return "android_tap_type";
  return null;
}
var DESKTOP_ACTIONS, ANDROID_ACTIONS, daemonActionTool;
var init_daemon = __esm({
  "server/agent/tools/daemon.ts"() {
    "use strict";
    init_bridge();
    DESKTOP_ACTIONS = ["shell", "notify", "file_read", "file_write", "file_list"];
    ANDROID_ACTIONS = [
      "android_open_app",
      "android_browse",
      "android_screenshot",
      "android_read_screen",
      "android_tap",
      "android_type",
      "android_swipe",
      "android_press_key",
      "android_file_list",
      "android_file_read"
    ];
    daemonActionTool = {
      name: "daemon_action",
      description: `Execute a sandboxed action on the user's paired daemon \u2014 either a desktop daemon or an Android device daemon.

DESKTOP actions (available when a desktop daemon is paired):
- shell: run a shell command in the workspace root
- notify: send a desktop notification
- file_read: read a text file under the workspace root
- file_write: write a text file under the workspace root
- file_list: list files in a directory under the workspace root

ANDROID actions (available when an Android device daemon is paired):
- android_open_app: launch an Android app by package name (e.g. "com.google.android.youtube") \u2014 confirm with user before launching
- android_browse: open a URL in the default browser
- android_screenshot: capture the current screen as a base64 PNG image
- android_read_screen: return the visible text and UI element tree via accessibility
- android_tap: tap at x/y pixel coordinates on the screen
- android_type: type text using the accessibility service
- android_swipe: swipe from (x1,y1) to (x2,y2)
- android_press_key: press a system key \u2014 "back", "home", "recents", "volume_up", "volume_down"
- android_file_list: list files in any path on the device (gallery, downloads, any folder)
- android_file_read: read any file on the device

Always confirm with the user before tap/type/swipe actions. Use android_read_screen or android_screenshot to understand context before acting. Require confirmation before any destructive shell or file_write actions. When an Android daemon is paired, prefer android_* actions. Returns the daemon's response or an error if not paired.`,
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: [
              "shell",
              "notify",
              "file_read",
              "file_write",
              "file_list",
              "android_open_app",
              "android_browse",
              "android_screenshot",
              "android_read_screen",
              "android_tap",
              "android_type",
              "android_swipe",
              "android_press_key",
              "android_file_list",
              "android_file_read"
            ]
          },
          cmd: { type: "string", description: "Shell command (when action is 'shell')" },
          cwd: { type: "string", description: "Optional working directory relative to workspace root" },
          title: { type: "string", description: "Notification title (when action is 'notify')" },
          body: { type: "string", description: "Notification body (when action is 'notify')" },
          path: { type: "string", description: "File or directory path (desktop: relative to workspace; android: absolute device path)" },
          content: { type: "string", description: "Text content (when action is 'file_write')" },
          timeoutMs: { type: "number", description: "Optional timeout in ms (default 15000)" },
          packageName: { type: "string", description: "Android app package name (when action is 'android_open_app')" },
          url: { type: "string", description: "URL to open (when action is 'android_browse')" },
          x: { type: "number", description: "X coordinate in pixels (when action is 'android_tap')" },
          y: { type: "number", description: "Y coordinate in pixels (when action is 'android_tap')" },
          text: { type: "string", description: "Text to type (when action is 'android_type')" },
          x1: { type: "number", description: "Swipe start X (when action is 'android_swipe')" },
          y1: { type: "number", description: "Swipe start Y (when action is 'android_swipe')" },
          x2: { type: "number", description: "Swipe end X (when action is 'android_swipe')" },
          y2: { type: "number", description: "Swipe end Y (when action is 'android_swipe')" },
          durationMs: { type: "number", description: "Swipe duration in ms (when action is 'android_swipe', default 300)" },
          key: { type: "string", enum: ["back", "home", "recents", "volume_up", "volume_down"], description: "System key (when action is 'android_press_key')" }
        },
        required: ["action"]
      },
      async execute(args, ctx) {
        if (!isUserPaired(ctx.userId)) {
          return { ok: false, content: JSON.stringify({ ok: false, error: "No daemon paired. Ask the user to install and pair either the desktop daemon (Profile \u2192 Connected Channels \u2192 Desktop Daemon) or the Android daemon APK (Profile \u2192 Connected Channels \u2192 Android Device)." }) };
        }
        const rawAction = String(args.action || "");
        const androidActive = await isAndroidDaemonActive(ctx.userId);
        if (isAndroidAction(rawAction)) {
          if (!androidActive) {
            return { ok: false, content: JSON.stringify({ ok: false, error: "No Android daemon connected. The currently-paired daemon is a desktop daemon. Ask the user to install the Jarvis Android APK and pair it." }) };
          }
          const permKey = androidPermKey(rawAction);
          if (permKey && !await isAndroidDaemonActionAllowed(ctx.userId, permKey)) {
            return { ok: false, content: JSON.stringify({ ok: false, error: `Android action '${rawAction}' is not permitted. Ask the user to enable it in Profile \u2192 Connected Channels \u2192 Android Device \u2192 Permissions.` }) };
          }
          let op2;
          if (rawAction === "android_open_app") {
            if (!args.packageName) return { ok: false, content: JSON.stringify({ ok: false, error: "packageName required" }) };
            op2 = { type: "android_open_app", packageName: String(args.packageName) };
          } else if (rawAction === "android_browse") {
            if (!args.url) return { ok: false, content: JSON.stringify({ ok: false, error: "url required" }) };
            op2 = { type: "android_browse", url: String(args.url) };
          } else if (rawAction === "android_screenshot") {
            op2 = { type: "android_screenshot" };
          } else if (rawAction === "android_read_screen") {
            op2 = { type: "android_read_screen" };
          } else if (rawAction === "android_tap") {
            if (typeof args.x !== "number" || typeof args.y !== "number") return { ok: false, content: JSON.stringify({ ok: false, error: "x and y required" }) };
            op2 = { type: "android_tap", x: args.x, y: args.y };
          } else if (rawAction === "android_type") {
            if (!args.text) return { ok: false, content: JSON.stringify({ ok: false, error: "text required" }) };
            op2 = { type: "android_type", text: String(args.text) };
          } else if (rawAction === "android_swipe") {
            if (typeof args.x1 !== "number" || typeof args.y1 !== "number" || typeof args.x2 !== "number" || typeof args.y2 !== "number") {
              return { ok: false, content: JSON.stringify({ ok: false, error: "x1, y1, x2, y2 required" }) };
            }
            op2 = { type: "android_swipe", x1: args.x1, y1: args.y1, x2: args.x2, y2: args.y2, durationMs: typeof args.durationMs === "number" ? args.durationMs : 300 };
          } else if (rawAction === "android_press_key") {
            const validKeys = ["back", "home", "recents", "volume_up", "volume_down"];
            const key = String(args.key || "back");
            if (!validKeys.includes(key)) return { ok: false, content: JSON.stringify({ ok: false, error: "invalid key" }) };
            op2 = { type: "android_press_key", key };
          } else if (rawAction === "android_file_list") {
            if (!args.path) return { ok: false, content: JSON.stringify({ ok: false, error: "path required" }) };
            op2 = { type: "android_file_list", path: String(args.path) };
          } else if (rawAction === "android_file_read") {
            if (!args.path) return { ok: false, content: JSON.stringify({ ok: false, error: "path required" }) };
            op2 = { type: "android_file_read", path: String(args.path) };
          } else {
            return { ok: false, content: JSON.stringify({ ok: false, error: `unknown android action ${rawAction}` }) };
          }
          const result2 = await sendDaemonOp(ctx.userId, op2, 3e4);
          return { ok: !!result2.ok, content: JSON.stringify(result2).slice(0, 12e3) };
        }
        if (!isDesktopAction(rawAction)) {
          return { ok: false, content: JSON.stringify({ ok: false, error: `unknown action ${rawAction}` }) };
        }
        if (androidActive) {
          return { ok: false, content: JSON.stringify({ ok: false, error: `Action '${rawAction}' is a desktop-only action but the connected daemon is Android. Use android_* actions instead.` }) };
        }
        const action = rawAction;
        if (!await isDaemonActionAllowed(ctx.userId, action)) {
          return { ok: false, content: JSON.stringify({ ok: false, error: `Action '${action}' is not permitted on this user's daemon. Ask the user to enable it in Profile \u2192 Connected Channels \u2192 Desktop Daemon \u2192 Permissions.` }) };
        }
        let op;
        if (action === "shell") {
          if (!args.cmd) return { ok: false, content: JSON.stringify({ ok: false, error: "cmd required" }) };
          op = { type: "shell", cmd: String(args.cmd), cwd: args.cwd ? String(args.cwd) : void 0, timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : void 0 };
        } else if (action === "notify") {
          op = { type: "notify", title: String(args.title || "GamePlan"), body: String(args.body || "") };
        } else if (action === "file_read") {
          if (!args.path) return { ok: false, content: JSON.stringify({ ok: false, error: "path required" }) };
          op = { type: "file_read", path: String(args.path) };
        } else if (action === "file_write") {
          if (!args.path || typeof args.content !== "string") return { ok: false, content: JSON.stringify({ ok: false, error: "path and content required" }) };
          op = { type: "file_write", path: String(args.path), content: String(args.content) };
        } else if (action === "file_list") {
          if (!args.path) return { ok: false, content: JSON.stringify({ ok: false, error: "path required" }) };
          op = { type: "file_list", path: String(args.path) };
        } else {
          return { ok: false, content: JSON.stringify({ ok: false, error: `unknown action ${action}` }) };
        }
        const result = await sendDaemonOp(ctx.userId, op, action === "shell" ? 3e4 : 1e4);
        return { ok: !!result.ok, content: JSON.stringify(result).slice(0, 8e3) };
      }
    };
  }
});

// server/agent/tools/connections.ts
import { eq as eq18 } from "drizzle-orm";
function getServerBaseUrl() {
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
  if (domain) {
    const isDev = process.env.REPLIT_DEV_DOMAIN === domain;
    return isDev ? `https://${domain}:5000` : `https://${domain}`;
  }
  return "http://localhost:5000";
}
var checkConnectionsTool, generateReconnectLinkTool;
var init_connections = __esm({
  "server/agent/tools/connections.ts"() {
    "use strict";
    init_userTokenStore();
    init_db();
    init_schema();
    init_bridge();
    checkConnectionsTool = {
      name: "check_connections",
      description: "Check which external accounts and messaging channels the user has connected. Returns a structured status for Google (Gmail/Calendar), Microsoft (Outlook/Calendar), Slack, Telegram, WhatsApp, Discord, and Desktop Daemon. Always call this before claiming a service is (or isn't) connected, or before attempting an action on a connected service.",
      parameters: {
        type: "object",
        properties: {}
      },
      async execute(_args, ctx) {
        try {
          const [googleToken, msToken, oauthStatus, tgRows, channelRows] = await Promise.all([
            getValidGoogleToken(ctx.userId).catch(() => null),
            getValidMicrosoftToken(ctx.userId).catch(() => null),
            getUserOAuthStatus(ctx.userId).catch(() => ({})),
            db.select({ chatId: telegramLinks.chatId }).from(telegramLinks).where(eq18(telegramLinks.userId, ctx.userId)).limit(1),
            db.select().from(channelLinks).where(eq18(channelLinks.userId, ctx.userId))
          ]);
          const daemonConnected = isUserPaired(ctx.userId);
          const androidActive = daemonConnected ? await isAndroidDaemonActive(ctx.userId) : false;
          const googleEmail = oauthStatus?.google?.email || oauthStatus?.google?.accounts?.[0]?.email || "unknown";
          const msEmail = oauthStatus?.microsoft?.email || oauthStatus?.microsoft?.accounts?.[0]?.email || "unknown";
          const daemonLabel = daemonConnected ? androidActive ? `Android Device Daemon: \u2713 online \u2014 use android_* actions (android_open_app, android_browse, android_screenshot, android_read_screen, android_tap, android_type, android_swipe, android_press_key, android_file_list, android_file_read). DO NOT use desktop shell/notify/file_read/file_write actions.` : `Desktop Daemon: \u2713 online \u2014 use shell, notify, file_read, file_write, file_list actions.` : `Android/Desktop Daemon: \u2717 not connected`;
          const lines = [
            `Google (Gmail + Calendar): ${googleToken ? `\u2713 token valid \u2014 ${googleEmail}` : "\u2717 not connected or token expired (reconnect needed)"}`,
            `Microsoft (Outlook + Calendar): ${msToken ? `\u2713 token valid \u2014 ${msEmail}` : "\u2717 not connected or token expired (reconnect needed)"}`,
            `Slack OAuth: ${oauthStatus?.slack?.connected ? "\u2713 connected" : "\u2717 not connected"}`,
            `Telegram: ${tgRows.length > 0 ? "\u2713 linked" : "\u2717 not linked"}`,
            `WhatsApp: ${channelRows.some((r) => r.channel === "whatsapp") ? "\u2713 linked" : "\u2717 not linked"}`,
            `Discord: ${channelRows.some((r) => r.channel === "discord") ? "\u2713 linked" : "\u2717 not linked"}`,
            daemonLabel
          ];
          const summary = lines.join("\n");
          return {
            ok: true,
            content: `Current connection status:
${summary}`,
            label: "Connections checked"
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { ok: false, content: `check_connections failed: ${msg}`, label: "Check connections failed" };
        }
      }
    };
    generateReconnectLinkTool = {
      name: "generate_reconnect_link",
      description: "Generate a fresh OAuth authorization URL to reconnect a disconnected or expired account. Returns a URL and a button label. Use after check_connections shows a service is not connected. provider must be 'google' (Gmail + Calendar) or 'microsoft' (Outlook + Calendar).",
      parameters: {
        type: "object",
        properties: {
          provider: {
            type: "string",
            enum: ["google", "microsoft"],
            description: "Which provider to reconnect: 'google' or 'microsoft'"
          }
        },
        required: ["provider"]
      },
      async execute(args, ctx) {
        const provider = String(args.provider || "").toLowerCase();
        const baseUrl = getServerBaseUrl();
        if (provider === "google") {
          const clientId = process.env.GOOGLE_WEB_CLIENT_ID;
          if (!clientId) {
            return { ok: false, content: "Google OAuth is not configured on this server.", label: "Google not configured" };
          }
          const redirectUri = `${baseUrl}/api/oauth/google/callback`;
          const params = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: "code",
            scope: [
              "openid",
              "email",
              "https://www.googleapis.com/auth/calendar.events",
              "https://www.googleapis.com/auth/calendar.readonly",
              "https://www.googleapis.com/auth/gmail.readonly",
              "https://www.googleapis.com/auth/gmail.compose",
              "https://www.googleapis.com/auth/gmail.modify",
              "https://www.googleapis.com/auth/drive.file"
            ].join(" "),
            access_type: "offline",
            prompt: "consent",
            state: ctx.userId
          });
          const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
          return {
            ok: true,
            content: `Google reconnect link ready. Present this to the user as a tappable button labelled "Reconnect Google". URL: ${url}`,
            label: "Reconnect Google",
            detail: JSON.stringify({ url, buttonLabel: "Reconnect Google", provider: "google" })
          };
        }
        if (provider === "microsoft") {
          const clientId = process.env.MICROSOFT_CLIENT_ID;
          if (!clientId) {
            return { ok: false, content: "Microsoft OAuth is not configured on this server.", label: "Microsoft not configured" };
          }
          const redirectUri = `${baseUrl}/api/oauth/microsoft/callback`;
          const params = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: "code",
            scope: "offline_access Calendars.ReadWrite Mail.ReadWrite Mail.Send User.Read",
            state: ctx.userId,
            response_mode: "query"
          });
          const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
          return {
            ok: true,
            content: `Microsoft reconnect link ready. Present this to the user as a tappable button labelled "Reconnect Outlook". URL: ${url}`,
            label: "Reconnect Outlook",
            detail: JSON.stringify({ url, buttonLabel: "Reconnect Outlook", provider: "microsoft" })
          };
        }
        return { ok: false, content: `Unknown provider "${provider}". Use 'google' or 'microsoft'.`, label: "Unknown provider" };
      }
    };
  }
});

// server/agent/tools/calendarCreate.ts
var createCalendarEventTool;
var init_calendarCreate = __esm({
  "server/agent/tools/calendarCreate.ts"() {
    "use strict";
    init_googleCalendar();
    init_outlook();
    init_userTokenStore();
    createCalendarEventTool = {
      name: "create_calendar_event",
      description: "Create a calendar event on the user's Google Calendar or Outlook calendar. Use this when the user asks to schedule, block time, or add a meeting. start and end must be ISO 8601 datetime strings (e.g. '2025-04-22T14:00:00Z'). provider defaults to 'google' if connected, otherwise 'microsoft'.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Event title / summary" },
          start: { type: "string", description: "Start datetime in ISO 8601 format (e.g. '2025-04-22T14:00:00Z')" },
          end: { type: "string", description: "End datetime in ISO 8601 format (e.g. '2025-04-22T15:00:00Z')" },
          description: { type: "string", description: "Optional event description or notes" },
          location: { type: "string", description: "Optional location or video call link" },
          provider: { type: "string", enum: ["google", "microsoft"], description: "Calendar provider. Defaults to 'google'." }
        },
        required: ["title", "start", "end"]
      },
      async execute(args, ctx) {
        const a = args;
        const title = String(a.title || "").trim();
        const start = String(a.start || "").trim();
        const end = String(a.end || "").trim();
        const description = a.description ? String(a.description).trim() : void 0;
        const location = a.location ? String(a.location).trim() : void 0;
        const provider = (a.provider || "google").toLowerCase();
        if (!title || !start || !end) {
          return { ok: false, content: "title, start, and end are all required.", label: "Missing required fields" };
        }
        try {
          if (provider === "google") {
            if (!ctx.googleAccessToken) {
              return { ok: false, content: "Google Calendar is not connected. Ask the user to connect their Google account in Profile.", label: "Google not connected" };
            }
            const result = await createGoogleCalendarEvent(ctx.googleAccessToken, { title, start, end, description, location });
            const startDate = start.slice(0, 10);
            const startTime = start.slice(11, 16);
            return {
              ok: true,
              content: `Event created on Google Calendar: "${title}" on ${startDate} at ${startTime}${result.htmlLink ? `. View: ${result.htmlLink}` : ""}`,
              label: `Event created: ${title}`,
              detail: result.htmlLink || void 0
            };
          }
          if (provider === "microsoft") {
            const msToken = await getValidMicrosoftToken(ctx.userId);
            if (!msToken) {
              return { ok: false, content: "Microsoft Calendar is not connected. Ask the user to connect their Microsoft account in Profile.", label: "Microsoft not connected" };
            }
            await createOutlookCalendarEvent(msToken, { title, start, end, description, location });
            const startDate = start.slice(0, 10);
            const startTime = start.slice(11, 16);
            return {
              ok: true,
              content: `Event created on Outlook Calendar: "${title}" on ${startDate} at ${startTime}`,
              label: `Event created: ${title}`
            };
          }
          return { ok: false, content: `Unknown provider "${provider}". Use 'google' or 'microsoft'.`, label: "Unknown provider" };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[${ctx.channel || "Agent"}] create_calendar_event failed:`, msg);
          return { ok: false, content: `Calendar event creation failed: ${msg}`, label: "Calendar create failed", detail: msg };
        }
      }
    };
  }
});

// server/agent/tools/sendEmail.ts
var sendEmailTool;
var init_sendEmail = __esm({
  "server/agent/tools/sendEmail.ts"() {
    "use strict";
    init_gmail();
    init_outlook();
    init_userTokenStore();
    sendEmailTool = {
      name: "send_email",
      description: "Send an email immediately via Gmail or Outlook. Only use this when the user explicitly confirms they want to send (not just draft). Requires Google or Microsoft to be connected. provider defaults to 'google' if connected, otherwise 'microsoft'. If the user has multiple Google accounts, pass accountHint with the sender email address to use the correct account.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email address" },
          subject: { type: "string", description: "Email subject line" },
          body: { type: "string", description: "Email body text (plain text)" },
          provider: { type: "string", enum: ["google", "microsoft"], description: "Which email provider to use: 'google' (Gmail) or 'microsoft' (Outlook). Defaults to 'google'." },
          accountHint: { type: "string", description: "Optional sender account email to disambiguate when multiple accounts are connected (e.g. 'alice@gmail.com')" }
        },
        required: ["to", "subject", "body"]
      },
      async execute(args, ctx) {
        const a = args;
        const to = String(a.to || "").trim();
        const subject = String(a.subject || "").trim();
        const body = String(a.body || "");
        const provider = (a.provider || "google").toLowerCase();
        const accountHint = a.accountHint ? String(a.accountHint).trim().toLowerCase() : null;
        if (!to || !subject || !body.trim()) {
          return { ok: false, content: "to, subject, and body are all required.", label: "Missing required fields" };
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(to)) {
          return { ok: false, content: `"${to}" doesn't look like a valid email address.`, label: "Invalid recipient" };
        }
        try {
          if (provider === "google") {
            let token = ctx.googleAccessToken || null;
            if (!token && accountHint) {
              const allTokens = await getUserTokens(ctx.userId, "google");
              const match = allTokens.find((t) => (t.accountEmail || "").toLowerCase() === accountHint);
              if (match && !(match.expiresAt && match.expiresAt.getTime() < Date.now() + 6e4)) {
                token = match.accessToken;
              }
            }
            if (!token) token = await getValidGoogleToken(ctx.userId);
            if (!token) {
              return { ok: false, content: "Gmail is not connected. Ask the user to connect Google in Profile.", label: "Gmail not connected" };
            }
            const result = await sendGmailEmail(token, to, subject, body);
            console.log(`[${ctx.channel || "Agent"}] send_email via Gmail to=${to} subject="${subject.slice(0, 60)}" id=${result.messageId}`);
            return {
              ok: true,
              content: `Email sent via Gmail to ${to} with subject "${subject}".`,
              label: `Email sent to ${to}`,
              detail: result.messageId
            };
          }
          if (provider === "microsoft") {
            const token = await getValidMicrosoftToken(ctx.userId);
            if (!token) {
              return { ok: false, content: "Outlook is not connected. Ask the user to connect Microsoft in Profile.", label: "Outlook not connected" };
            }
            await sendOutlookEmail(token, to, subject, body);
            console.log(`[${ctx.channel || "Agent"}] send_email via Outlook to=${to} subject="${subject.slice(0, 60)}"`);
            return {
              ok: true,
              content: `Email sent via Outlook to ${to} with subject "${subject}".`,
              label: `Email sent to ${to}`
            };
          }
          return { ok: false, content: `Unknown provider "${provider}". Use 'google' or 'microsoft'.`, label: "Unknown provider" };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[${ctx.channel || "Agent"}] send_email failed:`, msg);
          return { ok: false, content: `Email send failed: ${msg}`, label: "Email send failed", detail: msg };
        }
      }
    };
  }
});

// server/agent/tools/fetchEmails.ts
var fetchEmailsTool;
var init_fetchEmails = __esm({
  "server/agent/tools/fetchEmails.ts"() {
    "use strict";
    init_userTokenStore();
    init_gmail();
    init_outlook();
    fetchEmailsTool = {
      name: "fetch_emails",
      description: "Fetch recent emails on demand from Gmail or Outlook. Use when the user asks about their inbox beyond what's already available in context. provider: 'google' (Gmail) or 'microsoft' (Outlook). count: number of emails to fetch (default 10, max 25).",
      parameters: {
        type: "object",
        properties: {
          provider: {
            type: "string",
            enum: ["google", "microsoft"],
            description: "Email provider: 'google' for Gmail, 'microsoft' for Outlook"
          },
          count: {
            type: "number",
            description: "Number of emails to fetch (max 25, default 10)"
          }
        },
        required: ["provider"]
      },
      async execute(args, ctx) {
        const provider = String(args.provider || "google").toLowerCase();
        const count = Math.min(Number(args.count) || 10, 25);
        try {
          if (provider === "google") {
            const token = await getValidGoogleToken(ctx.userId);
            if (!token) {
              return {
                ok: false,
                content: "Gmail is not connected or the token has expired. Call generate_reconnect_link with provider='google' to get a reconnect button.",
                label: "Gmail not connected"
              };
            }
            const emails = await getRecentEmailCommitments(14, token);
            const recent = emails.slice(0, count);
            if (recent.length === 0) {
              return { ok: true, content: "No emails found in the last 14 days.", label: "Inbox empty" };
            }
            const lines = recent.map(
              (e) => `- From: ${e.from || "unknown"} | Subject: "${e.subject}" \u2014 ${e.snippet}`
            ).join("\n");
            return {
              ok: true,
              content: `Fetched ${recent.length} Gmail email(s):
${lines}`,
              label: `Fetched ${recent.length} Gmail emails`
            };
          }
          if (provider === "microsoft") {
            const token = await getValidMicrosoftToken(ctx.userId);
            if (!token) {
              return {
                ok: false,
                content: "Outlook is not connected or the token has expired. Call generate_reconnect_link with provider='microsoft' to get a reconnect button.",
                label: "Outlook not connected"
              };
            }
            const emails = await getRecentOutlookEmails(token, count);
            if (emails.length === 0) {
              return { ok: true, content: "No emails found in Outlook inbox.", label: "Inbox empty" };
            }
            const lines = emails.map(
              (e) => `- From: ${e.from} | Subject: "${e.subject}" \u2014 ${e.snippet}`
            ).join("\n");
            return {
              ok: true,
              content: `Fetched ${emails.length} Outlook email(s):
${lines}`,
              label: `Fetched ${emails.length} Outlook emails`
            };
          }
          return { ok: false, content: `Unknown provider "${provider}". Use 'google' or 'microsoft'.`, label: "Unknown provider" };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { ok: false, content: `fetch_emails failed: ${msg}`, label: "Email fetch failed" };
        }
      }
    };
  }
});

// server/channels/slackChannel.ts
import { eq as eq19, and as and14 } from "drizzle-orm";
async function postSlackMessage(botToken, channel, text2) {
  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({ channel, text: text2 })
    });
    const data = await res.json();
    if (!data.ok) return { ok: false, error: data.error || "slack error" };
    return { ok: true, ts: data.ts };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
async function openSlackDm(botToken, slackUserId) {
  try {
    const res = await fetch("https://slack.com/api/conversations.open", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({ users: slackUserId })
    });
    const data = await res.json();
    if (!data.ok) {
      console.error("[slackChannel] conversations.open failed:", data.error);
      return null;
    }
    return data.channel?.id ?? null;
  } catch (err) {
    console.error("[slackChannel] conversations.open exception:", err);
    return null;
  }
}
async function lookupLink2(userId2) {
  try {
    const rows = await db.select().from(channelLinks).where(and14(eq19(channelLinks.userId, userId2), eq19(channelLinks.channel, "slack"))).limit(1);
    const row = rows[0];
    if (!row) return null;
    return { address: row.address, meta: row.metadata || {} };
  } catch (err) {
    console.error("[slackChannel] link lookup failed:", err);
    return null;
  }
}
async function getSlackBotToken(userId2) {
  const tok = await getUserToken(userId2, "slack");
  return tok?.accessToken ?? null;
}
var slackChannel;
var init_slackChannel = __esm({
  "server/channels/slackChannel.ts"() {
    "use strict";
    init_db();
    init_schema();
    init_userTokenStore();
    slackChannel = {
      name: "slack",
      // "Configured" if any user has a slack OAuth — we check on demand per user.
      isConfigured: () => true,
      async isLinkedFor(userId2) {
        const link = await lookupLink2(userId2);
        if (!link) return false;
        const tok = await getSlackBotToken(userId2);
        return !!tok;
      },
      async sendMessage(userId2, text2, opts = {}) {
        const link = await lookupLink2(userId2);
        if (!link) return { ok: false, error: "no slack link" };
        const botToken = await getSlackBotToken(userId2);
        if (!botToken) return { ok: false, error: "no slack bot token" };
        let target = link.meta.imChannelId;
        if (!target && link.meta.slackUserId) {
          target = await openSlackDm(botToken, link.meta.slackUserId) || void 0;
          if (target) {
            await db.update(channelLinks).set({ metadata: { ...link.meta, imChannelId: target } }).where(and14(eq19(channelLinks.userId, userId2), eq19(channelLinks.channel, "slack")));
          }
        }
        if (!target) target = link.address;
        let body = text2 || "";
        if (opts.attachments && opts.attachments.length > 0) {
          body = body ? `${body}

_(${opts.attachments.length} attachment(s) generated \u2014 open the GamePlan app to download.)_` : `_(${opts.attachments.length} attachment(s) generated \u2014 open the GamePlan app to download.)_`;
        }
        const result = await postSlackMessage(botToken, target, body);
        return { ok: result.ok, messageId: result.ts, error: result.error };
      }
    };
  }
});

// server/channels/slackWebhook.ts
var slackWebhook_exports = {};
__export(slackWebhook_exports, {
  registerSlackUserLink: () => registerSlackUserLink,
  registerSlackWebhook: () => registerSlackWebhook
});
import express from "express";
import * as crypto3 from "crypto";
import { eq as eq20, and as and15 } from "drizzle-orm";
function verifySlackSignature(req) {
  if (!SLACK_SIGNING_SECRET) {
    console.error("[slack] rejecting request: SLACK_SIGNING_SECRET is not configured");
    return false;
  }
  const ts = req.header("x-slack-request-timestamp");
  const sig = req.header("x-slack-signature");
  if (!ts || !sig) return false;
  if (Math.abs(Date.now() / 1e3 - Number(ts)) > 60 * 5) return false;
  const raw = req.rawBody?.toString("utf8") || "";
  const base = `v0:${ts}:${raw}`;
  const computed = "v0=" + crypto3.createHmac("sha256", SLACK_SIGNING_SECRET).update(base).digest("hex");
  try {
    return crypto3.timingSafeEqual(Buffer.from(computed), Buffer.from(sig));
  } catch {
    return false;
  }
}
async function findUserBySlackId(teamId, slackUserId) {
  try {
    const rows = await db.select().from(channelLinks).where(and15(eq20(channelLinks.channel, "slack"), eq20(channelLinks.address, `${teamId}:${slackUserId}`))).limit(1);
    return rows[0]?.userId ?? null;
  } catch (err) {
    console.error("[slack] user lookup failed:", err);
    return null;
  }
}
async function registerSlackUserLink(userId2, teamId, slackUserId) {
  await db.insert(channelLinks).values({
    userId: userId2,
    channel: "slack",
    address: `${teamId}:${slackUserId}`,
    metadata: { teamId, slackUserId },
    lastSeenAt: /* @__PURE__ */ new Date()
  }).onConflictDoUpdate({
    target: [channelLinks.channel, channelLinks.address],
    set: { userId: userId2, metadata: { teamId, slackUserId }, lastSeenAt: /* @__PURE__ */ new Date() }
  });
}
function registerSlackWebhook(app2) {
  app2.post(
    "/api/slack/events",
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      }
    }),
    async (req, res) => {
      if (!verifySlackSignature(req)) return res.status(401).send("invalid signature");
      const body = req.body || {};
      if (body.type === "url_verification") {
        return res.status(200).type("text/plain").send(body.challenge);
      }
      res.status(200).send("ok");
      if (body.type !== "event_callback") return;
      const ev = body.event || {};
      const teamId = body.team_id;
      const slackUserId = ev.user;
      if (!teamId || !slackUserId) return;
      if (ev.bot_id || ev.subtype) return;
      if (ev.type !== "message" && ev.type !== "app_mention") return;
      if (ev.type === "message" && ev.channel_type !== "im") return;
      const userId2 = await findUserBySlackId(teamId, slackUserId);
      const text2 = String(ev.text || "").replace(/<@[A-Z0-9]+>/g, "").trim();
      if (!userId2) {
        const tok = await db.select().from(channelLinks).where(and15(eq20(channelLinks.channel, "slack"))).limit(1);
        const replyToken = tok[0] ? await getSlackBotToken(tok[0].userId) : null;
        if (replyToken) {
          await postSlackMessage(replyToken, ev.channel, "I don't recognize this Slack account. Open the GamePlan app and reconnect Slack from Profile \u2192 Connected Apps.");
        }
        return;
      }
      if (!text2) return;
      const botToken = await getSlackBotToken(userId2);
      if (!botToken) return;
      try {
        const { reply } = await runCoachAgent({ userId: userId2, userText: text2, channelName: "Slack" });
        if (reply && reply.trim()) {
          await postSlackMessage(botToken, ev.channel, reply);
        }
      } catch (err) {
        console.error("[slack] coach error:", err);
        await postSlackMessage(botToken, ev.channel, "Sorry, I hit an error processing that. Please try again.");
      }
    }
  );
  app2.post(
    "/api/slack/commands",
    express.urlencoded({
      extended: false,
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      }
    }),
    async (req, res) => {
      if (!verifySlackSignature(req)) return res.status(401).send("invalid signature");
      const teamId = String(req.body.team_id || "");
      const slackUserId = String(req.body.user_id || "");
      const text2 = String(req.body.text || "").trim();
      const responseUrl = String(req.body.response_url || "");
      const userId2 = await findUserBySlackId(teamId, slackUserId);
      if (!userId2) {
        return res.json({ response_type: "ephemeral", text: "Your Slack isn't linked to a GamePlan account. Open the app \u2192 Profile \u2192 Connected Apps and reconnect." });
      }
      const [sub, ...rest] = text2.split(/\s+/);
      const arg = rest.join(" ").trim();
      const subcommand = (sub || "status").toLowerCase();
      res.json({ response_type: "ephemeral", text: `Working on \`${subcommand}\`...` });
      const respond = async (msg) => {
        if (!responseUrl) return;
        try {
          await fetch(responseUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ response_type: "ephemeral", text: msg })
          });
        } catch (err) {
          console.error("[slack] response_url post failed:", err);
        }
      };
      try {
        if (subcommand === "plan") {
          const plan = await buildPlanFromInputs({ userId: userId2, brainDump: arg ? [{ text: arg }] : [] });
          const lines = plan.tasks.map((t, i) => `${i + 1}. *${t.title}* \u2014 ${t.priority}${t.time ? ` @ ${t.time}` : ""}`).join("\n");
          await respond(`*Today's plan*
${lines}

_${plan.reasoning}_`);
        } else if (subcommand === "brain-dump" || subcommand === "braindump") {
          if (!arg) {
            await respond("Add the thought after the command, e.g. `/jarvis brain-dump finish Q3 deck`.");
            return;
          }
          const { reply } = await runCoachAgent({ userId: userId2, userText: `Brain dump: ${arg}`, channelName: "Slack" });
          await respond(reply);
        } else if (subcommand === "status") {
          const { reply } = await runCoachAgent({ userId: userId2, userText: arg || "What's the status of my day?", channelName: "Slack" });
          await respond(reply);
        } else {
          await respond("Unknown subcommand. Try `/jarvis plan`, `/jarvis brain-dump <thought>`, or `/jarvis status`.");
        }
      } catch (err) {
        console.error("[slack] slash command error:", err);
        await respond("Sorry, I hit an error. Please try again.");
      }
    }
  );
  console.log("[slack] events + slash command webhooks mounted");
}
var SLACK_SIGNING_SECRET;
var init_slackWebhook = __esm({
  "server/channels/slackWebhook.ts"() {
    "use strict";
    init_db();
    init_schema();
    init_coachAgent();
    init_slackChannel();
    init_routes2();
    SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
  }
});

// server/oauthRoutes.ts
import { Router as Router3 } from "express";
function getBaseUrl(req) {
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
  if (domain) {
    const isDev = process.env.REPLIT_DEV_DOMAIN === domain;
    return isDev ? `https://${domain}:5000` : `https://${domain}`;
  }
  return `${req.protocol}://${req.get("host")}`;
}
function successHtml2(provider, email) {
  const displayName = provider === "google" ? "Google (Calendar & Gmail)" : provider === "slack" ? "Slack" : "Microsoft Outlook";
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Connected \u2014 GamePlan</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f0f0f; color: #fff;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; padding: 20px;
    }
    .card {
      text-align: center; max-width: 360px;
      background: #1a1a1a; border-radius: 20px; padding: 40px 32px;
    }
    .check { font-size: 52px; margin-bottom: 20px; }
    h2 { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
    p { color: #888; font-size: 15px; line-height: 1.5; margin-bottom: 6px; }
    .email { color: #6366f1; font-size: 14px; margin-top: 4px; }
    .close-note { color: #555; font-size: 13px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="check">\u2705</div>
    <h2>${displayName} Connected</h2>
    ${email ? `<p class="email">${email}</p>` : ""}
    <p class="close-note">You can close this tab and return to GamePlan.</p>
  </div>
  <script>
    setTimeout(function() { window.close(); }, 2000);
  </script>
</body>
</html>`;
}
function errorHtml2(message) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Error \u2014 GamePlan</title>
  <style>
    body { font-family: sans-serif; background: #0f0f0f; color: #fff;
           display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { text-align: center; padding: 40px; }
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size:48px;margin-bottom:16px">\u274C</div>
    <h2>Connection Failed</h2>
    <p style="color:#888;margin-top:8px">${message}</p>
    <p style="color:#555;margin-top:20px;font-size:13px">You can close this tab.</p>
  </div>
</body>
</html>`;
}
function buildSlackAuthorizeUrl(userId2, redirectUri) {
  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) return null;
  const params = new URLSearchParams({
    client_id: clientId,
    user_scope: "channels:history,channels:read,im:history,im:read,groups:history,groups:read,users:read",
    redirect_uri: redirectUri,
    state: userId2
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}
var oauthRouter, oauthCallbackRouter;
var init_oauthRoutes = __esm({
  "server/oauthRoutes.ts"() {
    "use strict";
    init_userTokenStore();
    oauthRouter = Router3();
    oauthCallbackRouter = Router3();
    oauthRouter.get("/google/authorize", (req, res) => {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const clientId = process.env.GOOGLE_WEB_CLIENT_ID;
      if (!clientId) return res.status(500).json({ error: "Google OAuth not configured" });
      const baseUrl = getBaseUrl(req);
      const redirectUri = `${baseUrl}/api/oauth/google/callback`;
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: [
          "openid",
          "email",
          "https://www.googleapis.com/auth/calendar.events",
          "https://www.googleapis.com/auth/calendar.readonly",
          "https://www.googleapis.com/auth/gmail.readonly",
          "https://www.googleapis.com/auth/gmail.compose",
          "https://www.googleapis.com/auth/gmail.modify",
          "https://www.googleapis.com/auth/drive.file"
        ].join(" "),
        access_type: "offline",
        prompt: "consent",
        state: userId2
      });
      const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
      res.json({ url, redirectUri });
    });
    oauthCallbackRouter.get("/google/callback", async (req, res) => {
      const { code, state: userId2, error } = req.query;
      if (error || !code || !userId2) {
        return res.send(errorHtml2(error || "Authorization was cancelled."));
      }
      const clientId = process.env.GOOGLE_WEB_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        return res.send(errorHtml2("Google OAuth credentials not configured on the server."));
      }
      const baseUrl = getBaseUrl(req);
      const redirectUri = `${baseUrl}/api/oauth/google/callback`;
      try {
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: "authorization_code"
          })
        });
        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) {
          console.error("Google token exchange failed:", tokenData);
          return res.send(errorHtml2("Failed to exchange authorization code. Please try again."));
        }
        let accountEmail;
        try {
          const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
          });
          const userInfo = await userInfoRes.json();
          accountEmail = userInfo.email;
        } catch {
        }
        const expiresAt = tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1e3) : null;
        await saveUserToken({
          userId: userId2,
          provider: "google",
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          expiresAt,
          scopes: tokenData.scope,
          accountEmail: accountEmail || ""
        });
        return res.send(successHtml2("google", accountEmail));
      } catch (err) {
        console.error("Google OAuth callback error:", err);
        return res.send(errorHtml2("An unexpected error occurred. Please try again."));
      }
    });
    oauthRouter.get("/microsoft/authorize", (req, res) => {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const clientId = process.env.MICROSOFT_CLIENT_ID;
      if (!clientId) {
        return res.json({ error: "Microsoft OAuth not configured" });
      }
      const baseUrl = getBaseUrl(req);
      const redirectUri = `${baseUrl}/api/oauth/microsoft/callback`;
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "offline_access Calendars.ReadWrite Mail.ReadWrite Mail.Send User.Read",
        state: userId2,
        response_mode: "query"
      });
      const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
      res.json({ url, redirectUri });
    });
    oauthCallbackRouter.get("/microsoft/callback", async (req, res) => {
      const { code, state: userId2, error, error_description } = req.query;
      if (error || !code || !userId2) {
        return res.send(errorHtml2(error_description || error || "Authorization was cancelled."));
      }
      const clientId = process.env.MICROSOFT_CLIENT_ID;
      const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        return res.send(errorHtml2("Microsoft OAuth credentials not configured on the server."));
      }
      const baseUrl = getBaseUrl(req);
      const redirectUri = `${baseUrl}/api/oauth/microsoft/callback`;
      try {
        const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
            scope: "offline_access Calendars.ReadWrite Mail.ReadWrite Mail.Send User.Read"
          })
        });
        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) {
          console.error("Microsoft token exchange failed:", tokenData);
          return res.send(errorHtml2("Failed to exchange authorization code. Please try again."));
        }
        let accountEmail;
        try {
          const meRes = await fetch("https://graph.microsoft.com/v1.0/me", {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
          });
          const me = await meRes.json();
          accountEmail = me.userPrincipalName || me.mail;
        } catch {
        }
        const expiresAt = tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1e3) : null;
        await saveUserToken({
          userId: userId2,
          provider: "microsoft",
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          expiresAt,
          scopes: tokenData.scope,
          accountEmail: accountEmail || ""
        });
        return res.send(successHtml2("microsoft", accountEmail));
      } catch (err) {
        console.error("Microsoft OAuth callback error:", err);
        return res.send(errorHtml2("An unexpected error occurred. Please try again."));
      }
    });
    oauthRouter.get("/slack/authorize", (req, res) => {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      if (!process.env.SLACK_CLIENT_ID) return res.json({ error: "Slack OAuth not configured" });
      const baseUrl = getBaseUrl(req);
      const redirectUri = `${baseUrl}/api/oauth/slack/callback`;
      const url = buildSlackAuthorizeUrl(userId2, redirectUri);
      if (!url) return res.json({ error: "Slack OAuth not configured" });
      res.json({ url, redirectUri });
    });
    oauthCallbackRouter.get("/slack/callback", async (req, res) => {
      const { code, state: userId2, error: oauthError } = req.query;
      if (oauthError || !code || !userId2) {
        return res.send(errorHtml2(oauthError || "Authorization was cancelled."));
      }
      const clientId = process.env.SLACK_CLIENT_ID;
      const clientSecret = process.env.SLACK_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        return res.send(errorHtml2("Slack OAuth credentials not configured on the server."));
      }
      const baseUrl = getBaseUrl(req);
      const redirectUri = `${baseUrl}/api/oauth/slack/callback`;
      try {
        const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri
          })
        });
        const tokenData = await tokenRes.json();
        const userToken = tokenData.authed_user?.access_token;
        if (!userToken) {
          console.error("Slack token exchange failed:", tokenData);
          return res.send(errorHtml2("Failed to exchange authorization code. Please try again."));
        }
        const authedUserId = tokenData.authed_user?.id || "";
        let accountEmail = "";
        let teamName = tokenData.team?.name || "";
        try {
          const userInfoRes = await fetch("https://slack.com/api/users.info", {
            headers: { Authorization: `Bearer ${userToken}` }
          });
          const userInfo = await userInfoRes.json();
          if (userInfo.ok && userInfo.user) {
            accountEmail = userInfo.user.profile?.email || teamName || authedUserId;
          }
        } catch {
        }
        if (!accountEmail) accountEmail = teamName || authedUserId;
        await saveUserToken({
          userId: userId2,
          provider: "slack",
          accessToken: userToken,
          refreshToken: null,
          expiresAt: null,
          scopes: "channels:history,channels:read,im:history,im:read,groups:history,groups:read,users:read",
          accountEmail
        });
        try {
          const teamId = tokenData.team?.id || "";
          if (teamId && authedUserId) {
            const { registerSlackUserLink: registerSlackUserLink2 } = await Promise.resolve().then(() => (init_slackWebhook(), slackWebhook_exports));
            await registerSlackUserLink2(userId2, teamId, authedUserId);
          }
        } catch (linkErr) {
          console.error("[slack] registerSlackUserLink failed (non-fatal):", linkErr);
        }
        return res.send(successHtml2("slack", accountEmail));
      } catch (err) {
        console.error("Slack OAuth callback error:", err);
        return res.send(errorHtml2("An unexpected error occurred. Please try again."));
      }
    });
    oauthRouter.get("/status", async (req, res) => {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      try {
        const status = await getUserOAuthStatus(userId2);
        if (!status.microsoft?.connected) {
          const { checkOutlookConnection: checkOutlookConnection2 } = await Promise.resolve().then(() => (init_outlook(), outlook_exports));
          const projConnected = await checkOutlookConnection2().catch(() => false);
          if (projConnected) {
            status.microsoft = { connected: true, accounts: [] };
          }
        }
        res.json(status);
      } catch (err) {
        console.error("OAuth status error:", err);
        res.json({ google: { connected: false }, microsoft: { connected: false }, slack: { connected: false } });
      }
    });
    oauthRouter.delete("/:provider/disconnect", async (req, res) => {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const { provider } = req.params;
      if (!["google", "microsoft", "slack"].includes(provider)) {
        return res.status(400).json({ error: "Unknown provider" });
      }
      try {
        const email = req.query.email;
        await deleteUserToken(userId2, provider, email);
        res.json({ success: true });
      } catch (err) {
        console.error("Disconnect error:", err);
        res.status(500).json({ error: "Failed to disconnect" });
      }
    });
  }
});

// server/agent/tools/connectChannel.ts
import { eq as eq21, and as and16 } from "drizzle-orm";
function generateCode2(length) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}
var connectChannelTool;
var init_connectChannel = __esm({
  "server/agent/tools/connectChannel.ts"() {
    "use strict";
    init_db();
    init_schema();
    init_telegram();
    init_oauthRoutes();
    connectChannelTool = {
      name: "connect_channel",
      description: "Generate a one-tap connection link so the user can connect a new messaging channel (Telegram, WhatsApp, Slack, or Discord) to Jarvis. Returns a tappable deep link. Use this proactively when the user asks to connect/link any of these services.",
      parameters: {
        type: "object",
        properties: {
          channel: {
            type: "string",
            enum: ["telegram", "whatsapp", "discord", "slack"],
            description: "Which channel to generate a connection link for."
          }
        },
        required: ["channel"]
      },
      async execute(args, ctx) {
        const channel = String(args.channel || "").toLowerCase();
        const userId2 = ctx.userId;
        if (!["telegram", "whatsapp", "discord", "slack"].includes(channel)) {
          return {
            ok: false,
            content: `Unknown channel "${channel}". Supported: telegram, whatsapp, discord, slack.`,
            label: "Unknown channel"
          };
        }
        try {
          if (channel === "telegram") {
            if (!isTelegramConfigured()) {
              return {
                ok: false,
                content: "Telegram bot is not configured on this server. Ask the admin to add TELEGRAM_BOT_TOKEN to secrets.",
                label: "Telegram not configured"
              };
            }
            const code = generateCode2(6);
            await db.insert(telegramLinkCodes).values({ code, userId: userId2 });
            const botUsername = await getTelegramBotUsername();
            if (!botUsername) {
              return {
                ok: false,
                content: "Could not fetch bot username from Telegram. Try again in a moment, or connect manually from Profile \u2192 Connections.",
                label: "Could not get bot username"
              };
            }
            const url = `https://t.me/${botUsername}`;
            return {
              ok: true,
              content: JSON.stringify({ url, buttonLabel: "Open Telegram", channel: "telegram", code }),
              label: "Open Telegram",
              detail: JSON.stringify({ url, buttonLabel: "Open Telegram", channel: "telegram", code })
            };
          }
          if (channel === "whatsapp") {
            const twilioRaw = process.env.TWILIO_WHATSAPP_NUMBER;
            if (!twilioRaw) {
              return {
                ok: false,
                content: "WhatsApp is not configured on this server (TWILIO_WHATSAPP_NUMBER is missing). Ask the admin to set it up.",
                label: "WhatsApp not configured"
              };
            }
            const phone = twilioRaw.replace(/^whatsapp:/i, "").replace(/\s+/g, "");
            const code = generateCode2(6);
            const expiresAt = new Date(Date.now() + 15 * 60 * 1e3);
            await db.delete(channelLinkCodes).where(and16(eq21(channelLinkCodes.userId, userId2), eq21(channelLinkCodes.channel, "whatsapp")));
            await db.insert(channelLinkCodes).values({ code, userId: userId2, channel: "whatsapp", expiresAt });
            const body = encodeURIComponent(`CONNECT ${code}`);
            const url = `https://wa.me/${phone.replace("+", "")}?text=${body}`;
            return {
              ok: true,
              content: JSON.stringify({ url, buttonLabel: "Open WhatsApp", channel: "whatsapp" }),
              label: "Open WhatsApp",
              detail: JSON.stringify({ url, buttonLabel: "Open WhatsApp", channel: "whatsapp" })
            };
          }
          if (channel === "slack") {
            if (!process.env.SLACK_CLIENT_ID) {
              return {
                ok: false,
                content: "Slack is not configured on this server (SLACK_CLIENT_ID missing). Ask the admin to set it up.",
                label: "Slack not configured"
              };
            }
            const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
            const baseUrl = domain ? `https://${domain}` : "http://localhost:5000";
            const redirectUri = `${baseUrl}/api/oauth/slack/callback`;
            const url = buildSlackAuthorizeUrl(userId2, redirectUri);
            if (!url) {
              return { ok: false, content: "Slack OAuth not configured.", label: "Slack not configured" };
            }
            return {
              ok: true,
              content: JSON.stringify({ url, buttonLabel: "Connect Slack", channel: "slack" }),
              label: "Connect Slack",
              detail: JSON.stringify({ url, buttonLabel: "Connect Slack", channel: "slack" })
            };
          }
          if (channel === "discord") {
            const url = "profile://connections";
            return {
              ok: true,
              content: JSON.stringify({
                url,
                buttonLabel: "Open Discord Setup",
                channel: "discord"
              }),
              label: "Open Discord Setup",
              detail: JSON.stringify({
                url,
                buttonLabel: "Open Discord Setup",
                channel: "discord"
              })
            };
          }
          return { ok: false, content: "Unexpected channel.", label: "Error" };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[connectChannel] failed for ${channel}:`, msg);
          return {
            ok: false,
            content: `Failed to generate connection link: ${msg}`,
            label: "Link generation failed",
            detail: msg
          };
        }
      }
    };
  }
});

// server/agent/tools/discordPost.ts
var topicList, discordPostTool;
var init_discordPost = __esm({
  "server/agent/tools/discordPost.ts"() {
    "use strict";
    init_manager();
    topicList = WORKSPACE_TOPICS.map((t) => `\`${t.key}\` (${t.emoji} ${t.name})`).join(", ");
    discordPostTool = {
      name: "discord_post",
      description: `Post a message or insight to a specific topic channel in the user's Jarvis Discord Workspace. Use this to log useful thoughts, plans, or progress notes that belong in a particular life area \u2014 so the user has an organised record in Discord. Available topics: ${topicList}. If unsure which topic fits, omit the topic and it will be auto-classified.`,
      parameters: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "The message to post. Can include markdown formatting. Keep it concise and useful \u2014 this is a log entry, not a conversation reply."
          },
          topic: {
            type: "string",
            enum: WORKSPACE_TOPICS.map((t) => t.key),
            description: "The workspace channel to post to. If omitted, the topic is inferred from the message content."
          }
        },
        required: ["message"]
      },
      async execute(args, ctx) {
        const { userId: userId2 } = ctx;
        const topicKey = args.topic ?? classifyTopic(args.message);
        const topicMeta = WORKSPACE_TOPICS.find((t) => t.key === topicKey);
        const posted = await postToDiscordWorkspace(userId2, topicKey, args.message);
        if (!posted) {
          return {
            ok: false,
            content: "Couldn't post to Discord \u2014 the workspace may not be set up yet, or the bot isn't running. Ask the user to go to Profile \u2192 Connected Channels \u2192 Discord \u2192 Setup Workspace.",
            label: "Discord post failed"
          };
        }
        return {
          ok: true,
          content: `Posted to ${topicMeta ? `${topicMeta.emoji} #${topicMeta.name}` : `#${topicKey}`} in your Discord workspace.`,
          label: `Discord \u2192 #${topicKey}`
        };
      }
    };
  }
});

// server/agent/tools/index.ts
function telegramCoachTools(opts) {
  const base = [
    webSearchTool,
    researchTopicTool,
    manageTasksTool,
    createDocumentTool,
    listDocumentsTool,
    readDocumentTool,
    spawnSubagentTool,
    daemonActionTool,
    checkConnectionsTool,
    generateReconnectLinkTool,
    createCalendarEventTool,
    sendEmailTool,
    fetchEmailsTool,
    connectChannelTool,
    discordPostTool
  ];
  if (opts.hasGoogle) {
    base.push(gmailActionTool, gmailDraftTool, fetchCalendarTool, driveCreateFileTool, driveListFilesTool, driveReadFileTool);
  }
  return base;
}
var ALL_TOOLS, TOOL_INDEX;
var init_tools = __esm({
  "server/agent/tools/index.ts"() {
    "use strict";
    init_webSearch();
    init_gmailActions();
    init_manageTasks();
    init_documents();
    init_googleDriveTools();
    init_calendar();
    init_spawnSubagent();
    init_daemon();
    init_connections();
    init_calendarCreate();
    init_sendEmail();
    init_fetchEmails();
    init_connectChannel();
    init_discordPost();
    ALL_TOOLS = [
      webSearchTool,
      researchTopicTool,
      gmailActionTool,
      gmailDraftTool,
      fetchCalendarTool,
      createCalendarEventTool,
      manageTasksTool,
      createDocumentTool,
      listDocumentsTool,
      readDocumentTool,
      driveCreateFileTool,
      driveListFilesTool,
      driveReadFileTool,
      spawnSubagentTool,
      daemonActionTool,
      checkConnectionsTool,
      generateReconnectLinkTool,
      sendEmailTool,
      fetchEmailsTool,
      connectChannelTool,
      discordPostTool
    ];
    TOOL_INDEX = new Map(ALL_TOOLS.map((t) => [t.name, t]));
  }
});

// server/agent/subagents.ts
import { and as and17, eq as eq22, sql as sql11 } from "drizzle-orm";
function summarize(body, fallback, max = 240) {
  const stripped = body.replace(/^#.*$/gm, "").replace(/^---EMAIL DRAFT---[\s\S]*?Body:\s*/m, "").replace(/^---END DRAFT---/m, "").replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
  if (!stripped) return fallback;
  if (stripped.length <= max) return stripped;
  return stripped.slice(0, max - 1).trimEnd() + "\u2026";
}
function extractTitle(body, fallback, type) {
  if (type === "email_draft") {
    const m = body.match(/^Subject:\s*(.+)$/m);
    return m?.[1]?.trim() || fallback;
  }
  const h1 = body.match(/^#\s+(.+)$/m);
  if (h1?.[1]) return h1[1].trim().slice(0, 200);
  const firstLine = body.split("\n").map((l) => l.trim()).find((l) => l.length > 0);
  if (firstLine) return firstLine.replace(/^#+\s*/, "").slice(0, 200);
  return fallback;
}
function parseEmailDraft(body) {
  const block = body.match(/---EMAIL DRAFT---\s*([\s\S]*?)---END DRAFT---/);
  if (!block) return null;
  const inner = block[1];
  const toMatch = inner.match(/^To:\s*(.+)$/m);
  const subjMatch = inner.match(/^Subject:\s*(.+)$/m);
  const bodyMatch = inner.match(/(^|\n)Body:\s*([\s\S]*)$/);
  if (!toMatch || !subjMatch || !bodyMatch) return null;
  return {
    to: toMatch[1].trim(),
    subject: subjMatch[1].trim(),
    emailBody: bodyMatch[2].trim()
  };
}
async function runSubAgent(opts) {
  const spec = SPECS[opts.agentType];
  if (!spec) throw new Error(`Unknown sub-agent type: ${opts.agentType}`);
  const hasGoogle = !!opts.context.googleAccessToken;
  const tools = spec.tools({ hasGoogle });
  let systemPrompt = spec.systemPrompt;
  if (opts.agentType === "email" && opts.context.userId) {
    const enrich = [];
    try {
      const { getSoulPromptBlock: getSoulPromptBlock2 } = await Promise.resolve().then(() => (init_soul(), soul_exports));
      const soulText = await getSoulPromptBlock2(opts.context.userId);
      if (soulText && soulText.trim()) {
        enrich.push(`What I know about the sender (JARVIS Soul):
${soulText.trim()}`);
      }
    } catch (err) {
      console.error(`[subagents/email] SOUL enrichment failed for ${opts.context.userId}:`, err);
    }
    try {
      const emailMatches = Array.from(opts.prompt.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)).map((m) => m[0].toLowerCase());
      if (emailMatches.length > 0) {
        const peopleRows = await db.select().from(people).where(and17(eq22(people.userId, opts.context.userId), sql11`lower(${people.email}) = ANY(${emailMatches})`));
        if (peopleRows.length > 0) {
          const lines = peopleRows.map((p) => {
            const bits = [`${p.name}${p.email ? ` <${p.email}>` : ""}`];
            if (p.relationship) bits.push(`relationship: ${p.relationship}`);
            if (p.interactionCount) bits.push(`prior interactions: ${p.interactionCount}`);
            if (p.lastInteractionAt) bits.push(`last seen: ${new Date(p.lastInteractionAt).toISOString().slice(0, 10)}`);
            if (p.notes) bits.push(`notes: ${p.notes.slice(0, 200)}`);
            return `- ${bits.join(" \u2014 ")}`;
          });
          enrich.push(`Recipient relationship history:
${lines.join("\n")}`);
        }
      }
    } catch (err) {
      console.error(`[subagents/email] people enrichment failed for ${opts.context.userId}:`, err);
    }
    if (enrich.length > 0) {
      systemPrompt = `${spec.systemPrompt}

--- CONTEXT ---
${enrich.join("\n\n")}`;
    }
  }
  const result = await runAgent({
    model: "gpt-5-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: opts.prompt }
    ],
    tools,
    context: opts.context,
    maxTurns: spec.maxTurns,
    maxCompletionTokens: 2400
  });
  const body = (result.reply || "").trim();
  if (!body) {
    throw new Error(`Sub-agent ${opts.agentType} produced empty output`);
  }
  const title = extractTitle(body, opts.defaultTitle, spec.deliverableType);
  const summary = summarize(body, opts.defaultTitle);
  const meta = {};
  if (spec.deliverableType === "email_draft") {
    const parsed = parseEmailDraft(body);
    if (!parsed) {
      throw new Error("Email sub-agent did not return a parsable ---EMAIL DRAFT--- block");
    }
    meta.to = parsed.to;
    meta.subject = parsed.subject;
    meta.emailBody = parsed.emailBody;
  }
  return {
    type: spec.deliverableType,
    title,
    summary,
    body,
    meta,
    turns: result.turns,
    toolCallsCount: result.toolCalls.length
  };
}
var SHARED_RULES, SPECS, SUB_AGENT_TYPES;
var init_subagents = __esm({
  "server/agent/subagents.ts"() {
    "use strict";
    init_harness();
    init_db();
    init_schema();
    init_tools();
    SHARED_RULES = `Output rules:
- Be concrete and specific, never generic.
- No filler ("As an AI\u2026", "I hope this helps\u2026").
- No markdown headers above H2 (##). No bold/italic for decoration.
- All factual claims must come from a tool result you actually executed in this run.`;
    SPECS = {
      research: {
        systemPrompt: `You are a Research sub-agent for Jarvis. The user has asked for a focused research brief; they will read it later and approve or discard it. They are NOT in this conversation.

How you work:
1. Use research_topic (preferred) or search_web 1-3 times to gather evidence.
2. Stop researching once you have enough to answer concretely.
3. Produce a final response that IS the deliverable \u2014 markdown, ~250-600 words.

Structure your final markdown:
## TL;DR
2-3 bullet points.

## Findings
Numbered list, each finding with a 1-sentence "why it matters".

## Sources
Bullet list of the URLs you actually used.

${SHARED_RULES}`,
        tools: () => [webSearchTool, researchTopicTool],
        deliverableType: "research",
        maxTurns: 6
      },
      writing: {
        systemPrompt: `You are a Writing sub-agent for Jarvis. The user has asked you to draft a longer-form document (memo, plan, note, post). They will review and approve.

How you work:
1. If the topic needs facts, call research_topic ONCE for context.
2. Optionally call list_documents / read_document if the user references existing notes.
3. Produce the final document as your last assistant message \u2014 that IS the deliverable.

The first line of your final reply MUST be: "# <document title>"
Keep length appropriate to the request (300-1200 words). Plain markdown only.

${SHARED_RULES}`,
        tools: () => [researchTopicTool, listDocumentsTool, readDocumentTool],
        deliverableType: "document",
        maxTurns: 5
      },
      planning: {
        systemPrompt: `You are a Planning sub-agent for Jarvis. Decompose the user's request into a concrete, sequenced action plan they can execute.

How you work:
1. If you need outside facts, call research_topic at most ONCE.
2. Optionally call fetch_calendar to know their schedule.
3. Output the plan as your final assistant message.

Final markdown structure:
## Goal
One sentence.

## Phases
For each phase:
### Phase N \u2014 <name> (<rough duration>)
- Milestone: <outcome>
- Tasks:
  - [ ] task 1 (\u22642h)
  - [ ] task 2 (\u22642h)

## Risks & how to handle them
2-4 bullets.

## First step (today)
Single, specific task \u226430 min.

${SHARED_RULES}`,
        tools: (opts) => opts.hasGoogle ? [researchTopicTool, fetchCalendarTool] : [researchTopicTool],
        deliverableType: "plan",
        maxTurns: 5
      },
      email: {
        systemPrompt: `You are an Email sub-agent for Jarvis. Draft a single outbound email on the user's behalf. They will review in their Inbox and either Approve (sent to Gmail Drafts) or Discard.

How you work:
1. If the request needs facts (recipient's company, current price, recent news), call research_topic at most ONCE.
2. Output ONLY the draft, in this EXACT format, as your final assistant message:

---EMAIL DRAFT---
To: recipient@example.com
Subject: <subject line>
Body:
<email body, plain text, 2-4 short paragraphs, sign off as the user, no signature line>
---END DRAFT---

Rules:
- Never invent commitments, prices, dates, or facts the user has not stated.
- If you need info from the user, leave a clearly bracketed placeholder like [confirm date].
- If the user did not name a recipient, put [recipient@unknown] in the To line.

${SHARED_RULES}`,
        tools: () => [researchTopicTool],
        deliverableType: "email_draft",
        maxTurns: 4
      }
    };
    SUB_AGENT_TYPES = ["research", "writing", "planning", "email"];
  }
});

// server/memory/weeklyJob.ts
import { eq as eq23, and as and18, gte as gte3, desc as desc9, sql as sql12 } from "drizzle-orm";
import OpenAI10 from "openai";
function asArray(value) {
  return Array.isArray(value) ? value : [];
}
function weekOfKey(now) {
  const start = new Date(now);
  const day = start.getDay();
  start.setDate(start.getDate() - day);
  return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
}
function parsePatterns(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = (() => {
    if (parsed && typeof parsed === "object" && "patterns" in parsed) {
      const p = parsed.patterns;
      return Array.isArray(p) ? p : [];
    }
    return Array.isArray(parsed) ? parsed : [];
  })();
  const out = [];
  for (const r of list.slice(0, 5)) {
    if (typeof r.observation !== "string" || !r.observation.trim()) continue;
    const evidence = Array.isArray(r.evidence) ? r.evidence.filter((x) => typeof x === "string").slice(0, 5) : [];
    const confidenceNum = typeof r.confidence === "number" ? r.confidence : Number(r.confidence);
    const confidence = Number.isFinite(confidenceNum) ? Math.max(0, Math.min(100, Math.round(confidenceNum))) : 60;
    const category = typeof r.category === "string" ? normalizeCategory(r.category) : "fact";
    out.push({ category, observation: r.observation.trim(), evidence, confidence });
  }
  return out;
}
async function runWeeklyPatternJob(userId2) {
  const now = /* @__PURE__ */ new Date();
  const windowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1e3);
  const sevenDaysAgo = windowStart;
  const weekOf = weekOfKey(now);
  const [completionRow, brainRow, chatRow, telegramRows, energyRows] = await Promise.allSettled([
    db.select().from(completionHistory).where(eq23(completionHistory.userId, userId2)).limit(1),
    db.select().from(brainDumpInbox).where(eq23(brainDumpInbox.userId, userId2)).limit(1),
    db.select().from(chatHistory).where(eq23(chatHistory.userId, userId2)).limit(1),
    db.select().from(telegramGroupMessages).where(and18(eq23(telegramGroupMessages.userId, userId2), gte3(telegramGroupMessages.messageDate, sevenDaysAgo))).orderBy(desc9(telegramGroupMessages.messageDate)).limit(50),
    db.select().from(energyCheckins).where(and18(eq23(energyCheckins.userId, userId2), gte3(energyCheckins.date, sevenDaysAgo.toISOString().slice(0, 10)))).orderBy(desc9(energyCheckins.date)).limit(60)
  ]);
  const completionData = completionRow.status === "fulfilled" ? asArray(completionRow.value[0]?.data) : [];
  const brainData = brainRow.status === "fulfilled" ? asArray(brainRow.value[0]?.data) : [];
  const chatData = chatRow.status === "fulfilled" ? asArray(chatRow.value[0]?.data).slice(0, 30) : [];
  const telegramData = telegramRows.status === "fulfilled" ? telegramRows.value : [];
  const energyData = energyRows.status === "fulfilled" ? energyRows.value : [];
  const recentCompletions = completionData.filter((c) => c.date && new Date(c.date) >= sevenDaysAgo);
  const completionsText = recentCompletions.slice(0, 50).map((c) => `- ${c.date}: ${c.completed ?? 0} completions${c.title ? ` (${c.title})` : ""}`).join("\n");
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const perDow = [0, 0, 0, 0, 0, 0, 0];
  const perDowDays = [/* @__PURE__ */ new Set(), /* @__PURE__ */ new Set(), /* @__PURE__ */ new Set(), /* @__PURE__ */ new Set(), /* @__PURE__ */ new Set(), /* @__PURE__ */ new Set(), /* @__PURE__ */ new Set()];
  let totalCompleted = 0;
  for (const c of recentCompletions) {
    if (!c.date) continue;
    const d = new Date(c.date);
    if (isNaN(d.getTime())) continue;
    const dow = d.getDay();
    const n = c.completed ?? 0;
    perDow[dow] += n;
    perDowDays[dow].add(c.date);
    totalCompleted += n;
  }
  const timingLines = perDow.map((total, i) => {
    const days = perDowDays[i].size || 1;
    const avg = (total / days).toFixed(1);
    return `- ${dayNames[i]}: ${total} total across ${perDowDays[i].size} day(s) (avg ${avg}/day)`;
  });
  const taskTimingText = `Total completions in window: ${totalCompleted}
By weekday:
${timingLines.join("\n")}`;
  const brainText = brainData.slice(0, 25).map((b) => `- ${b.text ?? ""}`).filter((s) => s.length > 2).join("\n");
  const chatText = chatData.map((m) => `${m.role ?? "?"}: ${(m.content ?? "").slice(0, 200)}`).filter((s) => s.length > 5).join("\n");
  const telegramText = telegramData.slice(0, 30).map((t) => `- ${t.text.slice(0, 200)}`).join("\n");
  const energyText = energyData.map((e) => {
    const d = e.data;
    if (!d || typeof d !== "object") return "";
    const obj = d;
    const energy = typeof obj.energy === "number" ? obj.energy : "?";
    const focus = typeof obj.focus === "number" ? obj.focus : "?";
    return `- ${e.date}: energy=${energy} focus=${focus}`;
  }).filter((s) => s.length > 0).join("\n");
  const prompt = `You are reviewing the last 30 days of one user's activity to identify 3-5 durable behavioral patterns that should influence how a personal AI coach supports them long-term.

Output JSON: { "patterns": [{ "category": one-of-categories, "observation": "...", "evidence": ["...", "..."], "confidence": 0-100 }], "summary": "1-2 sentence summary of the week" }

Categories:
- work_patterns | communication_style | energy_rhythms | goals_history
- relationships | values | blockers | accomplishments | preferences | fact

Rules:
- Patterns must be DURABLE \u2014 recurring behaviors, not one-off events.
- Each evidence item must be a concrete data point from the input.
- Confidence: 90+ overwhelmingly clear; 70-89 strong; 60-69 plausible. Skip below 60.
- Return at most 5 patterns. Empty array if nothing notable.

## Completion history
${completionsText || "(none)"}

## Task timing (30-day aggregates)
${taskTimingText}

## Brain dump items
${brainText || "(none)"}

## Recent chat (most recent first)
${chatText || "(none)"}

## Group chat messages
${telegramText || "(none)"}

## Energy check-ins
${energyText || "(none)"}`;
  let patterns = [];
  let summary = "";
  try {
    const response = await openai10.chat.completions.create({
      model: "gpt-5-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_completion_tokens: 1200
    });
    const content = response.choices[0]?.message?.content || "{}";
    patterns = parsePatterns(content);
    try {
      const meta = JSON.parse(content);
      if (typeof meta.summary === "string") summary = meta.summary.trim().slice(0, 600);
    } catch {
    }
  } catch (err) {
    console.error("[WeeklyPattern] LLM call failed:", err);
  }
  const signalCount = recentCompletions.length + brainData.length + chatData.length + telegramData.length + energyData.length;
  if (signalCount < 5) {
    console.log(`[WeeklyPattern] user=${userId2} week=${weekOf} skipped \u2014 only ${signalCount} signal(s) in 30-day window`);
    return { weekOf, patterns: [], summary: "" };
  }
  await db.insert(weeklyInsights).values({ userId: userId2, weekOf, patterns, summary: summary || null }).onConflictDoUpdate({
    target: [weeklyInsights.userId, weeklyInsights.weekOf],
    set: { patterns, summary: summary || null }
  });
  let promoted = 0;
  for (const p of patterns) {
    if (p.confidence < 80) continue;
    const cat = p.category === "fact" ? "fact" : p.category;
    try {
      await db.insert(userMemories).values({
        userId: userId2,
        content: p.observation,
        category: cat,
        confidence: p.confidence,
        relevanceScore: 70,
        sourceType: "weekly_pattern",
        sourceRef: weekOf
      });
      promoted += 1;
    } catch (err) {
      console.error("[WeeklyPattern] promote failed:", err);
    }
  }
  try {
    await regenerateSoul(userId2);
  } catch (err) {
    console.error("[WeeklyPattern] regenerateSoul failed:", err);
  }
  console.log(
    `[WeeklyPattern] user=${userId2} week=${weekOf} patterns=${patterns.length} promoted=${promoted}`
  );
  return {
    weekOf,
    patternCount: patterns.length,
    promotedMemories: promoted,
    summary: summary || (patterns.length === 0 ? "No notable patterns this week." : `${patterns.length} pattern(s) identified.`)
  };
}
async function enqueueWeeklyPatternJobs() {
  const { submitAgentJob: submitAgentJob2 } = await Promise.resolve().then(() => (init_jobQueue(), jobQueue_exports));
  const rows = await db.execute(sql12`
    SELECT DISTINCT user_id FROM chat_history
    WHERE updated_at > NOW() - INTERVAL '14 days'
  `);
  let count = 0;
  for (const r of rows.rows ?? []) {
    if (!r.user_id) continue;
    try {
      await submitAgentJob2({
        userId: r.user_id,
        agentType: "weekly_pattern",
        title: "Weekly pattern review",
        prompt: "Reflect on the last 30 days and identify durable patterns."
      });
      count += 1;
    } catch (err) {
      console.error(`[WeeklyPattern] enqueue failed for ${r.user_id}:`, err);
    }
  }
  console.log(`[WeeklyPattern] enqueued ${count} job(s)`);
  return count;
}
var openai10;
var init_weeklyJob = __esm({
  "server/memory/weeklyJob.ts"() {
    "use strict";
    init_db();
    init_schema();
    init_categories();
    init_soul();
    openai10 = new OpenAI10({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
    });
  }
});

// server/agent/jobQueue.ts
var jobQueue_exports = {};
__export(jobQueue_exports, {
  startJobQueueWorker: () => startJobQueueWorker,
  stopJobQueueWorker: () => stopJobQueueWorker,
  submitAgentJob: () => submitAgentJob
});
import { eq as eq24, sql as sql13 } from "drizzle-orm";
async function notifyJobComplete(userId2, agentType, title, body) {
  try {
    await notifyUser(
      userId2,
      "approval_request",
      `Jarvis (${agentType}): ${title}

${body}`.slice(0, 3500)
    );
  } catch (err) {
    console.error("[JobQueue] notify failed:", err);
  }
}
async function submitAgentJob(input) {
  const inserted = await db.insert(agentJobs).values({
    userId: input.userId,
    agentType: input.agentType,
    title: input.title.slice(0, 200),
    prompt: input.prompt,
    input: input.input || {},
    status: "queued"
  }).returning({ id: agentJobs.id });
  const id = inserted[0]?.id || "";
  console.log(`[JobQueue] queued job ${id} type=${input.agentType} user=${input.userId} title="${input.title.slice(0, 60)}"`);
  return id;
}
async function claimNextJob() {
  const claimed = await db.execute(sql13`
    WITH busy_users AS (
      SELECT DISTINCT user_id FROM agent_jobs WHERE status = 'running'
    ),
    candidate AS (
      SELECT id FROM agent_jobs
      WHERE status = 'queued'
        AND user_id NOT IN (SELECT user_id FROM busy_users)
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE agent_jobs SET status = 'running', started_at = NOW()
    WHERE id IN (SELECT id FROM candidate)
    RETURNING id
  `);
  const claimedId = claimed.rows?.[0]?.id;
  if (!claimedId) return null;
  const [row] = await db.select().from(agentJobs).where(eq24(agentJobs.id, claimedId)).limit(1);
  return row || null;
}
async function failJob(jobId, message) {
  try {
    await db.update(agentJobs).set({ status: "failed", error: message.slice(0, 2e3), completedAt: /* @__PURE__ */ new Date() }).where(eq24(agentJobs.id, jobId));
  } catch (err) {
    console.error(`[JobQueue] failJob ${jobId} write failed:`, err);
  }
}
async function completeJob(jobId, payload) {
  await db.update(agentJobs).set({
    status: "complete",
    result: payload.result,
    turns: payload.turns,
    toolCallsCount: payload.toolCallsCount,
    completedAt: /* @__PURE__ */ new Date()
  }).where(eq24(agentJobs.id, jobId));
}
async function processJob(job) {
  console.log(`[JobQueue] running job ${job.id} type=${job.agentType} user=${job.userId}`);
  const watchdog = setTimeout(() => {
    console.warn(`[JobQueue] job ${job.id} exceeded ${MAX_JOB_DURATION_MS}ms (still running)`);
  }, MAX_JOB_DURATION_MS);
  try {
    if (job.agentType === "weekly_pattern") {
      const result = await runWeeklyPatternJob(job.userId);
      await completeJob(job.id, {
        result: { weekOf: result.weekOf, patterns: result.patternCount, promoted: result.promotedMemories },
        turns: 1,
        toolCallsCount: 0
      });
      console.log(`[JobQueue] complete weekly_pattern job ${job.id} \u2192 ${result.patternCount} patterns`);
      await notifyJobComplete(
        job.userId,
        "weekly_pattern",
        `Weekly review (${result.weekOf})`,
        `${result.patternCount} pattern(s) identified, ${result.promotedMemories} promoted to long-term memory.
${result.summary}`
      );
      return;
    }
    if (job.agentType === "goal_decompose") {
      const result = await runGoalDecomposition(job);
      await completeJob(job.id, {
        result: { goalTreeId: result.goalTreeId, phases: result.phaseCount },
        turns: result.turns,
        toolCallsCount: result.toolCallsCount
      });
      console.log(`[JobQueue] complete goal_decompose job ${job.id} \u2192 tree ${result.goalTreeId}`);
      await notifyJobComplete(
        job.userId,
        "goal_decompose",
        job.title,
        `Goal broken into ${result.phaseCount} phase(s). Open the Goals tab to review.`
      );
      return;
    }
    const tokens = await getValidGoogleTokens(job.userId).catch(() => []);
    const googleAccessToken = tokens?.[0] || null;
    const ctx = {
      userId: job.userId,
      googleAccessToken,
      channel: `JobQueue/${job.agentType}`,
      state: { pendingAttachments: [] }
    };
    const sub = await runSubAgent({
      agentType: job.agentType,
      prompt: job.prompt,
      defaultTitle: job.title,
      context: ctx
    });
    const inserted = await db.insert(deliverables).values({
      userId: job.userId,
      jobId: job.id,
      agentType: job.agentType,
      type: sub.type,
      title: sub.title,
      summary: sub.summary,
      body: sub.body,
      meta: sub.meta
    }).returning({ id: deliverables.id });
    const deliverableId = inserted[0]?.id || "";
    await completeJob(job.id, {
      result: { deliverableId, type: sub.type, title: sub.title },
      turns: sub.turns,
      toolCallsCount: sub.toolCallsCount
    });
    console.log(`[JobQueue] complete ${job.agentType} job ${job.id} \u2192 deliverable ${deliverableId}`);
    await notifyJobComplete(
      job.userId,
      job.agentType,
      sub.title,
      `${sub.summary || "Ready for review"} \u2014 open Inbox to approve, edit, or discard.`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[JobQueue] job ${job.id} failed:`, err);
    await failJob(job.id, msg);
  } finally {
    clearTimeout(watchdog);
  }
}
async function tick() {
  for (let i = 0; i < 5; i++) {
    const job = await claimNextJob();
    if (!job) return;
    processJob(job).catch((err) => {
      console.error(`[JobQueue] processJob threw for ${job.id}:`, err);
    });
  }
}
async function recoverStaleJobs() {
  try {
    const result = await db.update(agentJobs).set({ status: "queued", startedAt: null }).where(eq24(agentJobs.status, "running")).returning({ id: agentJobs.id });
    if (result.length > 0) {
      console.log(`[JobQueue] recovered ${result.length} stale running job(s) from previous process`);
    }
  } catch (err) {
    console.error("[JobQueue] recoverStaleJobs failed:", err);
  }
}
function startJobQueueWorker() {
  if (workerStarted) return;
  workerStarted = true;
  stopRequested = false;
  recoverStaleJobs().catch((err) => console.error("[JobQueue] recover error:", err));
  const loop = async () => {
    if (stopRequested) return;
    if (workerRunning) {
      setTimeout(loop, TICK_MS);
      return;
    }
    workerRunning = true;
    try {
      await tick();
    } catch (err) {
      console.error("[JobQueue] tick error:", err);
    } finally {
      workerRunning = false;
      setTimeout(loop, TICK_MS);
    }
  };
  setTimeout(loop, 5e3);
  console.log(`[JobQueue] worker started \u2014 polling every ${TICK_MS / 1e3}s`);
}
function stopJobQueueWorker() {
  stopRequested = true;
}
var TICK_MS, MAX_JOB_DURATION_MS, workerRunning, workerStarted, stopRequested;
var init_jobQueue = __esm({
  "server/agent/jobQueue.ts"() {
    "use strict";
    init_db();
    init_schema();
    init_subagents();
    init_goalDecomposer();
    init_weeklyJob();
    init_userTokenStore();
    init_registry();
    TICK_MS = 15 * 1e3;
    MAX_JOB_DURATION_MS = 5 * 60 * 1e3;
    workerRunning = false;
    workerStarted = false;
    stopRequested = false;
  }
});

// server/agent/goalDecomposer.ts
var goalDecomposer_exports = {};
__export(goalDecomposer_exports, {
  enqueueGoalDecomposition: () => enqueueGoalDecomposition,
  runGoalDecomposition: () => runGoalDecomposition
});
import OpenAI11 from "openai";
import { eq as eq25, and as and20 } from "drizzle-orm";
function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function clampStr(s, max) {
  if (typeof s !== "string") return "";
  return s.trim().slice(0, max);
}
function clampNum(n, min, max, dflt) {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return dflt;
  return Math.max(min, Math.min(max, v));
}
function normaliseTree(raw, fallbackTitle) {
  const obj = raw && typeof raw === "object" ? raw : {};
  const phasesRaw = Array.isArray(obj.phases) ? obj.phases : [];
  const phases = phasesRaw.slice(0, 6).map((p, pi) => {
    const pp = p && typeof p === "object" ? p : {};
    const milestonesRaw = Array.isArray(pp.milestones) ? pp.milestones : [];
    const milestones = milestonesRaw.slice(0, 6).map((m, mi) => {
      const mm = m && typeof m === "object" ? m : {};
      const tasksRaw = Array.isArray(mm.tasks) ? mm.tasks : [];
      const tasks = tasksRaw.slice(0, 8).map((t, ti) => {
        const tt = t && typeof t === "object" ? t : {};
        return {
          id: newId(`t${pi}${mi}${ti}`),
          title: clampStr(tt.title, 200) || `Task ${ti + 1}`,
          description: clampStr(tt.description, 500) || void 0,
          estimateHours: clampNum(tt.estimateHours, 0.25, 40, 1),
          status: pi === 0 && mi === 0 && ti === 0 ? "ready" : pi === 0 && mi === 0 ? "ready" : "blocked"
        };
      });
      return {
        id: newId(`m${pi}${mi}`),
        title: clampStr(mm.title, 200) || `Milestone ${mi + 1}`,
        description: clampStr(mm.description, 500) || void 0,
        status: pi === 0 && mi === 0 ? "ready" : "ready",
        tasks
      };
    });
    return {
      id: newId(`p${pi}`),
      title: clampStr(pp.title, 200) || `Phase ${pi + 1}`,
      description: clampStr(pp.description, 500) || void 0,
      status: pi === 0 ? "ready" : "ready",
      milestones
    };
  });
  return {
    phases,
    rationale: clampStr(obj.rationale, 1e3) || `Decomposition of "${fallbackTitle}"`,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
async function loadGoal(userId2, goalId) {
  const [row] = await db.select({ data: goals.data }).from(goals).where(eq25(goals.userId, userId2)).limit(1);
  const list = row?.data || [];
  return list.find((g) => g.id === goalId) || null;
}
async function generateTreeWithLLM(goal, userId2) {
  let soulBlock = "";
  try {
    const { getSoulPromptBlock: getSoulPromptBlock2 } = await Promise.resolve().then(() => (init_soul(), soul_exports));
    soulBlock = await getSoulPromptBlock2(userId2);
  } catch (err) {
    console.error(`[goalDecomposer] SOUL load failed for ${userId2}:`, err);
  }
  const system = `You are Jarvis's goal-decomposition planner. Break a single user goal into a concrete, sequenced project tree.

${soulBlock ? `${soulBlock}

` : ""}

Hard rules:
- 2 to 4 PHASES (chronological, each represents a meaningful chunk of progress)
- Each phase has 1 to 3 MILESTONES (verifiable outcomes)
- Each milestone has 2 to 5 TASKS (each \u2264 4 hours of focused work)
- Tasks are concrete actions, not aspirations. "Email 3 prospective vendors with our spec" not "Find vendors".
- The very first task of phase 1 must be the smallest possible first step (\u226430 minutes).
- Do NOT invent facts about the user \u2014 work from what they wrote.

Return ONLY this JSON shape, nothing else:
{
  "rationale": "<2-3 sentences on the overall approach>",
  "phases": [
    {
      "title": "<phase name>",
      "description": "<one line>",
      "milestones": [
        {
          "title": "<milestone name>",
          "description": "<one line outcome>",
          "tasks": [
            { "title": "<task>", "description": "<one line>", "estimateHours": 1 }
          ]
        }
      ]
    }
  ]
}`;
  const targetText = goal.target && goal.unit ? `${goal.current ?? 0}/${goal.target} ${goal.unit}` : "";
  const userMsg = `Goal: ${goal.title}
${goal.category ? `Category: ${goal.category}` : ""}
${targetText ? `Progress: ${targetText}` : ""}
${goal.deadline ? `Deadline: ${goal.deadline}` : ""}
${goal.description ? `Notes: ${goal.description}` : ""}

Decompose it now.`;
  const resp = await openai11.chat.completions.create({
    model: "gpt-5-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: userMsg }
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 2500
  });
  const content = resp.choices[0]?.message?.content || "{}";
  let parsed = {};
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = {};
  }
  return normaliseTree(parsed, goal.title);
}
async function runGoalDecomposition(job) {
  const inputObj = job.input && typeof job.input === "object" ? job.input : {};
  const goalId = inputObj.goalId;
  if (!goalId) throw new Error("goal_decompose job missing input.goalId");
  const goal = await loadGoal(job.userId, goalId);
  if (!goal) throw new Error(`Goal ${goalId} not found for user ${job.userId}`);
  const tree = await generateTreeWithLLM(goal, job.userId);
  if (tree.phases.length === 0) {
    throw new Error("Decomposition returned no phases");
  }
  const existing = await db.select({ id: goalTrees.id }).from(goalTrees).where(and20(eq25(goalTrees.userId, job.userId), eq25(goalTrees.goalId, goalId))).limit(1);
  let goalTreeId;
  if (existing.length > 0) {
    goalTreeId = existing[0].id;
    await db.update(goalTrees).set({ tree, title: goal.title, status: "active", updatedAt: /* @__PURE__ */ new Date() }).where(eq25(goalTrees.id, goalTreeId));
  } else {
    const inserted = await db.insert(goalTrees).values({
      userId: job.userId,
      goalId,
      title: goal.title,
      tree,
      status: "active"
    }).returning({ id: goalTrees.id });
    goalTreeId = inserted[0]?.id || "";
  }
  return {
    goalTreeId,
    phaseCount: tree.phases.length,
    turns: 1,
    toolCallsCount: 0
  };
}
async function enqueueGoalDecomposition(userId2, goal) {
  const { submitAgentJob: submitAgentJob2 } = await Promise.resolve().then(() => (init_jobQueue(), jobQueue_exports));
  return submitAgentJob2({
    userId: userId2,
    agentType: "goal_decompose",
    title: `Decompose: ${goal.title}`,
    prompt: `Break the goal "${goal.title}" into a phased plan.`,
    input: { goalId: goal.id }
  });
}
var openai11;
var init_goalDecomposer = __esm({
  "server/agent/goalDecomposer.ts"() {
    "use strict";
    init_db();
    init_schema();
    openai11 = new OpenAI11({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
    });
  }
});

// server/dataRoutes.ts
import { eq as eq26, and as and21 } from "drizzle-orm";
function requireUserId(req, res) {
  const userId2 = req.userId;
  if (!userId2) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  return userId2;
}
function registerSimpleJsonCrud(app2, path4, table) {
  app2.get(`/api/data/${path4}`, async (req, res) => {
    try {
      const userId2 = requireUserId(req, res);
      if (!userId2) return;
      const result = await db.select({ data: table.data }).from(table).where(eq26(table.userId, userId2));
      if (result.length === 0) return res.json({ data: null });
      res.json({ data: result[0].data });
    } catch (e) {
      console.error(`Error fetching ${path4}:`, e);
      res.status(500).json({ error: `Failed to fetch ${path4}` });
    }
  });
  app2.put(`/api/data/${path4}`, async (req, res) => {
    try {
      const userId2 = requireUserId(req, res);
      if (!userId2) return;
      const { data } = req.body;
      await db.insert(table).values({ userId: userId2, data, updatedAt: /* @__PURE__ */ new Date() }).onConflictDoUpdate({
        target: [table.userId],
        set: { data, updatedAt: /* @__PURE__ */ new Date() }
      });
      res.json({ ok: true });
    } catch (e) {
      console.error(`Error saving ${path4}:`, e);
      res.status(500).json({ error: `Failed to save ${path4}` });
    }
  });
  app2.delete(`/api/data/${path4}`, async (req, res) => {
    try {
      const userId2 = requireUserId(req, res);
      if (!userId2) return;
      await db.delete(table).where(eq26(table.userId, userId2));
      res.json({ ok: true });
    } catch (e) {
      console.error(`Error deleting ${path4}:`, e);
      res.status(500).json({ error: `Failed to delete ${path4}` });
    }
  });
}
function registerDataRoutes(app2) {
  app2.get("/api/data/plans/:date", async (req, res) => {
    try {
      const userId2 = requireUserId(req, res);
      if (!userId2) return;
      const { date: date2 } = req.params;
      const result = await db.select().from(plans).where(and21(eq26(plans.userId, userId2), eq26(plans.date, date2)));
      if (result.length === 0) return res.json({ data: null });
      res.json({ data: result[0].data });
    } catch (e) {
      console.error("Error fetching plan:", e);
      res.status(500).json({ error: "Failed to fetch plan" });
    }
  });
  app2.get("/api/data/plans", async (req, res) => {
    try {
      const userId2 = requireUserId(req, res);
      if (!userId2) return;
      const result = await db.select().from(plans).where(eq26(plans.userId, userId2));
      const plansMap = {};
      for (const row of result) {
        plansMap[row.date] = row.data;
      }
      res.json({ data: plansMap });
    } catch (e) {
      console.error("Error fetching plans:", e);
      res.status(500).json({ error: "Failed to fetch plans" });
    }
  });
  app2.put("/api/data/plans/:date", async (req, res) => {
    try {
      const userId2 = requireUserId(req, res);
      if (!userId2) return;
      const { date: date2 } = req.params;
      const { data } = req.body;
      try {
        const [prev] = await db.select({ data: plans.data }).from(plans).where(and21(eq26(plans.userId, userId2), eq26(plans.date, date2))).limit(1);
        const prevTasks = prev?.data?.tasks || [];
        const newTasks = data?.tasks || [];
        const prevById = new Map(prevTasks.map((t) => [t.id, t]));
        const justCompleted = newTasks.filter((t) => {
          if (!t.completed) return false;
          if (!t.goalTreeId || !t.goalTaskId) return false;
          const prevTask = prevById.get(t.id);
          return !prevTask || !prevTask.completed;
        });
        if (justCompleted.length > 0) {
          const { markTreeTaskComplete: markTreeTaskComplete2 } = await Promise.resolve().then(() => (init_goalScheduler(), goalScheduler_exports));
          for (const t of justCompleted) {
            await markTreeTaskComplete2(userId2, t.goalTreeId, t.goalTaskId);
          }
        }
      } catch (e) {
        console.error("[Plans] goal-tree completion propagation failed:", e);
      }
      await db.insert(plans).values({ userId: userId2, date: date2, data, updatedAt: /* @__PURE__ */ new Date() }).onConflictDoUpdate({
        target: [plans.userId, plans.date],
        set: { data, updatedAt: /* @__PURE__ */ new Date() }
      });
      res.json({ ok: true });
    } catch (e) {
      console.error("Error saving plan:", e);
      res.status(500).json({ error: "Failed to save plan" });
    }
  });
  app2.get("/api/data/goals", async (req, res) => {
    try {
      const userId2 = requireUserId(req, res);
      if (!userId2) return;
      const result = await db.select({ data: goals.data }).from(goals).where(eq26(goals.userId, userId2));
      if (result.length === 0) return res.json({ data: null });
      res.json({ data: result[0].data });
    } catch (e) {
      console.error("Error fetching goals:", e);
      res.status(500).json({ error: "Failed to fetch goals" });
    }
  });
  app2.delete("/api/data/goals", async (req, res) => {
    try {
      const userId2 = requireUserId(req, res);
      if (!userId2) return;
      await db.delete(goals).where(eq26(goals.userId, userId2));
      res.json({ ok: true });
    } catch (e) {
      console.error("Error deleting goals:", e);
      res.status(500).json({ error: "Failed to delete goals" });
    }
  });
  app2.put("/api/data/goals", async (req, res) => {
    try {
      const userId2 = requireUserId(req, res);
      if (!userId2) return;
      const { data } = req.body;
      const incoming = Array.isArray(data) ? data : [];
      const [prev] = await db.select({ data: goals.data }).from(goals).where(eq26(goals.userId, userId2)).limit(1);
      const prevList = prev?.data || [];
      const prevById = new Map(prevList.map((g) => [g.id, g]));
      const incomingTyped = incoming;
      const incomingIds = new Set(incomingTyped.map((g) => g.id));
      const goalsToDecompose = [];
      for (const g of incomingTyped) {
        if (!g || !g.id || !g.title) continue;
        const prevGoal = prevById.get(g.id);
        if (!prevGoal) {
          goalsToDecompose.push(g);
          continue;
        }
        const changed = (prevGoal.title || "") !== (g.title || "") || (prevGoal.description || "") !== (g.description || "") || (prevGoal.targetDate || "") !== (g.targetDate || "") || (prevGoal.target || "") !== (g.target || "") || (prevGoal.why || "") !== (g.why || "");
        if (changed) goalsToDecompose.push(g);
      }
      const removedIds = prevList.map((g) => g.id).filter((id) => id && !incomingIds.has(id));
      await db.insert(goals).values({ userId: userId2, data, updatedAt: /* @__PURE__ */ new Date() }).onConflictDoUpdate({
        target: [goals.userId],
        set: { data, updatedAt: /* @__PURE__ */ new Date() }
      });
      if (removedIds.length > 0) {
        try {
          for (const removedId of removedIds) {
            await db.delete(goalTrees).where(and21(eq26(goalTrees.userId, userId2), eq26(goalTrees.goalId, removedId)));
          }
          console.log(`[Goals] removed ${removedIds.length} stale goal tree(s) user=${userId2}`);
        } catch (e) {
          console.error("[Goals] stale-tree cleanup failed:", e);
        }
      }
      if (goalsToDecompose.length > 0) {
        try {
          const { enqueueGoalDecomposition: enqueueGoalDecomposition2 } = await Promise.resolve().then(() => (init_goalDecomposer(), goalDecomposer_exports));
          for (const g of goalsToDecompose) {
            await enqueueGoalDecomposition2(userId2, { id: g.id, title: g.title });
          }
          console.log(`[Goals] auto-queued decomposition for ${goalsToDecompose.length} new/changed goal(s) user=${userId2}`);
        } catch (e) {
          console.error("[Goals] auto-decompose enqueue failed:", e);
        }
      }
      res.json({ ok: true });
    } catch (e) {
      console.error("Error saving goals:", e);
      res.status(500).json({ error: "Failed to save goals" });
    }
  });
  registerSimpleJsonCrud(app2, "stats", stats);
  registerSimpleJsonCrud(app2, "brain-dump-inbox", brainDumpInbox);
  registerSimpleJsonCrud(app2, "chat-history", chatHistory);
  registerSimpleJsonCrud(app2, "life-context", lifeContext);
  registerSimpleJsonCrud(app2, "timer-settings", timerSettings);
  registerSimpleJsonCrud(app2, "user-preferences", userPreferences);
  app2.post("/api/data/auto-built-plan/dismiss", async (req, res) => {
    try {
      const userId2 = requireUserId(req, res);
      if (!userId2) return;
      const result = await db.select({ data: userPreferences.data }).from(userPreferences).where(eq26(userPreferences.userId, userId2));
      const currentPrefs = result[0]?.data || {};
      if (currentPrefs.autoBuiltPlan) {
        currentPrefs.autoBuiltPlan.dismissed = true;
      }
      await db.insert(userPreferences).values({ userId: userId2, data: currentPrefs, updatedAt: /* @__PURE__ */ new Date() }).onConflictDoUpdate({
        target: [userPreferences.userId],
        set: { data: currentPrefs, updatedAt: /* @__PURE__ */ new Date() }
      });
      res.json({ ok: true });
    } catch (e) {
      console.error("Error dismissing auto-built plan:", e);
      res.status(500).json({ error: "Failed to dismiss auto-built plan" });
    }
  });
  registerSimpleJsonCrud(app2, "completion-history", completionHistory);
  registerSimpleJsonCrud(app2, "blocked-tasks", blockedTasks);
  registerSimpleJsonCrud(app2, "plan-snapshots", planSnapshots);
  app2.get("/api/data/energy-checkins/:date", async (req, res) => {
    try {
      const userId2 = requireUserId(req, res);
      if (!userId2) return;
      const { date: date2 } = req.params;
      const result = await db.select().from(energyCheckins).where(and21(eq26(energyCheckins.userId, userId2), eq26(energyCheckins.date, date2)));
      if (result.length === 0) return res.json({ data: null });
      res.json({ data: result[0].data });
    } catch (e) {
      console.error("Error fetching energy checkin:", e);
      res.status(500).json({ error: "Failed to fetch energy checkin" });
    }
  });
  app2.put("/api/data/energy-checkins/:date", async (req, res) => {
    try {
      const userId2 = requireUserId(req, res);
      if (!userId2) return;
      const { date: date2 } = req.params;
      const { data } = req.body;
      await db.insert(energyCheckins).values({ userId: userId2, date: date2, data, updatedAt: /* @__PURE__ */ new Date() }).onConflictDoUpdate({
        target: [energyCheckins.userId, energyCheckins.date],
        set: { data, updatedAt: /* @__PURE__ */ new Date() }
      });
      res.json({ ok: true });
    } catch (e) {
      console.error("Error saving energy checkin:", e);
      res.status(500).json({ error: "Failed to save energy checkin" });
    }
  });
  app2.get("/api/data/completed-calendar-ids/:date", async (req, res) => {
    try {
      const userId2 = requireUserId(req, res);
      if (!userId2) return;
      const { date: date2 } = req.params;
      const result = await db.select().from(completedCalendarIds).where(and21(eq26(completedCalendarIds.userId, userId2), eq26(completedCalendarIds.date, date2)));
      if (result.length === 0) return res.json({ data: [] });
      res.json({ data: result[0].data });
    } catch (e) {
      console.error("Error fetching completed calendar ids:", e);
      res.status(500).json({ error: "Failed to fetch completed calendar ids" });
    }
  });
  app2.put("/api/data/completed-calendar-ids/:date", async (req, res) => {
    try {
      const userId2 = requireUserId(req, res);
      if (!userId2) return;
      const { date: date2 } = req.params;
      const { data } = req.body;
      await db.insert(completedCalendarIds).values({ userId: userId2, date: date2, data, updatedAt: /* @__PURE__ */ new Date() }).onConflictDoUpdate({
        target: [completedCalendarIds.userId, completedCalendarIds.date],
        set: { data, updatedAt: /* @__PURE__ */ new Date() }
      });
      res.json({ ok: true });
    } catch (e) {
      console.error("Error saving completed calendar ids:", e);
      res.status(500).json({ error: "Failed to save completed calendar ids" });
    }
  });
  app2.get("/api/data/export", async (req, res) => {
    try {
      const userId2 = requireUserId(req, res);
      if (!userId2) return;
      const [goalsRow] = await db.select({ data: goals.data }).from(goals).where(eq26(goals.userId, userId2));
      const [statsRow] = await db.select({ data: stats.data }).from(stats).where(eq26(stats.userId, userId2));
      const [lifeContextRow] = await db.select({ data: lifeContext.data }).from(lifeContext).where(eq26(lifeContext.userId, userId2));
      const [userPrefsRow] = await db.select({ data: userPreferences.data }).from(userPreferences).where(eq26(userPreferences.userId, userId2));
      const [chatHistoryRow] = await db.select({ data: chatHistory.data }).from(chatHistory).where(eq26(chatHistory.userId, userId2));
      const [timerSettingsRow] = await db.select({ data: timerSettings.data }).from(timerSettings).where(eq26(timerSettings.userId, userId2));
      const [brainDumpRow] = await db.select({ data: brainDumpInbox.data }).from(brainDumpInbox).where(eq26(brainDumpInbox.userId, userId2));
      const [completionHistoryRow] = await db.select({ data: completionHistory.data }).from(completionHistory).where(eq26(completionHistory.userId, userId2));
      const [blockedTasksRow] = await db.select({ data: blockedTasks.data }).from(blockedTasks).where(eq26(blockedTasks.userId, userId2));
      const [planSnapshotsRow] = await db.select({ data: planSnapshots.data }).from(planSnapshots).where(eq26(planSnapshots.userId, userId2));
      const plansRows = await db.select().from(plans).where(eq26(plans.userId, userId2));
      const plans2 = {};
      for (const row of plansRows) {
        plans2[row.date] = row.data;
      }
      const energyRows = await db.select().from(energyCheckins).where(eq26(energyCheckins.userId, userId2));
      const energyCheckins2 = {};
      for (const row of energyRows) {
        energyCheckins2[row.date] = row.data;
      }
      const calendarIdRows = await db.select().from(completedCalendarIds).where(eq26(completedCalendarIds.userId, userId2));
      const completedCalendarIds2 = {};
      for (const row of calendarIdRows) {
        completedCalendarIds2[row.date] = row.data;
      }
      res.json({
        data: {
          goals: goalsRow?.data ?? null,
          stats: statsRow?.data ?? null,
          lifeContext: lifeContextRow?.data ?? null,
          userPreferences: userPrefsRow?.data ?? null,
          chatHistory: chatHistoryRow?.data ?? null,
          timerSettings: timerSettingsRow?.data ?? null,
          brainDumpInbox: brainDumpRow?.data ?? null,
          completionHistory: completionHistoryRow?.data ?? null,
          blockedTasks: blockedTasksRow?.data ?? null,
          planSnapshots: planSnapshotsRow?.data ?? null,
          plans: plans2,
          energyCheckins: energyCheckins2,
          completedCalendarIds: completedCalendarIds2
        }
      });
    } catch (e) {
      console.error("Error exporting data:", e);
      res.status(500).json({ error: "Failed to export data" });
    }
  });
  app2.post("/api/data/import", async (req, res) => {
    try {
      const userId2 = requireUserId(req, res);
      if (!userId2) return;
      const { data } = req.body;
      if (!data || typeof data !== "object") {
        return res.status(400).json({ error: "Missing data object in request body" });
      }
      const now = /* @__PURE__ */ new Date();
      await db.transaction(async (tx) => {
        const replaceSimple = async (table, value) => {
          if (value === null || value === void 0) {
            await tx.delete(table).where(eq26(table.userId, userId2));
            return;
          }
          await tx.insert(table).values({ userId: userId2, data: value, updatedAt: now }).onConflictDoUpdate({ target: [table.userId], set: { data: value, updatedAt: now } });
        };
        await replaceSimple(goals, data.goals);
        await replaceSimple(stats, data.stats);
        await replaceSimple(lifeContext, data.lifeContext);
        await replaceSimple(chatHistory, data.chatHistory);
        await replaceSimple(timerSettings, data.timerSettings);
        await replaceSimple(brainDumpInbox, data.brainDumpInbox);
        await replaceSimple(completionHistory, data.completionHistory);
        await replaceSimple(blockedTasks, data.blockedTasks);
        await replaceSimple(planSnapshots, data.planSnapshots);
        await replaceSimple(userPreferences, data.userPreferences);
        if (data.plans && typeof data.plans === "object") {
          await tx.delete(plans).where(eq26(plans.userId, userId2));
          for (const [date2, planData] of Object.entries(data.plans)) {
            await tx.insert(plans).values({ userId: userId2, date: date2, data: planData, updatedAt: now });
          }
        }
        if (data.energyCheckins && typeof data.energyCheckins === "object") {
          await tx.delete(energyCheckins).where(eq26(energyCheckins.userId, userId2));
          for (const [date2, checkinData] of Object.entries(data.energyCheckins)) {
            await tx.insert(energyCheckins).values({ userId: userId2, date: date2, data: checkinData, updatedAt: now });
          }
        }
        if (data.completedCalendarIds && typeof data.completedCalendarIds === "object") {
          await tx.delete(completedCalendarIds).where(eq26(completedCalendarIds.userId, userId2));
          for (const [date2, idsData] of Object.entries(data.completedCalendarIds)) {
            await tx.insert(completedCalendarIds).values({ userId: userId2, date: date2, data: idsData, updatedAt: now });
          }
        }
      });
      res.json({ ok: true });
    } catch (e) {
      console.error("Error importing data:", e);
      res.status(500).json({ error: "Failed to import data" });
    }
  });
}
var init_dataRoutes = __esm({
  "server/dataRoutes.ts"() {
    "use strict";
    init_db();
    init_schema();
  }
});

// server/channels/routes.ts
import { eq as eq27, and as and22 } from "drizzle-orm";
function generateCode3(len = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < len; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
function registerChannelRoutes(app2) {
  app2.get("/api/channels", authMiddleware, async (req, res) => {
    const userId2 = req.userId;
    try {
      const [tgRows, channelRows, prefs] = await Promise.all([
        db.select({ chatId: telegramLinks.chatId }).from(telegramLinks).where(eq27(telegramLinks.userId, userId2)).limit(1),
        db.select().from(channelLinks).where(eq27(channelLinks.userId, userId2)),
        getAllPreferences(userId2)
      ]);
      const discordTok = await getUserToken(userId2, "discord_bot").catch(() => null);
      const connected = {
        telegram: tgRows.length > 0,
        whatsapp: false,
        slack: false,
        daemon: false,
        discord: false
      };
      const meta = {};
      for (const row of channelRows) {
        const ch = row.channel;
        if (ch === "daemon") {
          const daemonMeta = row.metadata;
          const platform = daemonMeta?.platform || "desktop";
          connected.daemon = isUserPaired(userId2);
          meta.daemon = { hostname: daemonMeta?.hostname, lastSeenAt: row.lastSeenAt, connected: connected.daemon, platform };
        } else if (ch === "discord") {
          connected.discord = true;
          const discordMeta = row.metadata;
          const botStatus = getBotStatus(userId2);
          meta.discord = {
            discordUsername: discordMeta?.discordUsername,
            botStatus,
            botRunning: botStatus === "running",
            isPaired: true,
            hasBotToken: !!discordTok,
            lastSeenAt: row.lastSeenAt,
            allowlistedGuilds: discordMeta?.allowlistedGuilds ?? []
          };
        } else if (CHANNEL_NAMES.includes(ch)) {
          connected[ch] = true;
          if (ch === "whatsapp") meta.whatsapp = { phone: row.address, lastSeenAt: row.lastSeenAt };
          if (ch === "slack") meta.slack = { teamId: row.metadata?.teamId, lastSeenAt: row.lastSeenAt };
        }
      }
      if (discordTok && !connected.discord) {
        const botStatus = getBotStatus(userId2);
        meta.discord = {
          hasBotToken: true,
          botStatus,
          botRunning: botStatus === "running",
          isPaired: false
        };
      }
      const channels2 = listChannels().map((c) => ({
        name: c.name,
        configured: c.isConfigured(),
        connected: connected[c.name]
      }));
      res.json({
        channels: channels2,
        connected,
        meta,
        notificationTypes: NOTIFICATION_TYPES,
        preferences: prefs
      });
    } catch (err) {
      console.error("[channels] GET /api/channels failed:", err);
      res.status(500).json({ error: "failed to load channel state" });
    }
  });
  app2.put("/api/channels/preferences", authMiddleware, async (req, res) => {
    const userId2 = req.userId;
    const { notificationType, channels: channels2 } = req.body || {};
    if (!NOTIFICATION_TYPES.includes(notificationType)) {
      return res.status(400).json({ error: "invalid notificationType" });
    }
    if (!Array.isArray(channels2) || channels2.some((c) => !CHANNEL_NAMES.includes(c))) {
      return res.status(400).json({ error: "invalid channels" });
    }
    try {
      const unique = [...new Set(channels2)];
      await setPreference(userId2, notificationType, unique);
      res.json({ ok: true, notificationType, channels: unique });
    } catch (err) {
      console.error("[channels] preference update failed:", err);
      res.status(500).json({ error: "failed to update preference" });
    }
  });
  app2.post("/api/channels/whatsapp/code", authMiddleware, async (req, res) => {
    const userId2 = req.userId;
    try {
      const code = generateCode3(6);
      const expiresAt = new Date(Date.now() + 15 * 60 * 1e3);
      await db.insert(channelLinkCodes).values({ code, userId: userId2, channel: "whatsapp", expiresAt });
      res.json({ code, expiresAt, twilioNumber: process.env.TWILIO_WHATSAPP_NUMBER || null });
    } catch (err) {
      console.error("[channels] whatsapp code failed:", err);
      res.status(500).json({ error: "failed to generate code" });
    }
  });
  app2.delete("/api/channels/:channel", authMiddleware, async (req, res) => {
    const userId2 = req.userId;
    const channel = req.params.channel;
    if (!CHANNEL_NAMES.includes(channel) || channel === "telegram") {
      return res.status(400).json({ error: "channel not unlinkable here" });
    }
    try {
      if (channel === "daemon") {
        closeUserDaemon(userId2);
      }
      if (channel === "discord") {
        stopUserBot(userId2);
        await deleteUserToken(userId2, "discord_bot").catch(() => {
        });
        await db.delete(channelLinkCodes).where(and22(eq27(channelLinkCodes.userId, userId2), eq27(channelLinkCodes.channel, "discord"))).catch(() => {
        });
      }
      await db.delete(channelLinks).where(and22(eq27(channelLinks.userId, userId2), eq27(channelLinks.channel, channel)));
      res.json({ ok: true });
    } catch (err) {
      console.error("[channels] unlink failed:", err);
      res.status(500).json({ error: "failed to unlink" });
    }
  });
  app2.get("/api/channels/daemon/permissions", authMiddleware, async (req, res) => {
    const userId2 = req.userId;
    try {
      const perms = await getDaemonPermissions(userId2);
      res.json({ permissions: perms, defaults: DEFAULT_DAEMON_PERMISSIONS });
    } catch (err) {
      console.error("[channels] daemon permissions GET failed:", err);
      res.status(500).json({ error: "failed to load permissions" });
    }
  });
  app2.put("/api/channels/daemon/permissions", authMiddleware, async (req, res) => {
    const userId2 = req.userId;
    const incoming = req.body?.permissions || {};
    const ACTIONS2 = ["shell", "notify", "file_read", "file_write", "file_list"];
    const sanitized = {};
    for (const k of ACTIONS2) {
      if (k in incoming) sanitized[k] = !!incoming[k];
    }
    try {
      const merged = await setDaemonPermissions(userId2, sanitized);
      res.json({ ok: true, permissions: merged });
    } catch (err) {
      console.error("[channels] daemon permissions PUT failed:", err);
      res.status(500).json({ error: "failed to update permissions" });
    }
  });
  app2.post("/api/channels/daemon/code", authMiddleware, async (req, res) => {
    const userId2 = req.userId;
    try {
      const code = await createDaemonPairingCode(userId2);
      res.json({ code, expiresInSec: 15 * 60 });
    } catch (err) {
      console.error("[channels] daemon code failed:", err);
      res.status(500).json({ error: "failed to generate pairing code" });
    }
  });
  app2.post("/api/channels/daemon/exec", authMiddleware, async (req, res) => {
    const userId2 = req.userId;
    const { sendDaemonOp: sendDaemonOp2, isUserPaired: paired } = await Promise.resolve().then(() => (init_bridge(), bridge_exports));
    if (!paired(userId2)) return res.status(409).json({ ok: false, error: "daemon not connected" });
    const { op } = req.body || {};
    const allowed = ["shell", "file_read", "file_write", "file_list", "notify"];
    if (!op || !allowed.includes(op.type)) {
      return res.status(400).json({ ok: false, error: "invalid op" });
    }
    if (!await isDaemonActionAllowed(userId2, op.type)) {
      return res.status(403).json({ ok: false, error: `Action '${op.type}' is not permitted. Enable it in Profile \u2192 Connected Channels \u2192 Desktop Daemon \u2192 Permissions.` });
    }
    const result = await sendDaemonOp2(userId2, op, 3e4);
    res.json(result);
  });
  app2.get("/api/channels/android-daemon/permissions", authMiddleware, async (req, res) => {
    const userId2 = req.userId;
    try {
      const perms = await getAndroidDaemonPermissions(userId2);
      res.json({ permissions: perms, defaults: DEFAULT_ANDROID_DAEMON_PERMISSIONS });
    } catch (err) {
      console.error("[channels] android daemon permissions GET failed:", err);
      res.status(500).json({ error: "failed to load android permissions" });
    }
  });
  app2.put("/api/channels/android-daemon/permissions", authMiddleware, async (req, res) => {
    const userId2 = req.userId;
    const incoming = req.body?.permissions || {};
    const ANDROID_ACTIONS2 = [
      "android_screenshot",
      "android_read_screen",
      "android_open_app",
      "android_browse",
      "android_file_list",
      "android_file_read",
      "android_tap_type"
    ];
    const sanitized = {};
    for (const k of ANDROID_ACTIONS2) {
      if (k in incoming) sanitized[k] = !!incoming[k];
    }
    try {
      const merged = await setAndroidDaemonPermissions(userId2, sanitized);
      res.json({ ok: true, permissions: merged });
    } catch (err) {
      console.error("[channels] android daemon permissions PUT failed:", err);
      res.status(500).json({ error: "failed to update android permissions" });
    }
  });
  app2.post("/api/channels/discord/token", authMiddleware, async (req, res) => {
    const userId2 = req.userId;
    const { botToken } = req.body || {};
    if (!botToken || typeof botToken !== "string" || botToken.trim().length < 20) {
      return res.status(400).json({ error: "Invalid bot token" });
    }
    try {
      await saveUserToken({
        userId: userId2,
        provider: "discord_bot",
        accessToken: botToken.trim(),
        accountEmail: ""
      });
      try {
        await startUserBot(userId2, botToken.trim());
      } catch (loginErr) {
        await deleteUserToken(userId2, "discord_bot").catch(() => {
        });
        throw loginErr;
      }
      res.json({ ok: true, botStatus: getBotStatus(userId2) });
    } catch (err) {
      console.error("[channels] discord token save failed:", err);
      res.status(400).json({ ok: false, error: err?.message || "Failed to connect bot \u2014 check the token and ensure Message Content + Server Members intents are enabled in the Discord Developer Portal." });
    }
  });
  app2.post("/api/channels/discord/pair", authMiddleware, async (req, res) => {
    const userId2 = req.userId;
    const { code } = req.body || {};
    if (!code || typeof code !== "string") {
      return res.status(400).json({ error: "code required" });
    }
    const result = await completePairing(userId2, code.trim().toUpperCase());
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true, discordUsername: result.discordUsername });
  });
  app2.get("/api/channels/discord/guilds", authMiddleware, async (req, res) => {
    const userId2 = req.userId;
    const guilds = getGuildsForUser(userId2);
    res.json({ guilds });
  });
  app2.get("/api/channels/discord/channels/:guildId", authMiddleware, async (req, res) => {
    const userId2 = req.userId;
    const { guildId } = req.params;
    const channels2 = await getChannelsForGuild(userId2, guildId);
    res.json({ channels: channels2 });
  });
  app2.put("/api/channels/discord/allowlist", authMiddleware, async (req, res) => {
    const userId2 = req.userId;
    const { guildId, guildName, channelId, channelName, requireMention } = req.body || {};
    if (!guildId || !channelId) {
      return res.status(400).json({ error: "guildId and channelId required" });
    }
    try {
      const rows = await db.select().from(channelLinks).where(and22(eq27(channelLinks.userId, userId2), eq27(channelLinks.channel, "discord"))).limit(1);
      if (!rows[0]) return res.status(404).json({ error: "Discord account not linked" });
      const meta = rows[0].metadata || {};
      const guilds = meta.allowlistedGuilds || [];
      const existing = guilds.findIndex((g) => g.guildId === guildId && g.channelId === channelId);
      const entry = {
        guildId,
        guildName: guildName || guildId,
        channelId,
        channelName: channelName || channelId,
        requireMention: requireMention !== false
      };
      if (existing >= 0) {
        guilds[existing] = entry;
      } else {
        guilds.push(entry);
      }
      await db.update(channelLinks).set({ metadata: { ...meta, allowlistedGuilds: guilds } }).where(and22(eq27(channelLinks.userId, userId2), eq27(channelLinks.channel, "discord")));
      res.json({ ok: true, allowlistedGuilds: guilds });
    } catch (err) {
      console.error("[channels] discord allowlist update failed:", err);
      res.status(500).json({ error: "failed to update allowlist" });
    }
  });
  app2.delete("/api/channels/discord/allowlist/:guildId/:channelId", authMiddleware, async (req, res) => {
    const userId2 = req.userId;
    const { guildId, channelId } = req.params;
    try {
      const rows = await db.select().from(channelLinks).where(and22(eq27(channelLinks.userId, userId2), eq27(channelLinks.channel, "discord"))).limit(1);
      if (!rows[0]) return res.status(404).json({ error: "Discord account not linked" });
      const meta = rows[0].metadata || {};
      const guilds = (meta.allowlistedGuilds || []).filter(
        (g) => !(g.guildId === guildId && g.channelId === channelId)
      );
      await db.update(channelLinks).set({ metadata: { ...meta, allowlistedGuilds: guilds } }).where(and22(eq27(channelLinks.userId, userId2), eq27(channelLinks.channel, "discord")));
      res.json({ ok: true, allowlistedGuilds: guilds });
    } catch (err) {
      console.error("[channels] discord allowlist delete failed:", err);
      res.status(500).json({ error: "failed to update allowlist" });
    }
  });
  app2.post("/api/channels/discord/workspace/setup", authMiddleware, async (req, res) => {
    const userId2 = req.userId;
    const { guildId } = req.body;
    if (!guildId) return res.status(400).json({ error: "guildId is required" });
    try {
      const result = await setupDiscordWorkspace(userId2, guildId);
      if (!result.ok) return res.status(400).json({ error: result.error });
      res.json({ ok: true, workspace: result.workspace, topics: WORKSPACE_TOPICS });
    } catch (err) {
      console.error("[channels] discord workspace setup failed:", err);
      res.status(500).json({ error: "failed to set up workspace" });
    }
  });
  app2.get("/api/channels/discord/workspace/topics", authMiddleware, (_req, res) => {
    res.json({ topics: WORKSPACE_TOPICS });
  });
}
var init_routes = __esm({
  "server/channels/routes.ts"() {
    "use strict";
    init_db();
    init_schema();
    init_auth();
    init_registry();
    init_bridge();
    init_manager();
    init_userTokenStore();
  }
});

// server/downloadRoutes.ts
import * as fs from "fs";
import * as path from "path";
function getFallbackUrl() {
  return process.env.ANDROID_APK_URL ?? null;
}
function registerDownloadRoutes(app2) {
  app2.get("/api/download/apk", (_req, res) => {
    if (fs.existsSync(APK_PATH)) {
      const stat = fs.statSync(APK_PATH);
      res.setHeader("Content-Type", "application/vnd.android.package-archive");
      res.setHeader("Content-Disposition", 'attachment; filename="jarvis-daemon.apk"');
      res.setHeader("Content-Length", stat.size);
      res.setHeader("Cache-Control", "public, max-age=3600");
      fs.createReadStream(APK_PATH).pipe(res);
      return;
    }
    const fallback = getFallbackUrl();
    if (fallback) {
      res.redirect(302, fallback);
      return;
    }
    res.status(404).json({
      error: "APK not available",
      instructions: "Either place the built APK at downloads/jarvis-daemon.apk, or set the ANDROID_APK_URL environment variable to a hosted APK URL (e.g. a GitHub Release asset URL)."
    });
  });
  app2.get("/api/download/apk/info", (_req, res) => {
    if (fs.existsSync(APK_PATH)) {
      const stat = fs.statSync(APK_PATH);
      return res.json({
        available: true,
        source: "local",
        sizeBytes: stat.size,
        updatedAt: stat.mtime.toISOString()
      });
    }
    const fallback = getFallbackUrl();
    if (fallback) {
      return res.json({ available: true, source: "remote", url: fallback });
    }
    res.json({ available: false });
  });
}
var APK_PATH;
var init_downloadRoutes = __esm({
  "server/downloadRoutes.ts"() {
    "use strict";
    APK_PATH = path.resolve(process.cwd(), "downloads", "jarvis-daemon.apk");
  }
});

// server/integrationOwner.ts
import { sql as sql14 } from "drizzle-orm";
async function getIntegrationOwnerId() {
  if (cachedOwnerId) return cachedOwnerId;
  try {
    const result = await db.execute(sql14`SELECT owner_user_id FROM integration_owner LIMIT 1`);
    const row = result.rows?.[0];
    if (row?.owner_user_id) {
      cachedOwnerId = row.owner_user_id;
      return cachedOwnerId;
    }
    return null;
  } catch {
    return null;
  }
}
async function claimIntegrationOwnership(userId2) {
  try {
    const existing = await getIntegrationOwnerId();
    if (existing) return existing === userId2;
    await db.execute(sql14`INSERT INTO integration_owner (owner_user_id) VALUES (${userId2})`);
    cachedOwnerId = userId2;
    return true;
  } catch {
    return false;
  }
}
async function isIntegrationOwner(userId2) {
  const ownerId = await getIntegrationOwnerId();
  if (!ownerId) return false;
  return ownerId === userId2;
}
var cachedOwnerId;
var init_integrationOwner = __esm({
  "server/integrationOwner.ts"() {
    "use strict";
    init_db();
    cachedOwnerId = null;
  }
});

// server/memory/people.ts
import { eq as eq28, and as and23, sql as sql15 } from "drizzle-orm";
async function listPeople(userId2) {
  return db.select().from(people).where(eq28(people.userId, userId2)).orderBy(sql15`COALESCE(${people.lastInteractionAt}, ${people.createdAt}) DESC`);
}
async function deletePerson(userId2, id) {
  await db.delete(people).where(and23(eq28(people.userId, userId2), eq28(people.id, id)));
}
var init_people = __esm({
  "server/memory/people.ts"() {
    "use strict";
    init_db();
    init_schema();
  }
});

// server/inboxActions.ts
var inboxActions_exports = {};
__export(inboxActions_exports, {
  executeInboxAction: () => executeInboxAction
});
import { eq as eq29, and as and24 } from "drizzle-orm";
async function getGoogleToken(userId2) {
  try {
    const tokens = await getValidGoogleTokens(userId2);
    return tokens?.[0] || null;
  } catch {
    return null;
  }
}
async function executeInboxAction(userId2, itemId, actionType, telegramChatId) {
  const [item] = await db.select().from(inboxItems).where(and24(eq29(inboxItems.id, itemId), eq29(inboxItems.userId, userId2)));
  if (!item) {
    return { success: false, message: "Item not found" };
  }
  switch (actionType) {
    case "dismiss": {
      if (item.sourceType === "email") {
        const result = await learnFromDismissal(userId2, itemId, telegramChatId);
        return {
          success: true,
          message: result.learned ? `Dismissed. Jarvis learned to suppress ${result.ruleName}` : "Dismissed",
          learned: result.learned
        };
      }
      await db.update(inboxItems).set({ status: "dismissed", actedAt: /* @__PURE__ */ new Date() }).where(eq29(inboxItems.id, itemId));
      return { success: true, message: "Dismissed" };
    }
    case "never_again": {
      const senderDomain = item.sender ? (item.sender.match(/@([a-zA-Z0-9.-]+)/)?.[1] || "").toLowerCase() : "";
      const pattern = senderDomain ? `Auto: suppress ${senderDomain}` : `Auto: suppress "${item.subject || item.sender}"`;
      const matchHints = senderDomain ? { domains: [senderDomain] } : { subjectKeywords: [(item.subject || "").toLowerCase()] };
      await db.insert(inboxRules).values({
        userId: userId2,
        type: "suppress",
        scope: item.sourceType === "calendar" ? "calendar" : "email",
        pattern,
        matchHints,
        source: "user"
      });
      await db.update(inboxItems).set({ status: "dismissed", actedAt: /* @__PURE__ */ new Date() }).where(eq29(inboxItems.id, itemId));
      return { success: true, message: "Rule created \u2014 you'll never see these again" };
    }
    case "archive": {
      if (item.sourceType !== "email") {
        return { success: false, message: "Archive only works for emails" };
      }
      const rawId = (item.sourceId || "").replace(/^gmail:/, "");
      const token = await getGoogleToken(userId2);
      if (!token) {
        return { success: false, message: "No Google connection found" };
      }
      try {
        await gmailModifyMessage(rawId, [], ["INBOX"], token);
        await db.update(inboxItems).set({ status: "approved", actedAt: /* @__PURE__ */ new Date() }).where(eq29(inboxItems.id, itemId));
        return { success: true, message: "Email archived" };
      } catch (err) {
        return { success: false, message: `Archive failed: ${err.message || "unknown error"}` };
      }
    }
    case "mark_important": {
      if (item.sourceType !== "email") {
        return { success: false, message: "Only works for emails" };
      }
      const rawId = (item.sourceId || "").replace(/^gmail:/, "");
      const token = await getGoogleToken(userId2);
      if (!token) {
        return { success: false, message: "No Google connection found" };
      }
      try {
        await gmailModifyMessage(rawId, ["STARRED"], [], token);
        await db.update(inboxItems).set({ status: "approved", actedAt: /* @__PURE__ */ new Date() }).where(eq29(inboxItems.id, itemId));
        return { success: true, message: "Email starred" };
      } catch (err) {
        return { success: false, message: `Star failed: ${err.message || "unknown error"}` };
      }
    }
    case "save_as_task": {
      const taskTitle = item.subject || item.snippet || "Untitled task";
      const plans2 = await db.select().from(plans).where(eq29(plans.userId, userId2));
      const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      const existingPlan = plans2.find((p) => p.date === today);
      const planData = existingPlan?.data || { tasks: [] };
      const tasks = Array.isArray(planData.tasks) ? planData.tasks : [];
      const newTask = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        title: taskTitle,
        completed: false,
        duration: 15,
        priority: "high",
        source: item.sourceType === "email" ? "email" : "calendar"
      };
      tasks.push(newTask);
      planData.tasks = tasks;
      await db.insert(plans).values({ userId: userId2, date: today, data: planData }).onConflictDoUpdate({
        target: [plans.userId, plans.date],
        set: { data: planData, updatedAt: /* @__PURE__ */ new Date() }
      });
      await db.update(inboxItems).set({ status: "approved", actedAt: /* @__PURE__ */ new Date() }).where(eq29(inboxItems.id, itemId));
      return { success: true, message: `Task added: "${taskTitle}"` };
    }
    case "add_prep_time": {
      if (item.sourceType !== "calendar") {
        return { success: false, message: "Only works for calendar events" };
      }
      const prepTitle = `Prep: ${item.subject || "upcoming meeting"}`;
      const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      const plans2 = await db.select().from(plans).where(eq29(plans.userId, userId2));
      const existingPlan = plans2.find((p) => p.date === today);
      const planData = existingPlan?.data || { tasks: [] };
      const tasks = Array.isArray(planData.tasks) ? planData.tasks : [];
      const prepTask = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        title: prepTitle,
        completed: false,
        duration: 15,
        priority: "high",
        source: "calendar"
      };
      tasks.push(prepTask);
      planData.tasks = tasks;
      await db.insert(plans).values({ userId: userId2, date: today, data: planData }).onConflictDoUpdate({
        target: [plans.userId, plans.date],
        set: { data: planData, updatedAt: /* @__PURE__ */ new Date() }
      });
      await db.update(inboxItems).set({ status: "approved", actedAt: /* @__PURE__ */ new Date() }).where(eq29(inboxItems.id, itemId));
      return { success: true, message: `Prep task added: "${prepTitle}"` };
    }
    case "save_to_focus": {
      const contextText = `${item.subject || ""} \u2014 ${item.snippet || ""}`.trim();
      const [existing] = await db.select().from(lifeContext).where(eq29(lifeContext.userId, userId2));
      const data = existing?.data || {};
      const freeText = (data.freeText || "") + `
[From ${item.sourceType}] ${contextText}`;
      data.freeText = freeText.trim();
      await db.insert(lifeContext).values({ userId: userId2, data }).onConflictDoUpdate({
        target: lifeContext.userId,
        set: { data, updatedAt: /* @__PURE__ */ new Date() }
      });
      await db.update(inboxItems).set({ status: "approved", actedAt: /* @__PURE__ */ new Date() }).where(eq29(inboxItems.id, itemId));
      return { success: true, message: "Saved to your life context" };
    }
    default:
      return { success: false, message: `Unknown action: ${actionType}` };
  }
}
var init_inboxActions = __esm({
  "server/inboxActions.ts"() {
    "use strict";
    init_db();
    init_schema();
    init_inboxRules();
    init_gmail();
    init_userTokenStore();
  }
});

// server/routes.ts
import { createServer } from "node:http";
import OpenAI12 from "openai";
import { eq as eq30, and as and25, desc as desc10, sql as sql16, gte as gte4 } from "drizzle-orm";
import { YoutubeTranscript } from "youtube-transcript/dist/youtube-transcript.esm.js";
import ytSearch from "yt-search";
function getPersonaBlock(coachingMode) {
  return PERSONA_BLOCKS[coachingMode || "sharp"] || PERSONA_BLOCKS.sharp;
}
async function getUserLocalDate(userId2) {
  try {
    const prefs = await db.select({ data: userPreferences.data }).from(userPreferences).where(eq30(userPreferences.userId, userId2)).limit(1);
    const tz = prefs[0]?.data?.timezone || "America/New_York";
    return (/* @__PURE__ */ new Date()).toLocaleDateString("en-CA", { timeZone: tz });
  } catch {
    return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  }
}
async function getMorningNoteSummary(userId2) {
  const today = await getUserLocalDate(userId2);
  const cached = morningNoteSummaryCache.get(userId2);
  if (cached && cached.date === today) return cached.summary;
  try {
    const thirtyDaysAgo = /* @__PURE__ */ new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const cutoffDate = thirtyDaysAgo.toISOString().slice(0, 10);
    const notes = await db.select().from(morningVoiceNotes).where(and25(
      eq30(morningVoiceNotes.userId, userId2),
      gte4(morningVoiceNotes.recordedAt, cutoffDate)
    )).orderBy(desc10(morningVoiceNotes.recordedAt)).limit(30);
    if (notes.length === 0) return "";
    const moodCounts = {};
    const allThemes = {};
    const allBlockers = {};
    const recentIntentions = [];
    for (const note of notes) {
      moodCounts[note.moodSignal] = (moodCounts[note.moodSignal] || 0) + 1;
      const themes = note.themes || [];
      for (const t of themes) allThemes[t] = (allThemes[t] || 0) + 1;
      const blockers = note.blockers || [];
      for (const b of blockers) allBlockers[b] = (allBlockers[b] || 0) + 1;
      if (note.intention) recentIntentions.push(note.intention);
    }
    const topMoods = Object.entries(moodCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m, c]) => `${m} (${c}x)`).join(", ");
    const topThemes = Object.entries(allThemes).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t, c]) => `${t} (${c}x)`).join(", ");
    const topBlockers = Object.entries(allBlockers).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([b, c]) => `${b} (${c}x)`).join(", ");
    let summary = `
## Morning Voice Note Patterns (last ${notes.length} days)
`;
    summary += `- Mood trend: ${topMoods}
`;
    if (topThemes) summary += `- Recurring themes: ${topThemes}
`;
    if (topBlockers) summary += `- Common blockers: ${topBlockers}
`;
    if (recentIntentions.length > 0) summary += `- Recent intentions: ${recentIntentions.slice(0, 3).map((i) => `"${i}"`).join(", ")}
`;
    summary += `Use these patterns to provide personalized coaching. Reference specific trends when relevant.`;
    morningNoteSummaryCache.set(userId2, { summary, date: today });
    return summary;
  } catch {
    return "";
  }
}
function buildCoachSystemPrompt(goals2, stats2, history, calendarEvents = [], lifeContext2, gmailItems, gmailConnected, slackMessages, slackConnected, commitmentsList, coachingMode, memories, telegramMessages, telegramConnected, morningNoteSummary, documentsContext, crossChannelContext, soulBlock, daemonSection) {
  const completedHistory = history.filter((h) => h.completed);
  const skippedHistory = history.filter((h) => !h.completed);
  const completionRate = history.length > 0 ? Math.round(completedHistory.length / history.length * 100) : 0;
  const categorySkipCounts = {};
  skippedHistory.forEach((h) => {
    categorySkipCounts[h.category] = (categorySkipCounts[h.category] || 0) + 1;
  });
  const strugglingCategories = Object.entries(categorySkipCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([cat]) => cat);
  const goalsText = goals2.length > 0 ? goals2.map((g) => `  - ${g.title} (${g.category}): ${g.current}/${g.target} ${g.unit} \u2014 ${Math.round(g.current / Math.max(g.target, 1) * 100)}% complete`).join("\n") : "  - No goals set yet";
  const recentCompleted = completedHistory.slice(0, 8).map((h) => h.title).join(", ") || "none";
  const recentSkipped = skippedHistory.slice(0, 8).map((h) => h.title).join(", ") || "none";
  const calendarText = calendarEvents.length > 0 ? calendarEvents.slice(0, 8).map((e) => `  - ${e.time ? e.time + ": " : ""}${e.title}`).join("\n") : "  - No calendar events today";
  const lifeContextSection = lifeContext2 ? `
## About This Person
` + (lifeContext2.priorityGoal ? `- Priority right now: ${lifeContext2.priorityGoal}
` : "") + (lifeContext2.upcomingDeadline ? `- Upcoming commitment: ${lifeContext2.upcomingDeadline}
` : "") + (lifeContext2.improvementArea ? `- Wants to improve: ${lifeContext2.improvementArea}
` : "") + (lifeContext2.currentBlocker ? `- Current blocker: ${lifeContext2.currentBlocker}
` : "") + (lifeContext2.freeText ? `- Additional context: ${lifeContext2.freeText}` : "") : "";
  const documentsSection = documentsContext || "";
  const commitmentsSection = commitmentsList && commitmentsList.length > 0 ? `
## Open Commitments (user said they would do these)
` + commitmentsList.filter((c) => c.status === "pending").slice(0, 10).map((c) => `- "${c.content}"${c.dueDate ? ` (due ${c.dueDate})` : ""}`).join("\n") + `
If relevant, ask about progress on these commitments. Hold the user accountable to what they promised.` : "";
  const gmailSection = gmailItems && gmailItems.length > 0 ? `
## Recent Emails (last 7 days)
` + gmailItems.slice(0, 40).map((i) => {
    const dateStr2 = i.date ? new Date(i.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
    const acct = i.accountEmail ? ` [${i.accountEmail}]` : "";
    const labelStr = i.labels?.length ? ` [${i.labels.join(", ")}]` : "";
    return `- [${dateStr2}]${acct}${labelStr} From: ${i.from || "unknown"} | "${i.subject}" \u2014 ${i.snippet}`;
  }).join("\n") + `
(Use these to identify commitments, deadlines, or threads the user hasn't logged as tasks yet. Each email is labelled with which Gmail account it came from. When asked about a specific account, filter to those rows. Labels like \u2B50 Starred and Important indicate priority. Promotions/Social are lower signal. Refer to these directly \u2014 do not ask for more info.)` : gmailConnected ? `
## Recent Emails
Gmail is connected but no emails were found in the last 7 days. Do not pretend to have email data you don't have.` : `
## Recent Emails
Gmail is not connected \u2014 you have no access to the user's inbox. If asked about emails, tell them to connect Gmail in the Profile tab.`;
  const slackSection = slackConnected ? slackMessages && slackMessages.length > 0 ? `
## Recent Slack Messages (last 7 days)
` + slackMessages.slice(0, 50).map((m) => {
    const dateStr2 = m.timestamp ? new Date(m.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
    const channelLabel = m.channelType === "dm" ? "DM" : m.channelType === "group" ? "Group" : `#${m.channel}`;
    return `- [${dateStr2}] [${channelLabel}] ${m.user}: ${m.text}`;
  }).join("\n") + `
(Use these to identify commitments, follow-ups, and unresolved discussions. Treat Slack messages like emails \u2014 surface actionable items without asking for more info.)` : `
## Recent Slack Messages
Slack is connected but no messages were found in the last 7 days.` : "";
  const memoriesSection = (() => {
    if (!memories || memories.length === 0) return "";
    const categoryLabels = {
      personality: "Personality & Communication",
      values: "Values & Motivations",
      work_style: "Work Style & Patterns",
      accomplishment: "Accomplishments & Wins",
      goal_discovered: "Discovered Goals",
      relationship: "Key People & Relationships",
      pattern: "Recurring Patterns",
      preference: "Preferences",
      fact: "General Facts",
      goal: "Goals",
      achievement: "Achievements"
    };
    const grouped = {};
    for (const m of memories) {
      const cat = m.category || "fact";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(m.content);
    }
    let section = "\n## What I Know About You (from past conversations)";
    for (const [cat, items] of Object.entries(grouped)) {
      const label = categoryLabels[cat] || cat;
      section += `
### ${label}
${items.map((i) => `- ${i}`).join("\n")}`;
    }
    return section;
  })();
  const telegramSection = telegramConnected ? telegramMessages && telegramMessages.length > 0 ? `
## Recent Telegram Group Messages (last 7 days)
` + telegramMessages.slice(0, 50).map((m) => {
    const dateStr2 = m.timestamp ? new Date(m.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
    return `- [${dateStr2}] [${m.chatTitle || "Group"}] ${m.fromUser}: ${m.text}`;
  }).join("\n") + `
(Use these to identify commitments, follow-ups, and context. Treat like Slack messages.)` : `
## Recent Telegram Group Messages
Telegram is connected but no group messages were found in the last 7 days.` : "";
  const now = /* @__PURE__ */ new Date();
  const dayOfWeek = now.toLocaleDateString("en-US", { weekday: "long" });
  const dateStr = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const personaBlock = getPersonaBlock(coachingMode);
  return `You are GamePlan Coach \u2014 a sharp, supportive personal productivity coach embedded in the GamePlan app. You know this user's goals, habits, and patterns intimately. You give specific, actionable advice \u2014 not generic motivational fluff.

Today is ${dayOfWeek}, ${dateStr}.
${crossChannelContext || ""}

${COACHING_FRAMEWORKS}

${personaBlock}
${soulBlock && soulBlock.trim() ? soulBlock : memoriesSection}

## User Profile
- Current streak: ${stats2.streak || 0} days
- Best streak: ${stats2.bestStreak || 0} days
- Total tasks completed: ${stats2.totalCompleted || 0}
- Total XP earned: ${stats2.xp || 0}
- Task completion rate (last 7 days): ${completionRate}% (${completedHistory.length} completed, ${skippedHistory.length} skipped)
${strugglingCategories.length > 0 ? `- Struggling most with: ${strugglingCategories.join(", ")}` : ""}${soulBlock && soulBlock.trim() ? "" : lifeContextSection}${documentsSection}

## Active Goals
${goalsText}

## Today's Calendar
${calendarText}${gmailSection}${slackSection}${telegramSection}

## Recent Activity (last 7 days)
- Completed: ${recentCompleted}
- Left undone: ${recentSkipped}
${commitmentsSection}${morningNoteSummary || ""}
## How you coach

**Response length**: Keep replies short. 2\u20134 sentences is the default. Use a bullet list only when you have 3+ specific items to name. Never write multi-paragraph essays \u2014 the user is on their phone.

**Question-first rule**: When the user's message is open-ended, vague, or could go several directions ("help me", "what should I focus on", "I'm struggling", "any advice?") \u2014 ask ONE focused clarifying question before giving advice. Do not give generic advice while waiting for context. One question, nothing else.

**When you have enough context**: Give the direct, specific answer. No caveats, no generic encouragement padding, no restating what they said.

**Exception**: If the user explicitly asks for a plan, full strategy, or deep analysis, you may give a longer structured response \u2014 but still prefer lists over paragraphs.

**Other rules**:
- Be direct. Name what you see. Offer a concrete fix.
- For financial/career topics: think like a business advisor. Suggest specific resources (tools, books, frameworks) by name.
- You know what they've been skipping \u2014 call it out when relevant.
- Never say "I don't have access to your data" \u2014 everything is above.
- Respond in the same language the user writes in.

## Email Drafting
When asked to write or draft an email, format your response like this:
---EMAIL DRAFT---
To: [recipient]
Subject: [subject line]
Body:
[email body]
---END DRAFT---
Then add a brief note like "I've formatted this as a draft \u2014 tap 'Save to Drafts' to send it to your Gmail."

## Actuation \u2014 You Have Real Hands
You can take real actions on connected services. Use these tools proactively when the user asks:

- **check_connections** \u2014 Always call this before claiming a service is (or isn't) connected. Never make assumptions about connection status.
- **generate_reconnect_link** \u2014 When a Google or Microsoft account is disconnected and the user wants to reconnect, call this to generate a tappable OAuth button. After calling it, say something like "I've added a button below \u2014 tap it to reconnect." Do NOT write the URL in your message text.
- **connect_channel** \u2014 When the user asks to connect Telegram, WhatsApp, Slack, or Discord, call this to generate a connection code. After calling it, the tool result JSON contains a "code" field for Telegram. For Telegram: say "I've added a button below \u2014 tap it to open Telegram, then type the code **[CODE]** in the chat." (replace [CODE] with the actual code value from the tool result). Do NOT write raw URLs. Supported channels: telegram, whatsapp, slack, discord.
- **create_calendar_event** \u2014 When the user says "block time", "schedule a meeting", "add to my calendar" \u2014 call this to actually create the event. Don't describe what you'd do, do it.
- **fetch_emails** \u2014 Fetch inbox emails on demand beyond the ambient context.
- **send_email** \u2014 When the user explicitly confirms they want to send an email (not just draft), call this. Always confirm before sending.
- **daemon_action** \u2014 Execute actions on the user's paired daemon (desktop or Android). ${daemonSection || "Call check_connections first to determine which daemon type is paired and which actions are available."}

**Critical rule**: Never claim you can or cannot access a service without first calling check_connections. Never promise to send an email, create a calendar event, or run a daemon command if you haven't verified the service is connected. When a user asks to connect any channel, always call connect_channel rather than giving manual instructions.`;
}
async function buildPlanFromInputs(body) {
  const { goals: goals2, calendarEvents, gmailItems, brainDump, completionHistory: completionHistory2, energyLevel, coachingMode, existingTasks, userId: userId2 } = body;
  const goalsText = Array.isArray(goals2) && goals2.length > 0 ? goals2.map((g) => `- ${g.title} (${g.category}): ${g.current}/${g.target} ${g.unit} \u2014 ${Math.round(g.current / Math.max(g.target, 1) * 100)}% complete`).join("\n") : "No goals set";
  const calendarText = Array.isArray(calendarEvents) && calendarEvents.length > 0 ? calendarEvents.map((e) => `- ${e.time ? e.time + ": " : ""}${e.title}${e.description ? " (" + e.description + ")" : ""}`).join("\n") : "No calendar events today";
  const gmailText = Array.isArray(gmailItems) && gmailItems.length > 0 ? gmailItems.slice(0, 20).map((e) => `- From: ${e.from || "unknown"} | "${e.subject}" \u2014 ${e.snippet}`).join("\n") : "No emails available";
  const brainDumpText = Array.isArray(brainDump) && brainDump.length > 0 ? brainDump.map((b) => `- ${b.text || b}`).join("\n") : "No brain dump items";
  const historyText = Array.isArray(completionHistory2) && completionHistory2.length > 0 ? (() => {
    const completed = completionHistory2.filter((h) => h.completed).slice(0, 8);
    const skipped = completionHistory2.filter((h) => !h.completed).slice(0, 8);
    return `Completed recently: ${completed.map((h) => h.title).join(", ") || "none"}
Left undone recently: ${skipped.map((h) => h.title).join(", ") || "none"}`;
  })() : "No history available";
  const existingText = Array.isArray(existingTasks) && existingTasks.length > 0 ? existingTasks.map((t) => `- ${t.title} (${t.category}, ${t.priority}${t.completed ? ", done" : ""})`).join("\n") : "No existing tasks";
  const energyDescriptions = {
    1: "Dead \u2014 barely functional, needs very light tasks",
    2: "Low \u2014 limited capacity, keep it simple",
    3: "Okay \u2014 moderate capacity, balanced day",
    4: "Good \u2014 solid capacity, can handle challenging work",
    5: "On Fire \u2014 peak capacity, front-load the hard stuff"
  };
  const energyText = typeof energyLevel === "number" && energyLevel >= 1 && energyLevel <= 5 ? `${energyLevel}/5 \u2014 ${energyDescriptions[energyLevel]}` : "Not checked in";
  const modeInstructions = {
    mentor: "Coaching style: Mentor mode \u2014 include Deep Work blocks, be supportive, suggest learning and growth tasks.",
    drill: "Coaching style: Drill Sergeant mode \u2014 aggressive prioritization, no fluff, only the tasks that move the needle.",
    friend: "Coaching style: Friend mode \u2014 balanced and encouraging, mix of productive and enjoyable tasks."
  };
  const modeText = coachingMode && modeInstructions[coachingMode] ? modeInstructions[coachingMode] : "";
  const now = /* @__PURE__ */ new Date();
  const dayOfWeek = now.toLocaleDateString("en-US", { weekday: "long" });
  const dateStr = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const { buildAiContextSections: buildAiContextSections2 } = await Promise.resolve().then(() => (init_promptContext(), promptContext_exports));
  const planSeed = [
    ...Array.isArray(goals2) ? goals2.slice(0, 3).map((g) => g?.title).filter(Boolean) : [],
    ...Array.isArray(brainDump) ? brainDump.slice(0, 3).map((b) => b?.text || b).filter(Boolean) : []
  ].join(" \u2022 ");
  const { soulSection: planSoul, patternSection: planPatterns, memorySection: planMemories } = await buildAiContextSections2(typeof userId2 === "string" ? userId2 : void 0, planSeed);
  const prompt = `You are Jarvis, an autonomous planning AI. Build a realistic, prioritized daily plan for this person.

Today is ${dayOfWeek}, ${dateStr}.${planSoul}${planPatterns}${planMemories}

## Calendar
${calendarText}

## Goals
${goalsText}

## Recent Emails
${gmailText}

## Brain Dump (unprocessed thoughts/tasks)
${brainDumpText}

## Recent History
${historyText}

## Currently Planned Tasks
${existingText}

## Energy Level
${energyText}

${modeText}

## Rules
- Use their actual calendar to block around meetings (leave 10min buffer before/after)
- Pull tasks from brain dump that should be actioned today
- Surface email commitments that need a response or action today
- Apply their goals \u2014 at least one task should move a goal forward
- Match energy level to task difficulty
- Generate 4-7 tasks max \u2014 quality over quantity
- Be specific: "Review Q2 proposal draft" not "Work on proposal"
- For each task, add a brief description referencing WHY it made the cut (email, goal, deadline, brain dump)
- Do NOT duplicate calendar events as tasks
- Each task needs: title, category (one of: fitness, finance, career, personal, social), priority (high, medium, low), and optionally: duration (minutes), time (e.g. "9:30 AM"), description

Return JSON: { "reasoning": "2-3 sentences on your planning logic, referencing specific data points", "tasks": [{ "title": "...", "category": "...", "priority": "...", "duration": 60, "time": "9:30 AM", "description": "..." }] }
Return ONLY the JSON object.`;
  const response = await openai12.chat.completions.create({
    model: "gpt-5-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    max_completion_tokens: 2e3
  });
  const content = response.choices[0]?.message?.content || '{"reasoning":"","tasks":[]}';
  try {
    const parsed = JSON.parse(content);
    const validCategories = ["fitness", "finance", "career", "personal", "social"];
    const validPriorities = ["high", "medium", "low"];
    const tasks = Array.isArray(parsed.tasks) ? parsed.tasks.slice(0, 7).map((t) => ({
      title: String(t.title || "Task"),
      category: validCategories.includes(t.category) ? t.category : "personal",
      priority: validPriorities.includes(t.priority) ? t.priority : "medium",
      duration: typeof t.duration === "number" ? t.duration : void 0,
      time: t.time ? String(t.time) : void 0,
      description: t.description ? String(t.description) : void 0
    })) : [];
    return {
      reasoning: String(parsed.reasoning || ""),
      tasks
    };
  } catch {
    return { reasoning: "", tasks: [] };
  }
}
async function buildPlanForUser(userId2) {
  try {
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const [goalsRow, historyRow, brainDumpRow, lifeContextRow, prefsRow, energyRow] = await Promise.all([
      db.select({ data: goals.data }).from(goals).where(eq30(goals.userId, userId2)),
      db.select({ data: completionHistory.data }).from(completionHistory).where(eq30(completionHistory.userId, userId2)),
      db.select({ data: brainDumpInbox.data }).from(brainDumpInbox).where(eq30(brainDumpInbox.userId, userId2)),
      db.select({ data: lifeContext.data }).from(lifeContext).where(eq30(lifeContext.userId, userId2)),
      db.select({ data: userPreferences.data }).from(userPreferences).where(eq30(userPreferences.userId, userId2)),
      db.select({ data: energyCheckins.data }).from(energyCheckins).where(and25(eq30(energyCheckins.userId, userId2), eq30(energyCheckins.date, today)))
    ]);
    const goals2 = goalsRow[0]?.data || [];
    const completionHistory2 = historyRow[0]?.data || [];
    const brainDump = brainDumpRow[0]?.data || [];
    const prefs = prefsRow[0]?.data || {};
    const coachingMode = prefs.coachingMode;
    const energyCheckin = energyRow[0]?.data;
    const energyLevel = energyCheckin?.energy;
    let calendarEvents = [];
    let gmailItems = [];
    try {
      const googleTokens = await getValidGoogleTokens(userId2);
      if (googleTokens.length > 0) {
        const startTime = (/* @__PURE__ */ new Date(today + "T00:00:00")).toISOString();
        const endTime = (/* @__PURE__ */ new Date(today + "T23:59:59")).toISOString();
        const events = await getGoogleCalendarEvents(today, startTime, endTime, googleTokens[0]);
        calendarEvents = events.map((e) => ({
          title: e.title,
          time: e.start ? new Date(e.start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : void 0,
          description: e.location || e.description
        }));
      }
    } catch {
    }
    try {
      const googleTokens = await getValidGoogleTokens(userId2);
      if (googleTokens.length > 0) {
        gmailItems = await getRecentEmailCommitments(7, googleTokens[0]);
      }
    } catch {
    }
    const result = await buildPlanFromInputs({
      goals: goals2.map((g) => ({
        title: g.title,
        category: g.category,
        current: g.current,
        target: g.target,
        unit: g.unit
      })),
      calendarEvents,
      gmailItems,
      brainDump,
      completionHistory: completionHistory2,
      energyLevel: energyLevel ?? 3,
      coachingMode,
      existingTasks: [],
      userId: userId2
    });
    if (!result || result.tasks.length === 0) return null;
    return result;
  } catch (err) {
    console.error(`buildPlanForUser failed for ${userId2}:`, err);
    return null;
  }
}
async function registerRoutes(app2) {
  app2.use("/api/auth", authRouter);
  app2.use("/api/auth/mobile", mobileAuthRouter);
  app2.use("/api/oauth", oauthCallbackRouter);
  registerDownloadRoutes(app2);
  app2.get("/api/daemon/screenshot/:id", (req, res) => {
    const entry = screenshotStore.get(req.params.id);
    if (!entry || entry.expires < Date.now()) {
      return res.status(404).json({ error: "Screenshot not found or expired" });
    }
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-cache");
    res.send(entry.data);
  });
  app2.use(authMiddleware);
  app2.use("/api/oauth", oauthRouter);
  registerDataRoutes(app2);
  registerTelegramRoutes(app2);
  registerChannelRoutes(app2);
  app2.post("/api/ai/resize-task", async (req, res) => {
    try {
      const { taskTitle, taskDescription, detailLevel, direction, history } = req.body;
      if (!taskTitle || detailLevel === void 0 || !direction) {
        return res.status(400).json({ error: "taskTitle, detailLevel, and direction are required" });
      }
      if (typeof detailLevel !== "number" || detailLevel < 1 || detailLevel > 5) {
        return res.status(400).json({ error: "detailLevel must be a number between 1 and 5" });
      }
      if (direction !== "smaller" && direction !== "bigger") {
        return res.status(400).json({ error: "direction must be 'smaller' or 'bigger'" });
      }
      const result = await resizeTask({
        taskTitle,
        taskDescription,
        detailLevel: Math.min(5, Math.max(1, detailLevel)),
        direction,
        history: history || []
      });
      res.json(result);
    } catch (error) {
      console.error("Error resizing task:", error);
      res.status(500).json({ error: "Failed to resize task" });
    }
  });
  app2.post("/api/ai/generate-plan", async (req, res) => {
    try {
      const { goals: goals2, history, dayOfWeek, lifeContext: lifeContext2, gmailItems, energyCheckin, brainDumpTasks, carriedOverTasks, blockedTasks: blockedTasks2 } = req.body;
      const result = await generateSmartPlan({
        goals: goals2 || [],
        history: history || [],
        dayOfWeek: dayOfWeek || (/* @__PURE__ */ new Date()).toLocaleDateString("en-US", { weekday: "long" }),
        lifeContext: lifeContext2 || null,
        gmailItems: gmailItems || [],
        energyCheckin: energyCheckin || null,
        existingTasks: brainDumpTasks || [],
        carriedOverTasks: carriedOverTasks || [],
        blockedTasks: blockedTasks2 || [],
        userId: req.userId
      });
      res.json(result);
    } catch (error) {
      console.error("Error generating plan:", error);
      res.status(500).json({ error: "Failed to generate plan" });
    }
  });
  app2.post("/api/ai/unblock-task", async (req, res) => {
    try {
      const { taskTitle, taskDescription, blockerType, skipDays } = req.body;
      if (!taskTitle || !blockerType) {
        return res.status(400).json({ error: "taskTitle and blockerType are required" });
      }
      const result = await unblockTask({ taskTitle, taskDescription, blockerType, skipDays: skipDays || 1 });
      res.json(result);
    } catch (error) {
      console.error("Error unblocking task:", error);
      res.status(500).json({ error: "Failed to generate suggestion" });
    }
  });
  app2.post("/api/coach/build-plan", async (req, res) => {
    try {
      const result = await buildPlanFromInputs(req.body);
      res.json(result);
    } catch (error) {
      console.error("Error building plan:", error);
      res.status(500).json({ error: "Failed to build plan" });
    }
  });
  const coachTools = [
    {
      type: "function",
      function: {
        name: "add_task",
        description: "Add a new task to the user's plan for today",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Task title" },
            category: { type: "string", enum: ["health", "work", "personal", "learning", "finance", "social"], description: "Task category" },
            duration: { type: "number", description: "Estimated duration in minutes" }
          },
          required: ["title", "category"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "add_to_brain_dump",
        description: "Add an item to the user's brain dump inbox",
        parameters: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "log_goal_progress",
        description: "Log progress toward a goal",
        parameters: {
          type: "object",
          properties: {
            goalTitle: { type: "string", description: "Partial or full goal title to match" },
            amount: { type: "number", description: "Amount to add to current progress" }
          },
          required: ["goalTitle", "amount"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "update_life_context",
        description: "Update one or more life context fields for the user",
        parameters: {
          type: "object",
          properties: {
            priorityGoal: { type: "string" },
            currentBlocker: { type: "string" },
            improvementArea: { type: "string" },
            upcomingDeadline: { type: "string" },
            freeText: { type: "string" }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "complete_task",
        description: "Mark a task as complete in today's plan",
        parameters: {
          type: "object",
          properties: {
            taskTitle: { type: "string", description: "Partial or full title of the task to complete" }
          },
          required: ["taskTitle"]
        }
      }
    },
    ...process.env.TAVILY_API_KEY ? [{
      type: "function",
      function: {
        name: "web_search",
        description: "Search the internet for real-time information such as current events, weather, stock prices, news, product reviews, or anything else that requires up-to-date data. Use this when the user asks about something you don't know or when current information is needed.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "The search query to look up" }
          },
          required: ["query"]
        }
      }
    }] : [],
    {
      type: "function",
      function: {
        name: "check_connections",
        description: "Check which external accounts and channels the user has connected (Google/Gmail/Calendar, Microsoft/Outlook, Telegram, WhatsApp, Discord, Desktop Daemon). Always call this before claiming a service is or isn't available.",
        parameters: { type: "object", properties: {} }
      }
    },
    {
      type: "function",
      function: {
        name: "generate_reconnect_link",
        description: "Generate a fresh OAuth authorization URL so the user can reconnect a disconnected Google or Microsoft account. Returns a tappable link button. Use after check_connections confirms the service is not connected.",
        parameters: {
          type: "object",
          properties: {
            provider: { type: "string", enum: ["google", "microsoft"], description: "Which provider to reconnect" }
          },
          required: ["provider"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "create_calendar_event",
        description: "Create a calendar event on the user's Google or Outlook calendar. Use when the user asks to schedule or block time. start and end must be ISO 8601 datetime strings.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Event title" },
            start: { type: "string", description: "Start datetime ISO 8601 (e.g. '2025-04-22T14:00:00Z')" },
            end: { type: "string", description: "End datetime ISO 8601 (e.g. '2025-04-22T15:00:00Z')" },
            description: { type: "string", description: "Optional event notes" },
            location: { type: "string", description: "Optional location or video link" },
            provider: { type: "string", enum: ["google", "microsoft"], description: "Calendar provider, default 'google'" }
          },
          required: ["title", "start", "end"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "fetch_calendar",
        description: "Fetch the user's Google Calendar events for a given day or date range. Use whenever the user asks about their schedule, meetings, availability, or what's coming up. Returns events with title, time, and location.",
        parameters: {
          type: "object",
          properties: {
            date: { type: "string", description: "ISO date YYYY-MM-DD. Defaults to today if omitted." },
            days: { type: "number", description: "Number of consecutive days to fetch starting from date. Default 1, max 14." }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "fetch_emails",
        description: "Fetch recent emails on demand. Use when the user asks about their inbox beyond what's already in the system context. provider: 'google' (Gmail) or 'microsoft' (Outlook). count: number of emails to fetch (default 10, max 25).",
        parameters: {
          type: "object",
          properties: {
            provider: { type: "string", enum: ["google", "microsoft"], description: "Email provider" },
            count: { type: "number", description: "Number of emails to fetch (max 25)" }
          },
          required: ["provider"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "send_email",
        description: "Send an email immediately via Gmail or Outlook. Only use after the user explicitly confirms they want to send. Requires Google or Microsoft to be connected. If the user has multiple Google accounts, pass accountHint with the sender email address to select the correct account.",
        parameters: {
          type: "object",
          properties: {
            to: { type: "string", description: "Recipient email address" },
            subject: { type: "string", description: "Email subject" },
            body: { type: "string", description: "Email body (plain text)" },
            provider: { type: "string", enum: ["google", "microsoft"], description: "Which provider to use, default 'google'" },
            accountHint: { type: "string", description: "Optional sender account email to disambiguate when multiple accounts are connected (e.g. 'alice@gmail.com')" }
          },
          required: ["to", "subject", "body"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "daemon_action",
        description: "Execute a sandboxed action on the user's paired daemon \u2014 either a desktop daemon or an Android device daemon. DESKTOP actions (when desktop daemon paired): shell, notify, file_read, file_write, file_list. ANDROID actions (when Android daemon paired): android_open_app (launch app by package name e.g. 'com.google.android.youtube'), android_browse (open URL in browser or app via deep link \u2014 for YouTube search use url='vnd.youtube://results?search_query=QUERY', for Google Maps use 'geo:0,0?q=QUERY', for Spotify use 'spotify:search:QUERY'), android_screenshot (capture screen), android_read_screen (read visible UI text), android_tap (tap at x/y), android_type (type text into focused field \u2014 set submit:true to also press Search/Go/Enter after typing), android_swipe (swipe gesture), android_press_key (back/home/recents/enter), android_file_list, android_file_read, android_notifications_list (read current phone notifications \u2014 checks server cache first; if cache is empty, AUTOMATICALLY swipes open the notification shade, reads the screen, then closes the shade; always returns real live data, never makes up notifications). CRITICAL RULES: (1) If this tool returns result:'error', STOP IMMEDIATELY and tell the user exactly what went wrong \u2014 do NOT proceed or pretend the action succeeded. (2) After android_open_app or android_browse succeeds, ALWAYS call android_read_screen next to confirm the screen state \u2014 NEVER describe app content or search results without first reading the screen. (3) For in-app searches (YouTube, Reddit, Maps, etc.) prefer android_browse with a deep link URL over open_app + navigate UI. Do NOT narrate what you plan to do before calling this tool \u2014 only confirm what actually happened after a successful result. Always call check_connections first to know which daemon type is paired.",
        parameters: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["shell", "notify", "file_read", "file_write", "file_list", "android_open_app", "android_browse", "android_screenshot", "android_read_screen", "android_tap", "android_type", "android_swipe", "android_press_key", "android_file_list", "android_file_read", "android_notifications_list", "android_wait"], description: "Action to perform. 'notify' works on BOTH desktop and Android daemons \u2014 sends a pop-up banner notification with title and body. 'android_wait' pauses for ms milliseconds (default 1500, max 10000) \u2014 use between steps when the phone UI needs time to settle (e.g. after tapping a video to let it load before read_screen)." },
            cmd: { type: "string", description: "Shell command (for 'shell' action)" },
            title: { type: "string", description: "Notification title (for 'notify' action)" },
            body: { type: "string", description: "Notification body (for 'notify' action)" },
            path: { type: "string", description: "File/directory path (for file_read/file_write/file_list/android_file_list/android_file_read)" },
            content: { type: "string", description: "File content (for file_write)" },
            packageName: { type: "string", description: "Android app package name (for android_open_app, e.g. 'com.google.android.youtube')" },
            url: { type: "string", description: "URL to open (for android_browse)" },
            x: { type: "number", description: "X pixel coordinate (for android_tap)" },
            y: { type: "number", description: "Y pixel coordinate (for android_tap)" },
            text: { type: "string", description: "Text to type (for android_type)" },
            submit: { type: "boolean", description: "If true, press IME Search/Go/Enter after typing (for android_type only)" },
            x1: { type: "number", description: "Swipe start X (for android_swipe)" },
            y1: { type: "number", description: "Swipe start Y (for android_swipe)" },
            x2: { type: "number", description: "Swipe end X (for android_swipe)" },
            y2: { type: "number", description: "Swipe end Y (for android_swipe)" },
            key: { type: "string", enum: ["back", "home", "recents", "volume_up", "volume_down", "enter"], description: "System key (for android_press_key). Use 'enter' to press IME Search/Go/Done/Enter on the keyboard." },
            limit: { type: "number", description: "Max notifications to return (for android_notifications_list, default 20)" },
            ms: { type: "number", description: "Milliseconds to wait (for android_wait, default 1500, max 10000). Use 1500\u20133000ms after tapping a video to let YouTube load." }
          },
          required: ["action"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "daemon_diagnostic",
        description: "Ping the paired daemon to verify it is alive and retrieve the recent op audit log (last 20 ops with timestamps and durations). Use this when: (1) an android_* op timed out or failed unexpectedly, (2) the user reports the daemon isn't responding, or (3) you want to check if the accessibility service is enabled on the device. Returns device state (model, androidVersion, accessibilityEnabled, foregroundPackage) and a timestamped log of recent ops.",
        parameters: {
          type: "object",
          properties: {},
          required: []
        }
      }
    },
    {
      type: "function",
      function: {
        name: "search_youtube",
        description: "Search YouTube server-side and return structured results with title, channel name, view count, published date, duration, and video ID \u2014 without touching the phone. Use this BEFORE opening a video so you can intelligently pick the best result (reputable channel, high views, recent date). Returns up to 10 results. Then use fetch_youtube_transcript to get the transcript of the chosen video, and android_browse to open it on the phone.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query, e.g. 'how to improve focus ADHD'" },
            maxResults: { type: "number", description: "Number of results to return (1-10, default 8)" }
          },
          required: ["query"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "fetch_youtube_transcript",
        description: "Fetch the COMPLETE transcript/captions of a YouTube video server-side \u2014 returns the full text with no truncation. Use this INSTEAD of navigating YouTube's transcript UI on the phone (never tap through 3-dot menus). Call it with the video ID after search_youtube or after reading the video ID from android_read_screen. The transcript can be long for lengthy videos \u2014 use it to answer questions, summarize content, or extract specific information.",
        parameters: {
          type: "object",
          properties: {
            videoId: { type: "string", description: "YouTube video ID (e.g. 'dQw4w9WgXcQ') or full YouTube URL (https://youtube.com/watch?v=dQw4w9WgXcQ). Extract the video ID from the URL visible on screen via android_read_screen." }
          },
          required: ["videoId"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "connect_channel",
        description: "Generate a one-tap deep link so the user can connect a new messaging channel (Telegram, WhatsApp, Slack, or Discord) to Jarvis. Returns a tappable link button. Use proactively when the user asks to connect/link any of these services.",
        parameters: {
          type: "object",
          properties: {
            channel: {
              type: "string",
              enum: ["telegram", "whatsapp", "discord", "slack"],
              description: "Which channel to generate a connection link for."
            }
          },
          required: ["channel"]
        }
      }
    }
  ];
  function fuzzyMatch(needle, haystack) {
    const n = needle.toLowerCase().trim();
    const h = haystack.toLowerCase().trim();
    return h.includes(n) || n.includes(h);
  }
  const pendingConfirmations = /* @__PURE__ */ new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [token, entry] of pendingConfirmations.entries()) {
      if (entry.expiresAt < now) pendingConfirmations.delete(token);
    }
  }, 6e4);
  async function executeCoachTool(toolName, args, userId2) {
    const todayKey = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    try {
      switch (toolName) {
        case "add_task": {
          const planResult = await db.select({ data: plans.data }).from(plans).where(and25(eq30(plans.userId, userId2), eq30(plans.date, todayKey)));
          const plan = planResult.length > 0 ? planResult[0].data : { date: todayKey, tasks: [], greeting: "", insight: "" };
          const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
          const catMap = { health: "fitness", work: "career", learning: "personal" };
          const category = catMap[args.category] || args.category || "personal";
          const newTask = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            title: args.title,
            category,
            completed: false,
            priority: "medium"
          };
          tasks.push(newTask);
          const updatedPlan = { ...plan, tasks };
          await db.insert(plans).values({ userId: userId2, date: todayKey, data: updatedPlan, updatedAt: /* @__PURE__ */ new Date() }).onConflictDoUpdate({
            target: [plans.userId, plans.date],
            set: { data: updatedPlan, updatedAt: /* @__PURE__ */ new Date() }
          });
          return { result: "success", label: `Task added to today`, detail: `Added "${args.title}"` };
        }
        case "add_to_brain_dump": {
          const bdResult = await db.select({ data: brainDumpInbox.data }).from(brainDumpInbox).where(eq30(brainDumpInbox.userId, userId2));
          const items = bdResult.length > 0 ? Array.isArray(bdResult[0].data) ? bdResult[0].data : [] : [];
          items.unshift({
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            text: args.text,
            createdAt: (/* @__PURE__ */ new Date()).toISOString()
          });
          await db.insert(brainDumpInbox).values({ userId: userId2, data: items, updatedAt: /* @__PURE__ */ new Date() }).onConflictDoUpdate({
            target: [brainDumpInbox.userId],
            set: { data: items, updatedAt: /* @__PURE__ */ new Date() }
          });
          return { result: "success", label: `Added to brain dump`, detail: `Added "${args.text}"` };
        }
        case "log_goal_progress": {
          const goalsResult = await db.select({ data: goals.data }).from(goals).where(eq30(goals.userId, userId2));
          if (goalsResult.length === 0) return { result: "error", label: "No goals found", detail: "User has no goals set" };
          const goalsList = Array.isArray(goalsResult[0].data) ? goalsResult[0].data : [];
          const matched = goalsList.find((g) => fuzzyMatch(args.goalTitle, g.title));
          if (!matched) return { result: "error", label: `Goal not found`, detail: `Could not find goal matching "${args.goalTitle}"` };
          matched.current = (matched.current || 0) + args.amount;
          matched.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
          await db.insert(goals).values({ userId: userId2, data: goalsList, updatedAt: /* @__PURE__ */ new Date() }).onConflictDoUpdate({
            target: [goals.userId],
            set: { data: goalsList, updatedAt: /* @__PURE__ */ new Date() }
          });
          return { result: "success", label: `Progress logged`, detail: `Added ${args.amount} to "${matched.title}"` };
        }
        case "update_life_context": {
          const lcResult = await db.select({ data: lifeContext.data }).from(lifeContext).where(eq30(lifeContext.userId, userId2));
          const existing = lcResult.length > 0 ? lcResult[0].data : {};
          const merged = { ...existing };
          if (args.priorityGoal) merged.priorityGoal = args.priorityGoal;
          if (args.currentBlocker) merged.currentBlocker = args.currentBlocker;
          if (args.improvementArea) merged.improvementArea = args.improvementArea;
          if (args.upcomingDeadline) merged.upcomingDeadline = args.upcomingDeadline;
          if (args.freeText) merged.freeText = args.freeText;
          merged.lastUpdated = (/* @__PURE__ */ new Date()).toISOString();
          await db.insert(lifeContext).values({ userId: userId2, data: merged, updatedAt: /* @__PURE__ */ new Date() }).onConflictDoUpdate({
            target: [lifeContext.userId],
            set: { data: merged, updatedAt: /* @__PURE__ */ new Date() }
          });
          const updatedFields = Object.keys(args).filter((k) => args[k]).join(", ");
          return { result: "success", label: `Context updated`, detail: `Updated: ${updatedFields}` };
        }
        case "complete_task": {
          const planResult = await db.select({ data: plans.data }).from(plans).where(and25(eq30(plans.userId, userId2), eq30(plans.date, todayKey)));
          if (planResult.length === 0) return { result: "error", label: "No plan today", detail: "No plan found for today" };
          const plan = planResult[0].data;
          const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
          const matched = tasks.find((t) => !t.completed && fuzzyMatch(args.taskTitle, t.title));
          if (!matched) return { result: "error", label: `Task not found`, detail: `Could not find incomplete task matching "${args.taskTitle}"` };
          matched.completed = true;
          const updatedPlan = { ...plan, tasks };
          await db.insert(plans).values({ userId: userId2, date: todayKey, data: updatedPlan, updatedAt: /* @__PURE__ */ new Date() }).onConflictDoUpdate({
            target: [plans.userId, plans.date],
            set: { data: updatedPlan, updatedAt: /* @__PURE__ */ new Date() }
          });
          (async () => {
            try {
              const { extractAndStore: extractAndStore2 } = await Promise.resolve().then(() => (init_extractor(), extractor_exports));
              const { markSoulStale: markSoulStale2 } = await Promise.resolve().then(() => (init_soul(), soul_exports));
              await extractAndStore2({
                userId: userId2,
                source: `User just completed task: "${matched.title}". Notes: ${matched.notes || "(none)"}.`,
                sourceType: "plan_completion",
                sourceRef: `${todayKey}:${matched.title}`
              });
              await markSoulStale2(userId2);
            } catch (extractErr) {
              console.error("[Phase4] plan-completion extract failed:", extractErr);
            }
          })();
          return { result: "success", label: `Task completed`, detail: `Marked "${matched.title}" as done` };
        }
        case "web_search": {
          try {
            const results = await tavilySearch(args.query);
            const formatted = formatSearchResults(results);
            return { result: "success", label: `Web search: ${args.query}`, detail: formatted };
          } catch (searchErr) {
            const msg = String(searchErr?.message || searchErr);
            if (msg.includes("401") || msg.includes("403") || msg.includes("api_key")) {
              return { result: "error", label: "Search unavailable", detail: "Web search API key is invalid or expired. Tell the user web search is currently unavailable." };
            }
            if (msg.includes("429") || msg.includes("rate limit")) {
              return { result: "error", label: "Search rate limited", detail: "Web search rate limit reached. Tell the user to try again in a moment." };
            }
            if (msg.includes("timeout") || msg.includes("ECONNRESET") || msg.includes("ETIMEDOUT")) {
              return { result: "error", label: "Search timed out", detail: "Web search timed out. Tell the user the search could not complete and suggest trying again." };
            }
            return { result: "error", label: "Search failed", detail: `Web search failed: ${msg}. Tell the user you were unable to retrieve results.` };
          }
        }
        case "check_connections": {
          const [googleToken, msToken, oauthStatus, tgRows, chRows] = await Promise.all([
            getValidGoogleToken(userId2).catch(() => null),
            getValidMicrosoftToken(userId2).catch(() => null),
            getUserOAuthStatus(userId2).catch(() => ({})),
            db.select({ chatId: telegramLinks.chatId }).from(telegramLinks).where(eq30(telegramLinks.userId, userId2)).limit(1),
            db.select().from(channelLinks).where(eq30(channelLinks.userId, userId2))
          ]);
          const daemonOnline = isUserPaired(userId2);
          const isAndroid = daemonOnline ? await isAndroidDaemonActive(userId2) : false;
          const googleEmail = oauthStatus?.google?.email || oauthStatus?.google?.accounts?.[0]?.email || "unknown";
          const msEmail = oauthStatus?.microsoft?.email || oauthStatus?.microsoft?.accounts?.[0]?.email || "unknown";
          const slackConnectedCheck = oauthStatus?.slack?.connected ?? false;
          const daemonLabel = daemonOnline ? isAndroid ? `Android Device Daemon: \u2713 online \u2014 use android_open_app, android_browse, android_screenshot, android_read_screen, android_tap, android_type, android_swipe, android_press_key, android_file_list, android_file_read, android_notifications_list, notify. DO NOT use desktop shell/file actions. After completing a multi-step phone task, call notify (title:'Jarvis \u2713', body: one-line summary) so the user gets a banner on their phone. If a tool returns result:error, stop and report the error immediately \u2014 do NOT fabricate success. After android_open_app or android_browse succeeds, ALWAYS call android_read_screen before describing screen content. For app searches use deep links: YouTube='vnd.youtube://results?search_query=QUERY', Maps='geo:0,0?q=QUERY', Spotify='spotify:search:QUERY'.` : `Desktop Daemon: \u2713 online \u2014 use shell, notify, file_read, file_write, file_list actions.` : `Android/Desktop Daemon: \u2717 not connected \u2014 user must open Jarvis app \u2192 Profile \u2192 Android Device \u2192 Get Pairing Code, then open the Jarvis Daemon APK, enter server URL https://GameplanAI.replit.app and the 8-character code, tap Pair`;
          const lines = [
            `Google (Gmail + Calendar): ${googleToken ? `\u2713 token valid \u2014 ${googleEmail}` : "\u2717 not connected or token expired (reconnect needed)"}`,
            `Microsoft (Outlook + Calendar): ${msToken ? `\u2713 token valid \u2014 ${msEmail}` : "\u2717 not connected or token expired (reconnect needed)"}`,
            `Slack: ${slackConnectedCheck ? "\u2713 connected" : "\u2717 not connected"}`,
            `Telegram: ${tgRows.length > 0 ? "\u2713 linked" : "\u2717 not linked"}`,
            `WhatsApp: ${chRows.some((r) => r.channel === "whatsapp") ? "\u2713 linked" : "\u2717 not linked"}`,
            `Discord: ${chRows.some((r) => r.channel === "discord") ? "\u2713 linked" : "\u2717 not linked"}`,
            daemonLabel
          ];
          return { result: "success", label: "Connection status checked", detail: lines.join("\n") };
        }
        case "generate_reconnect_link": {
          const provider = String(args.provider || "").toLowerCase();
          const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
          const isDev = process.env.REPLIT_DEV_DOMAIN === domain;
          const baseUrl = domain ? isDev ? `https://${domain}:5000` : `https://${domain}` : "http://localhost:5000";
          if (provider === "google") {
            const clientId = process.env.GOOGLE_WEB_CLIENT_ID;
            if (!clientId) return { result: "error", label: "Google not configured", detail: "Google OAuth client ID not set on server." };
            const params = new URLSearchParams({
              client_id: clientId,
              redirect_uri: `${baseUrl}/api/oauth/google/callback`,
              response_type: "code",
              scope: "openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/drive.file",
              access_type: "offline",
              prompt: "consent",
              state: userId2
            });
            const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
            return { result: "success", label: "Reconnect Google", detail: JSON.stringify({ url, buttonLabel: "Reconnect Google", provider: "google" }) };
          }
          if (provider === "microsoft") {
            const clientId = process.env.MICROSOFT_CLIENT_ID;
            if (!clientId) return { result: "error", label: "Microsoft not configured", detail: "Microsoft OAuth client ID not set on server." };
            const params = new URLSearchParams({
              client_id: clientId,
              redirect_uri: `${baseUrl}/api/oauth/microsoft/callback`,
              response_type: "code",
              scope: "offline_access Calendars.ReadWrite Mail.ReadWrite Mail.Send User.Read",
              state: userId2,
              response_mode: "query"
            });
            const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
            return { result: "success", label: "Reconnect Outlook", detail: JSON.stringify({ url, buttonLabel: "Reconnect Outlook", provider: "microsoft" }) };
          }
          return { result: "error", label: "Unknown provider", detail: `Unknown provider: ${provider}` };
        }
        case "create_calendar_event": {
          const title = String(args.title || "").trim();
          const start = String(args.start || "").trim();
          const end = String(args.end || "").trim();
          const description = args.description ? String(args.description).trim() : void 0;
          const location = args.location ? String(args.location).trim() : void 0;
          const provider = String(args.provider || "google").toLowerCase();
          if (!title || !start || !end) return { result: "error", label: "Missing fields", detail: "title, start, and end are required." };
          if (provider === "google") {
            const tokens = await getValidGoogleTokens(userId2);
            if (!tokens.length) return { result: "error", label: "Google not connected", detail: "Connect Google in Profile to create calendar events." };
            const result = await createGoogleCalendarEvent(tokens[0], { title, start, end, description, location });
            return { result: "success", label: `Event created: ${title}`, detail: result.htmlLink || `Created on ${start.slice(0, 10)}` };
          }
          if (provider === "microsoft") {
            const msToken = await getValidMicrosoftToken(userId2);
            if (!msToken) return { result: "error", label: "Microsoft not connected", detail: "Connect Microsoft in Profile to create Outlook calendar events." };
            await createOutlookCalendarEvent(msToken, { title, start, end, description, location });
            return { result: "success", label: `Event created: ${title}`, detail: `Created on ${start.slice(0, 10)}` };
          }
          return { result: "error", label: "Unknown provider", detail: `Unknown provider: ${provider}` };
        }
        case "fetch_calendar": {
          let addDaysLocal2 = function(dateStr, n) {
            const d = /* @__PURE__ */ new Date(dateStr + "T12:00:00Z");
            d.setUTCDate(d.getUTCDate() + n);
            return d.toISOString().slice(0, 10);
          };
          var addDaysLocal = addDaysLocal2;
          const tokens = await getValidGoogleTokens(userId2);
          if (!tokens.length) return { result: "error", label: "Google not connected", detail: "Connect Google in Profile to fetch calendar events." };
          const startDate = String(args.date || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10));
          const days = Math.min(Math.max(Number(args.days) || 1, 1), 14);
          const blocks = [];
          let totalEvents = 0;
          for (let i = 0; i < days; i++) {
            const d = addDaysLocal2(startDate, i);
            const events = await getGoogleCalendarEvents(d, void 0, void 0, tokens[0]);
            totalEvents += events.length;
            if (events.length === 0) {
              blocks.push(`${d}: (no events)`);
              continue;
            }
            const lines = events.map((e) => {
              const loc = e.location ? ` @ ${e.location}` : "";
              return `  - ${e.time || e.start || ""}${e.end ? `\u2013${e.end}` : ""}: ${e.title || "(no title)"}${loc}`;
            });
            blocks.push(`${d}:
${lines.join("\n")}`);
          }
          return { result: "success", label: `Calendar: ${totalEvents} event(s) over ${days} day(s)`, detail: blocks.join("\n\n") };
        }
        case "fetch_emails": {
          const provider = String(args.provider || "google").toLowerCase();
          const count = Math.min(Number(args.count) || 10, 25);
          if (provider === "google") {
            const tokens = await getValidGoogleTokens(userId2);
            if (!tokens.length) return { result: "error", label: "Gmail not connected", detail: "Connect Google in Profile to fetch emails." };
            const emails = await getRecentEmailCommitments(14, tokens[0]);
            const recent = emails.slice(0, count).map((e) => `- From: ${e.from || "unknown"} | "${e.subject}" \u2014 ${e.snippet}`).join("\n");
            return { result: "success", label: `Fetched ${Math.min(emails.length, count)} Gmail emails`, detail: recent || "No emails found." };
          }
          if (provider === "microsoft") {
            const msToken = await getValidMicrosoftToken(userId2);
            if (!msToken) return { result: "error", label: "Outlook not connected", detail: "Connect Microsoft in Profile to fetch emails." };
            const emails = await getRecentOutlookEmails(msToken, count);
            const text2 = emails.map((e) => `- From: ${e.from} | "${e.subject}" \u2014 ${e.snippet}`).join("\n");
            return { result: "success", label: `Fetched ${emails.length} Outlook emails`, detail: text2 || "No emails found." };
          }
          return { result: "error", label: "Unknown provider", detail: `Unknown provider: ${provider}` };
        }
        case "send_email": {
          const to = String(args.to || "").trim();
          const subject = String(args.subject || "").trim();
          const body = String(args.body || "");
          const provider = String(args.provider || "google").toLowerCase();
          const accountHint = args.accountHint ? String(args.accountHint).trim().toLowerCase() : null;
          if (!to || !subject || !body.trim()) return { result: "error", label: "Missing fields", detail: "to, subject, and body are all required." };
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(to)) return { result: "error", label: "Invalid recipient", detail: `"${to}" is not a valid email address.` };
          if (provider === "google") {
            let token = null;
            if (accountHint) {
              const allTokens = await getUserTokens(userId2, "google");
              const match = allTokens.find((t) => (t.accountEmail || "").toLowerCase() === accountHint);
              if (match) {
                if (match.expiresAt && match.expiresAt.getTime() < Date.now() + 6e4) {
                  token = await getValidGoogleToken(userId2);
                } else {
                  token = match.accessToken;
                }
              }
            }
            if (!token) token = await getValidGoogleToken(userId2);
            if (!token) return { result: "error", label: "Gmail not connected", detail: "Connect Google in Profile to send emails." };
            const result = await sendGmailEmail(token, to, subject, body);
            return { result: "success", label: `Email sent to ${to}`, detail: `Gmail message ID: ${result.messageId}` };
          }
          if (provider === "microsoft") {
            const msToken = await getValidMicrosoftToken(userId2);
            if (!msToken) return { result: "error", label: "Outlook not connected", detail: "Connect Microsoft in Profile to send emails." };
            await sendOutlookEmail(msToken, to, subject, body);
            return { result: "success", label: `Email sent to ${to}`, detail: `Sent via Outlook` };
          }
          return { result: "error", label: "Unknown provider", detail: `Unknown provider: ${provider}` };
        }
        case "daemon_action": {
          const action = String(args.action || "");
          if (!isUserPaired(userId2)) {
            return { result: "error", label: "Daemon not connected", detail: "No daemon paired. Install and pair either the desktop daemon or the Android APK from Profile \u2192 Connected Channels." };
          }
          const isAndroidDaemon = await isAndroidDaemonActive(userId2);
          const androidActions = ["android_open_app", "android_browse", "android_screenshot", "android_read_screen", "android_tap", "android_type", "android_swipe", "android_press_key", "android_file_list", "android_file_read", "android_notifications_list", "android_wait", "notify"];
          const desktopActions = ["shell", "notify", "file_read", "file_write", "file_list"];
          let op;
          if (androidActions.includes(action)) {
            if (!isAndroidDaemon) return { result: "error", label: "Android daemon required", detail: "This action requires an Android daemon. The paired daemon is a desktop daemon." };
            const permMap = {
              android_screenshot: "android_screenshot",
              android_read_screen: "android_read_screen",
              android_open_app: "android_open_app",
              android_browse: "android_browse",
              android_file_list: "android_file_list",
              android_file_read: "android_file_read",
              android_tap: "android_tap_type",
              android_type: "android_tap_type",
              android_swipe: "android_tap_type",
              android_press_key: "android_tap_type",
              android_notifications_list: null
              // served from server cache — no daemon permission needed
            };
            const permKey = permMap[action];
            if (permKey && !await isAndroidDaemonActionAllowed(userId2, permKey)) {
              return { result: "error", label: `Permission denied`, detail: `Android action '${action}' is not permitted. Enable it in Profile \u2192 Connected Channels \u2192 Android Device \u2192 Permissions.` };
            }
            if (action === "android_open_app") {
              if (!args.packageName) return { result: "error", label: "packageName required", detail: "Provide packageName for android_open_app." };
              op = { type: "android_open_app", packageName: String(args.packageName) };
            } else if (action === "android_browse") {
              if (!args.url) return { result: "error", label: "url required", detail: "Provide url for android_browse." };
              let browseUrl = String(args.url);
              const ytSearch2 = browseUrl.match(/(?:https?:\/\/)?(?:www\.)?youtube\.com\/results\?search_query=([^&]+)/);
              if (ytSearch2) browseUrl = `vnd.youtube://results?search_query=${ytSearch2[1]}`;
              const ytWatch = browseUrl.match(/(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([^&]+)/);
              if (ytWatch) browseUrl = `vnd.youtube://watch?v=${ytWatch[1]}`;
              op = { type: "android_browse", url: browseUrl };
            } else if (action === "android_screenshot") {
              op = { type: "android_screenshot" };
            } else if (action === "android_read_screen") {
              op = { type: "android_read_screen" };
            } else if (action === "android_tap") {
              if (typeof args.x !== "number" || typeof args.y !== "number") return { result: "error", label: "x,y required", detail: "Provide x and y for android_tap." };
              op = { type: "android_tap", x: args.x, y: args.y };
            } else if (action === "android_type") {
              if (!args.text) return { result: "error", label: "text required", detail: "Provide text for android_type." };
              op = { type: "android_type", text: String(args.text), submit: !!args.submit };
            } else if (action === "android_notifications_list") {
              const limit = typeof args.limit === "number" ? Math.min(args.limit, 60) : 20;
              const daemonNotifResult = await sendDaemonOp(userId2, { type: "android_notifications_list", limit }, 1e4);
              if (daemonNotifResult.ok) {
                const d = daemonNotifResult.data;
                const listenerEnabled = !!d?.listenerEnabled;
                const rawNotifications = Array.isArray(d?.notifications) ? d.notifications : [];
                const count = rawNotifications.length;
                if (listenerEnabled && count > 0) {
                  const relativeTime = (tsMs) => {
                    const diffMs = Date.now() - tsMs;
                    const diffMins = Math.round(diffMs / 6e4);
                    if (diffMins < 1) return "just now";
                    if (diffMins < 60) return `${diffMins}m ago`;
                    const diffHours = Math.floor(diffMins / 60);
                    if (diffHours < 24) return `${diffHours}h ${diffMins % 60}m ago`;
                    return `${Math.floor(diffHours / 24)}d ago`;
                  };
                  const formatted = rawNotifications.map((n) => {
                    const ago = typeof n.ts === "number" ? relativeTime(n.ts) : "?";
                    const app3 = String(n.app || n.pkg || "Unknown");
                    const title = String(n.title || "");
                    const text2 = n.text ? `: ${String(n.text).slice(0, 120)}` : "";
                    return `\u2022 ${app3} (${ago}) \u2014 ${title}${text2}`;
                  }).join("\n");
                  return {
                    result: "success",
                    label: `${count} notification${count !== 1 ? "s" : ""} from phone`,
                    detail: `PHONE NOTIFICATIONS (${count} total) \u2014 speak these back to the user exactly. The "(X ago)" values are relative ages; DO NOT convert them to clock times \u2014 you cannot know the user's timezone and any conversion will be wrong. Just say "X minutes ago" or "X hours ago" as shown.

${formatted}`
                  };
                }
                if (listenerEnabled && count === 0) {
                  return {
                    result: "success",
                    label: "No notifications",
                    detail: "The notification listener is active on the phone and reports zero current notifications. The tray is clear."
                  };
                }
                console.warn(`[daemon] android_notifications_list: listenerEnabled=false for userId=${userId2}, falling back to shade`);
              } else {
                console.warn(`[daemon] android_notifications_list direct op failed (${daemonNotifResult.error}), falling back to shade`);
              }
              const swipeOp = await sendDaemonOp(userId2, {
                type: "android_swipe",
                x1: 540,
                y1: 10,
                x2: 540,
                y2: 1200,
                durationMs: 400
              }, 8e3);
              if (!swipeOp.ok) {
                return {
                  result: "error",
                  label: "Cannot read notifications",
                  detail: `The Notification Access permission is not granted to Jarvis Daemon (go to Settings > Notifications > Device & App Notifications > Jarvis Daemon and enable it). The shade-opening fallback also failed: ${swipeOp.error || "swipe failed"}.`
                };
              }
              await new Promise((r) => setTimeout(r, 700));
              const shadeReadOp = await sendDaemonOp(userId2, { type: "android_read_screen" }, 1e4);
              sendDaemonOp(userId2, { type: "android_press_key", key: "back" }, 5e3).catch(() => {
              });
              if (!shadeReadOp.ok) {
                return {
                  result: "error",
                  label: "Could not read notification shade",
                  detail: `Screen read failed: ${shadeReadOp.error || "unknown"}. Ensure the Accessibility Service is enabled.`
                };
              }
              const shadeData = shadeReadOp.data;
              const shadeText = typeof shadeData === "string" ? shadeData : JSON.stringify(shadeData || "");
              if (!shadeText || shadeText === "{}" || shadeText === '""' || shadeText === "null") {
                return {
                  result: "success",
                  label: "Notification shade appears empty",
                  detail: "No text was detected in the notification shade. Your notification tray may be empty."
                };
              }
              return {
                result: "success",
                label: "Notification shade content read from screen",
                detail: `SCREEN CONTENT (verbatim from phone \u2014 report ONLY what is shown here, do NOT add or infer any details):
${shadeText}`
              };
            } else if (action === "android_wait") {
              const ms = Math.min(Math.max(typeof args.ms === "number" ? args.ms : 1500, 200), 1e4);
              await new Promise((resolve4) => setTimeout(resolve4, ms));
              return { result: "success", label: `Waited ${ms}ms`, detail: `Paused ${ms}ms to let the phone UI settle.` };
            } else if (action === "android_swipe") {
              if (typeof args.x1 !== "number" || typeof args.y1 !== "number" || typeof args.x2 !== "number" || typeof args.y2 !== "number") return { result: "error", label: "coords required", detail: "Provide x1,y1,x2,y2 for android_swipe." };
              op = { type: "android_swipe", x1: args.x1, y1: args.y1, x2: args.x2, y2: args.y2, durationMs: typeof args.durationMs === "number" ? args.durationMs : 300 };
            } else if (action === "android_press_key") {
              const validKeys = ["back", "home", "recents", "volume_up", "volume_down", "enter"];
              const key = String(args.key || "back");
              if (!validKeys.includes(key)) return { result: "error", label: "invalid key", detail: "Key must be back, home, recents, volume_up, volume_down, or enter." };
              op = { type: "android_press_key", key };
            } else if (action === "android_file_list") {
              if (!args.path) return { result: "error", label: "path required", detail: "Provide path for android_file_list." };
              op = { type: "android_file_list", path: String(args.path) };
            } else if (action === "notify") {
              op = { type: "notify", title: String(args.title || "Jarvis"), body: String(args.body || "") };
            } else {
              if (!args.path) return { result: "error", label: "path required", detail: "Provide path for android_file_read." };
              op = { type: "android_file_read", path: String(args.path) };
            }
          } else if (desktopActions.includes(action)) {
            if (isAndroidDaemon) return { result: "error", label: "Wrong daemon type", detail: `Action '${action}' is desktop-only. Use android_* actions for the connected Android daemon.` };
            if (!await isDaemonActionAllowed(userId2, action)) {
              return { result: "error", label: `Action '${action}' not permitted`, detail: `Enable '${action}' in Profile \u2192 Connected Channels \u2192 Desktop Daemon \u2192 Permissions.` };
            }
            if (action === "shell") {
              if (!args.cmd) return { result: "error", label: "cmd required", detail: "Provide cmd for shell action." };
              op = { type: "shell", cmd: String(args.cmd), cwd: args.cwd ? String(args.cwd) : void 0 };
            } else if (action === "notify") {
              op = { type: "notify", title: String(args.title || "Jarvis"), body: String(args.body || "") };
            } else if (action === "file_read") {
              if (!args.path) return { result: "error", label: "path required", detail: "Provide path for file_read." };
              op = { type: "file_read", path: String(args.path) };
            } else if (action === "file_write") {
              if (!args.path || typeof args.content !== "string") return { result: "error", label: "path+content required", detail: "Provide path and content for file_write." };
              op = { type: "file_write", path: String(args.path), content: String(args.content) };
            } else {
              if (!args.path) return { result: "error", label: "path required", detail: "Provide path for file_list." };
              op = { type: "file_list", path: String(args.path) };
            }
          } else {
            return { result: "error", label: "Unknown action", detail: `Unknown daemon action: ${action}` };
          }
          if (action.startsWith("android_") && action !== "android_notifications_list") {
            const preflightResult = await pingDaemon(userId2, 5e3);
            if (!preflightResult.ok) {
              return {
                result: "error",
                label: "\u26D4 Daemon is not responding",
                detail: `Daemon ping failed before '${action}' (${preflightResult.error}). The daemon is not responding \u2014 it may have been killed by Samsung battery optimisation, the accessibility service may have been disabled, or the phone may be locked. Tell the user: "The Jarvis Daemon isn't responding. Please open the Jarvis Daemon app on your phone to check the status dot and the Recent Activity log \u2014 if the accessibility service is disabled, tap Fix to re-enable it."`
              };
            }
          }
          const actionTimeouts = {
            android_read_screen: 8e3,
            android_tap: 6e3,
            android_swipe: 6e3,
            android_press_key: 5e3,
            android_type: 1e4,
            android_browse: 8e3,
            android_open_app: 15e3,
            android_screenshot: 15e3,
            android_notifications_list: 12e3,
            android_file_list: 8e3,
            android_file_read: 1e4,
            shell: 2e4,
            notify: 5e3,
            file_read: 1e4,
            file_write: 1e4,
            file_list: 8e3
          };
          const timeoutMs = actionTimeouts[action] ?? 12e3;
          const daemonResult = await sendDaemonOp(userId2, op, timeoutMs);
          if (!daemonResult.ok) return { result: "error", label: "Daemon action failed", detail: daemonResult.error || "Unknown error" };
          if (action === "android_screenshot" && daemonResult.data) {
            const data = daemonResult.data;
            const b64 = data.screenshot;
            if (b64 && b64.length > 0) {
              const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
              const buf = Buffer.from(b64, "base64");
              screenshotStore.set(id, { data: buf, expires: Date.now() + 30 * 60 * 1e3 });
              return { result: "success", label: "Screenshot captured", detail: JSON.stringify({ screenshotUrl: `/api/daemon/screenshot/${id}` }) };
            }
          }
          return { result: "success", label: `Daemon: ${action}`, detail: JSON.stringify(daemonResult.data || {}).slice(0, 2e3) };
        }
        case "daemon_diagnostic": {
          if (!isUserPaired(userId2)) {
            return { result: "error", label: "Daemon not connected", detail: "No daemon paired \u2014 cannot run diagnostic." };
          }
          const pingResult = await pingDaemon(userId2, 5e3);
          const auditEntries = getOpAuditLog(userId2);
          const recent = auditEntries.slice(-20).reverse();
          const recentStr = recent.length === 0 ? "No ops recorded yet." : recent.map((e) => {
            const d = new Date(e.ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
            return `[${d}] ${e.type} \u2192 ${e.ok ? "OK" : `FAIL: ${e.error}`} (${e.durationMs}ms)`;
          }).join("\n");
          const pingStr = pingResult.ok ? `ping OK \u2014 ${JSON.stringify(pingResult.data)}` : `ping FAILED \u2014 ${pingResult.error}`;
          return {
            result: pingResult.ok ? "success" : "error",
            label: pingResult.ok ? "Daemon alive" : "Daemon ping failed",
            detail: `${pingStr}

Recent op log (newest first):
${recentStr}`
          };
        }
        case "search_youtube": {
          const query = String(args.query || "").trim();
          if (!query) return { result: "error", label: "query required", detail: "Provide a search query." };
          const maxResults = Math.min(Math.max(typeof args.maxResults === "number" ? args.maxResults : 8, 1), 10);
          try {
            const searchResult = await ytSearch({ query, pageStart: 1, pageEnd: 1 });
            const videos = (searchResult.videos || []).slice(0, maxResults);
            if (videos.length === 0) return { result: "error", label: "No results", detail: `No YouTube videos found for: "${query}"` };
            const formatted = videos.map((v, i) => {
              const views = typeof v.views === "number" ? v.views.toLocaleString() : v.views || "unknown";
              const ago = v.ago || "unknown date";
              const duration = v.duration?.timestamp || v.duration || "unknown";
              return `${i + 1}. "${v.title}"
   Channel: ${v.author?.name || "unknown"}
   Views: ${views} | Posted: ${ago} | Duration: ${duration}
   Video ID: ${v.videoId}
   URL: ${v.url}`;
            }).join("\n\n");
            return {
              result: "success",
              label: `YouTube search: ${videos.length} results`,
              detail: `Search: "${query}"

${formatted}

To open a video on the phone: android_browse with url='vnd.youtube://watch?v=VIDEO_ID'
To get its transcript: fetch_youtube_transcript with videoId='VIDEO_ID'`
            };
          } catch (err) {
            return { result: "error", label: "YouTube search failed", detail: err?.message || String(err) };
          }
        }
        case "fetch_youtube_transcript": {
          const rawInput = String(args.videoId || "").trim();
          if (!rawInput) return { result: "error", label: "videoId required", detail: "Provide a YouTube video ID or URL." };
          let videoId = rawInput;
          const urlMatch = rawInput.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
          if (urlMatch) videoId = urlMatch[1];
          const idMatch = videoId.match(/^([a-zA-Z0-9_-]{11})/);
          if (idMatch) videoId = idMatch[1];
          try {
            const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId);
            if (!transcriptItems || transcriptItems.length === 0) {
              return { result: "error", label: "No transcript available", detail: `The video '${videoId}' does not have a transcript/captions enabled. This is common for music videos or videos where the creator disabled captions.` };
            }
            const fullText = transcriptItems.map((t) => t.text).join(" ").replace(/\s+/g, " ").trim();
            return { result: "success", label: "Transcript fetched", detail: `Video ID: ${videoId}
Transcript (${transcriptItems.length} segments, ${fullText.length} chars total):

${fullText}` };
          } catch (err) {
            const msg = err?.message || String(err);
            if (msg.includes("disabled") || msg.includes("Transcript is disabled")) {
              return { result: "error", label: "Transcript disabled", detail: `Transcripts are disabled for video '${videoId}'. Try a different video.` };
            }
            return { result: "error", label: "Transcript fetch failed", detail: msg };
          }
        }
        case "connect_channel": {
          const toolResult = await connectChannelTool.execute(args, { userId: userId2, state: {} });
          if (!toolResult.ok) {
            return { result: "error", label: toolResult.label || "Connection failed", detail: toolResult.content };
          }
          return { result: "success", label: toolResult.label || "Connect channel", detail: toolResult.detail || toolResult.content };
        }
        default:
          return { result: "error", label: "Unknown action", detail: `Unknown tool: ${toolName}` };
      }
    } catch (error) {
      console.error(`Error executing tool ${toolName}:`, error);
      return { result: "error", label: "Action failed", detail: String(error) };
    }
  }
  function normalizeMemoryContent(content) {
    return content.trim().toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ");
  }
  async function extractProfileInBackground(userId2, messages) {
    const recentMessages = messages.slice(-6);
    if (recentMessages.length === 0) return;
    const conversationText = recentMessages.map((m) => `${m.role}: ${m.content}`).join("\n");
    await extractAndStore({
      userId: userId2,
      source: conversationText,
      sourceType: "chat"
    });
  }
  async function markProactiveQuestionsAnswered(userId2, messages) {
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1e3);
      const unanswered = await db.select().from(proactiveQuestionsSent).where(
        and25(
          eq30(proactiveQuestionsSent.userId, userId2),
          sql16`${proactiveQuestionsSent.answeredAt} IS NULL`,
          sql16`${proactiveQuestionsSent.sentAt} > ${twentyFourHoursAgo}`
        )
      ).orderBy(desc10(proactiveQuestionsSent.sentAt)).limit(1);
      if (unanswered.length > 0) {
        const lastUserMessage = messages.filter((m) => m.role === "user").pop();
        if (!lastUserMessage?.content) return;
        const checkResponse = await openai12.chat.completions.create({
          model: "gpt-5-mini",
          messages: [{
            role: "user",
            content: `Is the following user message a reply to (or related to) this question? Only answer "yes" or "no".

Question that was asked: "${unanswered[0].question}"
User's message: "${lastUserMessage.content}"

Answer (yes/no):`
          }],
          max_completion_tokens: 10
        });
        const answer = (checkResponse.choices[0]?.message?.content || "").trim().toLowerCase();
        if (answer.startsWith("yes")) {
          await db.update(proactiveQuestionsSent).set({ answeredAt: /* @__PURE__ */ new Date() }).where(eq30(proactiveQuestionsSent.id, unanswered[0].id));
          console.log(`[Profile] Marked proactive question as answered via coach chat: ${unanswered[0].id}`);
        }
      }
    } catch (err) {
      console.error("[Profile] Error marking proactive question answered:", err);
    }
  }
  app2.post("/api/coach/chat", async (req, res) => {
    try {
      const { messages, goals: goals2, stats: stats2, history, calendarEvents, lifeContext: lifeContext2, gmailItems, gmailConnected, slackMessages, slackConnected, coachingMode, telegramMessages, telegramConnected } = req.body;
      const userId2 = req.userId;
      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: "messages array is required" });
      }
      let resolvedGmailConnected = gmailConnected ?? false;
      let resolvedGmailItems = gmailItems || [];
      if (!resolvedGmailConnected && userId2) {
        try {
          const userTokens = await getUserTokens(userId2, "google");
          if (userTokens.length > 0) {
            resolvedGmailConnected = true;
            const perAccountItems = await Promise.all(
              userTokens.map(async (t) => {
                const emails = await getRecentEmailCommitments(7, t.accessToken).catch(() => []);
                return emails.map((e) => ({ ...e, accountEmail: t.accountEmail }));
              })
            );
            resolvedGmailItems = perAccountItems.flat();
          }
        } catch {
        }
      }
      let userCommitments = [];
      if (userId2) {
        try {
          userCommitments = await db.select().from(commitments).where(and25(eq30(commitments.userId, userId2), eq30(commitments.status, "pending"))).orderBy(desc10(commitments.extractedAt)).limit(20);
        } catch {
        }
      }
      let memories = [];
      let morningNoteSummary = "";
      let documentsContext = "";
      if (userId2) {
        try {
          const [rows, noteSummary, docsCtx] = await Promise.all([
            db.select({ content: userMemories.content, category: userMemories.category }).from(userMemories).where(eq30(userMemories.userId, userId2)).orderBy(desc10(userMemories.extractedAt)).limit(50),
            getMorningNoteSummary(userId2),
            getUserDocumentContext(userId2)
          ]);
          memories = rows;
          morningNoteSummary = noteSummary;
          documentsContext = docsCtx;
        } catch {
        }
      }
      let proactiveQuestionContext = "";
      if (userId2) {
        try {
          const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1e3);
          const recentUnanswered = await db.select().from(proactiveQuestionsSent).where(
            and25(
              eq30(proactiveQuestionsSent.userId, userId2),
              sql16`${proactiveQuestionsSent.answeredAt} IS NULL`,
              sql16`${proactiveQuestionsSent.sentAt} > ${twentyFourHoursAgo}`
            )
          ).orderBy(desc10(proactiveQuestionsSent.sentAt)).limit(3);
          if (recentUnanswered.length > 0) {
            proactiveQuestionContext = `
## Recent Proactive Questions You Asked (unanswered)
You recently sent these curiosity-driven questions via Telegram. If the user's message seems to be answering one of them, acknowledge it warmly and ask a brief follow-up to learn more about them.
` + recentUnanswered.map((q) => `- "${q.question}"`).join("\n");
          }
        } catch {
        }
      }
      let crossChannelContext = "";
      if (userId2) {
        try {
          const recentInteractions = await getRecentInteractions(userId2, 20);
          crossChannelContext = formatInteractionTimeline(recentInteractions);
        } catch {
        }
      }
      const soulBlock = await getSoulPromptBlock(userId2);
      const daemonPaired = userId2 ? isUserPaired(userId2) : false;
      const [androidActive, daemonDeviceMeta] = daemonPaired && userId2 ? await Promise.all([isAndroidDaemonActive(userId2), getDaemonDeviceMeta(userId2)]) : [false, { hostname: null, platform: null }];
      const hostname = daemonDeviceMeta.hostname || "";
      const isSamsung = hostname.startsWith("SM-") || hostname.toLowerCase().includes("samsung");
      const deviceHints = androidActive ? [
        `Device: ${hostname || "unknown"}`,
        isSamsung ? "Samsung device \u2014 use these package names: Camera=com.sec.android.app.camera, Gallery=com.sec.android.apps.myfiles, Messages=com.samsung.android.messaging, Settings=com.android.settings, Chrome=com.android.chrome, Phone=com.samsung.android.dialer, Contacts=com.samsung.android.contacts, YouTube=com.google.android.youtube, Maps=com.google.android.apps.maps, Gmail=com.google.android.gm, Instagram=com.instagram.android, Spotify=com.spotify.music" : "",
        "For android_press_key, valid keys are ONLY: back, home, recents, volume_up, volume_down, enter \u2014 no KEYCODE_ prefix, no camera key.",
        "For taking a photo: open the camera app with android_open_app, use android_screenshot to verify it opened, then ask the user to tap the shutter themselves (or use android_tap with the shutter button coordinates from android_read_screen).",
        "CRITICAL: If any tool returns result:error, you MUST report that failure immediately. NEVER describe a failed action as successful or invent file names, screenshots, or results that were not in the tool response."
      ].filter(Boolean).join("\n") : "";
      const daemonSection = daemonPaired ? androidActive ? `Android Device Daemon is ACTIVE and connected.
${deviceHints}
Available daemon actions: android_open_app, android_browse, android_screenshot, android_read_screen, android_tap, android_type, android_swipe, android_press_key, android_wait, android_file_list, android_file_read, android_notifications_list, notify. DO NOT use desktop shell/file actions.
SEARCH SHORTCUTS \u2014 use android_browse with these deep links (opens native app directly to results): YouTube search \u2192 url='vnd.youtube://results?search_query=YOUR_QUERY', Google Maps \u2192 url='geo:0,0?q=YOUR_QUERY', Spotify \u2192 url='spotify:search:YOUR_QUERY'.
UI SETTLING \u2014 use android_wait (ms: 1500\u20133000) after tapping interactive elements that trigger loading (videos, pages, navigation) before calling android_read_screen. This prevents read_screen from seeing a blank or transitioning state.

YOUTUBE RESEARCH WORKFLOW \u2014 when the user asks to research something on YouTube, find a good video and summarize it:
  1. Call search_youtube (server-side) with the query. This returns results with channel name, views, date, and video ID \u2014 use this to pick a reputable, high-view-count, recent video without touching the phone at all.
  2. Call fetch_youtube_transcript with the chosen video ID \u2014 this fetches the COMPLETE transcript server-side with no truncation.
  3. Call android_browse with url='vnd.youtube://watch?v=VIDEO_ID' to open the video on the phone so the user can watch it.
  4. Summarize the transcript content for the user.
  5. Call notify as the final step (see NOTIFICATIONS below).
  NEVER navigate YouTube's transcript UI (3-dot menu, Show Transcript, scroll) \u2014 always use fetch_youtube_transcript.

NOTIFICATION \u2192 YOUTUBE VIDEO WORKFLOW \u2014 when the user asks you to open a specific video from their notifications:
  1. android_notifications_list \u2192 find the notification the user mentioned (match by channel name or partial title).
  2. Extract the YouTube URL from the notification if present. YouTube notification bodies often contain 'youtube.com/watch?v=VIDEO_ID' or the URL is in the intent data. Use android_browse url='vnd.youtube://watch?v=VIDEO_ID' with the exact extracted ID.
  3. If no URL in notification: use the EXACT video title from the notification as the query for search_youtube, pick the result whose title matches most closely, then open with android_browse url='vnd.youtube://watch?v=VIDEO_ID'.
  4. android_wait(3000) \u2192 android_screenshot \u2192 VISUALLY VERIFY the correct video title is on screen before proceeding. If the wrong video loaded, go back (android_press_key: back) and retry with a more specific search query or the exact title.
  5. NEVER open a search results page and assume the first result is the correct video \u2014 always verify the video title matches what the user asked for.

YOUTUBE APP SPATIAL LAYOUT (Galaxy Z Fold 6 cover screen, portrait) \u2014 use this as your mental map when navigating:
  SCREEN ZONES (top to bottom):
  \u2022 Video Player (top ~35% of screen): The video plays here. Tapping it toggles play/pause controls.
  \u2022 Title Zone (~35\u201345%): Video title text.
  \u2022 Channel Zone (~45\u201352%): Channel name + Subscribe button.
  \u2022 Action Row (~52\u201360%): Like | Dislike | Share | Download | Save | More (\u22EE) \u2014 horizontally arranged.
  \u2022 Comments Header (~60\u201368%): Shows 'Comments' with the count number (e.g. '1.2K Comments'). THIS IS THE TAP TARGET to open the full comment list.
  \u2022 Description / Recommended (below 68%): Partially visible, can scroll to reveal.

  READING COMMENTS STEP-BY-STEP:
  1. After video opens: android_wait(2500), then android_screenshot to see current state.
  2. Take note of whether comments are visible. They are NOT visible by default \u2014 they are below the fold.
  3. Scroll down: android_swipe from (x=450, y=1800) to (x=450, y=700) \u2014 this scrolls the page DOWN (reveals content below). Repeat 1\u20132 times if needed.
  4. android_wait(1000), android_screenshot to see if the Comments section is now visible.
  5. Look for 'Comments' text with a number \u2014 TAP at the exact (x, y) coordinate where that text appears.
  6. android_wait(1500), android_screenshot \u2014 the comments bottom sheet should now be open showing individual comment text.
  7. android_read_screen to extract the comment text you need.
  8. If the comments sheet did NOT open (video went fullscreen instead): android_press_key(back) to exit fullscreen, then retry the swipe from step 3.

  IMPORTANT COORDINATE NOTES:
  \u2022 The Z Fold 6 cover screen is approx 904px wide \xD7 2316px tall (full pixels, not dp). Swipe x-coordinates: use x=450 (center). Swipe y-coordinates: use values in the range 600\u20131900.
  \u2022 For SCROLLING DOWN in any app: swipe from high y (e.g. 1800) to low y (e.g. 700). This is a 'finger swipes up' gesture which scrolls content downward.
  \u2022 After every swipe or tap, ALWAYS android_wait(1000\u20131500) then android_screenshot before the next tap. This prevents mis-taps on transitioning screens.
  \u2022 If android_read_screen shows the comments but you need coordinates to tap a specific comment: estimate position from the screenshot \u2014 the first comment is usually near y=700\u2013900, second at y=1000\u20131200.

ACTION FLOW for multi-step tasks: Use as many tool-call turns as the task requires \u2014 there is no turn limit. For each step: (1) If unsure what is on screen, call android_read_screen first. (2) Act \u2014 call android_browse, android_tap, android_swipe, android_type, etc. as needed. (3) After acting, call android_read_screen to confirm the result, then decide the next step. Complete the FULL task end-to-end before responding \u2014 do NOT stop mid-task and ask the user to finish. NEVER re-open an app that is already on screen. NEVER describe app content without calling android_read_screen first. If an op returns result:error, tell the user what failed and what you tried.


CAMERA TASKS \u2014 android_screenshot WILL FAIL inside camera apps. Camera apps use FLAG_SECURE which blocks all external screenshot APIs including accessibility services. For any photo task: (1) android_open_app the camera package, (2) android_wait 2000ms to let it load, (3) android_read_screen to see the viewfinder UI and find the shutter button coordinates, (4) android_tap the shutter button, (5) android_wait 1500ms, (6) send notify success banner \u2014 do NOT call android_screenshot inside the camera, it will always fail. Trust the shutter tap succeeded and move on.

NOTIFICATIONS \u2014 ALWAYS send a notify banner at the end of every multi-step task, success OR failure:
- SUCCESS: notify with title:'Jarvis \u2713', body: one-line summary of what was done (e.g. "Playing Lo-Fi Hip Hop \u2014 2.1M views, posted 3 days ago")
- FAILURE: notify with title:'Jarvis \u2717', body: one-line summary of what went wrong (e.g. "Couldn't get transcript \u2014 captions disabled on this video")
This ensures the user always gets a phone banner and never waits silently for a task that already ended.` : "Desktop Daemon is ACTIVE. Use shell, notify, file_read, file_write, file_list actions. ALWAYS report errors immediately if a tool returns result:error. Use daemon_diagnostic (no args) to check daemon health before multi-step sequences or when ops are failing." : `\u26A0\uFE0F NO DAEMON CONNECTED. Do NOT call daemon_action \u2014 it will fail with "daemon not connected". If the user asks to control their phone or computer, tell them exactly this: "Your phone daemon isn't connected. To fix it: (1) Open the Jarvis app \u2192 Profile \u2192 scroll to 'Android Device' \u2192 tap 'Get Pairing Code', (2) Open the Jarvis Daemon APK on your phone, (3) Make sure the Server URL is https://GameplanAI.replit.app, (4) Enter the 8-character pairing code, (5) Tap Pair. The status dot should turn green within a few seconds." Do not attempt daemon_action until they confirm it's connected.`;
      const systemPrompt = buildCoachSystemPrompt(goals2 || [], stats2 || {}, history || [], calendarEvents || [], lifeContext2 || null, resolvedGmailItems, resolvedGmailConnected, slackMessages || [], slackConnected ?? false, userCommitments, coachingMode, memories, telegramMessages || [], telegramConnected ?? false, morningNoteSummary, documentsContext, crossChannelContext, soulBlock, daemonSection);
      const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
      const lastUserContent = typeof lastUserMsg?.content === "string" ? lastUserMsg.content.toLowerCase() : "";
      const deviceControlKeywords = [
        "screenshot",
        "screen shot",
        "screen capture",
        "open youtube",
        "open instagram",
        "open spotify",
        "open chrome",
        "open camera",
        "open settings",
        "open messages",
        "open gmail",
        "open maps",
        "open the app",
        "launch",
        "take a photo",
        "tap on",
        "tap the",
        "swipe",
        "read the screen",
        "what's on the screen",
        "what is on the screen",
        "what does the screen",
        "browse to",
        "android_",
        "navigate to",
        "type into",
        "open app",
        // notification keywords
        "notification",
        "notifications",
        "my notifications",
        "read my notification",
        "check notification",
        "show notification",
        "what notification",
        "any notification",
        "new notification",
        "recent notification",
        "latest notification",
        // general phone/device read actions
        "read my phone",
        "check my phone",
        "what is on my phone",
        "what's on my phone",
        "phone screen",
        "my screen",
        "my phone",
        // youtube / video intelligence
        "transcript",
        "summarize the video",
        "summarize that video",
        "what is the video about",
        "what's the video about",
        "give me a summary",
        "summarize what",
        "tell me what the video",
        "search youtube",
        "find a youtube",
        "look up on youtube",
        "research on youtube",
        "look something up",
        "look it up",
        "find a video",
        "find me a video"
      ];
      const isDeviceControlRequest = androidActive && deviceControlKeywords.some((k) => lastUserContent.includes(k));
      const daemonAbsoluteRule = androidActive ? `
\u26A0\uFE0F ABSOLUTE RULE \u2014 DEVICE CONTROL: You have ZERO physical ability to open apps, take screenshots, tap, swipe, type, or perform any action on the phone through text alone. The ONLY way ANY phone action can happen is by calling the daemon_action tool and receiving result:'success'. If daemon_action is not called, NOTHING happened on the phone. Prior conversation messages where you (the assistant) described performing phone actions without a daemon_action tool call were ERRORS \u2014 do not repeat that pattern. For EVERY phone action request, call daemon_action. Never write "I opened X" or "I took a screenshot" unless daemon_action returned result:'success' in this response.
` : "";
      const chatMessages = [
        { role: "system", content: daemonAbsoluteRule + systemPrompt + proactiveQuestionContext + "\n\nYou can take actions on the user's behalf using the available tools. When a user asks you to add a task, log progress, update their context, etc., use the appropriate tool. Respond naturally \u2014 do not mention 'tool calls' or 'functions' to the user. Just confirm what you did conversationally." + (process.env.TAVILY_API_KEY ? "\n\nYou also have a web_search tool. Use it whenever the user asks about current events, live data (weather, stock prices, sports scores, news), or anything requiring real-time information you wouldn't know. Cite your sources naturally in your response." : "") },
        ...messages.map((m) => ({ role: m.role, content: m.content }))
      ];
      const actionResults = [];
      let toolMessages = [];
      let clientDisconnected = false;
      let hasDaemonActions = false;
      req.on("close", () => {
        if (!res.writableEnded) clientDisconnected = true;
      });
      let keepaliveInterval = null;
      const startKeepalive = () => {
        if (keepaliveInterval) return;
        keepaliveInterval = setInterval(() => {
          if (!res.writableEnded && !res.destroyed) {
            try {
              res.write(": keepalive\n\n");
            } catch {
            }
          }
        }, 1e4);
      };
      const stopKeepalive2 = () => {
        if (keepaliveInterval) {
          clearInterval(keepaliveInterval);
          keepaliveInterval = null;
        }
      };
      req.on("close", stopKeepalive2);
      if (userId2) {
        const MAX_TOOL_TURNS = 20;
        let loopFinalText = null;
        for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
          const currentMessages = [
            ...chatMessages,
            ...toolMessages
          ];
          const phase1 = await openai12.chat.completions.create({
            model: "gpt-5-mini",
            messages: currentMessages,
            tools: coachTools,
            // Force a tool call on turn 0 for device-control requests.
            // Subsequent turns use "auto" so the model can stop and respond.
            tool_choice: turn === 0 && isDeviceControlRequest ? "required" : "auto",
            max_completion_tokens: 2048
          });
          const choice = phase1.choices[0];
          if (choice.finish_reason !== "tool_calls" || !choice.message.tool_calls?.length) {
            if (turn === 0 && choice.message.content) {
              const responseText = choice.message.content;
              const hallucIndicators = [
                "i've opened",
                "i opened",
                "i launched",
                "i took a screenshot",
                "i captured",
                "screenshot has been taken",
                "screenshot taken",
                "i've taken",
                "i tapped",
                "i swiped",
                "i typed",
                "here is the screenshot",
                "here's the screenshot",
                "here are your current android notifications",
                "here are your android notifications",
                "here are your notifications",
                "got it \u2014 here are your",
                "got it, here are your",
                "your current notifications",
                "your android notifications",
                "fetching your notifications",
                "i'll fetch your android",
                "i will fetch your android",
                "fetched your notifications"
              ];
              const hasRawToolCallBlob = androidActive && (responseText.includes('"name":"daemon_action"') || responseText.includes('"name": "daemon_action"') || responseText.includes("android_notifications_list") || responseText.includes("android_open_app") || responseText.includes("android_screenshot") || responseText.includes("android_tap") || responseText.includes("android_read_screen"));
              const looksHallucinated = androidActive && (hasRawToolCallBlob || hallucIndicators.some((h) => responseText.toLowerCase().includes(h)));
              if (looksHallucinated) {
                console.warn(`[daemon] HALLUCINATION DETECTED userId=${userId2} \u2014 model claimed device action without tool call. Intercepting.`);
                const correctedResponse = "I wasn't able to perform that action on your phone \u2014 I need to call the phone tool to do that, and it didn't get called this time. Please try again and I'll make sure to actually execute the command.";
                res.setHeader("Content-Type", "text/event-stream");
                res.setHeader("Cache-Control", "no-cache, no-transform");
                res.setHeader("X-Accel-Buffering", "no");
                res.setHeader("Access-Control-Allow-Origin", "*");
                res.flushHeaders();
                res.write(`data: ${JSON.stringify({ content: correctedResponse })}

`);
                res.write("data: [DONE]\n\n");
                res.end();
                return;
              }
              res.setHeader("Content-Type", "text/event-stream");
              res.setHeader("Cache-Control", "no-cache, no-transform");
              res.setHeader("X-Accel-Buffering", "no");
              res.setHeader("Access-Control-Allow-Origin", "*");
              res.flushHeaders();
              res.write(`data: ${JSON.stringify({ content: responseText })}

`);
              res.write("data: [DONE]\n\n");
              res.end();
              extractProfileInBackground(userId2, messages);
              markProactiveQuestionsAnswered(userId2, messages).catch(() => {
              });
              const lastUserMsg0 = [...messages].reverse().find((m) => m.role === "user");
              if (lastUserMsg0?.content) logInteraction(userId2, "app_chat", "inbound", typeof lastUserMsg0.content === "string" ? lastUserMsg0.content : JSON.stringify(lastUserMsg0.content)).catch(() => {
              });
              logInteraction(userId2, "app_chat", "outbound", responseText).catch(() => {
              });
              return;
            }
            if (choice.message.content) loopFinalText = choice.message.content;
            break;
          }
          toolMessages.push(choice.message);
          const hasWebSearch = choice.message.tool_calls.some((tc) => tc.function.name === "web_search");
          if (hasWebSearch && !res.headersSent) {
            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("Cache-Control", "no-cache, no-transform");
            res.setHeader("X-Accel-Buffering", "no");
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.flushHeaders();
            res.write(`data: ${JSON.stringify({ type: "searching" })}

`);
          }
          for (const tc of choice.message.tool_calls) {
            let args = {};
            try {
              args = JSON.parse(tc.function.arguments);
            } catch {
            }
            const isHighStakes = tc.function.name === "send_email" || tc.function.name === "daemon_action" && ["shell", "file_write"].includes(String(args.action || ""));
            if (isHighStakes) {
              if (!res.headersSent) {
                res.setHeader("Content-Type", "text/event-stream");
                res.setHeader("Cache-Control", "no-cache, no-transform");
                res.setHeader("X-Accel-Buffering", "no");
                res.setHeader("Access-Control-Allow-Origin", "*");
                res.flushHeaders();
              }
              const preview = {};
              if (tc.function.name === "send_email") {
                preview.to = String(args.to || "");
                preview.subject = String(args.subject || "");
                preview.body = String(args.body || "");
                preview.provider = String(args.provider || "google");
              } else {
                preview.action = String(args.action || "");
                if (args.cmd) preview.cmd = String(args.cmd);
                if (args.path) preview.path = String(args.path);
                if (args.content) preview.content = String(args.content).slice(0, 200);
              }
              const confirmToken = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
              pendingConfirmations.set(confirmToken, {
                userId: userId2,
                tool: tc.function.name,
                args,
                expiresAt: Date.now() + 5 * 60 * 1e3
              });
              res.write(`data: ${JSON.stringify({ type: "confirm_required", token: confirmToken, tool: tc.function.name, preview })}

`);
              res.write("data: [DONE]\n\n");
              res.end();
              return;
            }
            if (tc.function.name === "daemon_action") {
              hasDaemonActions = true;
              if (!res.headersSent) {
                res.setHeader("Content-Type", "text/event-stream");
                res.setHeader("Cache-Control", "no-cache, no-transform");
                res.setHeader("X-Accel-Buffering", "no");
                res.setHeader("Access-Control-Allow-Origin", "*");
                res.flushHeaders();
              }
              const actionLabel = {
                android_browse: "Opening app on your phone...",
                android_open_app: "Launching app on your phone...",
                android_read_screen: "Reading your phone screen...",
                android_tap: "Tapping the screen...",
                android_swipe: "Scrolling...",
                android_type: "Typing on your phone...",
                android_screenshot: "Taking screenshot...",
                android_press_key: "Pressing key...",
                android_notifications_list: "Checking notifications...",
                notify: "Sending you a notification..."
              };
              const workingMsg = actionLabel[String(args.action || "")] || "Working on your phone...";
              res.write(`data: ${JSON.stringify({ type: "working", message: workingMsg })}

`);
              startKeepalive();
            }
            const execResult = await executeCoachTool(tc.function.name, args, userId2);
            let linkData = {};
            if ((tc.function.name === "generate_reconnect_link" || tc.function.name === "connect_channel") && execResult.result === "success") {
              try {
                linkData = JSON.parse(execResult.detail);
              } catch {
              }
            }
            if (tc.function.name === "daemon_action" && String(args.action) === "android_screenshot" && execResult.result === "success") {
              try {
                const parsed = JSON.parse(execResult.detail);
                if (parsed.screenshotUrl) linkData.screenshotUrl = parsed.screenshotUrl;
              } catch {
              }
            }
            actionResults.push({ tool: tc.function.name, result: execResult.result, label: execResult.label, ...linkData });
            let toolResultContent;
            if (tc.function.name === "daemon_action" && execResult.result === "error") {
              toolResultContent = `\u26D4 DAEMON ACTION FAILED \u2014 THE PHONE DID NOT EXECUTE THIS COMMAND.
Action attempted: ${String(args.action || "unknown")}
Error: ${execResult.detail || execResult.label}

You MUST tell the user this specific action FAILED. Do NOT describe it as successful. Do NOT invent what the phone showed or did.`;
            } else {
              toolResultContent = JSON.stringify({ result: execResult.result, detail: execResult.detail });
            }
            toolMessages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: toolResultContent
            });
          }
        }
        if (loopFinalText) {
          if (!res.headersSent) {
            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("Cache-Control", "no-cache, no-transform");
            res.setHeader("X-Accel-Buffering", "no");
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.flushHeaders();
          }
          if (actionResults.length > 0) {
            const nonSearchActions = actionResults.filter((a) => a.tool !== "web_search");
            if (nonSearchActions.length > 0) res.write(`data: ${JSON.stringify({ type: "actions", actions: nonSearchActions })}

`);
          }
          stopKeepalive2();
          if (hasDaemonActions && userId2) {
            savePendingResponse(userId2, loopFinalText).catch(() => {
            });
          }
          res.write(`data: ${JSON.stringify({ content: loopFinalText })}

`);
          res.write("data: [DONE]\n\n");
          res.end();
          extractProfileInBackground(userId2, messages);
          markProactiveQuestionsAnswered(userId2, messages).catch(() => {
          });
          const lastUserMsgLoop = [...messages].reverse().find((m) => m.role === "user");
          if (lastUserMsgLoop?.content) logInteraction(userId2, "app_chat", "inbound", typeof lastUserMsgLoop.content === "string" ? lastUserMsgLoop.content : JSON.stringify(lastUserMsgLoop.content)).catch(() => {
          });
          logInteraction(userId2, "app_chat", "outbound", loopFinalText).catch(() => {
          });
          return;
        }
      }
      if (!res.headersSent) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("X-Accel-Buffering", "no");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.flushHeaders();
      }
      if (actionResults.length > 0) {
        const nonSearchActions = actionResults.filter((a) => a.tool !== "web_search");
        if (nonSearchActions.length > 0) {
          res.write(`data: ${JSON.stringify({ type: "actions", actions: nonSearchActions })}

`);
        }
      }
      const failedDaemonActions = actionResults.filter((a) => a.tool === "daemon_action" && a.result === "error");
      if (failedDaemonActions.length > 0) {
        toolMessages.push({
          role: "user",
          content: `\u26D4 CORRECTION REQUIRED: ${failedDaemonActions.length} phone action(s) just FAILED (see the \u26D4 DAEMON ACTION FAILED messages above). Do NOT claim any of those actions succeeded. Do NOT invent search results, app content, or what the phone showed. Report exactly which action failed and why, then offer to retry or suggest an alternative. Failed actions:
${failedDaemonActions.map((a) => `- ${a.label}: ${a.result}`).join("\n")}`
        });
      }
      const streamMessages = toolMessages.length > 0 ? [...chatMessages, ...toolMessages] : chatMessages;
      const stream = await openai12.chat.completions.create({
        model: "gpt-5-mini",
        messages: streamMessages,
        stream: true,
        max_completion_tokens: 8192
      });
      stopKeepalive2();
      let fullStreamedReply = "";
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) {
          fullStreamedReply += content;
          if (!clientDisconnected) {
            try {
              res.write(`data: ${JSON.stringify({ content })}

`);
            } catch {
            }
          }
        }
      }
      if (hasDaemonActions && userId2 && fullStreamedReply) {
        savePendingResponse(userId2, fullStreamedReply).catch(() => {
        });
      }
      if (!clientDisconnected) {
        res.write("data: [DONE]\n\n");
        res.end();
      }
      if (userId2) {
        extractProfileInBackground(userId2, messages);
        markProactiveQuestionsAnswered(userId2, messages).catch(() => {
        });
        const lastUserMsg2 = [...messages].reverse().find((m) => m.role === "user");
        if (lastUserMsg2?.content) logInteraction(userId2, "app_chat", "inbound", typeof lastUserMsg2.content === "string" ? lastUserMsg2.content : JSON.stringify(lastUserMsg2.content)).catch(() => {
        });
        if (fullStreamedReply) logInteraction(userId2, "app_chat", "outbound", fullStreamedReply).catch(() => {
        });
      }
    } catch (error) {
      stopKeepalive();
      console.error("Error in coach chat:", error);
      if (userId && isUserPaired(userId)) {
        sendDaemonOp(userId, {
          type: "notify",
          title: "Jarvis \u2717 Task failed",
          body: "Something went wrong \u2014 check the app for details and try again."
        }, 5e3).catch(() => {
        });
      }
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to get coach response" });
      } else {
        res.write(`data: ${JSON.stringify({ error: "Stream interrupted" })}

`);
        res.end();
      }
    }
  });
  app2.post("/api/coach/execute-confirmed", async (req, res) => {
    try {
      const { token } = req.body;
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Unauthorized" });
      if (!token) return res.status(400).json({ error: "token is required" });
      const pending = pendingConfirmations.get(token);
      if (!pending) return res.status(400).json({ error: "Confirmation token not found or expired" });
      if (pending.userId !== userId2) return res.status(403).json({ error: "Token does not belong to this user" });
      if (pending.expiresAt < Date.now()) {
        pendingConfirmations.delete(token);
        return res.status(400).json({ error: "Confirmation token has expired" });
      }
      pendingConfirmations.delete(token);
      const execResult = await executeCoachTool(pending.tool, pending.args, userId2);
      return res.json({ result: execResult.result, label: execResult.label, detail: execResult.detail });
    } catch (error) {
      console.error("Error in execute-confirmed:", error);
      return res.status(500).json({ error: "Failed to execute confirmed action" });
    }
  });
  app2.post("/api/coach/decline-action", async (req, res) => {
    try {
      const { token } = req.body;
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Unauthorized" });
      let tool = "unknown";
      let preview = {};
      if (token) {
        const pending = pendingConfirmations.get(token);
        if (pending && pending.userId === userId2) {
          tool = pending.tool;
          const a = pending.args;
          if (tool === "send_email") preview = { to: a.to || "", subject: a.subject || "" };
          else preview = { action: a.action || "", cmd: a.cmd || "", path: a.path || "" };
          pendingConfirmations.delete(token);
        }
      }
      const toolLabel = tool === "send_email" ? `sending an email to ${preview.to || "the recipient"}` : `running a terminal command (${preview.cmd || preview.action || "shell"})`;
      const prompt = `The user has just declined an action you proposed. You were about to ${toolLabel} but they cancelled. Acknowledge briefly and naturally in one sentence \u2014 do not re-propose the action. Stay in your coaching persona.`;
      const resp = await openai12.chat.completions.create({
        model: "gpt-5-mini",
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: 80
      });
      const content = resp.choices[0]?.message?.content || "Got it \u2014 I won't proceed with that action.";
      return res.json({ content });
    } catch (error) {
      console.error("Error in decline-action:", error);
      return res.json({ content: "Got it \u2014 I'll leave that for now." });
    }
  });
  app2.post("/api/coach/suggestions", async (req, res) => {
    try {
      const { lastAssistantMessage, goals: goals2, coachingMode } = req.body;
      if (!lastAssistantMessage) {
        return res.json({ actions: [], followups: [] });
      }
      const prompt = `Analyze this coaching message and extract structured suggestions.

Coaching message:
"${lastAssistantMessage}"

User's active goals:
${(goals2 || []).map((g) => `- ${g.title} (${g.category})`).join("\n") || "None set"}

Return a JSON object with:
1. "actions": array of 0-2 actionable suggestions. Three action types are supported:
   - { "type": "task", "title": string (verb phrase), "category": "fitness"/"finance"/"career"/"personal"/"social", "priority": "high"/"medium"/"low", "description": one-line context }
   - { "type": "goal", "title": string, "category": "fitness"/"finance"/"career"/"personal"/"social", "description": one-line context }
   - { "type": "link", "title": string, "buttonLabel": string (short CTA \u22644 words), "url": string (use "profile://connections" to open connection settings, or a full https:// URL), "category": "personal" } \u2014 Use ONLY when the message explicitly suggests connecting/reconnecting Google, Microsoft, Outlook, or Gmail.
   Only include actions that are specific and actionable. Return empty array for purely conversational messages.
2. "followups": array of exactly 3 short follow-up questions (max 7 words each) the user would naturally ask next.

Return ONLY the JSON object.`;
      const response = await openai12.chat.completions.create({
        model: "gpt-5-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_completion_tokens: 600
      });
      const content = response.choices[0]?.message?.content || '{"actions":[],"followups":[]}';
      try {
        const parsed = JSON.parse(content);
        res.json({
          actions: Array.isArray(parsed.actions) ? parsed.actions.slice(0, 2) : [],
          followups: Array.isArray(parsed.followups) ? parsed.followups.slice(0, 3) : []
        });
      } catch {
        res.json({ actions: [], followups: [] });
      }
    } catch (error) {
      console.error("Error generating suggestions:", error);
      res.json({ actions: [], followups: [] });
    }
  });
  app2.post("/api/ai/parse-brain-dump", async (req, res) => {
    try {
      const { text: text2 } = req.body;
      if (!text2?.trim()) {
        return res.json({ tasks: [] });
      }
      const prompt = `You are a productivity assistant helping organize a brain dump into actionable tasks.

Brain dump text: "${text2.trim()}"

Read the text above and identify each distinct action item or topic. Different subjects become different tasks. If one task has multiple steps, list them as subtasks.

For each task provide:
- title: concise action phrase starting with a verb
- description: one sentence of context (or null if title is self-explanatory)
- priority: "high", "medium", or "low"
- category: one of "personal", "career", "finance", "fitness", "social"
- subtasks: array of short action strings (empty array if not needed)

Return ONLY a JSON object with a "tasks" array. No other text.`;
      const response = await openai12.chat.completions.create({
        model: "gpt-5-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_completion_tokens: 8192
      });
      const content = response.choices[0]?.message?.content || '{"tasks":[]}';
      try {
        const parsed = JSON.parse(content);
        const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
        res.json({ tasks });
      } catch {
        res.json({ tasks: [] });
      }
    } catch (error) {
      console.error("Error parsing brain dump:", error);
      res.json({ tasks: [] });
    }
  });
  app2.post("/api/coach/checkin", async (req, res) => {
    try {
      const { goals: goals2, stats: stats2, history, lifeContext: lifeContext2, coachingMode } = req.body;
      const userId2 = req.userId;
      const completedHistory = (history || []).filter((h) => h.completed);
      const skippedHistory = (history || []).filter((h) => !h.completed);
      const completionRate = history?.length > 0 ? Math.round(completedHistory.length / history.length * 100) : 0;
      const goalsText = (goals2 || []).length > 0 ? goals2.map((g) => `${g.title}: ${g.current}/${g.target} ${g.unit}`).join(", ") : "no goals set";
      const lifeCtxText = lifeContext2 ? `
- Priority: ${lifeContext2.priorityGoal || "not set"}` + (lifeContext2.currentBlocker ? `
- Known blocker: ${lifeContext2.currentBlocker}` : "") + (lifeContext2.improvementArea ? `
- Wants to improve: ${lifeContext2.improvementArea}` : "") : "";
      let commitmentText = "";
      if (userId2) {
        try {
          const pendingCommitments = await db.select().from(commitments).where(and25(eq30(commitments.userId, userId2), eq30(commitments.status, "pending"))).limit(5);
          if (pendingCommitments.length > 0) {
            commitmentText = `
- Open commitments: ${pendingCommitments.map((c) => `"${c.content}"${c.dueDate ? ` (due ${c.dueDate})` : ""}`).join(", ")}`;
          }
        } catch {
        }
      }
      const persona = getPersonaBlock(coachingMode);
      const prompt = `You are a personal productivity coach. Write a 1-2 sentence daily coaching note for this person.

${persona}

Their profile:
- Streak: ${stats2?.streak || 0} days, ${completionRate}% task completion this week
- Goals: ${goalsText}
- Recently completed: ${completedHistory.slice(0, 4).map((h) => h.title).join(", ") || "nothing yet"}
- Recently skipped: ${skippedHistory.slice(0, 3).map((h) => h.title).join(", ") || "nothing"}${lifeCtxText}${commitmentText}

Write ONE short, specific coaching observation. Be direct \u2014 name what's working or what to fix. If they have a clear priority or blocker, reference it specifically. If they have open commitments, call out specific ones by name. No greeting, no sign-off.

Return JSON: { "note": "your 1-2 sentence note here" }`;
      const response = await openai12.chat.completions.create({
        model: "gpt-5-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_completion_tokens: 200
      });
      const content = response.choices[0]?.message?.content || '{"note":""}';
      try {
        const parsed = JSON.parse(content);
        res.json({ note: parsed.note || "" });
      } catch {
        res.json({ note: "" });
      }
    } catch (error) {
      console.error("Error generating check-in:", error);
      res.json({ note: "" });
    }
  });
  app2.get("/api/calendar/status", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.json({ google: false, outlook: false });
      const [googleTokens, microsoftToken] = await Promise.all([
        getValidGoogleTokens(userId2),
        getValidMicrosoftToken(userId2)
      ]);
      let googleConnected = googleTokens.length > 0;
      let outlookConnected = !!microsoftToken;
      if (!googleConnected || !outlookConnected) {
        const isOwner = await isIntegrationOwner(userId2);
        if (isOwner) {
          const [projGoogle, projOutlook] = await Promise.all([
            googleConnected ? true : checkGoogleCalendarConnection(),
            outlookConnected ? true : checkOutlookConnection()
          ]);
          googleConnected = googleConnected || projGoogle;
          outlookConnected = outlookConnected || projOutlook;
          if (projGoogle || projOutlook) await claimIntegrationOwnership(userId2);
        }
      }
      res.json({ google: googleConnected, outlook: outlookConnected });
    } catch (error) {
      console.error("Error checking calendar status:", error);
      res.json({ google: false, outlook: false });
    }
  });
  app2.get("/api/calendar/google/events", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.json({ connected: false, events: [] });
      const accessTokens = await getValidGoogleTokens(userId2);
      let hasIntegration = false;
      if (accessTokens.length === 0) {
        if (!await isIntegrationOwner(userId2)) return res.json({ connected: false, events: [] });
        hasIntegration = true;
      }
      const date2 = req.query.date || (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
      const startTime = req.query.startTime;
      const endTime = req.query.endTime;
      const tokensToFetch = accessTokens.length > 0 ? accessTokens : [void 0];
      const allEvents = await Promise.all(
        tokensToFetch.map(
          (token) => getGoogleCalendarEvents(date2, startTime, endTime, token).catch(() => [])
        )
      );
      const events = allEvents.flat();
      res.json({ connected: true, events });
    } catch (error) {
      console.error("Error fetching Google Calendar events:", error);
      if (error.message?.includes("not connected")) return res.json({ connected: false, events: [] });
      res.json({ connected: true, events: [] });
    }
  });
  app2.get("/api/calendar/outlook/events", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.json({ connected: false, events: [] });
      let accessToken = await getValidMicrosoftToken(userId2);
      if (!accessToken) {
        if (!await isIntegrationOwner(userId2)) return res.json({ connected: false, events: [] });
      }
      const date2 = req.query.date || (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
      const startTime = req.query.startTime;
      const endTime = req.query.endTime;
      const events = await getOutlookCalendarEvents(date2, startTime, endTime, accessToken);
      res.json({ connected: true, events });
    } catch (error) {
      console.error("Error fetching Outlook events:", error);
      if (error.message?.includes("not connected")) return res.json({ connected: false, events: [] });
      res.json({ connected: true, events: [] });
    }
  });
  app2.get("/api/gmail/status", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.json({ connected: false });
      const googleTokens = await getValidGoogleTokens(userId2);
      if (googleTokens.length > 0) return res.json({ connected: true });
      const isOwner = await isIntegrationOwner(userId2);
      if (!isOwner) return res.json({ connected: false });
      const connected = await checkGmailConnection();
      if (connected) await claimIntegrationOwnership(userId2);
      res.json({ connected });
    } catch (error) {
      console.error("Error checking Gmail status:", error);
      res.json({ connected: false });
    }
  });
  app2.get("/api/gmail/commitments", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.json({ connected: false, items: [] });
      const userTokens = await getUserTokens(userId2, "google");
      if (userTokens.length === 0) {
        if (!await isIntegrationOwner(userId2)) return res.json({ connected: false, items: [] });
        const connected = await checkGmailConnection();
        if (!connected) return res.json({ connected: false, items: [] });
        const items = await getRecentEmailCommitments(7, void 0);
        return res.json({ connected: true, items });
      }
      const perAccountItems = await Promise.all(
        userTokens.map(async (t) => {
          const emails = await getRecentEmailCommitments(7, t.accessToken).catch(() => []);
          return emails.map((e) => ({ ...e, accountEmail: t.accountEmail }));
        })
      );
      const interleaved = [];
      const maxLen = Math.max(...perAccountItems.map((a) => a.length));
      for (let i = 0; i < maxLen; i++) {
        for (const account of perAccountItems) {
          if (i < account.length) interleaved.push(account[i]);
        }
      }
      res.json({ connected: true, items: interleaved });
    } catch (error) {
      console.error("Error fetching Gmail commitments:", error);
      res.json({ connected: false, items: [] });
    }
  });
  app2.post("/api/gmail/scan-for-tasks", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.json({ suggestions: [] });
      const { goals: goals2 } = req.body;
      if (!goals2 || !Array.isArray(goals2) || goals2.length === 0) {
        return res.json({ suggestions: [] });
      }
      const userTokens = await getUserTokens(userId2, "google");
      let allEmails = [];
      if (userTokens.length === 0) {
        if (!await isIntegrationOwner(userId2)) return res.json({ suggestions: [] });
        const connected = await checkGmailConnection();
        if (!connected) return res.json({ suggestions: [] });
        const items = await getRecentEmailCommitments(7, void 0);
        allEmails = items;
      } else {
        const perAccountItems = await Promise.all(
          userTokens.map(async (t) => {
            const emails = await getRecentEmailCommitments(7, t.accessToken).catch(() => []);
            return emails.map((e) => ({ ...e, accountEmail: t.accountEmail }));
          })
        );
        allEmails = perAccountItems.flat();
      }
      if (allEmails.length === 0) {
        return res.json({ suggestions: [] });
      }
      const goalsText = goals2.map((g) => `- ${g.title} (${g.category}): ${g.current}/${g.target} ${g.unit}`).join("\n");
      const emailsText = allEmails.slice(0, 30).map((e) => {
        const acct = e.accountEmail ? ` [Account: ${e.accountEmail}]` : "";
        const labels = e.labels ? ` [Labels: ${e.labels.join(", ")}]` : "";
        return `- From: ${e.from || "unknown"}${acct}${labels} | Subject: "${e.subject}" | Snippet: ${e.snippet}`;
      }).join("\n");
      const prompt = `You are a productivity assistant. Given the user's goals and recent emails, identify 3\u20135 specific tasks they should do. Prioritise emails that are Starred, Important, or from real people (not newsletters/promotions).

Goals:
${goalsText}

Recent emails (last 7 days):
${emailsText}

Return JSON:
{ "suggestions": [
  {
    "title": "action-verb task title (concise)",
    "emailSubject": "email that triggered this",
    "emailFrom": "sender",
    "accountEmail": "which Gmail account",
    "goalTitle": "which goal this serves (or 'General' if no specific goal)",
    "reason": "one sentence why this task matters"
  }
]}
Only return the JSON object, no extra text.`;
      const response = await openai12.chat.completions.create({
        model: "gpt-5-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_completion_tokens: 1e3
      });
      const content = response.choices[0]?.message?.content || '{"suggestions":[]}';
      try {
        const parsed = JSON.parse(content);
        const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 5) : [];
        res.json({ suggestions });
      } catch {
        res.json({ suggestions: [] });
      }
    } catch (error) {
      console.error("Error scanning emails for tasks:", error);
      res.json({ suggestions: [] });
    }
  });
  app2.post("/api/gmail/create-draft", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const { to, subject, body, accountEmail } = req.body;
      if (!to || !subject || !body) {
        return res.status(400).json({ error: "to, subject, and body are required" });
      }
      const userTokens = await getUserTokens(userId2, "google");
      if (userTokens.length === 0) {
        return res.status(400).json({ error: "no_google_account", message: "Connect your Google account in Profile to enable drafting" });
      }
      let token;
      if (accountEmail) {
        token = userTokens.find((t) => t.accountEmail === accountEmail);
      }
      if (!token) {
        const composeTokens = userTokens.filter((t) => t.scopes?.includes("gmail.compose")).sort((a, b) => (a.accountEmail ?? "").localeCompare(b.accountEmail ?? ""));
        token = composeTokens[0];
      }
      if (!token) {
        token = userTokens[0];
      }
      if (!token.scopes?.includes("gmail.compose")) {
        return res.json({ error: "reconnect_required", message: "Reconnect your Google account to enable drafting" });
      }
      let accessToken = token.accessToken;
      if (token.expiresAt && token.expiresAt.getTime() < Date.now() + 6e4) {
        const { refreshGoogleToken: refreshGoogleToken2 } = await Promise.resolve().then(() => (init_userTokenStore(), userTokenStore_exports));
        const refreshed = await refreshGoogleToken2(token);
        if (!refreshed) {
          return res.json({ error: "reconnect_required", message: "Your Google token has expired. Please reconnect in Profile." });
        }
        accessToken = refreshed.accessToken;
      }
      const result = await createGmailDraft(accessToken, to, subject, body);
      res.json(result);
    } catch (error) {
      console.error("Error creating Gmail draft:", error);
      res.status(500).json({ error: "Failed to create draft" });
    }
  });
  app2.get("/api/slack/status", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.json({ slack: false });
      const token = await getUserToken(userId2, "slack");
      res.json({ slack: !!token });
    } catch (error) {
      console.error("Error checking Slack status:", error);
      res.json({ slack: false });
    }
  });
  app2.get("/api/slack/messages", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.json({ connected: false, messages: [] });
      const token = await getUserToken(userId2, "slack");
      if (!token) return res.json({ connected: false, messages: [] });
      const messages = await getSlackMessages(token.accessToken);
      res.json({ connected: true, messages });
    } catch (error) {
      console.error("Error fetching Slack messages:", error);
      res.json({ connected: false, messages: [] });
    }
  });
  app2.post("/api/notifications/morning-brief", async (req, res) => {
    try {
      const { tasks, calendarEvents, goals: goals2, stats: stats2, energyLevel } = req.body;
      if (typeof energyLevel !== "number" || energyLevel < 1 || energyLevel > 5) {
        return res.status(400).json({ error: "energyLevel must be a number between 1 and 5" });
      }
      const taskList = Array.isArray(tasks) ? tasks : [];
      const eventList = Array.isArray(calendarEvents) ? calendarEvents : [];
      const goalList = Array.isArray(goals2) ? goals2 : [];
      const tasksText = taskList.length > 0 ? taskList.map((t) => `- [${t.priority || "medium"}] ${t.title}${t.description ? ": " + t.description : ""} (id: ${t.id})`).join("\n") : "No tasks planned yet";
      const eventsText = eventList.length > 0 ? eventList.slice(0, 8).map((e) => `- ${e.time ? e.time + ": " : ""}${e.title}`).join("\n") : "No events today";
      const goalsText = goalList.length > 0 ? goalList.map((g) => `- ${g.title} (${g.category}): ${g.current}/${g.target} ${g.unit}`).join("\n") : "No goals set";
      const energyDescriptions = {
        1: "Dead \u2014 barely functional",
        2: "Low \u2014 limited capacity",
        3: "Okay \u2014 moderate capacity",
        4: "Good \u2014 solid capacity",
        5: "On Fire \u2014 peak capacity"
      };
      const orderingGuidance = energyLevel >= 4 ? "High energy: put the hardest/most important task first. Front-load cognitively demanding work." : energyLevel === 3 ? "Medium energy: start with a quick win for momentum, then the most important task, then a medium one." : "Low energy: put the easiest tasks first. Defer anything cognitively heavy. Protect their time.";
      const prompt = `You are a productivity coach for someone with ADHD. Given their energy level and tasks, generate a morning briefing card and optimal task order using Atomic Habits principles (momentum-building).

Energy level: ${energyLevel}/5 (${energyDescriptions[energyLevel]})

Today's tasks:
${tasksText}

Today's calendar:
${eventsText}

Goals:
${goalsText}

Stats: streak ${stats2?.streak || 0} days, ${stats2?.totalCompleted || 0} tasks completed total

Ordering strategy: ${orderingGuidance}

Return JSON with:
{
  "headline": "1 punchy sentence based on energy (max 8 words). Examples: 'You're on fire today' or 'Easy does it today'",
  "suggestion": "1 sentence of specific advice referencing their actual tasks",
  "taskOrder": ["task id 1", "task id 2", "task id 3"]
}

taskOrder: Return up to 3 task IDs from the task list above, reordered optimally for this energy level. Only include IDs that appear in the task list. Prioritise momentum-building.

Return ONLY the JSON object.`;
      const response = await openai12.chat.completions.create({
        model: "gpt-5-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_completion_tokens: 300
      });
      const content = response.choices[0]?.message?.content || "{}";
      try {
        const parsed = JSON.parse(content);
        res.json({
          title: "Good morning! \u{1F3AF}",
          body: "Set your energy level and plan your day.",
          card: {
            headline: parsed.headline || (energyLevel >= 4 ? "You're on fire today" : energyLevel <= 2 ? "Easy does it today" : "Steady day ahead"),
            suggestion: parsed.suggestion || "Start with something small to build momentum.",
            taskOrder: Array.isArray(parsed.taskOrder) ? parsed.taskOrder.slice(0, 3) : []
          }
        });
      } catch {
        res.json({
          title: "Good morning! \u{1F3AF}",
          body: "Set your energy level and plan your day.",
          card: {
            headline: energyLevel >= 4 ? "You're on fire today" : energyLevel <= 2 ? "Easy does it today" : "Steady day ahead",
            suggestion: "Start with something small to build momentum.",
            taskOrder: []
          }
        });
      }
    } catch (error) {
      console.error("Error generating morning brief:", error);
      res.status(500).json({ error: "Failed to generate morning brief" });
    }
  });
  app2.post("/api/coach/transcribe", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const { audio } = req.body;
      if (!audio || typeof audio !== "string") {
        return res.status(400).json({ error: "audio (base64) is required" });
      }
      const { speechToText: speechToText2, detectAudioFormat: detectAudioFormat2 } = await Promise.resolve().then(() => (init_client(), client_exports));
      const rawBuffer = Buffer.from(audio, "base64");
      const format = detectAudioFormat2(rawBuffer);
      const text2 = await speechToText2(rawBuffer, format);
      res.json({ text: text2 });
    } catch (error) {
      console.error("Error transcribing audio:", error);
      res.status(500).json({ error: "Failed to transcribe audio" });
    }
  });
  app2.post("/api/coach/speak", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const { text: text2, voice } = req.body;
      if (!text2 || typeof text2 !== "string") {
        return res.status(400).json({ error: "text is required" });
      }
      let trimmedText = text2.slice(0, 4e3);
      if (text2.length > 4e3) {
        const lastSentence = trimmedText.lastIndexOf(".");
        if (lastSentence > 0) {
          trimmedText = trimmedText.slice(0, lastSentence + 1);
        }
      }
      const { textToSpeech: textToSpeech2 } = await Promise.resolve().then(() => (init_client(), client_exports));
      const audioBuffer = await textToSpeech2(trimmedText, voice || "alloy", "mp3");
      res.json({ audio: audioBuffer.toString("base64") });
    } catch (error) {
      console.error("Error generating speech:", error);
      res.status(500).json({ error: "Failed to generate speech" });
    }
  });
  app2.get("/api/commitments", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const rows = await db.select().from(commitments).where(and25(eq30(commitments.userId, userId2), eq30(commitments.status, "pending"))).orderBy(desc10(commitments.extractedAt));
      res.json({ commitments: rows });
    } catch (error) {
      console.error("Error fetching commitments:", error);
      res.status(500).json({ error: "Failed to fetch commitments" });
    }
  });
  app2.put("/api/commitments/:id", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const { id } = req.params;
      const { status } = req.body;
      if (!status || !["done", "skipped", "pending"].includes(status)) {
        return res.status(400).json({ error: "status must be 'done', 'skipped', or 'pending'" });
      }
      await db.update(commitments).set({ status, resolvedAt: status !== "pending" ? /* @__PURE__ */ new Date() : null }).where(and25(eq30(commitments.id, id), eq30(commitments.userId, userId2)));
      res.json({ ok: true });
    } catch (error) {
      console.error("Error updating commitment:", error);
      res.status(500).json({ error: "Failed to update commitment" });
    }
  });
  app2.delete("/api/commitments/:id", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const { id } = req.params;
      await db.delete(commitments).where(and25(eq30(commitments.id, id), eq30(commitments.userId, userId2)));
      res.json({ ok: true });
    } catch (error) {
      console.error("Error deleting commitment:", error);
      res.status(500).json({ error: "Failed to delete commitment" });
    }
  });
  app2.post("/api/commitments/extract", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const { message } = req.body;
      if (!message || typeof message !== "string") {
        return res.json({ hasCommitment: false });
      }
      const prompt = `Did this message from the user contain any explicit commitment ('I will', 'I'll', 'by tomorrow', 'I need to', 'I'm going to', 'I promise', 'I plan to', 'I'm committing to')? If yes, extract the commitment. Today's date is ${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}.

User message: "${message}"

Return ONLY JSON: { "hasCommitment": boolean, "commitment": "the thing they committed to" or null, "dueDate": "YYYY-MM-DD" or null }`;
      const response = await openai12.chat.completions.create({
        model: "gpt-5-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_completion_tokens: 200
      });
      const content = response.choices[0]?.message?.content || '{"hasCommitment":false}';
      const parsed = JSON.parse(content);
      if (parsed.hasCommitment && parsed.commitment) {
        await db.insert(commitments).values({
          userId: userId2,
          content: parsed.commitment,
          dueDate: parsed.dueDate || null,
          sourceMessage: message
        });
        res.json({ hasCommitment: true, commitment: parsed.commitment, dueDate: parsed.dueDate || null });
      } else {
        res.json({ hasCommitment: false });
      }
    } catch (error) {
      console.error("Error extracting commitment:", error);
      res.json({ hasCommitment: false });
    }
  });
  app2.post("/api/coach/proactive", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const { context, goals: goals2, stats: stats2, history, lifeContext: lifeContext2 } = req.body;
      if (!context) return res.status(400).json({ error: "context is required" });
      let userCommitments = [];
      try {
        userCommitments = await db.select().from(commitments).where(and25(eq30(commitments.userId, userId2), eq30(commitments.status, "pending"))).orderBy(desc10(commitments.extractedAt)).limit(10);
      } catch {
      }
      const soulBlock = await getSoulPromptBlock(userId2);
      const systemPrompt = buildCoachSystemPrompt(goals2 || [], stats2 || {}, history || [], [], lifeContext2 || null, [], false, [], false, userCommitments, void 0, [], [], false, void 0, void 0, void 0, soulBlock);
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.flushHeaders();
      const stream = await openai12.chat.completions.create({
        model: "gpt-5-mini",
        messages: [
          { role: "system", content: systemPrompt + `

IMPORTANT: You are initiating the conversation proactively \u2014 the user hasn't said anything yet. Address the following accountability context directly. Be brief (2-3 sentences max). Don't greet \u2014 get right to the point.

Accountability context:
${context}` },
          { role: "user", content: "[Jarvis is checking in proactively \u2014 no user message. Address the accountability context above.]" }
        ],
        stream: true,
        max_completion_tokens: 300
      });
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) {
          res.write(`data: ${JSON.stringify({ content })}

`);
        }
      }
      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error) {
      console.error("Error in proactive coach:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to generate proactive message" });
      } else {
        res.end();
      }
    }
  });
  app2.get("/api/coach/morning-brief", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      const rows = await db.select({ data: userPreferences.data }).from(userPreferences).where(eq30(userPreferences.userId, userId2));
      const prefs = rows[0]?.data || {};
      const brief = prefs.morningBrief;
      if (brief && brief.date === today && brief.text) {
        return res.json({ text: brief.text, date: brief.date });
      }
      return res.json({ text: null });
    } catch (err) {
      console.error("Error fetching morning brief:", err);
      return res.json({ text: null });
    }
  });
  async function savePendingResponse(userId2, text2) {
    const id = `pr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const rows = await db.select({ data: userPreferences.data }).from(userPreferences).where(eq30(userPreferences.userId, userId2));
    const prefs = rows[0]?.data || {};
    await db.insert(userPreferences).values({ userId: userId2, data: { ...prefs, pendingResponse: { id, text: text2, createdAt: Date.now() } } }).onConflictDoUpdate({ target: userPreferences.userId, set: { data: { ...prefs, pendingResponse: { id, text: text2, createdAt: Date.now() } } } });
  }
  app2.get("/api/coach/pending-response", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const rows = await db.select({ data: userPreferences.data }).from(userPreferences).where(eq30(userPreferences.userId, userId2));
      const prefs = rows[0]?.data || {};
      const pending = prefs.pendingResponse;
      const ONE_HOUR = 60 * 60 * 1e3;
      if (pending && pending.createdAt && Date.now() - pending.createdAt < ONE_HOUR && pending.text) {
        const updated = { ...prefs, pendingResponse: null };
        await db.update(userPreferences).set({ data: updated }).where(eq30(userPreferences.userId, userId2));
        return res.json({ id: pending.id, text: pending.text });
      }
      return res.json({ text: null });
    } catch (err) {
      console.error("Error fetching pending response:", err);
      return res.json({ text: null });
    }
  });
  app2.post("/api/coach/weekly-review", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const { goals: goals2, stats: stats2, history } = req.body;
      let weekCommitments = [];
      try {
        const sevenDaysAgo = /* @__PURE__ */ new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        weekCommitments = await db.select().from(commitments).where(eq30(commitments.userId, userId2)).orderBy(desc10(commitments.extractedAt)).limit(30);
        weekCommitments = weekCommitments.filter(
          (c) => new Date(c.extractedAt).getTime() >= sevenDaysAgo.getTime()
        );
      } catch {
      }
      const completedHistory = (history || []).filter((h) => h.completed);
      const skippedHistory = (history || []).filter((h) => !h.completed);
      const doneCommitments = weekCommitments.filter((c) => c.status === "done");
      const pendingCommitments = weekCommitments.filter((c) => c.status === "pending");
      const prompt = `Generate a weekly productivity review. Be specific and direct.

This week's data:
- Tasks completed: ${completedHistory.length} (${completedHistory.slice(0, 10).map((h) => h.title).join(", ") || "none"})
- Tasks skipped/incomplete: ${skippedHistory.length} (${skippedHistory.slice(0, 10).map((h) => h.title).join(", ") || "none"})
- Commitments made: ${weekCommitments.length}
- Commitments fulfilled: ${doneCommitments.length} (${doneCommitments.map((c) => c.content).join(", ") || "none"})
- Commitments still pending: ${pendingCommitments.length} (${pendingCommitments.map((c) => c.content).join(", ") || "none"})
- Goals: ${(goals2 || []).map((g) => `${g.title} (${g.current}/${g.target} ${g.unit})`).join(", ") || "none"}
- Current streak: ${stats2?.streak || 0} days

Return JSON:
{
  "headline": "One punchy sentence summarizing the week (max 10 words)",
  "wins": ["specific win 1", "specific win 2"],
  "patterns": ["pattern or observation 1", "pattern 2"],
  "avoided": ["thing they avoided or skipped consistently"],
  "nextWeekFocus": "One specific thing to focus on next week"
}

Return ONLY the JSON object.`;
      const response = await openai12.chat.completions.create({
        model: "gpt-5-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_completion_tokens: 500
      });
      const content = response.choices[0]?.message?.content || "{}";
      try {
        const parsed = JSON.parse(content);
        res.json({
          headline: parsed.headline || "Week in review",
          wins: Array.isArray(parsed.wins) ? parsed.wins : [],
          patterns: Array.isArray(parsed.patterns) ? parsed.patterns : [],
          avoided: Array.isArray(parsed.avoided) ? parsed.avoided : [],
          nextWeekFocus: parsed.nextWeekFocus || ""
        });
      } catch {
        res.json({ headline: "Week in review", wins: [], patterns: [], avoided: [], nextWeekFocus: "" });
      }
    } catch (error) {
      console.error("Error generating weekly review:", error);
      res.status(500).json({ error: "Failed to generate weekly review" });
    }
  });
  app2.get("/api/memories", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const rows = await db.select().from(userMemories).where(eq30(userMemories.userId, userId2)).orderBy(desc10(userMemories.extractedAt));
      res.json({ memories: rows });
    } catch (error) {
      console.error("Error fetching memories:", error);
      res.status(500).json({ error: "Failed to fetch memories" });
    }
  });
  app2.delete("/api/memories/:id", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const { id } = req.params;
      await db.delete(userMemories).where(sql16`${userMemories.id} = ${id} AND ${userMemories.userId} = ${userId2}`);
      res.json({ ok: true });
    } catch (error) {
      console.error("Error deleting memory:", error);
      res.status(500).json({ error: "Failed to delete memory" });
    }
  });
  app2.post("/api/memories/extract", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const { messages } = req.body;
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.json({ added: 0 });
      }
      const conversationText = messages.map((m) => `${m.role}: ${m.content}`).join("\n");
      const stored = await extractAndStore({
        userId: userId2,
        source: conversationText,
        sourceType: "chat"
      });
      res.json({ added: stored.length });
    } catch (error) {
      console.error("Error extracting memories:", error);
      res.json({ added: 0 });
    }
  });
  app2.get("/api/soul", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const soul = await getSoul(userId2);
      res.json(soul);
    } catch (error) {
      console.error("Error fetching SOUL:", error);
      res.status(500).json({ error: "Failed to fetch SOUL" });
    }
  });
  app2.post("/api/soul/regenerate", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const soul = await regenerateSoul(userId2);
      res.json(soul);
    } catch (error) {
      console.error("Error regenerating SOUL:", error);
      res.status(500).json({ error: "Failed to regenerate SOUL" });
    }
  });
  app2.put("/api/soul/override", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const body = req.body;
      const override = typeof body.override === "string" ? body.override : null;
      await setManualOverride(userId2, override);
      const soul = await getSoul(userId2);
      res.json(soul);
    } catch (error) {
      console.error("Error setting SOUL override:", error);
      res.status(500).json({ error: "Failed to set override" });
    }
  });
  app2.put("/api/soul/content", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const body = req.body;
      const content = typeof body.content === "string" ? body.content : "";
      await setSoulContent(userId2, content);
      const soul = await getSoul(userId2);
      res.json(soul);
    } catch (error) {
      console.error("Error saving SOUL content:", error);
      res.status(500).json({ error: "Failed to save SOUL content" });
    }
  });
  app2.get("/api/people", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const people2 = await listPeople(userId2);
      res.json({ people: people2 });
    } catch (error) {
      console.error("Error fetching people:", error);
      res.status(500).json({ error: "Failed to fetch people" });
    }
  });
  app2.delete("/api/people/:id", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      await deletePerson(userId2, req.params.id);
      res.json({ ok: true });
    } catch (error) {
      console.error("Error deleting person:", error);
      res.status(500).json({ error: "Failed to delete person" });
    }
  });
  app2.get("/api/weekly-insights", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const rows = await db.select().from(weeklyInsights).where(eq30(weeklyInsights.userId, userId2)).orderBy(desc10(weeklyInsights.createdAt)).limit(4);
      return res.json({ insights: rows });
    } catch (error) {
      console.error("Error getting weekly insights:", error);
      return res.status(500).json({ error: "Failed to get weekly insights" });
    }
  });
  app2.get("/api/preferences", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const row = await db.select({ data: userPreferences.data }).from(userPreferences).where(eq30(userPreferences.userId, userId2)).limit(1);
      return res.json(row[0]?.data || {});
    } catch (error) {
      console.error("Error getting preferences:", error);
      return res.status(500).json({ error: "Failed to get preferences" });
    }
  });
  app2.patch("/api/preferences", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const updates = req.body;
      const existing = await db.select({ data: userPreferences.data }).from(userPreferences).where(eq30(userPreferences.userId, userId2)).limit(1);
      const current = existing[0]?.data || {};
      const merged = { ...current, ...updates };
      await db.insert(userPreferences).values({ userId: userId2, data: merged }).onConflictDoUpdate({
        target: userPreferences.userId,
        set: { data: merged, updatedAt: /* @__PURE__ */ new Date() }
      });
      return res.json(merged);
    } catch (error) {
      console.error("Error saving preferences:", error);
      return res.status(500).json({ error: "Failed to save preferences" });
    }
  });
  app2.get("/api/morning-voice-notes", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const limit = parseInt(req.query.limit) || 30;
      const notes = await db.select().from(morningVoiceNotes).where(eq30(morningVoiceNotes.userId, userId2)).orderBy(desc10(morningVoiceNotes.recordedAt)).limit(limit);
      res.json({ notes });
    } catch (error) {
      console.error("Error fetching morning voice notes:", error);
      res.status(500).json({ error: "Failed to fetch morning voice notes" });
    }
  });
  app2.get("/api/morning-voice-notes/today", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const today = await getUserLocalDate(userId2);
      const notes = await db.select().from(morningVoiceNotes).where(and25(eq30(morningVoiceNotes.userId, userId2), eq30(morningVoiceNotes.recordedAt, today))).limit(1);
      res.json({ note: notes[0] || null });
    } catch (error) {
      console.error("Error fetching today's morning voice note:", error);
      res.status(500).json({ error: "Failed to fetch today's morning voice note" });
    }
  });
  async function extractMorningNoteSignals(transcript) {
    const extractionPrompt = `Analyze this morning voice note transcript and extract structured data.

Transcript: "${transcript}"

Extract:
1. moodSignal: one of "calm", "energized", "stressed", "overwhelmed", "uncertain" \u2014 infer from tone and content
2. themes: up to 5 short topic phrases mentioned (e.g. "client presentation", "exercise", "sleep quality")
3. blockers: up to 3 things preventing progress (e.g. "waiting on feedback", "too many meetings")
4. wins: up to 3 positive things mentioned (e.g. "finished report", "good workout")
5. intention: one sentence capturing what they want to accomplish or focus on today

Return JSON: { "moodSignal": "...", "themes": [...], "blockers": [...], "wins": [...], "intention": "..." }
Return ONLY the JSON object.`;
    const extraction = await openai12.chat.completions.create({
      model: "gpt-5-mini",
      messages: [{ role: "user", content: extractionPrompt }],
      response_format: { type: "json_object" },
      max_completion_tokens: 400
    });
    const extractionContent = extraction.choices[0]?.message?.content || "{}";
    let parsed = {};
    try {
      parsed = JSON.parse(extractionContent);
    } catch {
    }
    const validMoods = ["calm", "energized", "stressed", "overwhelmed", "uncertain"];
    const moodSignal = validMoods.includes(parsed.moodSignal) ? parsed.moodSignal : "calm";
    const themes = Array.isArray(parsed.themes) ? parsed.themes.slice(0, 5).map(String) : [];
    const blockers = Array.isArray(parsed.blockers) ? parsed.blockers.slice(0, 3).map(String) : [];
    const wins = Array.isArray(parsed.wins) ? parsed.wins.slice(0, 3).map(String) : [];
    const intention = typeof parsed.intention === "string" ? parsed.intention : null;
    return { moodSignal, themes, blockers, wins, intention };
  }
  app2.post("/api/morning-voice-notes/extract", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const { transcript } = req.body;
      if (!transcript || typeof transcript !== "string" || !transcript.trim()) {
        return res.status(400).json({ error: "transcript is required" });
      }
      const extracted = await extractMorningNoteSignals(transcript.trim());
      res.json({ extracted });
    } catch (error) {
      console.error("Error extracting morning note signals:", error);
      res.status(500).json({ error: "Failed to extract signals" });
    }
  });
  app2.post("/api/morning-voice-notes", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const { transcript, extracted: preExtracted } = req.body;
      if (!transcript || typeof transcript !== "string" || !transcript.trim()) {
        return res.status(400).json({ error: "transcript is required" });
      }
      const today = await getUserLocalDate(userId2);
      const existing = await db.select({ id: morningVoiceNotes.id }).from(morningVoiceNotes).where(and25(eq30(morningVoiceNotes.userId, userId2), eq30(morningVoiceNotes.recordedAt, today))).limit(1);
      if (existing.length > 0) {
        return res.status(409).json({ error: "Morning note already recorded today" });
      }
      const extracted = preExtracted && preExtracted.moodSignal ? preExtracted : await extractMorningNoteSignals(transcript.trim());
      const validMoods = ["calm", "energized", "stressed", "overwhelmed", "uncertain"];
      const moodSignal = validMoods.includes(extracted.moodSignal) ? extracted.moodSignal : "calm";
      const themes = Array.isArray(extracted.themes) ? extracted.themes.slice(0, 5).map(String) : [];
      const blockers = Array.isArray(extracted.blockers) ? extracted.blockers.slice(0, 3).map(String) : [];
      const wins = Array.isArray(extracted.wins) ? extracted.wins.slice(0, 3).map(String) : [];
      const intention = typeof extracted.intention === "string" ? extracted.intention : null;
      const [inserted] = await db.insert(morningVoiceNotes).values({
        userId: userId2,
        recordedAt: today,
        transcript: transcript.trim(),
        moodSignal,
        themes,
        blockers,
        wins,
        intention
      }).returning();
      const memorySummary = `Morning note (${today}): Mood=${moodSignal}. Themes: ${themes.join(", ") || "none"}. ${intention ? `Intention: ${intention}` : ""}`;
      try {
        await db.insert(userMemories).values({
          userId: userId2,
          content: memorySummary,
          category: "pattern"
        });
      } catch {
      }
      morningNoteSummaryCache.delete(userId2);
      res.json({
        note: inserted,
        extracted: { moodSignal, themes, blockers, wins, intention }
      });
    } catch (error) {
      console.error("Error creating morning voice note:", error);
      res.status(500).json({ error: "Failed to create morning voice note" });
    }
  });
  app2.post("/api/morning-voice-notes/transcribe", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const { audioBase64, mimeType } = req.body;
      if (!audioBase64) {
        return res.status(400).json({ error: "audioBase64 is required" });
      }
      const buffer = Buffer.from(audioBase64, "base64");
      const ext = (mimeType || "audio/webm").includes("mp4") ? "mp4" : "webm";
      const file = new File([buffer], `recording.${ext}`, { type: mimeType || "audio/webm" });
      const transcription = await openai12.audio.transcriptions.create({
        model: "whisper-1",
        file
      });
      res.json({ transcript: transcription.text || "" });
    } catch (error) {
      console.error("Error transcribing audio:", error);
      res.status(500).json({ error: "Failed to transcribe audio" });
    }
  });
  app2.get("/api/inbox/items", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const items = await db.select().from(inboxItems).where(and25(eq30(inboxItems.userId, userId2), eq30(inboxItems.status, "pending")));
      res.json(items);
    } catch (error) {
      console.error("Error fetching inbox items:", error);
      res.status(500).json({ error: "Failed to fetch inbox items" });
    }
  });
  app2.post("/api/inbox/items/:id/action", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const { id } = req.params;
      const { actionType } = req.body;
      if (!actionType) return res.status(400).json({ error: "actionType is required" });
      let telegramChatId;
      try {
        const [link] = await db.select().from(telegramLinks).where(eq30(telegramLinks.userId, userId2));
        telegramChatId = link?.chatId;
      } catch {
      }
      const { executeInboxAction: executeInboxAction2 } = await Promise.resolve().then(() => (init_inboxActions(), inboxActions_exports));
      const result = await executeInboxAction2(userId2, id, actionType, telegramChatId);
      res.json(result);
    } catch (error) {
      console.error("Error executing inbox action:", error);
      res.status(500).json({ error: "Failed to execute action" });
    }
  });
  app2.get("/api/inbox/rules", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const rules = await db.select().from(inboxRules).where(eq30(inboxRules.userId, userId2));
      res.json(rules);
    } catch (error) {
      console.error("Error fetching inbox rules:", error);
      res.status(500).json({ error: "Failed to fetch rules" });
    }
  });
  app2.post("/api/inbox/rules", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const { pattern, type, scope } = req.body;
      if (!pattern || !type || !scope) {
        return res.status(400).json({ error: "pattern, type, and scope are required" });
      }
      const { createRuleFromText: createRuleFromText2 } = await Promise.resolve().then(() => (init_inboxRules(), inboxRules_exports));
      const rule = await createRuleFromText2(userId2, pattern, type, scope);
      res.json(rule);
    } catch (error) {
      console.error("Error creating inbox rule:", error);
      res.status(500).json({ error: "Failed to create rule" });
    }
  });
  app2.delete("/api/inbox/rules/:id", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const { id } = req.params;
      await db.delete(inboxRules).where(and25(eq30(inboxRules.id, id), eq30(inboxRules.userId, userId2)));
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting inbox rule:", error);
      res.status(500).json({ error: "Failed to delete rule" });
    }
  });
  app2.patch("/api/inbox/rules/:id", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const { id } = req.params;
      const { active } = req.body;
      await db.update(inboxRules).set({ active: active ? "true" : "false", updatedAt: /* @__PURE__ */ new Date() }).where(and25(eq30(inboxRules.id, id), eq30(inboxRules.userId, userId2)));
      res.json({ success: true });
    } catch (error) {
      console.error("Error updating inbox rule:", error);
      res.status(500).json({ error: "Failed to update rule" });
    }
  });
  app2.get("/api/email-drafts", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const drafts = await db.select().from(emailDrafts).where(and25(eq30(emailDrafts.userId, userId2), eq30(emailDrafts.status, "pending_approval"))).orderBy(desc10(emailDrafts.createdAt));
      res.json(drafts);
    } catch (error) {
      console.error("Error fetching email drafts:", error);
      res.status(500).json({ error: "Failed to fetch drafts" });
    }
  });
  app2.post("/api/email-drafts/:id/approve", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const { id } = req.params;
      const { editedSubject, editedBody } = req.body;
      const [draft] = await db.select().from(emailDrafts).where(and25(eq30(emailDrafts.id, id), eq30(emailDrafts.userId, userId2))).limit(1);
      if (!draft) return res.status(404).json({ error: "Draft not found" });
      if (draft.status !== "pending_approval") return res.status(400).json({ error: "Draft already actioned" });
      const subject = editedSubject?.trim() || draft.draftSubject;
      const body = editedBody?.trim() || draft.draftBody;
      const recipientMatch = (draft.fromSender || "").match(/<([^>]+)>/);
      const recipient = recipientMatch ? recipientMatch[1] : (draft.fromSender || "").trim();
      if (!recipient || !recipient.includes("@")) {
        return res.status(400).json({ error: "Could not determine recipient address" });
      }
      const tokens = await getValidGoogleTokens(userId2);
      const token = tokens?.[0];
      if (!token) return res.status(400).json({ error: "Gmail not connected" });
      const { createGmailDraft: createGmailDraft2 } = await Promise.resolve().then(() => (init_gmail(), gmail_exports));
      const result = await createGmailDraft2(token, recipient, subject, body);
      await db.update(emailDrafts).set({
        status: "approved",
        gmailDraftId: result.draftId,
        gmailDraftUrl: result.gmailUrl,
        actedAt: /* @__PURE__ */ new Date(),
        draftSubject: subject,
        draftBody: body
      }).where(eq30(emailDrafts.id, id));
      res.json({ success: true, gmailDraftUrl: result.gmailUrl });
    } catch (error) {
      console.error("Error approving email draft:", error);
      res.status(500).json({ error: "Failed to approve draft" });
    }
  });
  app2.post("/api/email-drafts/:id/discard", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const { id } = req.params;
      await db.update(emailDrafts).set({ status: "discarded", actedAt: /* @__PURE__ */ new Date() }).where(and25(eq30(emailDrafts.id, id), eq30(emailDrafts.userId, userId2)));
      res.json({ success: true });
    } catch (error) {
      console.error("Error discarding email draft:", error);
      res.status(500).json({ error: "Failed to discard draft" });
    }
  });
  app2.post("/api/goals/:id/decompose", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const goalId = req.params.id;
      const [goalsRow] = await db.select({ data: goals.data }).from(goals).where(eq30(goals.userId, userId2)).limit(1);
      const goalsList = goalsRow?.data || [];
      const goal = goalsList.find((g) => g.id === goalId);
      if (!goal) return res.status(404).json({ error: "Goal not found" });
      const { enqueueGoalDecomposition: enqueueGoalDecomposition2 } = await Promise.resolve().then(() => (init_goalDecomposer(), goalDecomposer_exports));
      const jobId = await enqueueGoalDecomposition2(userId2, { id: goal.id, title: goal.title });
      res.json({ ok: true, jobId, status: "queued" });
    } catch (err) {
      console.error("Error queuing goal decompose:", err);
      res.status(500).json({ error: "Failed to queue decomposition" });
    }
  });
  app2.get("/api/goals/:id/tree", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const goalId = req.params.id;
      const [tree] = await db.select().from(goalTrees).where(and25(eq30(goalTrees.userId, userId2), eq30(goalTrees.goalId, goalId))).limit(1);
      if (!tree) return res.status(200).json({ hasTree: false });
      res.json({ hasTree: true, ...tree });
    } catch (err) {
      console.error("Error fetching goal tree:", err);
      res.status(500).json({ error: "Failed to fetch tree" });
    }
  });
  app2.post("/api/agent-jobs", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const { agentType, title, prompt, input } = req.body;
      const allowed = ["research", "writing", "planning", "email", "goal_decompose"];
      if (!agentType || !allowed.includes(agentType)) {
        return res.status(400).json({ error: `agentType must be one of ${allowed.join(", ")}` });
      }
      if (!title || !prompt) {
        return res.status(400).json({ error: "title and prompt are required" });
      }
      const { submitAgentJob: submitAgentJob2 } = await Promise.resolve().then(() => (init_jobQueue(), jobQueue_exports));
      const jobId = await submitAgentJob2({
        userId: userId2,
        agentType,
        title,
        prompt,
        input: input || {}
      });
      res.json({ ok: true, jobId, status: "queued" });
    } catch (err) {
      console.error("Error submitting agent job:", err);
      res.status(500).json({ error: "Failed to submit job" });
    }
  });
  app2.get("/api/agent-jobs", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
      const status = typeof req.query.status === "string" ? req.query.status : null;
      const where = status ? and25(eq30(agentJobs.userId, userId2), eq30(agentJobs.status, status)) : eq30(agentJobs.userId, userId2);
      const jobs = await db.select().from(agentJobs).where(where).orderBy(desc10(agentJobs.createdAt)).limit(limit);
      res.json(jobs);
    } catch (err) {
      console.error("Error listing agent jobs:", err);
      res.status(500).json({ error: "Failed to list jobs" });
    }
  });
  app2.get("/api/deliverables", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const status = typeof req.query.status === "string" ? req.query.status : "pending_approval";
      const items = await db.select().from(deliverables).where(and25(eq30(deliverables.userId, userId2), eq30(deliverables.status, status))).orderBy(desc10(deliverables.createdAt)).limit(50);
      res.json(items);
    } catch (err) {
      console.error("Error listing deliverables:", err);
      res.status(500).json({ error: "Failed to list deliverables" });
    }
  });
  app2.post("/api/deliverables/:id/approve", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const id = req.params.id;
      const [d] = await db.select().from(deliverables).where(and25(eq30(deliverables.id, id), eq30(deliverables.userId, userId2))).limit(1);
      if (!d) return res.status(404).json({ error: "Deliverable not found" });
      if (d.status !== "pending_approval") {
        return res.status(400).json({ error: "Already actioned" });
      }
      let resultExtra = {};
      if (d.type === "email_draft") {
        const meta = d.meta || {};
        const to = meta.to?.trim() || "";
        if (!to || !to.includes("@")) {
          return res.status(400).json({ error: "Email draft missing valid recipient" });
        }
        const tokens = await getValidGoogleTokens(userId2);
        const token = tokens?.[0];
        if (!token) return res.status(400).json({ error: "Gmail not connected" });
        const { createGmailDraft: createGmailDraft2 } = await Promise.resolve().then(() => (init_gmail(), gmail_exports));
        const result = await createGmailDraft2(token, to, meta.subject || d.title, meta.emailBody || d.body);
        resultExtra = { gmailDraftUrl: result.gmailUrl, gmailDraftId: result.draftId };
      } else {
        await db.insert(userDocuments).values({
          userId: userId2,
          name: d.title.slice(0, 200),
          mimeType: "text/markdown",
          sizeBytes: Buffer.byteLength(d.body, "utf8"),
          status: "ready",
          extractedText: d.body,
          summary: d.summary || null
        });
      }
      await db.update(deliverables).set({ status: "approved", actedAt: /* @__PURE__ */ new Date() }).where(eq30(deliverables.id, id));
      if (d.jobId) {
        await db.update(agentJobs).set({ status: "delivered" }).where(and25(eq30(agentJobs.id, d.jobId), eq30(agentJobs.status, "complete")));
      }
      res.json({ ok: true, ...resultExtra });
    } catch (err) {
      console.error("Error approving deliverable:", err);
      res.status(500).json({ error: "Failed to approve deliverable" });
    }
  });
  app2.put("/api/deliverables/:id", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const id = req.params.id;
      const { title, summary, body, meta } = req.body;
      const [existing] = await db.select().from(deliverables).where(and25(eq30(deliverables.id, id), eq30(deliverables.userId, userId2))).limit(1);
      if (!existing) return res.status(404).json({ error: "Deliverable not found" });
      if (existing.status !== "pending_approval") {
        return res.status(400).json({ error: "Only pending deliverables can be edited" });
      }
      const patch = {};
      if (typeof title === "string" && title.trim().length > 0) patch.title = title.trim().slice(0, 300);
      if (typeof summary === "string") patch.summary = summary.slice(0, 1e3);
      if (typeof body === "string" && body.trim().length > 0) patch.body = body.slice(0, 1e5);
      if (meta && typeof meta === "object" && !Array.isArray(meta)) {
        patch.meta = { ...existing.meta, ...meta };
      }
      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: "No editable fields provided" });
      }
      const [updated] = await db.update(deliverables).set(patch).where(eq30(deliverables.id, id)).returning();
      res.json({ ok: true, deliverable: updated });
    } catch (err) {
      console.error("Error editing deliverable:", err);
      res.status(500).json({ error: "Failed to edit deliverable" });
    }
  });
  app2.post("/api/deliverables/:id/discard", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const id = req.params.id;
      const [d] = await db.select({ jobId: deliverables.jobId }).from(deliverables).where(and25(eq30(deliverables.id, id), eq30(deliverables.userId, userId2))).limit(1);
      await db.update(deliverables).set({ status: "discarded", actedAt: /* @__PURE__ */ new Date() }).where(and25(eq30(deliverables.id, id), eq30(deliverables.userId, userId2)));
      if (d?.jobId) {
        await db.update(agentJobs).set({ status: "delivered" }).where(and25(eq30(agentJobs.id, d.jobId), eq30(agentJobs.status, "complete")));
      }
      res.json({ ok: true });
    } catch (err) {
      console.error("Error discarding deliverable:", err);
      res.status(500).json({ error: "Failed to discard deliverable" });
    }
  });
  app2.get("/api/documents", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const docs = await db.select({
        id: userDocuments.id,
        name: userDocuments.name,
        mimeType: userDocuments.mimeType,
        sizeBytes: userDocuments.sizeBytes,
        status: userDocuments.status,
        summary: userDocuments.summary,
        uploadedAt: userDocuments.uploadedAt
      }).from(userDocuments).where(eq30(userDocuments.userId, userId2)).orderBy(desc10(userDocuments.uploadedAt)).limit(MAX_DOCS_PER_USER);
      res.json({ documents: docs });
    } catch (error) {
      console.error("Error fetching documents:", error);
      res.status(500).json({ error: "Failed to fetch documents" });
    }
  });
  app2.post("/api/documents", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const { name, mimeType, data } = req.body;
      if (!name || !mimeType || !data) {
        return res.status(400).json({ error: "name, mimeType, and data are required" });
      }
      if (!SUPPORTED_MIME_TYPES.includes(mimeType)) {
        return res.status(400).json({ error: `Unsupported file type. Supported: ${SUPPORTED_EXTENSIONS.join(", ")}` });
      }
      const existing = await db.select({ id: userDocuments.id }).from(userDocuments).where(eq30(userDocuments.userId, userId2));
      if (existing.length >= MAX_DOCS_PER_USER) {
        return res.status(400).json({ error: `Maximum ${MAX_DOCS_PER_USER} documents allowed. Delete some to upload more.` });
      }
      const buffer = Buffer.from(data, "base64");
      const sizeBytes = buffer.length;
      if (sizeBytes > 20 * 1024 * 1024) {
        return res.status(400).json({ error: "File too large. Maximum size is 20MB." });
      }
      const [inserted] = await db.insert(userDocuments).values({ userId: userId2, name, mimeType, sizeBytes, status: "processing" }).returning();
      res.json({ document: inserted });
      processDocument(userId2, inserted.id, name, mimeType, buffer).catch((err) => {
        console.error("[Docs] Background processing error:", err);
      });
    } catch (error) {
      console.error("Error uploading document:", error);
      res.status(500).json({ error: "Failed to upload document" });
    }
  });
  app2.delete("/api/documents/:id", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const { id } = req.params;
      await db.delete(userDocuments).where(and25(eq30(userDocuments.id, id), eq30(userDocuments.userId, userId2)));
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting document:", error);
      res.status(500).json({ error: "Failed to delete document" });
    }
  });
  app2.get("/api/chatgpt-import/status", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const rows = await db.select().from(chatgptImports).where(eq30(chatgptImports.userId, userId2));
      if (rows.length === 0) {
        return res.json({ imported: false });
      }
      const row = rows[0];
      res.json({ imported: true, importedAt: row.importedAt, memoriesAdded: row.memoriesAdded });
    } catch (error) {
      console.error("Error getting ChatGPT import status:", error);
      res.status(500).json({ error: "Failed to get import status" });
    }
  });
  app2.post("/api/chatgpt-import", async (req, res) => {
    try {
      const userId2 = req.userId;
      if (!userId2) return res.status(401).json({ error: "Not authenticated" });
      const { conversations } = req.body;
      if (!conversations || !Array.isArray(conversations) || conversations.length === 0) {
        return res.status(400).json({ error: "No conversations found. Please upload a valid ChatGPT export file." });
      }
      const recentConversations = conversations.slice(-150);
      const allTexts = [];
      for (const convo of recentConversations) {
        const lines = [];
        if (convo.title) lines.push(`[Conversation: ${convo.title}]`);
        if (convo.messages && Array.isArray(convo.messages)) {
          for (const msg of convo.messages) {
            if (msg.role && msg.text && typeof msg.text === "string") {
              lines.push(`${msg.role}: ${msg.text.slice(0, 500)}`);
            }
          }
        } else if (convo.mapping && typeof convo.mapping === "object") {
          const nodes = Object.values(convo.mapping).filter((n) => n?.message?.create_time).sort((a, b) => (a.message.create_time || 0) - (b.message.create_time || 0));
          const unsortedNodes = Object.values(convo.mapping).filter((n) => !n?.message?.create_time);
          for (const node of [...nodes, ...unsortedNodes]) {
            const msg = node?.message;
            if (!msg || !msg.content?.parts) continue;
            const role = msg.author?.role;
            if (role !== "user" && role !== "assistant") continue;
            const text2 = msg.content.parts.filter((p) => typeof p === "string").join(" ").trim();
            if (text2.length > 0) {
              lines.push(`${role}: ${text2.slice(0, 500)}`);
            }
          }
        }
        if (lines.length > 1) {
          allTexts.push(lines.join("\n"));
        }
      }
      if (allTexts.length === 0) {
        return res.status(400).json({ error: "No readable conversations found in the file." });
      }
      const existingRows = await db.select({ content: userMemories.content }).from(userMemories).where(eq30(userMemories.userId, userId2));
      const existingMemories = existingRows.map((r) => r.content);
      const normalizedExisting = new Set(existingMemories.map(normalizeMemoryContent));
      const batchSize = 10;
      let totalAdded = 0;
      const validCategories = ["personality", "values", "work_style", "accomplishment", "goal_discovered", "relationship", "pattern", "preference", "fact", "goal", "achievement"];
      for (let i = 0; i < allTexts.length; i += batchSize) {
        const batch = allTexts.slice(i, i + batchSize);
        const batchText = batch.join("\n\n---\n\n").slice(0, 12e3);
        const currentMemories = [...existingMemories];
        const existingList = currentMemories.length > 0 ? `
Existing memories (DO NOT duplicate these):
${currentMemories.map((m) => `- ${m}`).join("\n")}` : "";
        const prompt = `You are extracting profile facts about a user from their ChatGPT conversation history.
Output a JSON array of { category, content } objects. Only extract facts that are specific, meaningful, and not already captured.
Focus on discovering: personality traits, values, work patterns, goals, relationships, preferences, and recurring behaviors.

Categories:
- personality \u2014 how they communicate, humor, energy, decision style
- values \u2014 what they care about deeply, what motivates them
- work_style \u2014 when/how they focus, work patterns, tools they use
- accomplishment \u2014 wins, achievements, proud moments mentioned
- goal_discovered \u2014 goals inferred from behavior (not just stated)
- relationship \u2014 key people in their life (family, teammates, boss)
- pattern \u2014 recurring behaviors, habits, tendencies
- preference \u2014 explicit preferences (meeting times, communication style, etc.)
- fact \u2014 general facts about the user
- goal \u2014 explicitly stated goals
- achievement \u2014 specific achievements mentioned
${existingList}

Conversations:
${batchText}

Return JSON: { "memories": [{"content": "string describing the fact", "category": "one of the categories above"}] }
Return { "memories": [] } if nothing new was learned. Do NOT repeat or rephrase existing memories.
Extract up to 8 memories per batch.`;
        try {
          const response = await openai12.chat.completions.create({
            model: "gpt-5-mini",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
            max_completion_tokens: 800
          });
          const content = response.choices[0]?.message?.content || '{"memories":[]}';
          const parsed = JSON.parse(content);
          const rawMemories = Array.isArray(parsed.memories) ? parsed.memories : Array.isArray(parsed) ? parsed : [];
          const newMemories = rawMemories.slice(0, 8);
          for (const mem of newMemories) {
            if (!mem.content || typeof mem.content !== "string" || mem.content.trim().length === 0) continue;
            const normalized = normalizeMemoryContent(mem.content);
            if (normalizedExisting.has(normalized)) continue;
            const category = validCategories.includes(mem.category) ? mem.category : "fact";
            await db.insert(userMemories).values({
              userId: userId2,
              content: mem.content.trim(),
              category
            });
            normalizedExisting.add(normalized);
            existingMemories.push(mem.content.trim());
            totalAdded++;
            console.log(`[ChatGPT Import] Extracted: [${category}] ${mem.content.trim().slice(0, 60)}...`);
          }
        } catch (err) {
          console.error("[ChatGPT Import] Batch extraction error:", err);
        }
      }
      await db.insert(chatgptImports).values({ userId: userId2, importedAt: /* @__PURE__ */ new Date(), memoriesAdded: totalAdded }).onConflictDoUpdate({
        target: [chatgptImports.userId],
        set: { importedAt: /* @__PURE__ */ new Date(), memoriesAdded: totalAdded }
      });
      console.log(`[ChatGPT Import] User ${userId2}: imported ${totalAdded} memories from ${allTexts.length} conversations`);
      res.json({ imported: totalAdded, importedAt: (/* @__PURE__ */ new Date()).toISOString() });
    } catch (error) {
      console.error("Error importing ChatGPT history:", error);
      res.status(500).json({ error: "Failed to import ChatGPT history" });
    }
  });
  const httpServer = createServer(app2);
  return httpServer;
}
var openai12, screenshotStore, COACHING_FRAMEWORKS, PERSONA_BLOCKS, morningNoteSummaryCache;
var init_routes2 = __esm({
  "server/routes.ts"() {
    "use strict";
    init_db();
    init_schema();
    init_schema();
    init_documentProcessor();
    init_ai();
    init_googleCalendar();
    init_outlook();
    init_gmail();
    init_slack();
    init_auth();
    init_mobileAuthRoutes();
    init_dataRoutes();
    init_telegramRoutes();
    init_routes();
    init_downloadRoutes();
    init_integrationOwner();
    init_oauthRoutes();
    init_userTokenStore();
    init_search();
    init_interactionLog();
    init_extractor();
    init_soul();
    init_people();
    init_bridge();
    init_schema();
    init_connectChannel();
    openai12 = new OpenAI12({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
    });
    screenshotStore = /* @__PURE__ */ new Map();
    setInterval(() => {
      const now = Date.now();
      for (const [id, entry] of screenshotStore) {
        if (entry.expires < now) screenshotStore.delete(id);
      }
    }, 5 * 60 * 1e3);
    COACHING_FRAMEWORKS = `## Coaching Frameworks You Draw From
Apply these when relevant \u2014 reference them by name:
- Atomic Habits (James Clear): Habits = cue + craving + response + reward. Small 1% improvements compound. Environment design > willpower.
- Deep Work (Cal Newport): Protect deep focus blocks. Shallow work is the enemy. Produce at a high level.
- 80/20 Principle (Pareto): 20% of efforts produce 80% of results. Identify and double down on the 20%.
- Extreme Ownership (Jocko Willink): No excuses. Own every outcome. Simplify plans. Cover and move.
- The ONE Thing (Gary Keller): What is the one thing that makes everything else easier or unnecessary?
- OKRs (Measure What Matters): Objectives + Key Results. Ambitious goals + measurable milestones.
- 7 Habits (Stephen Covey): Be proactive. Begin with the end in mind. First things first. Sharpen the saw.
- Essentialism (Greg McKeown): Less but better. Eliminate the trivial many. Protect your highest contribution.
- ADHD Strategies: Task decomposition. External accountability. Body doubling. Time-blocking. Momentum before perfectionism.
- Stoicism (Marcus Aurelius): Focus only on what you control. Obstacles are the way. Memento mori.
- First Principles (Musk): Strip back assumptions. Reason from fundamentals. Don't copy \u2014 derive.
When you reference a framework, name the author/book naturally: "Per Atomic Habits..." or "This is an OKR problem..."`;
    PERSONA_BLOCKS = {
      sharp: `## Your Coaching Style: Sharp Advisor
You are a direct, no-fluff executive advisor. Diagnose fast. Prescribe specifically. Apply 80/20 and First Principles instinctively. Skip pleasantries. If you see the real problem, name it immediately.`,
      drill: `## Your Coaching Style: Drill Sergeant
You are Jocko Willink meets David Goggins. Zero tolerance for excuses. Name them directly. Apply Extreme Ownership \u2014 the user is responsible for everything. Push hard. Short, punchy sentences. End with a direct command.`,
      mentor: `## Your Coaching Style: Wise Mentor
You are a patient, systems-thinking mentor. You care about the long game. Apply Atomic Habits and Deep Work thinking. You ask Socratic questions. You help the user build systems that make success inevitable.`,
      strategist: `## Your Coaching Style: Business Strategist
You are a high-leverage business partner. You think in ROI, leverage, and compounding returns. Apply OKR thinking. Every decision should be examined for 10x potential. Cut low-value work ruthlessly.`,
      flow: `## Your Coaching Style: Flow Coach
You are a gentle, ADHD-aware coach. You reduce friction. You chunk tasks into tiny pieces. You celebrate momentum. You never overwhelm. You understand that motivation follows action, not the other way around. You ask "what's the smallest next step?"`
    };
    morningNoteSummaryCache = /* @__PURE__ */ new Map();
  }
});

// server/memory/decay.ts
var decay_exports = {};
__export(decay_exports, {
  maybeRunDailyDecay: () => maybeRunDailyDecay,
  reinforceMemories: () => reinforceMemories,
  runDailyDecay: () => runDailyDecay
});
import { eq as eq31, sql as sql17, and as and26 } from "drizzle-orm";
function utcDayKey(d) {
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}
async function runDailyDecay() {
  const result = { decremented: 0, deleted: 0 };
  try {
    const dec = await db.execute(sql17`
      UPDATE user_memories
      SET relevance_score = GREATEST(0, relevance_score - CASE WHEN confidence >= 90 THEN ${sql17.raw(String(Math.max(1, Math.floor(DECAY_STEP / 3))))} ELSE ${sql17.raw(String(DECAY_STEP))} END)
      WHERE (
        (last_referenced_at IS NOT NULL AND last_referenced_at < NOW() - INTERVAL '${sql17.raw(String(STALE_AFTER_REF_DAYS))} days')
        OR (last_referenced_at IS NULL AND extracted_at < NOW() - INTERVAL '${sql17.raw(String(STALE_AFTER_EXTRACT_DAYS))} days')
      )
      RETURNING id
    `);
    result.decremented = dec.rows?.length || 0;
    const del = await db.execute(sql17`
      DELETE FROM user_memories
      WHERE relevance_score < ${DECAY_FLOOR}
        AND (
          (last_referenced_at IS NOT NULL AND last_referenced_at < NOW() - INTERVAL '${sql17.raw(String(STALE_AFTER_REF_DAYS))} days')
          OR (last_referenced_at IS NULL AND extracted_at < NOW() - INTERVAL '${sql17.raw(String(STALE_AFTER_EXTRACT_DAYS))} days')
        )
      RETURNING id
    `);
    result.deleted = del.rows?.length || 0;
    if (result.decremented > 0 || result.deleted > 0) {
      console.log(`[MemoryDecay] decremented=${result.decremented} deleted=${result.deleted}`);
    }
  } catch (err) {
    console.error("[MemoryDecay] failed:", err);
  }
  return result;
}
async function maybeRunDailyDecay() {
  const key = utcDayKey(/* @__PURE__ */ new Date());
  if (key === lastDecayDayKey) return null;
  lastDecayDayKey = key;
  return runDailyDecay();
}
async function reinforceMemories(userId2, ids) {
  if (ids.length === 0) return;
  try {
    await db.update(userMemories).set({
      relevanceScore: sql17`LEAST(100, ${userMemories.relevanceScore} + 5)`,
      lastReferencedAt: /* @__PURE__ */ new Date()
    }).where(and26(eq31(userMemories.userId, userId2), sql17`${userMemories.id} = ANY(${ids})`));
  } catch (err) {
    console.error("[MemoryDecay] reinforce failed:", err);
  }
}
var DECAY_STEP, DECAY_FLOOR, STALE_AFTER_REF_DAYS, STALE_AFTER_EXTRACT_DAYS, lastDecayDayKey;
var init_decay = __esm({
  "server/memory/decay.ts"() {
    "use strict";
    init_db();
    init_schema();
    DECAY_STEP = 5;
    DECAY_FLOOR = 10;
    STALE_AFTER_REF_DAYS = 7;
    STALE_AFTER_EXTRACT_DAYS = 14;
    lastDecayDayKey = "";
  }
});

// server/memory/peopleSync.ts
var peopleSync_exports = {};
__export(peopleSync_exports, {
  syncPeopleFromGoogle: () => syncPeopleFromGoogle
});
import { eq as eq32, and as and27 } from "drizzle-orm";
function parseSender(from) {
  const angle = from.match(/^"?([^"<]+?)"?\s*<([^>]+)>$/);
  if (angle) return { name: angle[1].trim(), email: angle[2].trim().toLowerCase() };
  const bare = from.match(/^[^\s<>]+@[^\s<>]+$/);
  if (bare) return { name: null, email: from.trim().toLowerCase() };
  return null;
}
async function syncPeopleFromGoogle(userId2, accessToken, now) {
  const observations = [];
  try {
    const dayKeys = [];
    for (let i = 0; i <= SYNC_LOOKAHEAD_DAYS; i++) {
      const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1e3);
      dayKeys.push(d.toISOString().slice(0, 10));
    }
    for (const day of dayKeys) {
      const events = await getGoogleCalendarEvents(day, void 0, void 0, accessToken).catch(() => []);
      for (const ev of events) {
        for (const att of ev.attendees ?? []) {
          if (att.self) continue;
          const email = att.email.toLowerCase();
          if (!email.includes("@")) continue;
          observations.push({
            email,
            name: att.displayName || null,
            source: "calendar",
            context: ev.title,
            when: new Date(ev.start)
          });
        }
      }
    }
  } catch (err) {
    console.error("[PeopleSync] calendar pass failed:", err);
  }
  try {
    const sinceMs = now.getTime() - SYNC_LOOKBACK_HOURS * 60 * 60 * 1e3;
    const emails = await getEmailsSince(sinceMs, accessToken).catch(() => []);
    for (const e of emails) {
      const parsed = parseSender(e.from);
      if (!parsed) continue;
      observations.push({
        email: parsed.email,
        name: parsed.name,
        source: "email",
        context: e.subject,
        when: new Date(e.receivedAt)
      });
    }
  } catch (err) {
    console.error("[PeopleSync] gmail pass failed:", err);
  }
  if (observations.length === 0) return 0;
  const byEmail = /* @__PURE__ */ new Map();
  for (const o of observations) {
    const existing = byEmail.get(o.email);
    if (!existing || o.when > existing.when) byEmail.set(o.email, o);
  }
  const nowMs = now.getTime();
  const upcoming = /* @__PURE__ */ new Map();
  for (const o of observations) {
    if (o.source !== "calendar") continue;
    if (o.when.getTime() < nowMs) continue;
    const cur = upcoming.get(o.email);
    if (!cur) upcoming.set(o.email, { count: 1, nearest: o.when });
    else {
      cur.count += 1;
      if (o.when < cur.nearest) cur.nearest = o.when;
    }
  }
  let upserts = 0;
  for (const obs of byEmail.values()) {
    const upc = upcoming.get(obs.email);
    try {
      const [existing] = await db.select().from(people).where(and27(eq32(people.userId, userId2), eq32(people.email, obs.email))).limit(1);
      const relationshipHint = obs.source === "calendar" ? `calendar attendee \u2014 ${obs.context}` : `email correspondent \u2014 re: ${obs.context}`;
      if (existing) {
        await db.update(people).set({
          name: existing.name && existing.name !== obs.email ? existing.name : obs.name || obs.email,
          relationship: existing.relationship || relationshipHint,
          interactionCount: (existing.interactionCount ?? 0) + 1,
          lastInteractionAt: obs.when,
          nextInteractionAt: upc?.nearest ?? null,
          upcomingCount: upc?.count ?? 0,
          updatedAt: /* @__PURE__ */ new Date()
        }).where(eq32(people.id, existing.id));
      } else {
        await db.insert(people).values({
          userId: userId2,
          name: obs.name || obs.email,
          email: obs.email,
          relationship: relationshipHint,
          notes: null,
          interactionCount: 1,
          lastInteractionAt: obs.when,
          nextInteractionAt: upc?.nearest ?? null,
          upcomingCount: upc?.count ?? 0
        });
      }
      upserts += 1;
    } catch (err) {
      console.error(`[PeopleSync] upsert failed for ${obs.email}:`, err);
    }
  }
  try {
    const { markSoulStale: markSoulStale2 } = await Promise.resolve().then(() => (init_soul(), soul_exports));
    await markSoulStale2(userId2);
  } catch (err) {
    console.error(`[PeopleSync] markSoulStale failed for ${userId2}:`, err);
  }
  console.log(`[PeopleSync] user=${userId2} upserted=${upserts}`);
  return upserts;
}
var SYNC_LOOKBACK_HOURS, SYNC_LOOKAHEAD_DAYS;
var init_peopleSync = __esm({
  "server/memory/peopleSync.ts"() {
    "use strict";
    init_db();
    init_schema();
    init_googleCalendar();
    init_gmail();
    SYNC_LOOKBACK_HOURS = 24;
    SYNC_LOOKAHEAD_DAYS = 3;
  }
});

// server/index.ts
init_routes2();
init_db();
init_telegramRoutes();
init_momentumCoach();
import express3 from "express";

// server/heartbeat.ts
init_db();
init_schema();
init_telegram();
init_registry();
init_googleCalendar();
init_gmail();
init_search();
init_googleDrive();
init_userTokenStore();
init_interactionLog();
import * as fs2 from "fs";
import * as path2 from "path";
import { eq as eq33, and as and28, sql as sql18, desc as desc11, gte as gte5 } from "drizzle-orm";
import OpenAI13 from "openai";
var openai13 = new OpenAI13({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
});
var HEARTBEAT_INTERVAL_MS = 5 * 60 * 1e3;
var CHECKLIST_PATH = path2.resolve(process.cwd(), "JARVIS_HEARTBEAT.md");
var cachedChecklist = null;
var cachedChecklistMtime = 0;
function readChecklist() {
  try {
    const stat = fs2.statSync(CHECKLIST_PATH);
    if (cachedChecklist && stat.mtimeMs === cachedChecklistMtime) return cachedChecklist;
    cachedChecklist = fs2.readFileSync(CHECKLIST_PATH, "utf-8");
    cachedChecklistMtime = stat.mtimeMs;
    return cachedChecklist;
  } catch {
    return "";
  }
}
function localDateKey(now, tz) {
  const d = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function localHour(now, tz) {
  return new Date(now.toLocaleString("en-US", { timeZone: tz })).getHours();
}
async function alreadyLogged(userId2, messageType, sentDate) {
  const rows = await db.select({ id: proactiveScheduleLog.id }).from(proactiveScheduleLog).where(
    and28(
      eq33(proactiveScheduleLog.userId, userId2),
      eq33(proactiveScheduleLog.messageType, messageType),
      eq33(proactiveScheduleLog.sentDate, sentDate)
    )
  ).limit(1);
  return rows.length > 0;
}
async function recordLog(userId2, messageType, sentDate) {
  try {
    await db.insert(proactiveScheduleLog).values({ userId: userId2, messageType, sentDate });
  } catch (err) {
    console.error("[Heartbeat] recordLog error:", err);
  }
}
async function runMeetingBriefs(userId2, chatId, token, memories, now, tz, userEmail) {
  const localKey = localDateKey(now, tz);
  let events = [];
  try {
    events = await getGoogleCalendarEvents(localKey, void 0, void 0, token);
  } catch (err) {
    console.error(`[Heartbeat] calendar fetch failed for ${userId2}:`, err);
    return 0;
  }
  if (events.length === 0) return 0;
  const userDomain = userEmail && userEmail.includes("@") ? userEmail.split("@")[1].toLowerCase() : null;
  const userEmailLower = userEmail?.toLowerCase() || null;
  const nowMs = now.getTime();
  let fired = 0;
  for (const event of events) {
    const startMs = new Date(event.start).getTime();
    const minutesUntil = (startMs - nowMs) / 6e4;
    if (minutesUntil < 30 || minutesUntil > 60) continue;
    const attendees = (event.attendees || []).filter((a) => !a.self);
    if (attendees.length === 0) continue;
    const externalAttendees = attendees.filter((a) => {
      const email = a.email?.toLowerCase();
      if (!email || !email.includes("@")) return false;
      if (userEmailLower && email === userEmailLower) return false;
      const domain = email.split("@")[1];
      if (userDomain) return domain !== userDomain;
      return true;
    });
    if (externalAttendees.length === 0) continue;
    const messageType = `meeting_brief:${event.id}`;
    if (await alreadyLogged(userId2, messageType, localKey)) continue;
    let emailContext = "";
    try {
      const titleWords = event.title.split(/[\s,\-—]+/).filter((w) => w.length > 3).map((w) => w.toLowerCase());
      if (titleWords.length > 0) {
        const recent = await getEmailsSince(Date.now() - 7 * 24 * 60 * 60 * 1e3, token);
        const matches = recent.filter((e) => titleWords.some((w) => e.subject.toLowerCase().includes(w))).slice(0, 3);
        if (matches.length > 0) {
          emailContext = matches.map((e) => `- "${e.subject}" from ${e.from.replace(/<.*>/, "").trim()}`).join("\n");
        }
      }
    } catch {
    }
    let webContext = "";
    try {
      const focal = externalAttendees[0];
      const query = focal.displayName || focal.email.split("@")[1] || event.title;
      if (query && query.length > 2) {
        const result = await tavilySearch(query, 3);
        const formatted = formatSearchResults(result).slice(0, 1500);
        if (formatted) webContext = formatted;
      }
    } catch {
    }
    const attendeeList = attendees.length > 0 ? attendees.slice(0, 6).map((a) => a.displayName || a.email).join(", ") : "no listed attendees";
    let memoryContext = "";
    try {
      const { retrieveRelevantMemories: retrieveMemories } = await Promise.resolve().then(() => (init_retrieve(), retrieve_exports));
      const seedQuery = [event.title, attendeeList, event.description?.slice(0, 200) || ""].filter(Boolean).join(" \u2022 ");
      const ranked = await retrieveMemories(userId2, seedQuery, 8);
      if (ranked.length > 0) {
        memoryContext = ranked.map((m) => `- [${m.category}] ${m.content}`).join("\n");
      }
    } catch {
      memoryContext = memories.length > 0 ? memories.slice(0, 10).map((m) => `- [${m.category}] ${m.content}`).join("\n") : "";
    }
    let peopleContext = "";
    try {
      const emails = externalAttendees.map((a) => a.email.toLowerCase()).filter(Boolean);
      if (emails.length > 0) {
        const peopleRows = await db.select().from(people).where(and28(eq33(people.userId, userId2), sql18`lower(${people.email}) = ANY(${emails})`));
        if (peopleRows.length > 0) {
          peopleContext = peopleRows.map((p) => {
            const bits = [`${p.name}${p.email ? ` <${p.email}>` : ""}`];
            if (p.relationship) bits.push(`relationship: ${p.relationship}`);
            if (p.interactionCount && p.interactionCount > 0) bits.push(`prior interactions: ${p.interactionCount}`);
            if (p.lastInteractionAt) bits.push(`last seen: ${new Date(p.lastInteractionAt).toISOString().slice(0, 10)}`);
            if (p.notes) bits.push(`notes: ${p.notes.slice(0, 200)}`);
            return `- ${bits.join(" \u2014 ")}`;
          }).join("\n");
        }
      }
    } catch (err) {
      console.error("[Heartbeat] people lookup failed:", err);
    }
    const eventTime = new Date(event.start).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: tz
    });
    const prompt = `Compose a tight pre-meeting briefing for the user.

Meeting: "${event.title}"
Time: ${eventTime} (${tz})
Attendees: ${attendeeList}
${event.location ? `Location: ${event.location}
` : ""}${event.description ? `Description: ${event.description.slice(0, 400)}
` : ""}
${emailContext ? `
Related recent emails:
${emailContext}
` : ""}${webContext ? `
Web context:
${webContext}
` : ""}${peopleContext ? `
Relationship history with attendees:
${peopleContext}
` : ""}${memoryContext ? `
What we know about the user:
${memoryContext}
` : ""}

Output exactly 3 short bullets (one line each, no headers):
\u2022 Who/what \u2014 one line on the meeting and key person/company
\u2022 Why it matters \u2014 one line on stakes or context
\u2022 Suggested focus \u2014 one specific thing to drive in the meeting

Plain text, no markdown asterisks, no preamble.`;
    let brief = "";
    try {
      const resp = await openai13.chat.completions.create({
        model: "gpt-5-mini",
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: 600
      });
      brief = resp.choices[0]?.message?.content?.trim() || "";
    } catch (err) {
      console.error(`[Heartbeat] brief generation failed for "${event.title}":`, err);
      continue;
    }
    if (!brief) continue;
    const header = `\u{1F4C5} Meeting in ~${Math.round(minutesUntil)} min \u2014 ${event.title} (${eventTime})`;
    const fullMsg = `${header}

${brief}`;
    try {
      await notifyUser(userId2, "meeting_brief", fullMsg);
      await recordLog(userId2, messageType, localKey);
      logInteraction(userId2, "notification", "outbound", fullMsg, "meeting_brief").catch(() => {
      });
      fired++;
      console.log(`[Heartbeat] sent meeting brief for "${event.title}" to ${userId2}`);
    } catch (err) {
      console.error(`[Heartbeat] send brief failed:`, err);
    }
  }
  return fired;
}
async function runEmailDrafts(userId2, chatId, token, now) {
  const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1e3);
  let urgentItems = [];
  try {
    urgentItems = await db.select().from(inboxItems).where(
      and28(
        eq33(inboxItems.userId, userId2),
        eq33(inboxItems.sourceType, "email"),
        eq33(inboxItems.status, "pending"),
        sql18`${inboxItems.surfacedAt} > ${twelveHoursAgo}`,
        sql18`${inboxItems.jarvisReason} IS NOT NULL`,
        sql18`${inboxItems.matchedRuleId} IS NULL`
      )
    ).limit(10);
  } catch (err) {
    console.error(`[Heartbeat] urgent inbox fetch failed:`, err);
    return 0;
  }
  if (urgentItems.length === 0) return 0;
  const replySignals = /reply|respond|response|answer|follow[- ]?up|confirm|question|asking|requesting/i;
  urgentItems = urgentItems.filter((it) => replySignals.test(it.jarvisReason || ""));
  if (urgentItems.length === 0) return 0;
  let recentEmails = [];
  try {
    recentEmails = await getEmailsSince(Date.now() - 24 * 60 * 60 * 1e3, token);
  } catch {
  }
  let queued = 0;
  for (const item of urgentItems) {
    const sourceMessageId = item.sourceId.startsWith("gmail:") ? item.sourceId.slice(6) : null;
    if (!sourceMessageId) continue;
    try {
      const existing = await db.select({ id: emailDrafts.id }).from(emailDrafts).where(
        and28(
          eq33(emailDrafts.userId, userId2),
          eq33(emailDrafts.sourceMessageId, sourceMessageId)
        )
      ).limit(1);
      if (existing.length > 0) continue;
    } catch {
    }
    const matched = recentEmails.find((e) => e.messageId === sourceMessageId);
    const senderEmail = matched?.from || item.sender || "";
    const recipientMatch = senderEmail.match(/<([^>]+)>/);
    const recipientEmail = recipientMatch ? recipientMatch[1] : senderEmail.trim();
    if (!recipientEmail || !recipientEmail.includes("@")) continue;
    const subject = item.subject || matched?.subject || "(no subject)";
    const snippet = item.snippet || matched?.snippet || "";
    const reason = item.jarvisReason || "";
    const prompt = `You are drafting a reply on the user's behalf. Be polite, direct, on-voice. Plain text, no markdown.

Original email:
From: ${senderEmail}
Subject: ${subject}
Snippet: ${snippet}

Why this needs a reply: ${reason}

Write a concise reply (2\u20134 short paragraphs max). Do NOT invent commitments, prices, dates, or facts the user has not stated. If you need information from the user, leave a clearly bracketed placeholder like [confirm date] or [add link]. Sign off as the user \u2014 do not include a signature line.

Return JSON: { "subject": "Re: ...", "body": "..." }`;
    let draftSubject = subject.startsWith("Re:") ? subject : `Re: ${subject}`;
    let draftBody = "";
    try {
      const resp = await openai13.chat.completions.create({
        model: "gpt-5-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_completion_tokens: 800
      });
      const raw = resp.choices[0]?.message?.content || "{}";
      const parsed = JSON.parse(raw);
      if (parsed.subject) draftSubject = parsed.subject;
      if (parsed.body) draftBody = parsed.body;
    } catch (err) {
      console.error(`[Heartbeat] draft generation failed:`, err);
      continue;
    }
    if (!draftBody.trim()) continue;
    try {
      await db.insert(emailDrafts).values({
        userId: userId2,
        sourceMessageId,
        fromSender: senderEmail,
        originalSubject: subject,
        draftSubject,
        draftBody,
        jarvisReason: reason
      });
      queued++;
      console.log(`[Heartbeat] queued draft reply for "${subject}" (user ${userId2})`);
    } catch (err) {
      const code = err?.code;
      if (code !== "23505") console.error(`[Heartbeat] draft insert failed:`, err);
    }
  }
  if (queued > 0) {
    const localKey = localDateKey(now, "UTC");
    const nudgeKey = `draft_nudge:${queued}`;
    if (!await alreadyLogged(userId2, nudgeKey, localKey)) {
      try {
        await sendMessage(
          chatId,
          `\u2709\uFE0F ${queued} email draft${queued === 1 ? "" : "s"} waiting for your review in the Inbox tab.`
        );
        await recordLog(userId2, nudgeKey, localKey);
        logInteraction(userId2, "notification", "outbound", `Draft queue: ${queued} item(s)`, "draft_nudge").catch(() => {
        });
      } catch (err) {
        console.error(`[Heartbeat] draft nudge send failed:`, err);
      }
    }
  }
  return queued;
}
async function runEveningWrapUp(userId2, chatId, token, prefs, now, tz) {
  const wrapHour = typeof prefs.eveningWrapUpHour === "number" ? prefs.eveningWrapUpHour : 21;
  const hour = localHour(now, tz);
  if (hour < wrapHour || hour >= 24) return false;
  const localKey = localDateKey(now, tz);
  const messageType = "evening_wrapup";
  if (await alreadyLogged(userId2, messageType, localKey)) return false;
  let tasks = [];
  try {
    const planRows = await db.select().from(plans).where(and28(eq33(plans.userId, userId2), eq33(plans.date, localKey))).limit(1);
    const data = planRows[0]?.data || {};
    tasks = Array.isArray(data.tasks) ? data.tasks : [];
  } catch {
  }
  let statsData = {};
  let statsRowExists = false;
  try {
    const statsRows = await db.select().from(stats).where(eq33(stats.userId, userId2)).limit(1);
    if (statsRows.length > 0) {
      statsData = statsRows[0].data || {};
      statsRowExists = true;
    }
  } catch {
  }
  const completed = tasks.filter((t) => t.completed);
  const open = tasks.filter((t) => !t.completed);
  const completedCount = completed.length;
  if (completedCount > 0 && statsRowExists) {
    try {
      const yesterday = (() => {
        const d = new Date(now);
        d.setDate(d.getDate() - 1);
        return localDateKey(d, tz);
      })();
      const lastDate = statsData.lastStreakDate || "";
      let newStreak = statsData.streak || 0;
      if (lastDate === localKey) {
      } else if (lastDate === yesterday) {
        newStreak += 1;
      } else if (lastDate < localKey) {
        newStreak = 1;
      }
      const xpEarned = completedCount * 10;
      const newXp = (statsData.xp || 0) + xpEarned;
      const newTotalCompleted = (statsData.totalCompleted || 0) + completedCount;
      const newBestStreak = Math.max(statsData.bestStreak || 0, newStreak);
      await db.update(stats).set({
        data: {
          ...statsData,
          streak: newStreak,
          bestStreak: newBestStreak,
          xp: newXp,
          totalCompleted: newTotalCompleted,
          lastStreakDate: localKey
        },
        updatedAt: /* @__PURE__ */ new Date()
      }).where(eq33(stats.userId, userId2));
      statsData = {
        ...statsData,
        streak: newStreak,
        bestStreak: newBestStreak,
        xp: newXp,
        totalCompleted: newTotalCompleted,
        lastStreakDate: localKey
      };
      console.log(`[Heartbeat] stats updated for ${userId2}: streak=${newStreak}, xp+${xpEarned}`);
    } catch (err) {
      console.error(`[Heartbeat] stats update failed (non-fatal):`, err);
    }
  }
  const completedList = completed.length > 0 ? completed.slice(0, 8).map((t) => `- ${t.title}`).join("\n") : "(nothing checked off today)";
  const openList = open.length > 0 ? open.slice(0, 6).map((t) => `- ${t.title}`).join("\n") : "(no open items)";
  const llmPrompt = `Compose a short evening wrap-up for the user. Warm but direct \u2014 no fluff.

Today (${localKey}):
Streak: ${statsData.streak || 0} days | XP: ${statsData.xp || 0} | Best streak: ${statsData.bestStreak || 0}

Completed today (${completedCount}):
${completedList}

Still open (${open.length}):
${openList}

Return JSON:
{
  "summary": "<4 short sentences: (1) acknowledge what got done, (2) note what's still open, (3) one observation about today's pattern, (4) one specific prompt for tomorrow morning \u2014 plain text, no markdown, total \u226490 words>",
  "tomorrowPrompt": "<single sentence: a concrete morning-focus intention for tomorrow, \u226420 words>",
  "observation": "<one sentence pattern observation from today, \u226415 words>"
}`;
  let summary = "";
  let tomorrowPrompt = "";
  let observation = "";
  try {
    const resp = await openai13.chat.completions.create({
      model: "gpt-5-mini",
      messages: [{ role: "user", content: llmPrompt }],
      response_format: { type: "json_object" },
      max_completion_tokens: 600
    });
    const parsed = JSON.parse(resp.choices[0]?.message?.content || "{}");
    summary = parsed.summary?.trim() || "";
    tomorrowPrompt = parsed.tomorrowPrompt?.trim() || "";
    observation = parsed.observation?.trim() || "";
  } catch (err) {
    console.error(`[Heartbeat] wrap-up generation failed:`, err);
    return false;
  }
  if (!summary) return false;
  try {
    await notifyUser(userId2, "evening_wrap", `\u{1F319} Evening wrap-up

${summary}`);
    logInteraction(userId2, "notification", "outbound", summary, "evening_wrapup").catch(() => {
    });
  } catch (err) {
    console.error(`[Heartbeat] wrap-up send failed:`, err);
    return false;
  }
  try {
    const tomorrowKey = (() => {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      return localDateKey(d, tz);
    })();
    const prefRows = await db.select().from(userPreferences).where(eq33(userPreferences.userId, userId2)).limit(1);
    const prefData = prefRows[0]?.data || {};
    const tomorrowSeed = {
      date: tomorrowKey,
      generatedAt: now.toISOString(),
      carryoverTasks: open.slice(0, 8).map((t) => t.title),
      observation,
      tomorrowPrompt
    };
    await db.update(userPreferences).set({ data: { ...prefData, tomorrowSeed }, updatedAt: /* @__PURE__ */ new Date() }).where(eq33(userPreferences.userId, userId2));
    console.log(`[Heartbeat] tomorrow seed written for ${userId2} (date: ${tomorrowKey})`);
  } catch (err) {
    console.error(`[Heartbeat] tomorrow seed write failed (non-fatal):`, err);
  }
  if (token) {
    try {
      const reflection = `# Evening reflection \u2014 ${localKey}

${summary}

---

## Completed (${completedCount})
${completedList}

## Carry into tomorrow (${open.length})
${openList}
${observation ? `
## Pattern note
${observation}
` : ""}${tomorrowPrompt ? `
## Tomorrow morning
${tomorrowPrompt}
` : ""}`;
      await createDriveTextFile(token, `reflection-${localKey}.md`, reflection, { convertToDoc: false });
      console.log(`[Heartbeat] reflection saved to Drive for ${userId2}`);
    } catch (err) {
      console.error(`[Heartbeat] Drive save failed (non-fatal):`, err);
    }
  }
  await recordLog(userId2, messageType, localKey);
  return true;
}
async function runHeartbeatTick() {
  try {
    const { maybeRunDailyDecay: maybeRunDailyDecay2 } = await Promise.resolve().then(() => (init_decay(), decay_exports));
    await maybeRunDailyDecay2();
  } catch (err) {
    console.error("[Heartbeat] memory decay failed:", err);
  }
  const checklist = readChecklist();
  if (!checklist) {
    console.warn("[Heartbeat] checklist file missing, skipping tick");
    return;
  }
  let links = [];
  try {
    links = await db.select().from(telegramLinks);
  } catch (err) {
    console.error("[Heartbeat] failed to load telegram links:", err);
    return;
  }
  if (links.length === 0) return;
  const allPrefs = await db.select().from(userPreferences).catch(() => []);
  const prefsMap = {};
  for (const p of allPrefs) prefsMap[p.userId] = p.data || {};
  const allUsers = await db.select({ id: users.id, username: users.username }).from(users).catch(() => []);
  const userEmailMap = {};
  for (const u of allUsers) userEmailMap[u.id] = u.username || null;
  const now = /* @__PURE__ */ new Date();
  for (const link of links) {
    const prefs = prefsMap[link.userId] || {};
    if (prefs.heartbeatEnabled === false) continue;
    const tz = prefs.timezone || "America/New_York";
    const userEmail = userEmailMap[link.userId] || null;
    let token = null;
    try {
      const tokens = await getValidGoogleTokens(link.userId);
      token = tokens?.[0] || null;
    } catch {
    }
    let memories = [];
    try {
      memories = await db.select({ content: userMemories.content, category: userMemories.category }).from(userMemories).where(eq33(userMemories.userId, link.userId)).orderBy(desc11(userMemories.extractedAt)).limit(30);
    } catch {
    }
    let actionsFired = 0;
    try {
      if (token) actionsFired += await runMeetingBriefs(link.userId, link.chatId, token, memories, now, tz, userEmail);
    } catch (err) {
      console.error(`[Heartbeat] meeting briefs failed for ${link.userId}:`, err);
    }
    try {
      if (token) actionsFired += await runEmailDrafts(link.userId, link.chatId, token, now);
    } catch (err) {
      console.error(`[Heartbeat] email drafts failed for ${link.userId}:`, err);
    }
    try {
      if (await runEveningWrapUp(link.userId, link.chatId, token, prefs, now, tz)) actionsFired++;
    } catch (err) {
      console.error(`[Heartbeat] wrap-up failed for ${link.userId}:`, err);
    }
    try {
      await runHeartbeatMemoryPass(link.userId, token, now);
    } catch (err) {
      console.error(`[Heartbeat] memory pass failed for ${link.userId}:`, err);
    }
    if (actionsFired > 0) {
      console.log(`[Heartbeat] user ${link.userId} \u2014 ${actionsFired} action(s) fired`);
    }
  }
}
var lastHeartbeatExtractAt = {};
var HEARTBEAT_EXTRACT_INTERVAL_MS = 60 * 60 * 1e3;
async function runHeartbeatMemoryPass(userId2, googleToken, now) {
  const last = lastHeartbeatExtractAt[userId2] || 0;
  if (now.getTime() - last < HEARTBEAT_EXTRACT_INTERVAL_MS) return;
  lastHeartbeatExtractAt[userId2] = now.getTime();
  const sinceCutoff = new Date(now.getTime() - HEARTBEAT_EXTRACT_INTERVAL_MS);
  try {
    const recentMessages = await db.select().from(telegramGroupMessages).where(and28(eq33(telegramGroupMessages.userId, userId2), gte5(telegramGroupMessages.messageDate, sinceCutoff))).orderBy(desc11(telegramGroupMessages.messageDate)).limit(20);
    if (recentMessages.length > 0) {
      const text2 = recentMessages.map((m) => `[${m.fromUser ?? "?"}]: ${m.text}`).join("\n").slice(0, 4e3);
      const { extractAndStore: extractAndStore2 } = await Promise.resolve().then(() => (init_extractor(), extractor_exports));
      await extractAndStore2({
        userId: userId2,
        source: text2,
        sourceType: "heartbeat_telegram",
        sourceRef: `${now.toISOString().slice(0, 13)}`
      });
    }
  } catch (err) {
    console.error(`[Heartbeat] telegram extract failed for ${userId2}:`, err);
  }
  try {
    if (googleToken) {
      const { syncPeopleFromGoogle: syncPeopleFromGoogle2 } = await Promise.resolve().then(() => (init_peopleSync(), peopleSync_exports));
      await syncPeopleFromGoogle2(userId2, googleToken, now);
    }
  } catch (err) {
    console.error(`[Heartbeat] people sync failed for ${userId2}:`, err);
  }
}
function startHeartbeat() {
  if (!isTelegramConfigured()) return;
  console.log(`[Heartbeat] daemon started \u2014 checklist at ${CHECKLIST_PATH}, interval ${HEARTBEAT_INTERVAL_MS / 1e3}s`);
  setTimeout(() => {
    runHeartbeatTick().catch((err) => console.error("[Heartbeat] tick error:", err));
  }, 60 * 1e3);
  setInterval(() => {
    runHeartbeatTick().catch((err) => console.error("[Heartbeat] tick error:", err));
  }, HEARTBEAT_INTERVAL_MS);
}

// server/index.ts
init_jobQueue();
init_telegram();

// server/scheduler.ts
init_db();
init_schema();
init_routes2();
init_goalScheduler();
init_weeklyJob();
import { eq as eq34, and as and29 } from "drizzle-orm";
var schedulerRunning = false;
var lastWeeklyRunKey = "";
function sundayKey(d) {
  const start = new Date(d);
  const day = start.getDay();
  start.setDate(start.getDate() - day);
  return `${start.getFullYear()}-${start.getMonth() + 1}-${start.getDate()}`;
}
function startScheduler() {
  if (schedulerRunning) return;
  schedulerRunning = true;
  setInterval(async () => {
    const now = /* @__PURE__ */ new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    const dow = now.getDay();
    if (h === 7 && m === 0) {
      console.log("[Scheduler] Running morning plan build...");
      await runMorningPlanBuild();
    }
    if (dow === 0 && h === 3 && m === 0) {
      const key = sundayKey(now);
      if (key !== lastWeeklyRunKey) {
        lastWeeklyRunKey = key;
        try {
          const count = await enqueueWeeklyPatternJobs();
          console.log(`[Scheduler] Sunday weekly pattern jobs enqueued: ${count}`);
        } catch (err) {
          console.error("[Scheduler] enqueueWeeklyPatternJobs failed:", err);
        }
      }
    }
  }, 60 * 1e3);
  console.log("[Scheduler] Started \u2014 morning plan 7:00 AM daily, weekly patterns Sunday 3:00 AM");
}
async function runMorningPlanBuild() {
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const allUsers = await db.select({ id: users.id }).from(users);
  console.log(`[Scheduler] Processing ${allUsers.length} user(s) for auto-plan build`);
  for (const user of allUsers) {
    try {
      const existingPlan = await db.select({ data: plans.data }).from(plans).where(and29(eq34(plans.userId, user.id), eq34(plans.date, today)));
      const existingTasks = existingPlan[0]?.data?.tasks || [];
      if (existingTasks.length > 0) {
        console.log(`[Scheduler] User ${user.id} already has ${existingTasks.length} tasks, skipping`);
        continue;
      }
      const result = await buildPlanForUser(user.id);
      if (!result || result.tasks.length === 0) {
        console.log(`[Scheduler] No tasks generated for user ${user.id}, skipping`);
        continue;
      }
      const newTasks = result.tasks.map((t) => ({
        id: `jarvis_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        title: t.title,
        category: t.category,
        priority: t.priority,
        duration: t.duration,
        time: t.time,
        description: t.description,
        completed: false,
        createdAt: Date.now(),
        fromJarvis: true
      }));
      let injected = [];
      try {
        injected = await getInjectableGoalTasks(user.id, today);
      } catch (e) {
        console.error(`[Scheduler] goal injection lookup failed for ${user.id}:`, e);
      }
      for (const pick of injected) {
        const minutes = Math.max(15, Math.round((pick.estimateHours || 1) * 60));
        const goalTask = {
          id: `goal_${pick.taskId}_${today}`,
          title: pick.title,
          category: "goal",
          priority: "high",
          duration: minutes,
          time: void 0,
          description: pick.description ? `${pick.description} (from goal: ${pick.goalTitle})` : `From goal: ${pick.goalTitle}`,
          completed: false,
          createdAt: Date.now(),
          fromJarvis: true,
          goalTreeId: pick.goalTreeId,
          goalTaskId: pick.taskId
        };
        newTasks.push(goalTask);
      }
      if (injected.length > 0) {
        try {
          await markTasksInjected(user.id, injected, today);
          console.log(`[Scheduler] injected ${injected.length} goal task(s) for user ${user.id}`);
        } catch (e) {
          console.error(`[Scheduler] markTasksInjected failed for ${user.id}:`, e);
        }
      }
      await db.insert(plans).values({
        userId: user.id,
        date: today,
        data: { date: today, tasks: newTasks }
      }).onConflictDoUpdate({
        target: [plans.userId, plans.date],
        set: { data: { date: today, tasks: newTasks }, updatedAt: /* @__PURE__ */ new Date() }
      });
      const topTask = result.tasks[0];
      const existingPrefs = await db.select({ data: userPreferences.data }).from(userPreferences).where(eq34(userPreferences.userId, user.id));
      const currentPrefs = existingPrefs[0]?.data || {};
      const updatedPrefs = {
        ...currentPrefs,
        autoBuiltPlan: {
          date: today,
          topTask: topTask.title,
          reasoning: result.reasoning,
          taskCount: result.tasks.length
        }
      };
      await db.insert(userPreferences).values({
        userId: user.id,
        data: updatedPrefs
      }).onConflictDoUpdate({
        target: [userPreferences.userId],
        set: {
          data: updatedPrefs,
          updatedAt: /* @__PURE__ */ new Date()
        }
      });
      console.log(`[Scheduler] Auto-built ${newTasks.length} tasks for user ${user.id} (top: "${topTask.title}")`);
    } catch (err) {
      console.error(`[Scheduler] Auto-plan build failed for user ${user.id}:`, err);
    }
  }
  console.log("[Scheduler] Morning plan build complete");
}

// server/channels/index.ts
init_registry();

// server/channels/telegramChannel.ts
init_db();
init_schema();
init_telegram();
import { eq as eq35 } from "drizzle-orm";
var linkCache = /* @__PURE__ */ new Map();
var LINK_CACHE_TTL = 6e4;
var linkCacheTimestamps = /* @__PURE__ */ new Map();
async function lookupChatId(userId2) {
  const ts = linkCacheTimestamps.get(userId2);
  if (ts && Date.now() - ts < LINK_CACHE_TTL) {
    return linkCache.get(userId2) ?? null;
  }
  try {
    const rows = await db.select({ chatId: telegramLinks.chatId }).from(telegramLinks).where(eq35(telegramLinks.userId, userId2)).limit(1);
    const chatId = rows[0]?.chatId ?? null;
    linkCache.set(userId2, chatId);
    linkCacheTimestamps.set(userId2, Date.now());
    return chatId;
  } catch (err) {
    console.error("[telegramChannel] link lookup failed:", err);
    return null;
  }
}
var telegramChannel = {
  name: "telegram",
  isConfigured: () => isTelegramConfigured(),
  isLinkedFor: async (userId2) => !!await lookupChatId(userId2),
  async sendMessage(userId2, text2, opts = {}) {
    const chatId = await lookupChatId(userId2);
    if (!chatId) return { ok: false, error: "no telegram link" };
    try {
      if (text2 && text2.trim()) await sendMessage(chatId, text2);
      for (const att of opts.attachments || []) {
        if (att.kind === "document") {
          await sendTelegramDocument(chatId, att.filename, att.content, att.caption, att.mimeType);
        }
      }
      return { ok: true, messageId: chatId };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }
};

// server/channels/whatsappChannel.ts
init_db();
init_schema();
import { eq as eq36, and as and30 } from "drizzle-orm";
var TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
var TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
var TWILIO_FROM = process.env.TWILIO_WHATSAPP_NUMBER;
function isTwilioConfigured() {
  return !!(TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM);
}
async function sendWhatsAppMessage(toAddress, body) {
  if (!isTwilioConfigured()) return { ok: false, error: "twilio not configured" };
  const to = toAddress.startsWith("whatsapp:") ? toAddress : `whatsapp:${toAddress}`;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
  const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64");
  const params = new URLSearchParams({ From: TWILIO_FROM, To: to, Body: body });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: `${data.message || "twilio error"} (code ${data.code || res.status})` };
    }
    return { ok: true, sid: data.sid };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
async function lookupAddress(userId2) {
  try {
    const rows = await db.select({ address: channelLinks.address }).from(channelLinks).where(and30(eq36(channelLinks.userId, userId2), eq36(channelLinks.channel, "whatsapp"))).limit(1);
    return rows[0]?.address ?? null;
  } catch (err) {
    console.error("[whatsappChannel] link lookup failed:", err);
    return null;
  }
}
var whatsappChannel = {
  name: "whatsapp",
  isConfigured: () => isTwilioConfigured(),
  isLinkedFor: async (userId2) => !!await lookupAddress(userId2),
  async sendMessage(userId2, text2, opts = {}) {
    const address = await lookupAddress(userId2);
    if (!address) return { ok: false, error: "no whatsapp link" };
    let body = text2 || "";
    if (opts.attachments && opts.attachments.length > 0) {
      body = body ? `${body}

(${opts.attachments.length} attachment(s) generated \u2014 open the GamePlan app to download.)` : `(${opts.attachments.length} attachment(s) generated \u2014 open the GamePlan app to download.)`;
    }
    const result = await sendWhatsAppMessage(address, body);
    return { ok: result.ok, messageId: result.sid, error: result.error };
  }
};

// server/channels/index.ts
init_slackChannel();

// server/channels/daemonChannel.ts
init_db();
init_schema();
init_bridge();
import { eq as eq37, and as and31 } from "drizzle-orm";
async function lookupDaemon(userId2) {
  try {
    const rows = await db.select({ id: channelLinks.id }).from(channelLinks).where(and31(eq37(channelLinks.userId, userId2), eq37(channelLinks.channel, "daemon"))).limit(1);
    return rows.length > 0;
  } catch (err) {
    console.error("[daemonChannel] link lookup failed:", err);
    return false;
  }
}
var daemonChannel = {
  name: "daemon",
  isConfigured: () => true,
  async isLinkedFor(userId2) {
    return await lookupDaemon(userId2) && isUserPaired(userId2);
  },
  async sendMessage(userId2, text2, _opts = {}) {
    if (!isUserPaired(userId2)) return { ok: false, error: "daemon not connected" };
    if (!await isDaemonActionAllowed(userId2, "notify")) {
      return { ok: false, error: "daemon notify permission disabled by user" };
    }
    try {
      const title = "GamePlan Coach";
      const result = await sendDaemonOp(userId2, { type: "notify", title, body: text2 }, 5e3);
      if (!result.ok) return { ok: false, error: result.error || "daemon notify failed" };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }
};

// server/channels/discordChannel.ts
init_db();
init_schema();
init_userTokenStore();
init_manager();
import { eq as eq38, and as and32 } from "drizzle-orm";
var discordChannel = {
  name: "discord",
  isConfigured() {
    return true;
  },
  async isLinkedFor(userId2) {
    try {
      const [tok, link] = await Promise.all([
        getUserToken(userId2, "discord_bot"),
        db.select({ id: channelLinks.id }).from(channelLinks).where(and32(eq38(channelLinks.userId, userId2), eq38(channelLinks.channel, "discord"))).limit(1)
      ]);
      return !!(tok && link.length > 0 && getBotStatus(userId2) === "running");
    } catch {
      return false;
    }
  },
  async sendMessage(userId2, text2, _opts = {}) {
    if (!text2?.trim()) return { ok: true };
    const sent = await sendToDiscordUser(userId2, text2);
    if (!sent) return { ok: false, error: "Discord send failed \u2014 bot not running or user not linked" };
    return { ok: true };
  }
};

// server/channels/index.ts
init_registry();
init_coachAgent();
function initChannels() {
  registerChannel(telegramChannel);
  registerChannel(whatsappChannel);
  registerChannel(slackChannel);
  registerChannel(daemonChannel);
  registerChannel(discordChannel);
  console.log("[channels] registered: telegram, whatsapp, slack, daemon, discord");
}

// server/channels/whatsappWebhook.ts
init_db();
init_schema();
init_coachAgent();
import { eq as eq39, and as and33, sql as sql19 } from "drizzle-orm";
import express2 from "express";
import * as crypto4 from "crypto";
function verifyTwilioSignature(req) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return false;
  const sigHeader = req.header("x-twilio-signature");
  if (!sigHeader) return false;
  const proto = (req.header("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim();
  const host = req.header("x-forwarded-host") || req.header("host") || "";
  const fullUrl = `${proto}://${host}${req.originalUrl}`;
  const params = req.body || {};
  const sortedKeys = Object.keys(params).sort();
  let data = fullUrl;
  for (const k of sortedKeys) data += k + String(params[k] ?? "");
  const expected = crypto4.createHmac("sha1", authToken).update(data).digest("base64");
  try {
    return crypto4.timingSafeEqual(Buffer.from(expected), Buffer.from(sigHeader));
  } catch {
    return false;
  }
}
async function findUserByPhone(phone) {
  try {
    const rows = await db.select({ userId: channelLinks.userId }).from(channelLinks).where(and33(eq39(channelLinks.channel, "whatsapp"), eq39(channelLinks.address, phone))).limit(1);
    return rows[0]?.userId ?? null;
  } catch (err) {
    console.error("[whatsapp] user lookup failed:", err);
    return null;
  }
}
async function tryConsumeLinkCode(code, phone) {
  try {
    const rows = await db.select().from(channelLinkCodes).where(and33(eq39(channelLinkCodes.code, code), eq39(channelLinkCodes.channel, "whatsapp"))).limit(1);
    const row = rows[0];
    if (!row) return null;
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
      await db.delete(channelLinkCodes).where(eq39(channelLinkCodes.code, code));
      return null;
    }
    await db.insert(channelLinks).values({
      userId: row.userId,
      channel: "whatsapp",
      address: phone,
      metadata: {}
    }).onConflictDoUpdate({
      target: [channelLinks.channel, channelLinks.address],
      set: { userId: row.userId, lastSeenAt: /* @__PURE__ */ new Date() }
    });
    await db.delete(channelLinkCodes).where(eq39(channelLinkCodes.code, code));
    return row.userId;
  } catch (err) {
    console.error("[whatsapp] link code consume failed:", err);
    return null;
  }
}
function registerWhatsAppWebhook(app2) {
  app2.post("/api/channels/whatsapp/webhook", express2.urlencoded({ extended: false }), async (req, res) => {
    if (!isTwilioConfigured()) {
      return res.status(503).type("text/xml").send("<Response/>");
    }
    if (!verifyTwilioSignature(req)) {
      console.warn("[whatsapp] rejected webhook: invalid or missing signature");
      return res.status(401).type("text/xml").send("<Response/>");
    }
    const from = String(req.body?.From || "");
    const text2 = String(req.body?.Body || "").trim();
    res.type("text/xml").status(200).send("<Response/>");
    if (!from) return;
    let userId2 = await findUserByPhone(from);
    if (!userId2) {
      const codeMatch = text2.match(/^[A-Z0-9]{6,8}$/i);
      if (codeMatch) {
        const linked = await tryConsumeLinkCode(text2.toUpperCase(), from);
        if (linked) {
          await sendWhatsAppMessage(from, "\u2705 You're connected to GamePlan! Jarvis can now reach you here. Send a message any time.");
          return;
        }
        await sendWhatsAppMessage(from, "That code didn't work or has expired. Open the GamePlan app \u2192 Profile \u2192 Connected Channels \u2192 WhatsApp to generate a fresh one.");
        return;
      }
      await sendWhatsAppMessage(from, "Welcome to GamePlan Coach! To connect, open the app \u2192 Profile \u2192 Connected Channels \u2192 WhatsApp, generate a link code, and send it here.");
      return;
    }
    if (!text2) {
      await sendWhatsAppMessage(from, "I got that but couldn't read any text. Try again?");
      return;
    }
    try {
      const { reply } = await runCoachAgent({ userId: userId2, userText: text2, channelName: "WhatsApp" });
      if (reply && reply.trim()) {
        await sendWhatsAppMessage(from, reply);
      }
    } catch (err) {
      console.error("[whatsapp] coach error:", err);
      await sendWhatsAppMessage(from, "Sorry, I hit an error processing that. Please try again.");
    }
  });
  const cleanup = setInterval(() => {
    db.delete(channelLinkCodes).where(and33(eq39(channelLinkCodes.channel, "whatsapp"), sql19`${channelLinkCodes.expiresAt} < NOW()`)).catch((err) => console.error("[whatsapp] code cleanup failed:", err));
  }, 5 * 60 * 1e3);
  cleanup.unref();
}

// server/index.ts
init_slackWebhook();
init_bridge();
init_manager();
import * as fs3 from "fs";
import * as path3 from "path";
var app = express3();
var log = console.log;
function setupCors(app2) {
  app2.use((req, res, next) => {
    const origins = /* @__PURE__ */ new Set();
    if (process.env.REPLIT_DEV_DOMAIN) {
      origins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
    }
    if (process.env.REPLIT_DOMAINS) {
      process.env.REPLIT_DOMAINS.split(",").forEach((d) => {
        origins.add(`https://${d.trim()}`);
      });
    }
    const origin = req.header("origin");
    const isLocalhost = origin?.startsWith("http://localhost:") || origin?.startsWith("http://127.0.0.1:");
    if (origin && (origins.has(origin) || isLocalhost)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS"
      );
      res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.header("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });
}
function setupBodyParsing(app2) {
  app2.use(
    express3.json({
      limit: "50mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      }
    })
  );
  app2.use(
    express3.urlencoded({
      extended: false,
      verify: (req, _res, buf) => {
        if (!req.rawBody) req.rawBody = buf;
      }
    })
  );
}
function setupRequestLogging(app2) {
  app2.use((req, res, next) => {
    const start = Date.now();
    const path4 = req.path;
    let capturedJsonResponse = void 0;
    const originalResJson = res.json;
    res.json = function(bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };
    res.on("finish", () => {
      if (!path4.startsWith("/api")) return;
      const duration = Date.now() - start;
      let logLine = `${req.method} ${path4} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "\u2026";
      }
      log(logLine);
    });
    next();
  });
}
function getAppName() {
  try {
    const appJsonPath = path3.resolve(process.cwd(), "app.json");
    const appJsonContent = fs3.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}
function serveExpoManifest(platform, res) {
  const manifestPath = path3.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json"
  );
  if (!fs3.existsSync(manifestPath)) {
    return res.status(404).json({ error: `Manifest not found for platform: ${platform}` });
  }
  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");
  const manifest = fs3.readFileSync(manifestPath, "utf-8");
  res.send(manifest);
}
function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName
}) {
  const forwardedProto = req.header("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "https";
  const forwardedHost = req.header("x-forwarded-host");
  const host = forwardedHost || req.get("host");
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;
  log(`baseUrl`, baseUrl);
  log(`expsUrl`, expsUrl);
  const html = landingPageTemplate.replace(/BASE_URL_PLACEHOLDER/g, baseUrl).replace(/EXPS_URL_PLACEHOLDER/g, expsUrl).replace(/APP_NAME_PLACEHOLDER/g, appName);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}
function configureExpoAndLanding(app2) {
  const templatePath = path3.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.html"
  );
  const landingPageTemplate = fs3.readFileSync(templatePath, "utf-8");
  const appName = getAppName();
  const webBuildDir = path3.resolve(process.cwd(), "static-build", "web");
  const webIndexPath = path3.join(webBuildDir, "index.html");
  log("Serving static Expo files with dynamic manifest routing");
  app2.use((req, res, next) => {
    if (req.path.startsWith("/api")) {
      return next();
    }
    if (req.path !== "/" && req.path !== "/manifest") {
      return next();
    }
    const platform = req.header("expo-platform");
    if (platform && (platform === "ios" || platform === "android")) {
      return serveExpoManifest(platform, res);
    }
    if (req.path === "/") {
      if (fs3.existsSync(webIndexPath)) {
        return res.sendFile(webIndexPath);
      }
      return serveLandingPage({
        req,
        res,
        landingPageTemplate,
        appName
      });
    }
    next();
  });
  if (fs3.existsSync(webBuildDir)) {
    app2.use(express3.static(webBuildDir));
  }
  app2.use("/assets", express3.static(path3.resolve(process.cwd(), "assets")));
  app2.use(express3.static(path3.resolve(process.cwd(), "static-build")));
  app2.use((req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/assets")) return next();
    if (fs3.existsSync(webIndexPath)) {
      return res.sendFile(webIndexPath);
    }
    next();
  });
  log("Expo routing: Checking expo-platform header on / and /manifest");
}
function setupErrorHandler(app2) {
  app2.use((err, _req, res, next) => {
    const error = err;
    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";
    console.error("Internal Server Error:", err);
    if (res.headersSent) {
      return next(err);
    }
    return res.status(status).json({ message });
  });
}
(async () => {
  await ensureTablesExist();
  logTelegramStatus();
  setupCors(app);
  setupBodyParsing(app);
  setupRequestLogging(app);
  configureExpoAndLanding(app);
  registerTelegramWebhook(app);
  registerWhatsAppWebhook(app);
  registerSlackWebhook(app);
  const server = await registerRoutes(app);
  initChannels();
  startDaemonBridge(server);
  startScheduler();
  startJobQueueWorker();
  setupErrorHandler(app);
  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true
    },
    () => {
      log(`express server serving on port ${port}`);
      if (isTelegramConfigured()) {
        const isProduction = process.env.NODE_ENV === "production";
        if (isProduction) {
          const domain = (process.env.REPLIT_DOMAINS || "").split(",")[0]?.trim();
          if (domain) {
            const webhookUrl = `https://${domain}/api/telegram/webhook`;
            setWebhook(webhookUrl).then(() => {
              console.log(`[Telegram] Production mode \u2014 webhook active at ${webhookUrl}`);
            }).catch((err) => {
              console.error("[Telegram] Failed to set webhook:", err);
            });
          } else {
            console.error("[Telegram] Production mode but REPLIT_DOMAINS is not set \u2014 cannot register webhook");
          }
        } else {
          deleteWebhook().then(() => startTelegramPolling()).catch((err) => {
            console.error("Failed to start Telegram polling:", err);
          });
        }
      }
      bootAllBots().catch((err) => {
        console.error("Failed to boot Discord bots:", err);
      });
      startProactiveScheduler().catch((err) => {
        console.error("Failed to start proactive scheduler:", err);
      });
      runProactiveStartupCatchup().catch((err) => {
        console.error("Failed to run proactive startup catchup:", err);
      });
      startMomentumExpiryScheduler();
      startEmailAlertScanner().catch((err) => {
        console.error("Failed to start email alert scanner:", err);
      });
      startHeartbeat();
    }
  );
})();
