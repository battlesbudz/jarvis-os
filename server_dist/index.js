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
  blockedTasks: () => blockedTasks,
  brainDumpInbox: () => brainDumpInbox,
  chatHistory: () => chatHistory,
  commitments: () => commitments,
  completedCalendarIds: () => completedCalendarIds,
  completionHistory: () => completionHistory,
  energyCheckins: () => energyCheckins,
  goals: () => goals,
  insertUserSchema: () => insertUserSchema,
  lifeContext: () => lifeContext,
  mobileAuthSessions: () => mobileAuthSessions,
  morningVoiceNotes: () => morningVoiceNotes,
  planSnapshots: () => planSnapshots,
  plans: () => plans,
  stats: () => stats,
  telegramGroupMessages: () => telegramGroupMessages,
  telegramLinkCodes: () => telegramLinkCodes,
  telegramLinks: () => telegramLinks,
  timerSettings: () => timerSettings,
  userMemories: () => userMemories,
  userPreferences: () => userPreferences,
  users: () => users
});
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, jsonb, timestamp, date, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
var users, insertUserSchema, plans, goals, stats, brainDumpInbox, energyCheckins, chatHistory, lifeContext, timerSettings, userPreferences, completionHistory, blockedTasks, completedCalendarIds, planSnapshots, telegramLinks, telegramLinkCodes, telegramGroupMessages, commitments, userMemories, mobileAuthSessions, morningVoiceNotes;
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
      extractedAt: timestamp("extracted_at").defaultNow().notNull()
    });
    mobileAuthSessions = pgTable("mobile_auth_sessions", {
      sessionId: text("session_id").primaryKey(),
      token: text("token").notNull(),
      expiresAt: timestamp("expires_at").notNull()
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
  }
});

