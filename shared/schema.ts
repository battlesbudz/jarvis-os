import { sql } from "drizzle-orm";
import { pgTable, text, varchar, jsonb, timestamp, date, primaryKey, integer } from "drizzle-orm/pg-core";
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
  extractedAt: timestamp("extracted_at").defaultNow().notNull(),
});

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
  matchCount: varchar("match_count").default("0"),
  active: varchar("active").default("true"),
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
  dismissCount: varchar("dismiss_count").default("0"),
  matchedRuleId: varchar("matched_rule_id"),
  surfacedAt: timestamp("surfaced_at").defaultNow(),
  actedAt: timestamp("acted_at"),
});

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

export const agentJobs = pgTable("agent_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  agentType: varchar("agent_type").notNull(),
  title: text("title").notNull(),
  prompt: text("prompt").notNull(),
  input: jsonb("input").notNull().default(sql`'{}'::jsonb`),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
  actedAt: timestamp("acted_at"),
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
