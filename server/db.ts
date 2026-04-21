import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });

export async function ensureTablesExist() {
  try {
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        username TEXT NOT NULL UNIQUE,
        password TEXT,
        google_id TEXT UNIQUE,
        display_name TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`ALTER TABLE users ALTER COLUMN password DROP NOT NULL`).catch(() => {});
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE`).catch(() => {});
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT`).catch(() => {});

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS plans (
        user_id VARCHAR NOT NULL REFERENCES users(id),
        date VARCHAR NOT NULL,
        data JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (user_id, date)
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS goals (
        user_id VARCHAR NOT NULL PRIMARY KEY REFERENCES users(id),
        data JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS stats (
        user_id VARCHAR NOT NULL PRIMARY KEY REFERENCES users(id),
        data JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS brain_dump_inbox (
        user_id VARCHAR NOT NULL PRIMARY KEY REFERENCES users(id),
        data JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS energy_checkins (
        user_id VARCHAR NOT NULL REFERENCES users(id),
        date VARCHAR NOT NULL,
        data JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (user_id, date)
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS chat_history (
        user_id VARCHAR NOT NULL PRIMARY KEY REFERENCES users(id),
        data JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS life_context (
        user_id VARCHAR NOT NULL PRIMARY KEY REFERENCES users(id),
        data JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS timer_settings (
        user_id VARCHAR NOT NULL PRIMARY KEY REFERENCES users(id),
        data JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id VARCHAR NOT NULL PRIMARY KEY REFERENCES users(id),
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS completion_history (
        user_id VARCHAR NOT NULL PRIMARY KEY REFERENCES users(id),
        data JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS blocked_tasks (
        user_id VARCHAR NOT NULL PRIMARY KEY REFERENCES users(id),
        data JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS completed_calendar_ids (
        user_id VARCHAR NOT NULL REFERENCES users(id),
        date VARCHAR NOT NULL,
        data JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (user_id, date)
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS plan_snapshots (
        user_id VARCHAR NOT NULL PRIMARY KEY REFERENCES users(id),
        data JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.execute(sql`
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

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_memories (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id),
        content TEXT NOT NULL,
        category VARCHAR NOT NULL DEFAULT 'fact',
        extracted_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    // Phase 4 — typed memory layer + relationships + soul + insights.
    await db.execute(sql`ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS relevance_score INTEGER NOT NULL DEFAULT 50`).catch(() => {});
    await db.execute(sql`ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS confidence INTEGER NOT NULL DEFAULT 70`).catch(() => {});
    await db.execute(sql`ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS source_type VARCHAR NOT NULL DEFAULT 'manual'`).catch(() => {});
    await db.execute(sql`ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS source_ref VARCHAR`).catch(() => {});
    await db.execute(sql`ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS last_referenced_at TIMESTAMP`).catch(() => {});
    await db.execute(sql`ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS embedding JSONB`).catch(() => {});
    await db.execute(sql`CREATE INDEX IF NOT EXISTS user_memories_fts_idx ON user_memories USING gin(to_tsvector('english', content))`).catch(() => {});
    await db.execute(sql`
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
    await db.execute(sql`CREATE INDEX IF NOT EXISTS people_user_idx ON people(user_id)`).catch(() => {});
    await db.execute(sql`ALTER TABLE people ADD COLUMN IF NOT EXISTS next_interaction_at TIMESTAMP`).catch(() => {});
    await db.execute(sql`ALTER TABLE people ADD COLUMN IF NOT EXISTS upcoming_count INTEGER NOT NULL DEFAULT 0`).catch(() => {});
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS weekly_insights_user_week_idx ON weekly_insights(user_id, week_of)`).catch(() => {});
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS jarvis_souls (
        user_id VARCHAR PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL DEFAULT '',
        manual_override TEXT,
        generated_at TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS weekly_insights (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        week_of VARCHAR NOT NULL,
        patterns JSONB NOT NULL DEFAULT '[]'::jsonb,
        summary TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS weekly_insights_user_week_idx ON weekly_insights(user_id, week_of)`).catch(() => {});

    await db.execute(sql`
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

    await db.execute(sql`
      UPDATE user_oauth_tokens SET account_email = '' WHERE account_email IS NULL
    `).catch(() => {});

    await db.execute(sql`
      ALTER TABLE user_oauth_tokens DROP CONSTRAINT IF EXISTS user_oauth_tokens_pkey
    `).catch(() => {});

    await db.execute(sql`
      ALTER TABLE user_oauth_tokens ALTER COLUMN account_email SET DEFAULT ''
    `).catch(() => {});

    await db.execute(sql`
      ALTER TABLE user_oauth_tokens ALTER COLUMN account_email SET NOT NULL
    `).catch(() => {});

    await db.execute(sql`
      ALTER TABLE user_oauth_tokens ADD CONSTRAINT user_oauth_tokens_pkey PRIMARY KEY (user_id, provider, account_email)
    `).catch(() => {});

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS telegram_links (
        user_id VARCHAR NOT NULL PRIMARY KEY REFERENCES users(id),
        chat_id VARCHAR NOT NULL,
        username VARCHAR,
        linked_at TIMESTAMP NOT NULL DEFAULT NOW(),
        group_chat_ids JSONB DEFAULT '[]'::jsonb
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS telegram_link_codes (
        code VARCHAR PRIMARY KEY,
        user_id VARCHAR NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
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

    await db.execute(sql`
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

    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS proactive_questions_user_source_idx
        ON proactive_questions_sent (user_id, source_type, source_id)
    `).catch(() => {});

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS mobile_auth_sessions (
        session_id TEXT PRIMARY KEY,
        token TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL
      )
    `);

    await db.execute(sql`
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
    await db.execute(sql`ALTER TABLE morning_voice_notes ALTER COLUMN recorded_at TYPE DATE USING recorded_at::DATE`).catch(() => {});
    await db.execute(sql`ALTER TABLE morning_voice_notes ADD CONSTRAINT morning_voice_notes_mood_check CHECK (mood_signal IN ('calm', 'energized', 'stressed', 'overwhelmed', 'uncertain'))`).catch(() => {});
    await db.execute(sql`ALTER TABLE morning_voice_notes ADD CONSTRAINT morning_voice_notes_user_date_unique UNIQUE (user_id, recorded_at)`).catch(() => {});

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS chatgpt_imports (
        "userId" VARCHAR PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        "importedAt" TIMESTAMP DEFAULT NOW(),
        "memoriesAdded" INTEGER DEFAULT 0
      )
    `);

    await db.execute(sql`
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

    await db.execute(sql`
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

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS proactive_schedule_log (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        message_type VARCHAR NOT NULL,
        sent_date VARCHAR NOT NULL,
        sent_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.execute(sql`
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

    await db.execute(sql`
      ALTER TABLE momentum_sessions
        ADD COLUMN IF NOT EXISTS status VARCHAR NOT NULL DEFAULT 'active'
    `);

    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS proactive_schedule_log_uniq
        ON proactive_schedule_log (user_id, message_type, sent_date)
    `);

    await db.execute(sql`
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

    await db.execute(sql`
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

    await db.execute(sql`
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

    await db.execute(sql`
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

    await db.execute(sql`
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
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS email_drafts_user_status_idx
        ON email_drafts (user_id, status, created_at DESC)
    `).catch(() => {});
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS email_drafts_user_msg_uniq
        ON email_drafts (user_id, source_message_id)
        WHERE source_message_id IS NOT NULL
    `).catch(() => {});

    await db.execute(sql`
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

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS interaction_log_user_created_idx
        ON interaction_log (user_id, created_at DESC)
    `).catch(() => {});

    // ── Phase 3: Sub-agent goals tables ──────────────────────────────
    await db.execute(sql`
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
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS goal_trees_user_goal_uniq
        ON goal_trees (user_id, goal_id)
    `).catch(() => {});

    await db.execute(sql`
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
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS agent_jobs_status_created_idx
        ON agent_jobs (status, created_at)
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS agent_jobs_user_status_idx
        ON agent_jobs (user_id, status, created_at DESC)
    `).catch(() => {});

    await db.execute(sql`
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
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS deliverables_user_status_idx
        ON deliverables (user_id, status, created_at DESC)
    `).catch(() => {});

    // ── Phase 5: multi-channel + computer control ──────────────────
    await db.execute(sql`
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
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS channel_links_channel_address_idx
        ON channel_links (channel, address)
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS channel_links_user_idx
        ON channel_links (user_id, channel)
    `).catch(() => {});

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS channel_link_codes (
        code VARCHAR PRIMARY KEY,
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        channel VARCHAR NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMP
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS channel_link_codes_channel_expires_idx
        ON channel_link_codes (channel, expires_at)
    `).catch(() => {});

    await db.execute(sql`
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