// server/db.ts
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
import { sql as sql3 } from "drizzle-orm";
async function saveUserToken(token) {
  await db.execute(sql3`
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
async function getUserToken(userId, provider) {
  const rows = await db.execute(sql3`
    SELECT user_id, provider, access_token, refresh_token, expires_at, scopes, account_email
    FROM user_oauth_tokens
    WHERE user_id = ${userId} AND provider = ${provider}
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
async function getUserTokens(userId, provider) {
  const rows = await db.execute(sql3`
    SELECT user_id, provider, access_token, refresh_token, expires_at, scopes, account_email
    FROM user_oauth_tokens
    WHERE user_id = ${userId} AND provider = ${provider}
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
async function deleteUserToken(userId, provider, accountEmail) {
  if (accountEmail) {
    await db.execute(sql3`
      DELETE FROM user_oauth_tokens WHERE user_id = ${userId} AND provider = ${provider} AND account_email = ${accountEmail}
    `);
  } else {
    await db.execute(sql3`
      DELETE FROM user_oauth_tokens WHERE user_id = ${userId} AND provider = ${provider}
    `);
  }
}
async function getUserOAuthStatus(userId) {
  const rows = await db.execute(sql3`
    SELECT provider, account_email, expires_at, scopes FROM user_oauth_tokens WHERE user_id = ${userId}
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
async function getValidGoogleToken(userId) {
  const token = await getUserToken(userId, "google");
  if (!token) return null;
  if (token.expiresAt && token.expiresAt.getTime() < Date.now() + 6e4) {
    const refreshed = await refreshGoogleToken(token);
    return refreshed?.accessToken ?? null;
  }
  return token.accessToken;
}
async function getValidGoogleTokens(userId) {
  const tokens = await getUserTokens(userId, "google");
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
        scope: "offline_access Calendars.Read Mail.Read User.Read"
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
async function getValidMicrosoftToken(userId) {
  const token = await getUserToken(userId, "microsoft");
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

// server/replit_integrations/audio/client.ts
var client_exports = {};
__export(client_exports, {
  convertToWav: () => convertToWav,
  detectAudioFormat: () => detectAudioFormat,
  ensureCompatibleFormat: () => ensureCompatibleFormat,
  openai: () => openai2,
  speechToText: () => speechToText,
  speechToTextStream: () => speechToTextStream,
  textToSpeech: () => textToSpeech,
  textToSpeechStream: () => textToSpeechStream,
  voiceChat: () => voiceChat,
  voiceChatStream: () => voiceChatStream
});
import OpenAI2, { toFile } from "openai";
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
    await new Promise((resolve2, reject) => {
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
        if (code === 0) resolve2();
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
  const response = await openai2.chat.completions.create({
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
  const stream = await openai2.chat.completions.create({
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
async function textToSpeech(text2, voice = "alloy", format = "wav") {
  const response = await openai2.chat.completions.create({
    model: "gpt-audio",
    modalities: ["text", "audio"],
    audio: { voice, format },
    messages: [
      { role: "system", content: "You are an assistant that performs text-to-speech." },
      { role: "user", content: `Repeat the following text verbatim: ${text2}` }
    ]
  });
  const audioData = response.choices[0]?.message?.audio?.data ?? "";
  return Buffer3.from(audioData, "base64");
}
async function textToSpeechStream(text2, voice = "alloy") {
  const stream = await openai2.chat.completions.create({
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
  const file = await toFile(audioBuffer, `audio.${format}`);
  const response = await openai2.audio.transcriptions.create({
    file,
    model: "gpt-4o-mini-transcribe"
  });
  return response.text;
}
async function speechToTextStream(audioBuffer, format = "wav") {
  const file = await toFile(audioBuffer, `audio.${format}`);
  const stream = await openai2.audio.transcriptions.create({
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
var openai2;
var init_client = __esm({
  "server/replit_integrations/audio/client.ts"() {
    "use strict";
    openai2 = new OpenAI2({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
    });
  }
});

// server/index.ts
import express from "express";

// server/routes.ts
init_db();
init_schema();
init_schema();
import { createServer } from "node:http";
import OpenAI4 from "openai";
import { eq as eq5, and as and3, desc as desc2, sql as sql6, gte as gte2 } from "drizzle-orm";

// server/ai.ts
import OpenAI from "openai";
var openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
});
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
  const response = await openai.chat.completions.create({
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
  const response = await openai.chat.completions.create({
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
  const lifeCtxSection = lifeContext2 ? `
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
  const prompt = `You create personalized daily task plans for people. Today is ${dayOfWeek}.

User's goals:
${goalsText}

Recent activity:
${historyText}${energyFocusText}${lifeCtxSection}${gmailSection}${existingTasksSection}${carriedOverSection}${blockedSection}

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
  const response = await openai.chat.completions.create({
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
          allEvents.push({
            id: e.id || String(Math.random()),
            title: e.summary || "Event",
            start: e.start?.dateTime || e.start?.date || date2,
            end: e.end?.dateTime || e.end?.date || date2,
            description: e.description || void 0,
            location: e.location || void 0
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

// server/integrations/outlook.ts
import { Client } from "@microsoft/microsoft-graph-client";
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
  const res = await client.api("/me/calendarView").query({ startDateTime: startOfDay, endDateTime: endOfDay }).select("id,subject,start,end,body,location").orderby("start/dateTime").top(20).get();
  const items = res.value || [];
  return items.map((e) => ({
    id: e.id || String(Math.random()),
    title: e.subject || "Event",
    start: e.start?.dateTime || date2,
    end: e.end?.dateTime || date2,
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

// server/integrations/gmail.ts
import { Buffer as Buffer2 } from "node:buffer";
var LABEL_NAMES = {
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

// server/auth.ts
init_db();
init_schema();
import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import crypto2 from "crypto";
function getJwtSecret() {
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }
  const generated = crypto2.randomBytes(32).toString("hex");
  process.env.JWT_SECRET = generated;
  console.log("Generated JWT_SECRET (set JWT_SECRET env var for persistent tokens across restarts)");
  return generated;
}
var JWT_SECRET = getJwtSecret();
var TOKEN_EXPIRY = "30d";
function generateToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}
var authRouter = Router();
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
    const existing = await db.select().from(users).where(eq(users.username, username)).limit(1);
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
    const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);
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
    const existing = await db.select().from(users).where(eq(users.googleId, googleUser.id)).limit(1);
    let user;
    if (existing.length > 0) {
      user = existing[0];
      if (googleUser.name && googleUser.name !== user.displayName) {
        await db.update(users).set({ displayName: googleUser.name }).where(eq(users.id, user.id));
        user = { ...user, displayName: googleUser.name };
      }
    } else {
      const username = googleUser.email ? googleUser.email.split("@")[0] : `google_${googleUser.id.slice(0, 8)}`;
      let uniqueUsername = username;
      const existingUsername = await db.select().from(users).where(eq(users.username, username)).limit(1);
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
    }).from(users).where(eq(users.id, payload.userId)).limit(1);
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

// server/mobileAuthRoutes.ts
init_db();
init_schema();
import { Router as Router2 } from "express";
import { eq as eq2, lt } from "drizzle-orm";
var mobileAuthRouter = Router2();
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
    const existing = await db.select().from(users).where(eq2(users.googleId, googleUser.id)).limit(1);
    let user;
    if (existing.length > 0) {
      user = existing[0];
    } else {
      const base = googleUser.email ? googleUser.email.split("@")[0] : `google_${googleUser.id.slice(0, 8)}`;
      let uniqueUsername = base;
      const existingUsername = await db.select().from(users).where(eq2(users.username, base)).limit(1);
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
    const rows = await db.select().from(mobileAuthSessions).where(eq2(mobileAuthSessions.sessionId, session_id)).limit(1);
    if (rows.length === 0) {
      return res.status(404).json({ ready: false });
    }
    const session = rows[0];
    await db.delete(mobileAuthSessions).where(eq2(mobileAuthSessions.sessionId, session_id));
    return res.json({ ready: true, token: session.token });
  } catch (err) {
    console.error("Mobile auth poll error:", err);
    return res.status(500).json({ ready: false, error: "Internal error" });
  }
});

// server/dataRoutes.ts
init_db();
init_schema();
import { eq as eq3, and } from "drizzle-orm";
function requireUserId(req, res) {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  return userId;
}
function registerSimpleJsonCrud(app2, path2, table) {
  app2.get(`/api/data/${path2}`, async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const result = await db.select({ data: table.data }).from(table).where(eq3(table.userId, userId));
      if (result.length === 0) return res.json({ data: null });
      res.json({ data: result[0].data });
    } catch (e) {
      console.error(`Error fetching ${path2}:`, e);
      res.status(500).json({ error: `Failed to fetch ${path2}` });
    }
  });
  app2.put(`/api/data/${path2}`, async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const { data } = req.body;
      await db.insert(table).values({ userId, data, updatedAt: /* @__PURE__ */ new Date() }).onConflictDoUpdate({
        target: [table.userId],
        set: { data, updatedAt: /* @__PURE__ */ new Date() }
      });
      res.json({ ok: true });
    } catch (e) {
      console.error(`Error saving ${path2}:`, e);
      res.status(500).json({ error: `Failed to save ${path2}` });
    }
  });
  app2.delete(`/api/data/${path2}`, async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      await db.delete(table).where(eq3(table.userId, userId));
      res.json({ ok: true });
    } catch (e) {
      console.error(`Error deleting ${path2}:`, e);
      res.status(500).json({ error: `Failed to delete ${path2}` });
    }
  });
}
function registerDataRoutes(app2) {
  app2.get("/api/data/plans/:date", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const { date: date2 } = req.params;
      const result = await db.select().from(plans).where(and(eq3(plans.userId, userId), eq3(plans.date, date2)));
      if (result.length === 0) return res.json({ data: null });
      res.json({ data: result[0].data });
    } catch (e) {
      console.error("Error fetching plan:", e);
      res.status(500).json({ error: "Failed to fetch plan" });
    }
  });
  app2.get("/api/data/plans", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const result = await db.select().from(plans).where(eq3(plans.userId, userId));
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
      const userId = requireUserId(req, res);
      if (!userId) return;
      const { date: date2 } = req.params;
      const { data } = req.body;
      await db.insert(plans).values({ userId, date: date2, data, updatedAt: /* @__PURE__ */ new Date() }).onConflictDoUpdate({
        target: [plans.userId, plans.date],
        set: { data, updatedAt: /* @__PURE__ */ new Date() }
      });
      res.json({ ok: true });
    } catch (e) {
      console.error("Error saving plan:", e);
      res.status(500).json({ error: "Failed to save plan" });
    }
  });
  registerSimpleJsonCrud(app2, "goals", goals);
  registerSimpleJsonCrud(app2, "stats", stats);
  registerSimpleJsonCrud(app2, "brain-dump-inbox", brainDumpInbox);
  registerSimpleJsonCrud(app2, "chat-history", chatHistory);
  registerSimpleJsonCrud(app2, "life-context", lifeContext);
  registerSimpleJsonCrud(app2, "timer-settings", timerSettings);
  registerSimpleJsonCrud(app2, "user-preferences", userPreferences);
  app2.post("/api/data/auto-built-plan/dismiss", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const result = await db.select({ data: userPreferences.data }).from(userPreferences).where(eq3(userPreferences.userId, userId));
      const currentPrefs = result[0]?.data || {};
      if (currentPrefs.autoBuiltPlan) {
        currentPrefs.autoBuiltPlan.dismissed = true;
      }
      await db.insert(userPreferences).values({ userId, data: currentPrefs, updatedAt: /* @__PURE__ */ new Date() }).onConflictDoUpdate({
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
      const userId = requireUserId(req, res);
      if (!userId) return;
      const { date: date2 } = req.params;
      const result = await db.select().from(energyCheckins).where(and(eq3(energyCheckins.userId, userId), eq3(energyCheckins.date, date2)));
      if (result.length === 0) return res.json({ data: null });
      res.json({ data: result[0].data });
    } catch (e) {
      console.error("Error fetching energy checkin:", e);
      res.status(500).json({ error: "Failed to fetch energy checkin" });
    }
  });
  app2.put("/api/data/energy-checkins/:date", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const { date: date2 } = req.params;
      const { data } = req.body;
      await db.insert(energyCheckins).values({ userId, date: date2, data, updatedAt: /* @__PURE__ */ new Date() }).onConflictDoUpdate({
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
      const userId = requireUserId(req, res);
      if (!userId) return;
      const { date: date2 } = req.params;
      const result = await db.select().from(completedCalendarIds).where(and(eq3(completedCalendarIds.userId, userId), eq3(completedCalendarIds.date, date2)));
      if (result.length === 0) return res.json({ data: [] });
      res.json({ data: result[0].data });
    } catch (e) {
      console.error("Error fetching completed calendar ids:", e);
      res.status(500).json({ error: "Failed to fetch completed calendar ids" });
    }
  });
  app2.put("/api/data/completed-calendar-ids/:date", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const { date: date2 } = req.params;
      const { data } = req.body;
      await db.insert(completedCalendarIds).values({ userId, date: date2, data, updatedAt: /* @__PURE__ */ new Date() }).onConflictDoUpdate({
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
      const userId = requireUserId(req, res);
      if (!userId) return;
      const [goalsRow] = await db.select({ data: goals.data }).from(goals).where(eq3(goals.userId, userId));
      const [statsRow] = await db.select({ data: stats.data }).from(stats).where(eq3(stats.userId, userId));
      const [lifeContextRow] = await db.select({ data: lifeContext.data }).from(lifeContext).where(eq3(lifeContext.userId, userId));
      const [userPrefsRow] = await db.select({ data: userPreferences.data }).from(userPreferences).where(eq3(userPreferences.userId, userId));
      const [chatHistoryRow] = await db.select({ data: chatHistory.data }).from(chatHistory).where(eq3(chatHistory.userId, userId));
      const [timerSettingsRow] = await db.select({ data: timerSettings.data }).from(timerSettings).where(eq3(timerSettings.userId, userId));
      const [brainDumpRow] = await db.select({ data: brainDumpInbox.data }).from(brainDumpInbox).where(eq3(brainDumpInbox.userId, userId));
      const [completionHistoryRow] = await db.select({ data: completionHistory.data }).from(completionHistory).where(eq3(completionHistory.userId, userId));
      const [blockedTasksRow] = await db.select({ data: blockedTasks.data }).from(blockedTasks).where(eq3(blockedTasks.userId, userId));
      const [planSnapshotsRow] = await db.select({ data: planSnapshots.data }).from(planSnapshots).where(eq3(planSnapshots.userId, userId));
      const plansRows = await db.select().from(plans).where(eq3(plans.userId, userId));
      const plans2 = {};
      for (const row of plansRows) {
        plans2[row.date] = row.data;
      }
      const energyRows = await db.select().from(energyCheckins).where(eq3(energyCheckins.userId, userId));
      const energyCheckins2 = {};
      for (const row of energyRows) {
        energyCheckins2[row.date] = row.data;
      }
      const calendarIdRows = await db.select().from(completedCalendarIds).where(eq3(completedCalendarIds.userId, userId));
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
      const userId = requireUserId(req, res);
      if (!userId) return;
      const { data } = req.body;
      if (!data || typeof data !== "object") {
        return res.status(400).json({ error: "Missing data object in request body" });
      }
      const now = /* @__PURE__ */ new Date();
      const replaceSimple = async (table, value) => {
        if (value === null || value === void 0) {
          await db.delete(table).where(eq3(table.userId, userId));
          return;
        }
        await db.insert(table).values({ userId, data: value, updatedAt: now }).onConflictDoUpdate({ target: [table.userId], set: { data: value, updatedAt: now } });
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
        await db.delete(plans).where(eq3(plans.userId, userId));
        for (const [date2, planData] of Object.entries(data.plans)) {
          await db.insert(plans).values({ userId, date: date2, data: planData, updatedAt: now });
        }
      }
      if (data.energyCheckins && typeof data.energyCheckins === "object") {
        await db.delete(energyCheckins).where(eq3(energyCheckins.userId, userId));
        for (const [date2, checkinData] of Object.entries(data.energyCheckins)) {
          await db.insert(energyCheckins).values({ userId, date: date2, data: checkinData, updatedAt: now });
        }
      }
      if (data.completedCalendarIds && typeof data.completedCalendarIds === "object") {
        await db.delete(completedCalendarIds).where(eq3(completedCalendarIds.userId, userId));
        for (const [date2, idsData] of Object.entries(data.completedCalendarIds)) {
          await db.insert(completedCalendarIds).values({ userId, date: date2, data: idsData, updatedAt: now });
        }
      }
      res.json({ ok: true });
    } catch (e) {
      console.error("Error importing data:", e);
      res.status(500).json({ error: "Failed to import data" });
    }
  });
}

// server/telegramRoutes.ts
init_db();
init_schema();
import { eq as eq4, and as and2, desc, sql as sql4, gte, lte } from "drizzle-orm";

// server/integrations/telegram.ts
var BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
var BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;
async function sendMessage(chatId, text2) {
  if (!BOT_TOKEN) return;
  const res = await fetch(`${BASE}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text2
    })
  });
  if (!res.ok) {
    const body = await res.text();
    console.error("Telegram sendMessage error:", body);
  }
}
async function setWebhook(webhookUrl) {
  if (!BOT_TOKEN) return;
  const res = await fetch(`${BASE}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      allowed_updates: ["message", "my_chat_member"]
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
    const res = await fetch(`${BASE}/getUpdates?offset=${offset}&timeout=5&limit=100`);
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

// server/telegramRoutes.ts
init_userTokenStore();

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

// server/telegramRoutes.ts
import OpenAI3 from "openai";
var openai3 = new OpenAI3({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
});
function generateLinkCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
async function handleCoachReply(userId, chatId, userText, imageUrl) {
  try {
    let userGoals = [];
    let userStats = {};
    let userLifeContext = null;
    let userCommitments = [];
    let chatMessages = [];
    let gmailItems = [];
    let calendarEvents = [];
    let gmailConnected = false;
    let googleAccessToken = null;
    const [goalsRow, statsRow, lcRow, chatRow, commitmentsRows, googleTokens, prefsRow] = await Promise.allSettled([
      db.select().from(goals).where(eq4(goals.userId, userId)).limit(1),
      db.select().from(stats).where(eq4(stats.userId, userId)).limit(1),
      db.select().from(lifeContext).where(eq4(lifeContext.userId, userId)).limit(1),
      db.select().from(chatHistory).where(eq4(chatHistory.userId, userId)).limit(1),
      db.select().from(commitments).where(and2(eq4(commitments.userId, userId), eq4(commitments.status, "pending"))).orderBy(desc(commitments.extractedAt)).limit(10),
      getValidGoogleTokens(userId),
      db.select().from(userPreferences).where(eq4(userPreferences.userId, userId)).limit(1)
    ]);
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
    const nowForDateKey = /* @__PURE__ */ new Date();
    const localForDateKey = new Date(nowForDateKey.toLocaleString("en-US", { timeZone: userTimezone }));
    const dateKey = `${localForDateKey.getFullYear()}-${String(localForDateKey.getMonth() + 1).padStart(2, "0")}-${String(localForDateKey.getDate()).padStart(2, "0")}`;
    let todayPlan = null;
    try {
      const planRows = await db.select().from(plans).where(and2(eq4(plans.userId, userId), eq4(plans.date, dateKey))).limit(1);
      todayPlan = planRows[0]?.data || null;
    } catch {
    }
    if (googleTokens.status === "fulfilled" && googleTokens.value.length > 0) {
      gmailConnected = true;
      const tokens = googleTokens.value;
      const token = tokens[0];
      googleAccessToken = token;
      console.log(`[Telegram] Fetching Gmail+Calendar for user ${userId} \u2014 ${tokens.length} Google account(s), date: ${dateKey}`);
      const [emailResult, ...calResults] = await Promise.allSettled([
        getRecentEmailCommitments(14, token),
        ...tokens.map((t) => getGoogleCalendarEvents(dateKey, void 0, void 0, t))
      ]);
      if (emailResult.status === "fulfilled") {
        gmailItems = emailResult.value;
        console.log(`[Telegram] Gmail: ${gmailItems.length} emails`);
      } else {
        console.error(`[Telegram] Gmail fetch failed:`, emailResult.reason);
      }
      const seenEventIds = /* @__PURE__ */ new Set();
      for (const calResult of calResults) {
        if (calResult.status === "fulfilled") {
          for (const ev of calResult.value) {
            if (!seenEventIds.has(ev.id)) {
              seenEventIds.add(ev.id);
              calendarEvents.push(ev);
            }
          }
        } else {
          console.error(`[Telegram] Calendar fetch failed:`, calResult.reason);
        }
      }
      console.log(`[Telegram] Calendar: ${calendarEvents.length} events total across ${tokens.length} account(s)`);
    } else {
      console.log(`[Telegram] No Google tokens for user ${userId} \u2014 status: ${googleTokens.status}`);
      if (googleTokens.status === "rejected") console.error(`[Telegram] Token fetch error:`, googleTokens.reason);
    }
    const recentMessages = chatMessages.slice(0, 10).reverse();
    const now = /* @__PURE__ */ new Date();
    const dayOfWeek = now.toLocaleDateString("en-US", { weekday: "long" });
    const dateStr = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const goalsText = userGoals.length > 0 ? userGoals.map((g) => `- ${g.title} (${g.category}): ${g.current}/${g.target} ${g.unit}`).join("\n") : "No goals set";
    const commitmentsText = userCommitments.length > 0 ? userCommitments.map((c) => `- [id:${c.id}] "${c.content}"${c.dueDate ? ` (due ${c.dueDate})` : ""}`).join("\n") : "";
    const calendarText = calendarEvents.length > 0 ? calendarEvents.slice(0, 8).map((e) => `- ${e.time ? e.time + ": " : ""}${e.title}`).join("\n") : "";
    const gmailSection = gmailItems.length > 0 ? `## Recent Emails (last 14 days from Gmail)
` + gmailItems.slice(0, 100).map((i) => `- [id:${i.id}] From: ${i.from || "unknown"} | "${i.subject}" \u2014 ${i.snippet}`).join("\n") + `
(Refer to these directly when asked. Do not say you cannot access email \u2014 you have the data above. Use the gmail_action tool with the message id to act on emails when asked.)` : gmailConnected ? `## Recent Emails
Gmail is connected but no emails found in the last 7 days.` : `## Recent Emails
Gmail not connected \u2014 if asked about emails, let the user know.`;
    const localNow = new Date(now.toLocaleString("en-US", { timeZone: userTimezone }));
    const localHour = localNow.getHours();
    const localMinute = localNow.getMinutes();
    const localDay = localNow.getDay();
    const scheduleSlots = [
      { hour: 8, minute: 0, label: "8:00 AM morning check-in" },
      { hour: 10, minute: 0, label: "10:00 AM commitment check (only if items due/overdue)" },
      { hour: 20, minute: 0, label: "8:00 PM evening recap" }
    ];
    if (localDay === 0) {
      scheduleSlots.push({ hour: 19, minute: 0, label: "7:00 PM weekly planning session (Sunday)" });
      scheduleSlots.sort((a, b) => a.hour - b.hour || a.minute - b.minute);
    }
    const nextSlot = scheduleSlots.find((s) => s.hour > localHour || s.hour === localHour && s.minute > localMinute);
    const nextScheduledText = nextSlot ? `Next scheduled notification: ${nextSlot.label} (${userTimezone})` : "All scheduled notifications for today have already passed. Next: 8:00 AM tomorrow morning check-in";
    const systemPrompt = `You are GamePlan Coach Jarvis \u2014 a sharp, supportive personal productivity coach. You're responding via Telegram, so keep messages SHORT (2-4 sentences max). Use plain text, no markdown headers.

Today is ${dayOfWeek}, ${dateStr}. User's timezone: ${userTimezone}.

## What You Do Automatically (you do NOT control these \u2014 the system runs them)
- 8:00 AM: Morning check-in with today's plan and inbox highlights
- 10:00 AM: Commitment accountability check (ONLY fires if there are items due today or overdue \u2014 otherwise skipped)
- 8:00 PM: Evening recap of what was completed and what's still open
- 7:00 PM Sundays: Weekly planning session (comprehensive week review + pattern insights + next week intentions)
- Every 30 minutes: Email scanner checks Gmail and sends a Telegram alert ONLY for genuinely urgent emails
All times are in the user's timezone (${userTimezone}). These fire automatically \u2014 you cannot pause, delay, reschedule, or skip them. You have no log of whether a specific notification was actually sent.
${nextScheduledText}

## What You Must NEVER Do
- NEVER claim you "paused", "held", "scheduled", "decided to wait", or took any autonomous action regarding notifications. You don't have that ability.
- NEVER invent a narrative about your own past behavior or past conversations you don't have in your message history below.
- If asked whether a notification went out, be honest: "I don't have a record of which notifications fired. The morning check-in is scheduled for 8 AM \u2014 I can tell you what's in your data right now."
- If asked about past conversations not in your message history, say so. Don't fabricate.

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

## Task Management
You can manage the user's tasks and commitments using the manage_tasks tool:
- Add tasks to today's plan (add_plan_task)
- Add commitments with optional due dates (add_commitment)
- Mark commitments as done using their [id:...] (complete_commitment)
- List today's tasks and open commitments (list_tasks)
- Analyze behavioral patterns from 30 days of data (analyze_patterns)
When the user asks to add, complete, or list tasks/commitments, use the manage_tasks tool.
If the user asks about their patterns, habits, trends, what you notice about them, their best/worst days, or anything about how they work over time, use manage_tasks with action analyze_patterns.

Be direct, specific, actionable. No fluff. You have full access to the user's email and calendar data above \u2014 use it. Respond in the same language the user writes in.`;
    let reply = "Sorry, I couldn't generate a response right now.";
    try {
      const userMessageContent = imageUrl ? [
        { type: "text", text: userText || "What do you see in this image? Give me your thoughts and any relevant actions." },
        { type: "image_url", image_url: { url: imageUrl } }
      ] : userText;
      const searchTool = {
        type: "function",
        function: {
          name: "search_web",
          description: "Search the web for current information, news, weather, prices, recent events, or anything requiring up-to-date data.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "The search query" }
            },
            required: ["query"]
          }
        }
      };
      const gmailActionTool = {
        type: "function",
        function: {
          name: "gmail_action",
          description: "Perform an action on a Gmail email. Use the message id from the email list provided in the system prompt.",
          parameters: {
            type: "object",
            properties: {
              message_id: { type: "string", description: "The Gmail message ID (from [id:...] in the email list)" },
              action: { type: "string", enum: ["star", "unstar", "archive", "mark_read", "mark_unread", "spam", "trash"], description: "The action to perform on the email" }
            },
            required: ["message_id", "action"]
          }
        }
      };
      const manageTasksTool = {
        type: "function",
        function: {
          name: "manage_tasks",
          description: "Manage the user's daily plan tasks and commitments. Use this to add tasks to today's plan, add commitments, complete/resolve commitments, list current tasks, or analyze behavioral patterns from historical data.",
          parameters: {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: ["add_plan_task", "add_commitment", "complete_commitment", "list_tasks", "analyze_patterns"],
                description: "The action to perform"
              },
              title: {
                type: "string",
                description: "Title of the task (required for add_plan_task)"
              },
              content: {
                type: "string",
                description: "Content of the commitment (required for add_commitment)"
              },
              due_date: {
                type: "string",
                description: "Due date in YYYY-MM-DD format (optional, for add_commitment)"
              },
              commitment_id: {
                type: "string",
                description: "The commitment ID from [id:...] (required for complete_commitment)"
              }
            },
            required: ["action"]
          }
        }
      };
      const baseMessages = [
        { role: "system", content: systemPrompt },
        ...recentMessages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: userMessageContent }
      ];
      const response = await openai3.chat.completions.create({
        model: "gpt-5-mini",
        messages: baseMessages,
        tools: [searchTool, gmailActionTool, manageTasksTool],
        tool_choice: "auto",
        max_completion_tokens: 2e3
      });
      const finishReason = response.choices?.[0]?.finish_reason;
      console.log(`[Telegram] OpenAI finish_reason: ${finishReason}`);
      if (finishReason === "tool_calls") {
        const toolCall = response.choices[0].message.tool_calls?.[0];
        if (toolCall?.function?.name === "search_web") {
          let searchResult = "Search unavailable right now.";
          try {
            const args = JSON.parse(toolCall.function.arguments);
            console.log(`[Telegram] Web search: "${args.query}"`);
            const results = await tavilySearch(args.query);
            searchResult = formatSearchResults(results);
            console.log(`[Telegram] Search returned ${results.results.length} results`);
          } catch (searchErr) {
            console.error("[Telegram] Search failed:", searchErr.message);
          }
          const followUp = await openai3.chat.completions.create({
            model: "gpt-5-mini",
            messages: [
              ...baseMessages,
              response.choices[0].message,
              { role: "tool", tool_call_id: toolCall.id, content: searchResult }
            ],
            max_completion_tokens: 2e3
          });
          console.log(`[Telegram] Follow-up finish_reason: ${followUp.choices?.[0]?.finish_reason}`);
          reply = followUp.choices[0]?.message?.content || reply;
        } else if (toolCall?.function?.name === "gmail_action") {
          let actionResult = "Gmail action failed.";
          try {
            const args = JSON.parse(toolCall.function.arguments);
            console.log(`[Telegram] Gmail action: ${args.action} on message ${args.message_id}`);
            if (!googleAccessToken) {
              actionResult = "Gmail is not connected. Ask the user to connect their Google account first.";
            } else if (gmailItems.length > 0 && !gmailItems.some((e) => e.id === args.message_id)) {
              actionResult = `Message ID "${args.message_id}" not found in the current email list. Please use a valid message ID from the emails shown.`;
            } else {
              const actionMap = {
                star: { add: ["STARRED"], remove: [] },
                unstar: { add: [], remove: ["STARRED"] },
                archive: { add: [], remove: ["INBOX"] },
                mark_read: { add: [], remove: ["UNREAD"] },
                mark_unread: { add: ["UNREAD"], remove: [] },
                spam: { add: ["SPAM"], remove: ["INBOX"] },
                trash: { add: ["TRASH"], remove: ["INBOX"] }
              };
              const mapping = actionMap[args.action];
              if (!mapping) {
                actionResult = `Unknown action: ${args.action}`;
              } else {
                await gmailModifyMessage(args.message_id, mapping.add, mapping.remove, googleAccessToken);
                actionResult = `Successfully performed "${args.action}" on the email.`;
                console.log(`[Telegram] Gmail action succeeded: ${args.action} on ${args.message_id}`);
              }
            }
          } catch (gmailErr) {
            console.error("[Telegram] Gmail action failed:", gmailErr.message);
            actionResult = `Gmail action failed: ${gmailErr.message}`;
          }
          const followUp = await openai3.chat.completions.create({
            model: "gpt-5-mini",
            messages: [
              ...baseMessages,
              response.choices[0].message,
              { role: "tool", tool_call_id: toolCall.id, content: actionResult }
            ],
            max_completion_tokens: 2e3
          });
          console.log(`[Telegram] Follow-up finish_reason: ${followUp.choices?.[0]?.finish_reason}`);
          reply = followUp.choices[0]?.message?.content || reply;
        } else if (toolCall?.function?.name === "manage_tasks") {
          let taskResult = "Task management action failed.";
          try {
            const args = JSON.parse(toolCall.function.arguments);
            console.log(`[Telegram] manage_tasks action: ${args.action}`);
            if (args.action === "add_plan_task") {
              if (!args.title) {
                taskResult = "Error: title is required for add_plan_task";
              } else {
                const tasks = todayPlan?.tasks || [];
                const newTask = {
                  id: crypto.randomUUID(),
                  title: args.title,
                  completed: false
                };
                tasks.push(newTask);
                const planData = todayPlan ? { ...todayPlan, tasks } : { tasks };
                await db.insert(plans).values({ userId, date: dateKey, data: planData }).onConflictDoUpdate({
                  target: [plans.userId, plans.date],
                  set: { data: planData, updatedAt: /* @__PURE__ */ new Date() }
                });
                todayPlan = planData;
                taskResult = `Added "${args.title}" to today's plan. Today's plan now has ${tasks.length} task(s).`;
                console.log(`[Telegram] Added plan task: "${args.title}"`);
              }
            } else if (args.action === "add_commitment") {
              if (!args.content) {
                taskResult = "Error: content is required for add_commitment";
              } else {
                await db.insert(commitments).values({
                  userId,
                  content: args.content,
                  dueDate: args.due_date || null,
                  sourceMessage: `Added via Telegram`
                });
                taskResult = `Added commitment: "${args.content}"${args.due_date ? ` (due ${args.due_date})` : ""}`;
                console.log(`[Telegram] Added commitment: "${args.content}"`);
              }
            } else if (args.action === "complete_commitment") {
              if (!args.commitment_id) {
                taskResult = "Error: commitment_id is required for complete_commitment";
              } else {
                const updated = await db.update(commitments).set({ status: "done", resolvedAt: /* @__PURE__ */ new Date() }).where(and2(eq4(commitments.id, args.commitment_id), eq4(commitments.userId, userId), eq4(commitments.status, "pending"))).returning({ id: commitments.id });
                if (updated.length > 0) {
                  taskResult = `Marked commitment as done (id: ${args.commitment_id}).`;
                  console.log(`[Telegram] Completed commitment: ${args.commitment_id}`);
                } else {
                  taskResult = `Error: No pending commitment found with id "${args.commitment_id}". Check the commitment ID and try again.`;
                  console.log(`[Telegram] Commitment not found: ${args.commitment_id}`);
                }
              }
            } else if (args.action === "list_tasks") {
              const planTasks = todayPlan?.tasks || [];
              const pendingCommitments = await db.select().from(commitments).where(and2(eq4(commitments.userId, userId), eq4(commitments.status, "pending"))).orderBy(desc(commitments.extractedAt)).limit(10);
              let listing = "";
              if (planTasks.length > 0) {
                listing += "Today's Plan:\n" + planTasks.map(
                  (t) => `- ${t.completed ? "\u2705" : "\u2B1C"} ${t.title}`
                ).join("\n");
              } else {
                listing += "Today's Plan: No tasks yet.";
              }
              listing += "\n\n";
              if (pendingCommitments.length > 0) {
                listing += "Open Commitments:\n" + pendingCommitments.map(
                  (c) => `- [id:${c.id}] "${c.content}"${c.dueDate ? ` (due ${c.dueDate})` : ""}`
                ).join("\n");
              } else {
                listing += "Open Commitments: None.";
              }
              taskResult = listing;
              console.log(`[Telegram] Listed tasks: ${planTasks.length} plan tasks, ${pendingCommitments.length} commitments`);
            } else if (args.action === "analyze_patterns") {
              const today = /* @__PURE__ */ new Date();
              const thirtyDaysAgo = new Date(today);
              thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
              const startDate = thirtyDaysAgo.toISOString().slice(0, 10);
              const endDate = today.toISOString().slice(0, 10);
              const plans2 = await getPlansForDateRange(userId, startDate, endDate);
              if (plans2.length < 3) {
                taskResult = "Not enough data yet for pattern analysis. Need at least a few days of plan data to identify meaningful patterns.";
              } else {
                const allCommitments = await db.select().from(commitments).where(eq4(commitments.userId, userId)).limit(200);
                const scopedCommitments = allCommitments.filter(
                  (c) => c.dueDate && c.dueDate >= startDate && c.dueDate <= endDate || c.extractedAt && c.extractedAt >= new Date(startDate) && c.extractedAt <= /* @__PURE__ */ new Date(endDate + "T23:59:59") || c.resolvedAt && c.resolvedAt >= new Date(startDate) && c.resolvedAt <= /* @__PURE__ */ new Date(endDate + "T23:59:59")
                );
                const patternData = computePatternInsights(plans2, scopedCommitments);
                taskResult = `Here is the user's behavioral pattern data from the last 30 days. Analyze this and provide 3-5 sharp, specific behavioral observations. Name each pattern (e.g. "Friday drop-off", "Health task avoidance", "Overplanning on Mondays"). Use specific numbers from the data. Be direct and insightful, not generic.

${patternData}`;
              }
              console.log(`[Telegram] Pattern analysis: ${plans2.length} days of data`);
            } else {
              taskResult = `Unknown action: ${args.action}`;
            }
          } catch (taskErr) {
            console.error("[Telegram] manage_tasks failed:", taskErr.message);
            taskResult = `Task management failed: ${taskErr.message}`;
          }
          const followUp = await openai3.chat.completions.create({
            model: "gpt-5-mini",
            messages: [
              ...baseMessages,
              response.choices[0].message,
              { role: "tool", tool_call_id: toolCall.id, content: taskResult }
            ],
            max_completion_tokens: 2e3
          });
          console.log(`[Telegram] Follow-up finish_reason: ${followUp.choices?.[0]?.finish_reason}`);
          reply = followUp.choices[0]?.message?.content || reply;
        }
      } else {
        reply = response.choices[0]?.message?.content || reply;
      }
    } catch (aiErr) {
      console.error("[Telegram] OpenAI error:", aiErr?.status, aiErr?.message, aiErr?.error);
      throw aiErr;
    }
    const userMsg = { id: Date.now().toString(), role: "user", content: userText };
    const assistantMsg = { id: (Date.now() + 1).toString(), role: "assistant", content: reply };
    const updatedChat = [assistantMsg, userMsg, ...chatMessages].slice(0, 100);
    try {
      await db.insert(chatHistory).values({ userId, data: updatedChat }).onConflictDoUpdate({
        target: chatHistory.userId,
        set: { data: updatedChat, updatedAt: /* @__PURE__ */ new Date() }
      });
    } catch {
    }
    await sendMessage(chatId, reply);
  } catch (error) {
    console.error("Error handling Telegram coach reply:", error);
    await sendMessage(chatId, "Sorry, I encountered an error. Please try again.");
  }
}
async function processUpdate(update) {
  try {
    if (update.my_chat_member) {
      const chatMember = update.my_chat_member;
      const chat = chatMember.chat;
      const status = chatMember.new_chat_member?.status;
      if ((chat.type === "group" || chat.type === "supergroup") && (status === "member" || status === "administrator")) {
        const fromUserId = chatMember.from?.id?.toString();
        if (fromUserId) {
          try {
            const link = await db.select().from(telegramLinks).where(
              sql4`${telegramLinks.chatId} = ${fromUserId}`
            ).limit(1);
            if (link[0]) {
              const currentGroups = link[0].groupChatIds || [];
              const chatIdStr = chat.id.toString();
              if (!currentGroups.includes(chatIdStr)) {
                currentGroups.push(chatIdStr);
                await db.update(telegramLinks).set({ groupChatIds: currentGroups }).where(eq4(telegramLinks.userId, link[0].userId));
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
        const { speechToText: speechToText2, ensureCompatibleFormat: ensureCompatibleFormat2 } = await Promise.resolve().then(() => (init_client(), client_exports));
        const { buffer, format } = await ensureCompatibleFormat2(file.buffer);
        const transcript = await speechToText2(buffer, format);
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
          sql4`${telegramLinks.groupChatIds}::jsonb @> ${JSON.stringify([chatId])}::jsonb`
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
        const codeRows = await db.select().from(telegramLinkCodes).where(eq4(telegramLinkCodes.code, code));
        if (codeRows.length === 0) {
          await sendMessage(chatId, "Invalid or expired link code. Please generate a new one from the app.");
          return;
        }
        const { userId } = codeRows[0];
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1e3);
        if (codeRows[0].createdAt < fiveMinAgo) {
          await db.delete(telegramLinkCodes).where(eq4(telegramLinkCodes.code, code));
          await sendMessage(chatId, "This link code has expired. Please generate a new one from the app.");
          return;
        }
        await db.insert(telegramLinks).values({ userId, chatId, username: message.from?.username || message.from?.first_name || null }).onConflictDoUpdate({
          target: telegramLinks.userId,
          set: { chatId, username: message.from?.username || message.from?.first_name || null, linkedAt: /* @__PURE__ */ new Date() }
        });
        await db.delete(telegramLinkCodes).where(eq4(telegramLinkCodes.code, code));
        await sendMessage(chatId, "\u2705 You're connected to GamePlan! Jarvis will send you morning check-ins and you can chat anytime right here.");
        console.log(`[Telegram] Linked user ${userId} to chat ${chatId}`);
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
      const link = await db.select().from(telegramLinks).where(eq4(telegramLinks.chatId, chatId)).limit(1);
      if (link.length === 0) {
        await sendMessage(chatId, "Your Telegram isn't linked to a GamePlan account yet. Open the app, go to Profile > Connected Apps > Telegram, and send the link code here.");
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
var pollingOffset = 0;
var pollingActive = false;
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
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      if (!isTelegramConfigured()) {
        return res.status(400).json({ error: "Telegram bot not configured. Add TELEGRAM_BOT_TOKEN to secrets." });
      }
      await db.delete(telegramLinkCodes).where(eq4(telegramLinkCodes.userId, userId));
      const code = generateLinkCode();
      await db.insert(telegramLinkCodes).values({ code, userId });
      res.json({ code });
    } catch (error) {
      console.error("Error generating link code:", error);
      res.status(500).json({ error: "Failed to generate link code" });
    }
  });
  app2.get("/api/telegram/status", async (req, res) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const link = await db.select().from(telegramLinks).where(eq4(telegramLinks.userId, userId)).limit(1);
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
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      await db.delete(telegramLinks).where(eq4(telegramLinks.userId, userId));
      res.json({ success: true });
    } catch (error) {
      console.error("Error disconnecting Telegram:", error);
      res.status(500).json({ error: "Failed to disconnect" });
    }
  });
  app2.get("/api/telegram/messages", async (req, res) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const link = await db.select().from(telegramLinks).where(eq4(telegramLinks.userId, userId)).limit(1);
      if (link.length === 0) {
        return res.json({ connected: false, messages: [] });
      }
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1e3);
      const messages = await db.select().from(telegramGroupMessages).where(and2(
        eq4(telegramGroupMessages.userId, userId),
        gte(telegramGroupMessages.messageDate, sevenDaysAgo)
      )).orderBy(desc(telegramGroupMessages.messageDate)).limit(50);
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
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { type, message: msgText } = req.body;
      if (!msgText) return res.status(400).json({ error: "message is required" });
      const link = await db.select().from(telegramLinks).where(eq4(telegramLinks.userId, userId)).limit(1);
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
async function getCommitmentsForUser(userId) {
  try {
    return await db.select().from(commitments).where(and2(eq4(commitments.userId, userId), eq4(commitments.status, "pending"))).orderBy(desc(commitments.extractedAt)).limit(20);
  } catch {
    return [];
  }
}
async function getPlansForDateRange(userId, startDate, endDate) {
  try {
    const rows = await db.select().from(plans).where(and2(
      eq4(plans.userId, userId),
      gte(plans.date, startDate),
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
    const userId = context.userId;
    if (userId) {
      const endDate = context.dateKey || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      const anchorDate = /* @__PURE__ */ new Date(endDate + "T12:00:00");
      const startOfWeekDate = new Date(anchorDate);
      startOfWeekDate.setDate(startOfWeekDate.getDate() - 6);
      const startDate = startOfWeekDate.toISOString().slice(0, 10);
      const weekPlans = await getPlansForDateRange(userId, startDate, endDate);
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
      const allWeekCommitments = await db.select().from(commitments).where(eq4(commitments.userId, userId)).limit(200);
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
        const allPlans = await getPlansForDateRange(userId, thirtyDayStart, endDate);
        const allCommitmentsRaw = await db.select().from(commitments).where(eq4(commitments.userId, userId)).limit(200);
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
    const resp = await openai3.chat.completions.create({
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
async function startProactiveScheduler() {
  if (!isTelegramConfigured()) return;
  const SCHEDULE = [
    { type: "morning", hour: 8, minute: 0 },
    { type: "commitment_check", hour: 10, minute: 0 },
    { type: "followup_check", hour: 12, minute: 0 },
    { type: "evening", hour: 20, minute: 0 },
    { type: "weekly_planning", dayOfWeek: 0, hour: 19, minute: 0 }
  ];
  const lastSent = {};
  setInterval(async () => {
    const now = /* @__PURE__ */ new Date();
    try {
      const links = await db.select().from(telegramLinks);
      if (links.length === 0) return;
      const allPrefs = await db.select().from(userPreferences);
      const prefsMap = {};
      for (const p of allPrefs) prefsMap[p.userId] = p.data || {};
      for (const link of links) {
        const timezone = prefsMap[link.userId]?.timezone || "America/New_York";
        const localDate = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
        const localHour = localDate.getHours();
        const localMinute = localDate.getMinutes();
        const localDay = localDate.getDay();
        const yr = localDate.getFullYear();
        const mo = String(localDate.getMonth() + 1).padStart(2, "0");
        const dy = String(localDate.getDate()).padStart(2, "0");
        const dateKey = `${yr}-${mo}-${dy}`;
        for (const schedule of SCHEDULE) {
          if (localHour !== schedule.hour || localMinute !== schedule.minute) continue;
          if (schedule.type === "weekly_planning" && localDay !== schedule.dayOfWeek) continue;
          const sentKey = `${link.userId}-${schedule.type}-${dateKey}`;
          if (lastSent[sentKey]) continue;
          lastSent[sentKey] = dateKey;
          try {
            if (schedule.type === "followup_check") {
              const tokens = await getValidGoogleTokens(link.userId).catch(() => []);
              if (!tokens || tokens.length === 0) continue;
              const token = tokens[0];
              const starredEmails = await getStarredFollowUpEmails(token, 3);
              if (starredEmails.length === 0) continue;
              const emailList = starredEmails.slice(0, 10).map((e) => {
                const senderName = e.from.replace(/<.*>/, "").trim() || e.from;
                return `${senderName} (${e.ageDays}d) \u2014 "${e.subject}"`;
              }).join("\n");
              const msg = `\u{1F4EC} ${starredEmails.length} starred/important email${starredEmails.length === 1 ? "" : "s"} sitting >3 days:

${emailList}

Still relevant? Reply, archive, or unstar anything you've handled.`;
              console.log(`[Proactive] Sending followup_check to user ${link.userId} (${timezone})`);
              await sendMessage(link.chatId, msg);
              continue;
            }
            let userGoals = [];
            let todayPlan = null;
            let userStats = {};
            let commitments2 = [];
            const [goalsRow, planRow, statsRow] = await Promise.allSettled([
              db.select().from(goals).where(eq4(goals.userId, link.userId)).limit(1),
              db.select().from(plans).where(and2(eq4(plans.userId, link.userId), eq4(plans.date, dateKey))).limit(1),
              db.select().from(stats).where(eq4(stats.userId, link.userId)).limit(1)
            ]);
            if (goalsRow.status === "fulfilled") userGoals = goalsRow.value[0]?.data || [];
            if (planRow.status === "fulfilled") todayPlan = planRow.value[0]?.data;
            if (statsRow.status === "fulfilled") userStats = statsRow.value[0]?.data || {};
            commitments2 = await getCommitmentsForUser(link.userId);
            const tasks = todayPlan?.tasks || [];
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
              await sendMessage(link.chatId, message);
            }
          } catch (err) {
            console.error(`[Proactive] Error for user ${link.userId}:`, err);
          }
        }
      }
    } catch (err) {
      console.error("[Proactive] Scheduler error:", err);
    }
  }, 60 * 1e3);
  console.log("Telegram proactive scheduler started");
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
              const resp = await openai3.chat.completions.create({
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
                await sendMessage(link.chatId, fullMsg);
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
  if (!isTelegramConfigured()) return;
  const SCAN_INTERVAL_MS = 30 * 60 * 1e3;
  const runScan = async () => {
    try {
      const links = await db.select().from(telegramLinks);
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
        const emailList = emails.map(
          (e, i) => `${i}. From: ${e.from}
   Subject: "${e.subject}"
   Preview: ${e.snippet}`
        ).join("\n\n");
        let flagged = [];
        try {
          const classification = await openai3.chat.completions.create({
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
          const email = emails[flag.index];
          if (!email) continue;
          const senderName = email.from.replace(/<.*>/, "").trim() || email.from;
          const msg = `\u{1F4E7} Email needs your attention:
From: ${senderName}
"${email.subject}"

${email.snippet.slice(0, 150)}${email.snippet.length > 150 ? "..." : ""}

Jarvis: ${flag.reason}`;
          await sendMessage(link.chatId, msg);
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

// server/integrationOwner.ts
init_db();
import { sql as sql5 } from "drizzle-orm";
var cachedOwnerId = null;
async function getIntegrationOwnerId() {
  if (cachedOwnerId) return cachedOwnerId;
  try {
    const result = await db.execute(sql5`SELECT owner_user_id FROM integration_owner LIMIT 1`);
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
async function claimIntegrationOwnership(userId) {
  try {
    const existing = await getIntegrationOwnerId();
    if (existing) return existing === userId;
    await db.execute(sql5`INSERT INTO integration_owner (owner_user_id) VALUES (${userId})`);
    cachedOwnerId = userId;
    return true;
  } catch {
    return false;
  }
}
async function isIntegrationOwner(userId) {
  const ownerId = await getIntegrationOwnerId();
  if (!ownerId) return false;
  return ownerId === userId;
}

// server/oauthRoutes.ts
init_userTokenStore();
import { Router as Router3 } from "express";
var oauthRouter = Router3();
var oauthCallbackRouter = Router3();
function getBaseUrl(req) {
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
  if (domain) return `https://${domain}:5000`;
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
oauthRouter.get("/google/authorize", (req, res) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: "Not authenticated" });
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
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.compose"
    ].join(" "),
    access_type: "offline",
    prompt: "consent",
    state: userId
  });
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  res.json({ url, redirectUri });
});
oauthCallbackRouter.get("/google/callback", async (req, res) => {
  const { code, state: userId, error } = req.query;
  if (error || !code || !userId) {
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
      userId,
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
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: "Not authenticated" });
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
    scope: "offline_access Calendars.Read Mail.Read User.Read",
    state: userId,
    response_mode: "query"
  });
  const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
  res.json({ url, redirectUri });
});
oauthCallbackRouter.get("/microsoft/callback", async (req, res) => {
  const { code, state: userId, error, error_description } = req.query;
  if (error || !code || !userId) {
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
        scope: "offline_access Calendars.Read Mail.Read User.Read"
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
      userId,
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
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: "Not authenticated" });
  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) return res.json({ error: "Slack OAuth not configured" });
  const baseUrl = getBaseUrl(req);
  const redirectUri = `${baseUrl}/api/oauth/slack/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    user_scope: "channels:history,channels:read,im:history,im:read,groups:history,groups:read,users:read",
    redirect_uri: redirectUri,
    state: userId
  });
  const url = `https://slack.com/oauth/v2/authorize?${params.toString()}`;
  res.json({ url, redirectUri });
});
oauthCallbackRouter.get("/slack/callback", async (req, res) => {
  const { code, state: userId, error: oauthError } = req.query;
  if (oauthError || !code || !userId) {
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
      userId,
      provider: "slack",
      accessToken: userToken,
      refreshToken: null,
      expiresAt: null,
      scopes: "channels:history,channels:read,im:history,im:read,groups:history,groups:read,users:read",
      accountEmail
    });
    return res.send(successHtml2("slack", accountEmail));
  } catch (err) {
    console.error("Slack OAuth callback error:", err);
    return res.send(errorHtml2("An unexpected error occurred. Please try again."));
  }
});
oauthRouter.get("/status", async (req, res) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: "Not authenticated" });
  try {
    const status = await getUserOAuthStatus(userId);
    res.json(status);
  } catch (err) {
    console.error("OAuth status error:", err);
    res.json({ google: { connected: false }, microsoft: { connected: false }, slack: { connected: false } });
  }
});
oauthRouter.delete("/:provider/disconnect", async (req, res) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: "Not authenticated" });
  const { provider } = req.params;
  if (!["google", "microsoft", "slack"].includes(provider)) {
    return res.status(400).json({ error: "Unknown provider" });
  }
  try {
    const email = req.query.email;
    await deleteUserToken(userId, provider, email);
    res.json({ success: true });
  } catch (err) {
    console.error("Disconnect error:", err);
    res.status(500).json({ error: "Failed to disconnect" });
  }
});

// server/routes.ts
init_userTokenStore();
var openai4 = new OpenAI4({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
});
var COACHING_FRAMEWORKS = `## Coaching Frameworks You Draw From
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
var PERSONA_BLOCKS = {
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
function getPersonaBlock(coachingMode) {
  return PERSONA_BLOCKS[coachingMode || "sharp"] || PERSONA_BLOCKS.sharp;
}
var morningNoteSummaryCache = /* @__PURE__ */ new Map();
async function getUserLocalDate(userId) {
  try {
    const prefs = await db.select({ data: userPreferences.data }).from(userPreferences).where(eq5(userPreferences.userId, userId)).limit(1);
    const tz = prefs[0]?.data?.timezone || "America/New_York";
    return (/* @__PURE__ */ new Date()).toLocaleDateString("en-CA", { timeZone: tz });
  } catch {
    return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  }
}
async function getMorningNoteSummary(userId) {
  const today = await getUserLocalDate(userId);
  const cached = morningNoteSummaryCache.get(userId);
  if (cached && cached.date === today) return cached.summary;
  try {
    const thirtyDaysAgo = /* @__PURE__ */ new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const cutoffDate = thirtyDaysAgo.toISOString().slice(0, 10);
    const notes = await db.select().from(morningVoiceNotes).where(and3(
      eq5(morningVoiceNotes.userId, userId),
      gte2(morningVoiceNotes.recordedAt, cutoffDate)
    )).orderBy(desc2(morningVoiceNotes.recordedAt)).limit(30);
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
    morningNoteSummaryCache.set(userId, { summary, date: today });
    return summary;
  } catch {
    return "";
  }
}
function buildCoachSystemPrompt(goals2, stats2, history, calendarEvents = [], lifeContext2, gmailItems, gmailConnected, slackMessages, slackConnected, commitmentsList, coachingMode, memories, telegramMessages, telegramConnected, morningNoteSummary) {
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
  const memoriesSection = memories && memories.length > 0 ? `
## What I Know About You (from past conversations)
` + memories.slice(0, 20).map((m) => `- [${m.category}] ${m.content}`).join("\n") : "";
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

${COACHING_FRAMEWORKS}

${personaBlock}
${memoriesSection}

## User Profile
- Current streak: ${stats2.streak || 0} days
- Best streak: ${stats2.bestStreak || 0} days
- Total tasks completed: ${stats2.totalCompleted || 0}
- Total XP earned: ${stats2.xp || 0}
- Task completion rate (last 7 days): ${completionRate}% (${completedHistory.length} completed, ${skippedHistory.length} skipped)
${strugglingCategories.length > 0 ? `- Struggling most with: ${strugglingCategories.join(", ")}` : ""}${lifeContextSection}

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
Then add a brief note like "I've formatted this as a draft \u2014 tap 'Save to Drafts' to send it to your Gmail."`;
}
async function buildPlanFromInputs(body) {
  const { goals: goals2, calendarEvents, gmailItems, brainDump, completionHistory: completionHistory2, energyLevel, coachingMode, existingTasks } = body;
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
  const prompt = `You are Jarvis, an autonomous planning AI. Build a realistic, prioritized daily plan for this person.

Today is ${dayOfWeek}, ${dateStr}.

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
  const response = await openai4.chat.completions.create({
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
async function buildPlanForUser(userId) {
  try {
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const [goalsRow, historyRow, brainDumpRow, lifeContextRow, prefsRow, energyRow] = await Promise.all([
      db.select({ data: goals.data }).from(goals).where(eq5(goals.userId, userId)),
      db.select({ data: completionHistory.data }).from(completionHistory).where(eq5(completionHistory.userId, userId)),
      db.select({ data: brainDumpInbox.data }).from(brainDumpInbox).where(eq5(brainDumpInbox.userId, userId)),
      db.select({ data: lifeContext.data }).from(lifeContext).where(eq5(lifeContext.userId, userId)),
      db.select({ data: userPreferences.data }).from(userPreferences).where(eq5(userPreferences.userId, userId)),
      db.select({ data: energyCheckins.data }).from(energyCheckins).where(and3(eq5(energyCheckins.userId, userId), eq5(energyCheckins.date, today)))
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
      const googleTokens = await getValidGoogleTokens(userId);
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
      const googleTokens = await getValidGoogleTokens(userId);
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
      existingTasks: []
    });
    if (!result || result.tasks.length === 0) return null;
    return result;
  } catch (err) {
    console.error(`buildPlanForUser failed for ${userId}:`, err);
    return null;
  }
}
async function registerRoutes(app2) {
  app2.use("/api/auth", authRouter);
  app2.use("/api/auth/mobile", mobileAuthRouter);
  app2.use("/api/oauth", oauthCallbackRouter);
  app2.use(authMiddleware);
  app2.use("/api/oauth", oauthRouter);
  registerDataRoutes(app2);
  registerTelegramRoutes(app2);
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
        blockedTasks: blockedTasks2 || []
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
    }
  ];
  function fuzzyMatch(needle, haystack) {
    const n = needle.toLowerCase().trim();
    const h = haystack.toLowerCase().trim();
    return h.includes(n) || n.includes(h);
  }
  async function executeCoachTool(toolName, args, userId) {
    const todayKey = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    try {
      switch (toolName) {
        case "add_task": {
          const planResult = await db.select({ data: plans.data }).from(plans).where(and3(eq5(plans.userId, userId), eq5(plans.date, todayKey)));
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
          await db.insert(plans).values({ userId, date: todayKey, data: updatedPlan, updatedAt: /* @__PURE__ */ new Date() }).onConflictDoUpdate({
            target: [plans.userId, plans.date],
            set: { data: updatedPlan, updatedAt: /* @__PURE__ */ new Date() }
          });
          return { result: "success", label: `Task added to today`, detail: `Added "${args.title}"` };
        }
        case "add_to_brain_dump": {
          const bdResult = await db.select({ data: brainDumpInbox.data }).from(brainDumpInbox).where(eq5(brainDumpInbox.userId, userId));
          const items = bdResult.length > 0 ? Array.isArray(bdResult[0].data) ? bdResult[0].data : [] : [];
          items.unshift({
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            text: args.text,
            createdAt: (/* @__PURE__ */ new Date()).toISOString()
          });
          await db.insert(brainDumpInbox).values({ userId, data: items, updatedAt: /* @__PURE__ */ new Date() }).onConflictDoUpdate({
            target: [brainDumpInbox.userId],
            set: { data: items, updatedAt: /* @__PURE__ */ new Date() }
          });
          return { result: "success", label: `Added to brain dump`, detail: `Added "${args.text}"` };
        }
        case "log_goal_progress": {
          const goalsResult = await db.select({ data: goals.data }).from(goals).where(eq5(goals.userId, userId));
          if (goalsResult.length === 0) return { result: "error", label: "No goals found", detail: "User has no goals set" };
          const goalsList = Array.isArray(goalsResult[0].data) ? goalsResult[0].data : [];
          const matched = goalsList.find((g) => fuzzyMatch(args.goalTitle, g.title));
          if (!matched) return { result: "error", label: `Goal not found`, detail: `Could not find goal matching "${args.goalTitle}"` };
          matched.current = (matched.current || 0) + args.amount;
          matched.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
          await db.insert(goals).values({ userId, data: goalsList, updatedAt: /* @__PURE__ */ new Date() }).onConflictDoUpdate({
            target: [goals.userId],
            set: { data: goalsList, updatedAt: /* @__PURE__ */ new Date() }
          });
          return { result: "success", label: `Progress logged`, detail: `Added ${args.amount} to "${matched.title}"` };
        }
        case "update_life_context": {
          const lcResult = await db.select({ data: lifeContext.data }).from(lifeContext).where(eq5(lifeContext.userId, userId));
          const existing = lcResult.length > 0 ? lcResult[0].data : {};
          const merged = { ...existing };
          if (args.priorityGoal) merged.priorityGoal = args.priorityGoal;
          if (args.currentBlocker) merged.currentBlocker = args.currentBlocker;
          if (args.improvementArea) merged.improvementArea = args.improvementArea;
          if (args.upcomingDeadline) merged.upcomingDeadline = args.upcomingDeadline;
          if (args.freeText) merged.freeText = args.freeText;
          merged.lastUpdated = (/* @__PURE__ */ new Date()).toISOString();
          await db.insert(lifeContext).values({ userId, data: merged, updatedAt: /* @__PURE__ */ new Date() }).onConflictDoUpdate({
            target: [lifeContext.userId],
            set: { data: merged, updatedAt: /* @__PURE__ */ new Date() }
          });
          const updatedFields = Object.keys(args).filter((k) => args[k]).join(", ");
          return { result: "success", label: `Context updated`, detail: `Updated: ${updatedFields}` };
        }
        case "complete_task": {
          const planResult = await db.select({ data: plans.data }).from(plans).where(and3(eq5(plans.userId, userId), eq5(plans.date, todayKey)));
          if (planResult.length === 0) return { result: "error", label: "No plan today", detail: "No plan found for today" };
          const plan = planResult[0].data;
          const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
          const matched = tasks.find((t) => !t.completed && fuzzyMatch(args.taskTitle, t.title));
          if (!matched) return { result: "error", label: `Task not found`, detail: `Could not find incomplete task matching "${args.taskTitle}"` };
          matched.completed = true;
          const updatedPlan = { ...plan, tasks };
          await db.insert(plans).values({ userId, date: todayKey, data: updatedPlan, updatedAt: /* @__PURE__ */ new Date() }).onConflictDoUpdate({
            target: [plans.userId, plans.date],
            set: { data: updatedPlan, updatedAt: /* @__PURE__ */ new Date() }
          });
          return { result: "success", label: `Task completed`, detail: `Marked "${matched.title}" as done` };
        }
        default:
          return { result: "error", label: "Unknown action", detail: `Unknown tool: ${toolName}` };
      }
    } catch (error) {
      console.error(`Error executing tool ${toolName}:`, error);
      return { result: "error", label: "Action failed", detail: String(error) };
    }
  }
  app2.post("/api/coach/chat", async (req, res) => {
    try {
      const { messages, goals: goals2, stats: stats2, history, calendarEvents, lifeContext: lifeContext2, gmailItems, gmailConnected, slackMessages, slackConnected, coachingMode, telegramMessages, telegramConnected } = req.body;
      const userId = req.userId;
      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: "messages array is required" });
      }
      let userCommitments = [];
      if (userId) {
        try {
          userCommitments = await db.select().from(commitments).where(and3(eq5(commitments.userId, userId), eq5(commitments.status, "pending"))).orderBy(desc2(commitments.extractedAt)).limit(20);
        } catch {
        }
      }
      let memories = [];
      let morningNoteSummary = "";
      if (userId) {
        try {
          const [rows, noteSummary] = await Promise.all([
            db.select({ content: userMemories.content, category: userMemories.category }).from(userMemories).where(eq5(userMemories.userId, userId)).orderBy(desc2(userMemories.extractedAt)).limit(20),
            getMorningNoteSummary(userId)
          ]);
          memories = rows;
          morningNoteSummary = noteSummary;
        } catch {
        }
      }
      const systemPrompt = buildCoachSystemPrompt(goals2 || [], stats2 || {}, history || [], calendarEvents || [], lifeContext2 || null, gmailItems || [], gmailConnected ?? false, slackMessages || [], slackConnected ?? false, userCommitments, coachingMode, memories, telegramMessages || [], telegramConnected ?? false, morningNoteSummary);
      const chatMessages = [
        { role: "system", content: systemPrompt + "\n\nYou can take actions on the user's behalf using the available tools. When a user asks you to add a task, log progress, update their context, etc., use the appropriate tool. Respond naturally \u2014 do not mention 'tool calls' or 'functions' to the user. Just confirm what you did conversationally." },
        ...messages.map((m) => ({ role: m.role, content: m.content }))
      ];
      const actionResults = [];
      let toolMessages = [];
      if (userId) {
        const phase1 = await openai4.chat.completions.create({
          model: "gpt-5-mini",
          messages: chatMessages,
          tools: coachTools,
          max_completion_tokens: 2048
        });
        const choice = phase1.choices[0];
        if (choice.finish_reason === "tool_calls" && choice.message.tool_calls?.length) {
          toolMessages.push(choice.message);
          for (const tc of choice.message.tool_calls) {
            let args = {};
            try {
              args = JSON.parse(tc.function.arguments);
            } catch {
            }
            const execResult = await executeCoachTool(tc.function.name, args, userId);
            actionResults.push({ tool: tc.function.name, result: execResult.result, label: execResult.label });
            toolMessages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: JSON.stringify({ result: execResult.result, detail: execResult.detail })
            });
          }
        } else if (choice.message.content) {
          res.setHeader("Content-Type", "text/event-stream");
          res.setHeader("Cache-Control", "no-cache, no-transform");
          res.setHeader("X-Accel-Buffering", "no");
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.flushHeaders();
          const words = choice.message.content;
          res.write(`data: ${JSON.stringify({ content: words })}

`);
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }
      }
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.flushHeaders();
      if (actionResults.length > 0) {
        res.write(`data: ${JSON.stringify({ type: "actions", actions: actionResults })}

`);
      }
      const streamMessages = toolMessages.length > 0 ? [...chatMessages, ...toolMessages] : chatMessages;
      const stream = await openai4.chat.completions.create({
        model: "gpt-5-mini",
        messages: streamMessages,
        stream: true,
        max_completion_tokens: 8192
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
      console.error("Error in coach chat:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to get coach response" });
      } else {
        res.write(`data: ${JSON.stringify({ error: "Stream interrupted" })}

`);
        res.end();
      }
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
1. "actions": array of 0-2 specific, immediately actionable tasks or goals mentioned or implied in the message. Each action: { "type": "task" or "goal", "title": string (concise, starts with verb for tasks), "category": one of "fitness/finance/career/personal/social", "priority": "high"/"medium"/"low" (tasks only), "description": short one-line context }. Only include if genuinely specific and actionable \u2014 return empty array if message is conversational.
2. "followups": array of exactly 3 short follow-up questions (max 7 words each) the user would naturally ask next.

Return ONLY the JSON object.`;
      const response = await openai4.chat.completions.create({
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
      const response = await openai4.chat.completions.create({
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
      const userId = req.userId;
      const completedHistory = (history || []).filter((h) => h.completed);
      const skippedHistory = (history || []).filter((h) => !h.completed);
      const completionRate = history?.length > 0 ? Math.round(completedHistory.length / history.length * 100) : 0;
      const goalsText = (goals2 || []).length > 0 ? goals2.map((g) => `${g.title}: ${g.current}/${g.target} ${g.unit}`).join(", ") : "no goals set";
      const lifeCtxText = lifeContext2 ? `
- Priority: ${lifeContext2.priorityGoal || "not set"}` + (lifeContext2.currentBlocker ? `
- Known blocker: ${lifeContext2.currentBlocker}` : "") + (lifeContext2.improvementArea ? `
- Wants to improve: ${lifeContext2.improvementArea}` : "") : "";
      let commitmentText = "";
      if (userId) {
        try {
          const pendingCommitments = await db.select().from(commitments).where(and3(eq5(commitments.userId, userId), eq5(commitments.status, "pending"))).limit(5);
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
      const response = await openai4.chat.completions.create({
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
      const userId = req.userId;
      if (!userId) return res.json({ google: false, outlook: false });
      const [googleTokens, microsoftToken] = await Promise.all([
        getValidGoogleTokens(userId),
        getValidMicrosoftToken(userId)
      ]);
      let googleConnected = googleTokens.length > 0;
      let outlookConnected = !!microsoftToken;
      if (!googleConnected || !outlookConnected) {
        const isOwner = await isIntegrationOwner(userId);
        if (isOwner) {
          const [projGoogle, projOutlook] = await Promise.all([
            googleConnected ? true : checkGoogleCalendarConnection(),
            outlookConnected ? true : checkOutlookConnection()
          ]);
          googleConnected = googleConnected || projGoogle;
          outlookConnected = outlookConnected || projOutlook;
          if (projGoogle || projOutlook) await claimIntegrationOwnership(userId);
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
      const userId = req.userId;
      if (!userId) return res.json({ connected: false, events: [] });
      const accessTokens = await getValidGoogleTokens(userId);
      let hasIntegration = false;
      if (accessTokens.length === 0) {
        if (!await isIntegrationOwner(userId)) return res.json({ connected: false, events: [] });
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
      const userId = req.userId;
      if (!userId) return res.json({ connected: false, events: [] });
      let accessToken = await getValidMicrosoftToken(userId);
      if (!accessToken) {
        if (!await isIntegrationOwner(userId)) return res.json({ connected: false, events: [] });
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
      const userId = req.userId;
      if (!userId) return res.json({ connected: false });
      const googleTokens = await getValidGoogleTokens(userId);
      if (googleTokens.length > 0) return res.json({ connected: true });
      const isOwner = await isIntegrationOwner(userId);
      if (!isOwner) return res.json({ connected: false });
      const connected = await checkGmailConnection();
      if (connected) await claimIntegrationOwnership(userId);
      res.json({ connected });
    } catch (error) {
      console.error("Error checking Gmail status:", error);
      res.json({ connected: false });
    }
  });
  app2.get("/api/gmail/commitments", async (req, res) => {
    try {
      const userId = req.userId;
      if (!userId) return res.json({ connected: false, items: [] });
      const userTokens = await getUserTokens(userId, "google");
      if (userTokens.length === 0) {
        if (!await isIntegrationOwner(userId)) return res.json({ connected: false, items: [] });
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
      const userId = req.userId;
      if (!userId) return res.json({ suggestions: [] });
      const { goals: goals2 } = req.body;
      if (!goals2 || !Array.isArray(goals2) || goals2.length === 0) {
        return res.json({ suggestions: [] });
      }
      const userTokens = await getUserTokens(userId, "google");
      let allEmails = [];
      if (userTokens.length === 0) {
        if (!await isIntegrationOwner(userId)) return res.json({ suggestions: [] });
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
      const response = await openai4.chat.completions.create({
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
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { to, subject, body, accountEmail } = req.body;
      if (!to || !subject || !body) {
        return res.status(400).json({ error: "to, subject, and body are required" });
      }
      const userTokens = await getUserTokens(userId, "google");
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
      const userId = req.userId;
      if (!userId) return res.json({ slack: false });
      const token = await getUserToken(userId, "slack");
      res.json({ slack: !!token });
    } catch (error) {
      console.error("Error checking Slack status:", error);
      res.json({ slack: false });
    }
  });
  app2.get("/api/slack/messages", async (req, res) => {
    try {
      const userId = req.userId;
      if (!userId) return res.json({ connected: false, messages: [] });
      const token = await getUserToken(userId, "slack");
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
      const response = await openai4.chat.completions.create({
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
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { audio } = req.body;
      if (!audio || typeof audio !== "string") {
        return res.status(400).json({ error: "audio (base64) is required" });
      }
      const { speechToText: speechToText2, ensureCompatibleFormat: ensureCompatibleFormat2 } = await Promise.resolve().then(() => (init_client(), client_exports));
      const rawBuffer = Buffer.from(audio, "base64");
      const { buffer, format } = await ensureCompatibleFormat2(rawBuffer);
      const text2 = await speechToText2(buffer, format);
      res.json({ text: text2 });
    } catch (error) {
      console.error("Error transcribing audio:", error);
      res.status(500).json({ error: "Failed to transcribe audio" });
    }
  });
  app2.post("/api/coach/speak", async (req, res) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
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
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const rows = await db.select().from(commitments).where(and3(eq5(commitments.userId, userId), eq5(commitments.status, "pending"))).orderBy(desc2(commitments.extractedAt));
      res.json({ commitments: rows });
    } catch (error) {
      console.error("Error fetching commitments:", error);
      res.status(500).json({ error: "Failed to fetch commitments" });
    }
  });
  app2.put("/api/commitments/:id", async (req, res) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { id } = req.params;
      const { status } = req.body;
      if (!status || !["done", "skipped", "pending"].includes(status)) {
        return res.status(400).json({ error: "status must be 'done', 'skipped', or 'pending'" });
      }
      await db.update(commitments).set({ status, resolvedAt: status !== "pending" ? /* @__PURE__ */ new Date() : null }).where(and3(eq5(commitments.id, id), eq5(commitments.userId, userId)));
      res.json({ ok: true });
    } catch (error) {
      console.error("Error updating commitment:", error);
      res.status(500).json({ error: "Failed to update commitment" });
    }
  });
  app2.delete("/api/commitments/:id", async (req, res) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { id } = req.params;
      await db.delete(commitments).where(and3(eq5(commitments.id, id), eq5(commitments.userId, userId)));
      res.json({ ok: true });
    } catch (error) {
      console.error("Error deleting commitment:", error);
      res.status(500).json({ error: "Failed to delete commitment" });
    }
  });
  app2.post("/api/commitments/extract", async (req, res) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { message } = req.body;
      if (!message || typeof message !== "string") {
        return res.json({ hasCommitment: false });
      }
      const prompt = `Did this message from the user contain any explicit commitment ('I will', 'I'll', 'by tomorrow', 'I need to', 'I'm going to', 'I promise', 'I plan to', 'I'm committing to')? If yes, extract the commitment. Today's date is ${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}.

User message: "${message}"

Return ONLY JSON: { "hasCommitment": boolean, "commitment": "the thing they committed to" or null, "dueDate": "YYYY-MM-DD" or null }`;
      const response = await openai4.chat.completions.create({
        model: "gpt-5-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_completion_tokens: 200
      });
      const content = response.choices[0]?.message?.content || '{"hasCommitment":false}';
      const parsed = JSON.parse(content);
      if (parsed.hasCommitment && parsed.commitment) {
        await db.insert(commitments).values({
          userId,
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
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { context, goals: goals2, stats: stats2, history, lifeContext: lifeContext2 } = req.body;
      if (!context) return res.status(400).json({ error: "context is required" });
      let userCommitments = [];
      try {
        userCommitments = await db.select().from(commitments).where(and3(eq5(commitments.userId, userId), eq5(commitments.status, "pending"))).orderBy(desc2(commitments.extractedAt)).limit(10);
      } catch {
      }
      const systemPrompt = buildCoachSystemPrompt(goals2 || [], stats2 || {}, history || [], [], lifeContext2 || null, [], false, [], false, userCommitments, void 0, [], [], false);
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.flushHeaders();
      const stream = await openai4.chat.completions.create({
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
  app2.post("/api/coach/weekly-review", async (req, res) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { goals: goals2, stats: stats2, history } = req.body;
      let weekCommitments = [];
      try {
        const sevenDaysAgo = /* @__PURE__ */ new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        weekCommitments = await db.select().from(commitments).where(eq5(commitments.userId, userId)).orderBy(desc2(commitments.extractedAt)).limit(30);
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
      const response = await openai4.chat.completions.create({
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
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const rows = await db.select().from(userMemories).where(eq5(userMemories.userId, userId)).orderBy(desc2(userMemories.extractedAt));
      res.json({ memories: rows });
    } catch (error) {
      console.error("Error fetching memories:", error);
      res.status(500).json({ error: "Failed to fetch memories" });
    }
  });
  app2.delete("/api/memories/:id", async (req, res) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { id } = req.params;
      await db.delete(userMemories).where(sql6`${userMemories.id} = ${id} AND ${userMemories.userId} = ${userId}`);
      res.json({ ok: true });
    } catch (error) {
      console.error("Error deleting memory:", error);
      res.status(500).json({ error: "Failed to delete memory" });
    }
  });
  app2.post("/api/memories/extract", async (req, res) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { messages } = req.body;
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.json({ added: 0 });
      }
      const existingRows = await db.select({ content: userMemories.content }).from(userMemories).where(eq5(userMemories.userId, userId)).orderBy(desc2(userMemories.extractedAt));
      const existingMemories = existingRows.map((r) => r.content);
      const conversationText = messages.map((m) => `${m.role}: ${m.content}`).join("\n");
      const existingList = existingMemories.length > 0 ? `
Existing memories (DO NOT duplicate these):
${existingMemories.map((m) => `- ${m}`).join("\n")}` : "";
      const prompt = `You are a memory extractor. Given this conversation snippet, extract 0-3 key facts about the user worth remembering long-term. Only extract facts that would be useful in future coaching sessions. Skip generic statements, greetings, and things already known.
${existingList}

Conversation:
${conversationText}

Return JSON: { "memories": [{"content": "string describing the fact", "category": "fact"|"pattern"|"preference"|"goal"|"achievement"}] }
Return an empty array if nothing notable was said. Do NOT repeat or rephrase existing memories.`;
      const response = await openai4.chat.completions.create({
        model: "gpt-5-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_completion_tokens: 400
      });
      const content = response.choices[0]?.message?.content || '{"memories":[]}';
      let added = 0;
      try {
        const parsed = JSON.parse(content);
        const newMemories = Array.isArray(parsed.memories) ? parsed.memories.slice(0, 3) : [];
        for (const mem of newMemories) {
          if (!mem.content || typeof mem.content !== "string" || mem.content.trim().length === 0) continue;
          const validCategories = ["fact", "pattern", "preference", "goal", "achievement"];
          const category = validCategories.includes(mem.category) ? mem.category : "fact";
          await db.insert(userMemories).values({
            userId,
            content: mem.content.trim(),
            category
          });
          added++;
        }
      } catch {
      }
      res.json({ added });
    } catch (error) {
      console.error("Error extracting memories:", error);
      res.json({ added: 0 });
    }
  });
  app2.get("/api/preferences", async (req, res) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const row = await db.select({ data: userPreferences.data }).from(userPreferences).where(eq5(userPreferences.userId, userId)).limit(1);
      return res.json(row[0]?.data || {});
    } catch (error) {
      console.error("Error getting preferences:", error);
      return res.status(500).json({ error: "Failed to get preferences" });
    }
  });
  app2.patch("/api/preferences", async (req, res) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const updates = req.body;
      const existing = await db.select({ data: userPreferences.data }).from(userPreferences).where(eq5(userPreferences.userId, userId)).limit(1);
      const current = existing[0]?.data || {};
      const merged = { ...current, ...updates };
      await db.insert(userPreferences).values({ userId, data: merged }).onConflictDoUpdate({
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
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const limit = parseInt(req.query.limit) || 30;
      const notes = await db.select().from(morningVoiceNotes).where(eq5(morningVoiceNotes.userId, userId)).orderBy(desc2(morningVoiceNotes.recordedAt)).limit(limit);
      res.json({ notes });
    } catch (error) {
      console.error("Error fetching morning voice notes:", error);
      res.status(500).json({ error: "Failed to fetch morning voice notes" });
    }
  });
  app2.get("/api/morning-voice-notes/today", async (req, res) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const today = await getUserLocalDate(userId);
      const notes = await db.select().from(morningVoiceNotes).where(and3(eq5(morningVoiceNotes.userId, userId), eq5(morningVoiceNotes.recordedAt, today))).limit(1);
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
    const extraction = await openai4.chat.completions.create({
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
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
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
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { transcript, extracted: preExtracted } = req.body;
      if (!transcript || typeof transcript !== "string" || !transcript.trim()) {
        return res.status(400).json({ error: "transcript is required" });
      }
      const today = await getUserLocalDate(userId);
      const existing = await db.select({ id: morningVoiceNotes.id }).from(morningVoiceNotes).where(and3(eq5(morningVoiceNotes.userId, userId), eq5(morningVoiceNotes.recordedAt, today))).limit(1);
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
        userId,
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
          userId,
          content: memorySummary,
          category: "pattern"
        });
      } catch {
      }
      morningNoteSummaryCache.delete(userId);
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
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { audioBase64, mimeType } = req.body;
      if (!audioBase64) {
        return res.status(400).json({ error: "audioBase64 is required" });
      }
      const buffer = Buffer.from(audioBase64, "base64");
      const ext = (mimeType || "audio/webm").includes("mp4") ? "mp4" : "webm";
      const file = new File([buffer], `recording.${ext}`, { type: mimeType || "audio/webm" });
      const transcription = await openai4.audio.transcriptions.create({
        model: "whisper-1",
        file
      });
      res.json({ transcript: transcription.text || "" });
    } catch (error) {
      console.error("Error transcribing audio:", error);
      res.status(500).json({ error: "Failed to transcribe audio" });
    }
  });
  const httpServer = createServer(app2);
  return httpServer;
}

// server/index.ts
init_db();

// server/scheduler.ts
init_db();
init_schema();
import { eq as eq6, and as and4 } from "drizzle-orm";
var schedulerRunning = false;
function startScheduler() {
  if (schedulerRunning) return;
  schedulerRunning = true;
  setInterval(async () => {
    const now = /* @__PURE__ */ new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    if (h === 7 && m === 0) {
      console.log("[Scheduler] Running morning plan build...");
      await runMorningPlanBuild();
    }
  }, 60 * 1e3);
  console.log("[Scheduler] Started \u2014 will run morning plan build at 7:00 AM daily");
}
async function runMorningPlanBuild() {
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const allUsers = await db.select({ id: users.id }).from(users);
  console.log(`[Scheduler] Processing ${allUsers.length} user(s) for auto-plan build`);
  for (const user of allUsers) {
    try {
      const existingPlan = await db.select({ data: plans.data }).from(plans).where(and4(eq6(plans.userId, user.id), eq6(plans.date, today)));
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
      await db.insert(plans).values({
        userId: user.id,
        date: today,
        data: { date: today, tasks: newTasks }
      }).onConflictDoUpdate({
        target: [plans.userId, plans.date],
        set: { data: { date: today, tasks: newTasks }, updatedAt: /* @__PURE__ */ new Date() }
      });
      const topTask = result.tasks[0];
      const existingPrefs = await db.select({ data: userPreferences.data }).from(userPreferences).where(eq6(userPreferences.userId, user.id));
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

// server/index.ts
import * as fs from "fs";
import * as path from "path";
var app = express();
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
    express.json({
      limit: "50mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      }
    })
  );
  app2.use(express.urlencoded({ extended: false }));
}
function setupRequestLogging(app2) {
  app2.use((req, res, next) => {
    const start = Date.now();
    const path2 = req.path;
    let capturedJsonResponse = void 0;
    const originalResJson = res.json;
    res.json = function(bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };
    res.on("finish", () => {
      if (!path2.startsWith("/api")) return;
      const duration = Date.now() - start;
      let logLine = `${req.method} ${path2} ${res.statusCode} in ${duration}ms`;
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
    const appJsonPath = path.resolve(process.cwd(), "app.json");
    const appJsonContent = fs.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}
function serveExpoManifest(platform, res) {
  const manifestPath = path.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json"
  );
  if (!fs.existsSync(manifestPath)) {
    return res.status(404).json({ error: `Manifest not found for platform: ${platform}` });
  }
  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");
  const manifest = fs.readFileSync(manifestPath, "utf-8");
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
  const templatePath = path.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.html"
  );
  const landingPageTemplate = fs.readFileSync(templatePath, "utf-8");
  const appName = getAppName();
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
      return serveLandingPage({
        req,
        res,
        landingPageTemplate,
        appName
      });
    }
    next();
  });
  app2.use("/assets", express.static(path.resolve(process.cwd(), "assets")));
  app2.use(express.static(path.resolve(process.cwd(), "static-build")));
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
  const server = await registerRoutes(app);
  startScheduler();
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
          startTelegramPolling().catch((err) => {
            console.error("Failed to start Telegram polling:", err);
          });
        }
        startProactiveScheduler().catch((err) => {
          console.error("Failed to start proactive scheduler:", err);
        });
        startEmailAlertScanner().catch((err) => {
          console.error("Failed to start email alert scanner:", err);
        });
        startMeetingBriefScanner().catch((err) => {
          console.error("Failed to start meeting brief scanner:", err);
        });
      }
    }
  );
})();
