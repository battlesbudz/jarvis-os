import { sql } from "drizzle-orm";
import { pgTable, text, varchar, jsonb, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
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
