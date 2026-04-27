import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

export const pool = new pg.Pool({
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
    // Biomimetic memory tier & type system migration.
    await db.execute(sql`ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS tier VARCHAR NOT NULL DEFAULT 'long_term'`).catch(() => {});
    await db.execute(sql`ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS memory_type VARCHAR NOT NULL DEFAULT 'semantic'`).catch(() => {});
    await db.execute(sql`ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP`).catch(() => {});
    await db.execute(sql`ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS access_count INTEGER NOT NULL DEFAULT 0`).catch(() => {});
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
      DELETE FROM inbox_items a
      USING (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY "userId", "sourceId"
                 ORDER BY "createdAt" ASC, id ASC
               ) AS rn
        FROM inbox_items
      ) b
      WHERE a.id = b.id AND b.rn > 1
    `);

    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS inbox_items_user_source_uidx
      ON inbox_items ("userId", "sourceId")
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
    await db.execute(sql`
      ALTER TABLE deliverables
        ADD COLUMN IF NOT EXISTS triage_status VARCHAR NOT NULL DEFAULT 'needs_attention',
        ADD COLUMN IF NOT EXISTS triage_note TEXT
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

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS nervous_system_watches (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        category VARCHAR NOT NULL DEFAULT 'keyword',
        active BOOLEAN NOT NULL DEFAULT true,
        last_checked_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS nervous_system_watches_user_idx
        ON nervous_system_watches (user_id)
    `).catch(() => {});

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS nervous_system_signals (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        watch_id VARCHAR REFERENCES nervous_system_watches(id) ON DELETE SET NULL,
        watch_label TEXT NOT NULL,
        headline TEXT NOT NULL,
        url TEXT,
        snippet TEXT,
        relevance_explanation TEXT,
        relevance_score INTEGER NOT NULL DEFAULT 0,
        content_hash VARCHAR NOT NULL,
        delivered_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS nervous_system_signals_hash_idx
        ON nervous_system_signals (user_id, content_hash)
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS nervous_system_signals_user_idx
        ON nervous_system_signals (user_id, created_at DESC)
    `).catch(() => {});

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS dream_insights (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        dream_date VARCHAR NOT NULL,
        insight_text TEXT NOT NULL,
        confidence_score INTEGER NOT NULL DEFAULT 70,
        source_memory_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        shown_to_user BOOLEAN NOT NULL DEFAULT FALSE,
        delivered_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS dream_insights_user_date_idx
        ON dream_insights (user_id, dream_date DESC)
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS dream_insights_pending_idx
        ON dream_insights (user_id, shown_to_user)
        WHERE shown_to_user = FALSE
    `).catch(() => {});

    // ── Emotional State Engine ────────────────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_emotional_state (
        user_id VARCHAR NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        stress_score INTEGER NOT NULL DEFAULT 0,
        flow_score INTEGER NOT NULL DEFAULT 0,
        label VARCHAR NOT NULL DEFAULT 'calm',
        explanation TEXT,
        signal_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
        manual_override VARCHAR,
        manual_override_at TIMESTAMP,
        computed_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        consecutive_high_stress_cycles INTEGER NOT NULL DEFAULT 0,
        last_stress_checkin_at TIMESTAMP
      )
    `);
    // Baseline columns added in Task #168 — safe no-ops on existing tables
    await db.execute(sql`ALTER TABLE user_emotional_state ADD COLUMN IF NOT EXISTS baseline_stress REAL`);
    await db.execute(sql`ALTER TABLE user_emotional_state ADD COLUMN IF NOT EXISTS baseline_flow REAL`);
    await db.execute(sql`ALTER TABLE user_emotional_state ADD COLUMN IF NOT EXISTS pattern_note TEXT`);

    // Historical snapshots for baseline learning (Task #168)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_emotional_state_history (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        stress_score INTEGER NOT NULL,
        flow_score INTEGER NOT NULL,
        label VARCHAR NOT NULL,
        day_of_week INTEGER NOT NULL,
        hour_of_day INTEGER NOT NULL,
        recorded_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_ues_history_user_recorded
        ON user_emotional_state_history (user_id, recorded_at DESC)
    `);

    // ── Jarvis Gut — Reflexive Anomaly Detection ──────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS gut_signals (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        signal_type VARCHAR NOT NULL,
        item_ref VARCHAR,
        confidence_score INTEGER NOT NULL DEFAULT 50,
        explanation TEXT NOT NULL,
        user_response VARCHAR,
        responded_at TIMESTAMP,
        delivered_in_morning_brief BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS gut_signals_user_created_idx
        ON gut_signals (user_id, created_at DESC)
    `).catch(() => {});

    // ── Gut Calibration — persisted per-user per-signal-type feedback rates ───
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS gut_calibration (
        user_id          VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        signal_type      VARCHAR NOT NULL,
        confirmed_count  INTEGER NOT NULL DEFAULT 0,
        dismissed_count  INTEGER NOT NULL DEFAULT 0,
        ignored_count    INTEGER NOT NULL DEFAULT 0,
        confirmation_rate REAL,
        gate_adjustment  INTEGER NOT NULL DEFAULT 0,
        last_updated_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, signal_type)
      )
    `);

    // ── Jarvis Ego — Action Log + Weekly Reports ──────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS jarvis_action_log (
        id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        action_type VARCHAR NOT NULL,
        outcome     VARCHAR NOT NULL DEFAULT 'pending',
        metadata    JSONB   NOT NULL DEFAULT '{}',
        created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS jarvis_action_log_user_created_idx
        ON jarvis_action_log (user_id, created_at DESC)
    `).catch(() => {});

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ego_weekly_reports (
        id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        week_of     VARCHAR NOT NULL,
        analysis    JSONB   NOT NULL DEFAULT '{}',
        report_text TEXT    NOT NULL DEFAULT '',
        delivered_at TIMESTAMP,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT ego_weekly_reports_user_week_idx UNIQUE (user_id, week_of)
      )
    `);

    // Discord OS scheduled channel reports table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS discord_channel_schedules (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        guild_id VARCHAR,
        channel_id VARCHAR,
        channel_name VARCHAR NOT NULL,
        label VARCHAR NOT NULL,
        cron_expression VARCHAR NOT NULL DEFAULT '0 7 * * *',
        prompt TEXT NOT NULL,
        pipeline_next VARCHAR,
        last_run TIMESTAMP,
        last_output TEXT,
        enabled BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});

    // Discord agents table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS discord_agents (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR NOT NULL,
        role VARCHAR NOT NULL DEFAULT 'custom',
        persona TEXT,
        channel_id VARCHAR,
        channel_name VARCHAR,
        is_active INTEGER NOT NULL DEFAULT 1,
        loop_enabled INTEGER NOT NULL DEFAULT 0,
        loop_interval_minutes INTEGER DEFAULT 60,
        loop_prompt TEXT,
        last_loop_run TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});

    // Discord pending approvals
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS discord_pending_approvals (
        message_id VARCHAR PRIMARY KEY,
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        channel_id VARCHAR NOT NULL,
        guild_id VARCHAR,
        type VARCHAR NOT NULL DEFAULT 'custom',
        content TEXT NOT NULL,
        approve_emoji VARCHAR NOT NULL DEFAULT '✅',
        reject_emoji VARCHAR NOT NULL DEFAULT '❌',
        on_approve JSONB NOT NULL,
        on_reject JSONB,
        status VARCHAR NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        resolved_at TIMESTAMP
      )
    `);

    // Agent workflows
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS agent_workflows (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        steps JSONB NOT NULL DEFAULT '[]'::jsonb,
        current_step_index INTEGER NOT NULL DEFAULT 0,
        status VARCHAR NOT NULL DEFAULT 'active',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});

    // Jarvis scheduled tasks
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS jarvis_scheduled_tasks (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        scheduled_at TIMESTAMP NOT NULL,
        recurrence VARCHAR,
        completed_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // ── Prediction Engine (Task #156) ─────────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS jarvis_predictions (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        prediction_type VARCHAR NOT NULL,
        target_datetime TIMESTAMP NOT NULL,
        target_date VARCHAR NOT NULL,
        confidence_score INTEGER NOT NULL DEFAULT 50,
        basis_summary TEXT NOT NULL DEFAULT '',
        human_readable TEXT NOT NULL DEFAULT '',
        action_suggestion TEXT,
        observation_count INTEGER NOT NULL DEFAULT 0,
        validated BOOLEAN,
        validation_note TEXT,
        validated_at TIMESTAMP,
        delivered_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS jarvis_predictions_user_type_date_idx
        ON jarvis_predictions (user_id, prediction_type, target_date)
    `).catch(() => {});

    // Discord seen message IDs — persist dedup state across server restarts
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS discord_seen_messages (
        message_id VARCHAR PRIMARY KEY,
        seen_at BIGINT NOT NULL
      )
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS discord_seen_messages_seen_at_idx
        ON discord_seen_messages (seen_at)
    `).catch(() => {});

    // ── MCP API Keys — per-user bearer tokens for the Jarvis MCP server ─────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS mcp_api_keys (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key_hash TEXT NOT NULL,
        key_prefix VARCHAR NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        last_used_at TIMESTAMP
      )
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS mcp_api_keys_user_idx ON mcp_api_keys (user_id)
    `).catch(() => {});

    // ── MCP Rate Limits — DB-backed sliding-window counters ──────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS mcp_rate_limits (
        bucket       TEXT PRIMARY KEY,
        count        INTEGER NOT NULL,
        window_start BIGINT  NOT NULL
      )
    `).catch(() => {});

    // openclaw_build_log — created via migration 005; ensure new columns exist
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS openclaw_build_log (
        id              VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        feature_name    VARCHAR NOT NULL,
        description     TEXT    NOT NULL,
        output_code     TEXT    NOT NULL DEFAULT '',
        success         BOOLEAN NOT NULL DEFAULT FALSE,
        smoke_test_passed BOOLEAN,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS openclaw_build_log_user_created_idx
        ON openclaw_build_log (user_id, created_at DESC)
    `).catch(() => {});
    await db.execute(sql`
      ALTER TABLE openclaw_build_log ADD COLUMN IF NOT EXISTS smoke_test_args JSONB
    `).catch(() => {});

    // integration_status — pre-flight validator cache written every 30 min
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS integration_status (
        user_id         VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        integration     VARCHAR NOT NULL,
        status          VARCHAR NOT NULL DEFAULT 'unconfigured',
        last_checked_at TIMESTAMP NOT NULL DEFAULT NOW(),
        error_message   TEXT,
        expires_at      TIMESTAMP,
        PRIMARY KEY (user_id, integration)
      )
    `).catch(() => {});

    // ── Behaviour Packs — operator publish + Ego override path (Task #282) ──
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS skill_packs (
        id               VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        name             TEXT    NOT NULL,
        description      TEXT    NOT NULL DEFAULT '',
        version          INTEGER NOT NULL DEFAULT 1,
        instructions     TEXT    NOT NULL DEFAULT '',
        is_store_visible BOOLEAN NOT NULL DEFAULT false,
        published_at     TIMESTAMP,
        changelog        JSONB   NOT NULL DEFAULT '[]'::jsonb,
        created_at       TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});
    await db.execute(sql`ALTER TABLE skill_packs ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''`).catch(() => {});
    await db.execute(sql`ALTER TABLE skill_packs ADD COLUMN IF NOT EXISTS heartbeat_rules JSONB NOT NULL DEFAULT '{}'::jsonb`).catch(() => {});
    await db.execute(sql`ALTER TABLE skill_packs ADD COLUMN IF NOT EXISTS tool_groups JSONB NOT NULL DEFAULT '{}'::jsonb`).catch(() => {});
    await db.execute(sql`ALTER TABLE skill_packs ADD COLUMN IF NOT EXISTS is_store_visible BOOLEAN NOT NULL DEFAULT false`).catch(() => {});

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_skill_packs (
        user_id               VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        pack_id               VARCHAR NOT NULL REFERENCES skill_packs(id) ON DELETE CASCADE,
        applied_version       INTEGER NOT NULL DEFAULT 1,
        is_active             BOOLEAN NOT NULL DEFAULT false,
        instruction_overrides JSONB   NOT NULL DEFAULT '{}'::jsonb,
        updated_at            TIMESTAMP NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, pack_id)
      )
    `).catch(() => {});
    await db.execute(sql`ALTER TABLE user_skill_packs ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT false`).catch(() => {});

    // Diagnostics — system health events
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS diagnostic_events (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE,
        subsystem VARCHAR NOT NULL,
        severity VARCHAR NOT NULL DEFAULT 'info',
        message TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        resolved BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});
    await db.execute(sql`CREATE INDEX IF NOT EXISTS diag_events_user_subsystem_idx ON diagnostic_events(user_id, subsystem, created_at DESC)`).catch(() => {});

    // ── Multi-agent ego system: new discord_agents columns ─────────────────
    await db.execute(sql`ALTER TABLE discord_agents ADD COLUMN IF NOT EXISTS platforms JSONB NOT NULL DEFAULT '["discord"]'::jsonb`).catch(() => {});
    await db.execute(sql`ALTER TABLE discord_agents ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{
      "can_search_web":true,"can_use_browser":false,"can_send_emails":false,
      "can_create_email_drafts":false,"can_read_email":false,"can_send_messages":true,
      "can_access_files":false,"can_take_screenshots":false,"can_open_apps":false,
      "can_call_user":false,"can_use_voice":false,"can_create_tasks":true,
      "can_create_other_agents":false,"can_access_global_memory":false
    }'::jsonb`).catch(() => {});
    await db.execute(sql`ALTER TABLE discord_agents ADD COLUMN IF NOT EXISTS memory_scope VARCHAR NOT NULL DEFAULT 'agent_private'`).catch(() => {});
    await db.execute(sql`ALTER TABLE discord_agents ADD COLUMN IF NOT EXISTS access_global_memory BOOLEAN NOT NULL DEFAULT false`).catch(() => {});
    await db.execute(sql`ALTER TABLE discord_agents ADD COLUMN IF NOT EXISTS allowed_users JSONB NOT NULL DEFAULT '[]'::jsonb`).catch(() => {});
    await db.execute(sql`ALTER TABLE discord_agents ADD COLUMN IF NOT EXISTS allowed_conversations JSONB NOT NULL DEFAULT '[]'::jsonb`).catch(() => {});
    await db.execute(sql`ALTER TABLE discord_agents ADD COLUMN IF NOT EXISTS private_mode BOOLEAN NOT NULL DEFAULT false`).catch(() => {});
    await db.execute(sql`ALTER TABLE discord_agents ADD COLUMN IF NOT EXISTS platform_channels JSONB NOT NULL DEFAULT '{}'::jsonb`).catch(() => {});
    await db.execute(sql`ALTER TABLE discord_agents ADD COLUMN IF NOT EXISTS config_json JSONB`).catch(() => {});
    await db.execute(sql`ALTER TABLE discord_agents ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMP`).catch(() => {});
    await db.execute(sql`ALTER TABLE discord_agents ADD COLUMN IF NOT EXISTS stuck_since TIMESTAMP`).catch(() => {});
    await db.execute(sql`ALTER TABLE discord_agents ADD COLUMN IF NOT EXISTS heartbeat_fail_count INTEGER NOT NULL DEFAULT 0`).catch(() => {});
    await db.execute(sql`ALTER TABLE discord_agents ADD COLUMN IF NOT EXISTS preferred_model TEXT`).catch(() => {});

    // ── agent_memories: per-agent private memory namespace ─────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS agent_memories (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id VARCHAR NOT NULL REFERENCES discord_agents(id) ON DELETE CASCADE,
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        category VARCHAR NOT NULL DEFAULT 'fact',
        embedding JSONB,
        relevance_score INTEGER NOT NULL DEFAULT 50,
        confidence INTEGER NOT NULL DEFAULT 70,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});
    await db.execute(sql`CREATE INDEX IF NOT EXISTS agent_memories_agent_user_idx ON agent_memories(agent_id, user_id, created_at DESC)`).catch(() => {});

    // ── agent_messages: agent-to-agent message bus ─────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS agent_messages (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        from_agent_id VARCHAR REFERENCES discord_agents(id) ON DELETE SET NULL,
        to_agent_id VARCHAR NOT NULL REFERENCES discord_agents(id) ON DELETE CASCADE,
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        message_type VARCHAR NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        status VARCHAR NOT NULL DEFAULT 'pending',
        delegation_depth INTEGER NOT NULL DEFAULT 0,
        task_id VARCHAR,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});
    await db.execute(sql`CREATE INDEX IF NOT EXISTS agent_messages_to_agent_status_idx ON agent_messages(to_agent_id, status, created_at)`).catch(() => {});

    // ── agent_approval_gates: persistent tool approval gates ───────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS agent_approval_gates (
        id VARCHAR PRIMARY KEY,
        agent_id VARCHAR NOT NULL REFERENCES discord_agents(id) ON DELETE CASCADE,
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tool_name VARCHAR NOT NULL,
        tool_args JSONB NOT NULL DEFAULT '{}'::jsonb,
        description TEXT NOT NULL,
        status VARCHAR NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL,
        resolved_at TIMESTAMP,
        resolved_by VARCHAR
      )
    `).catch(() => {});
    await db.execute(sql`CREATE INDEX IF NOT EXISTS agent_approval_gates_user_status_idx ON agent_approval_gates(user_id, status, created_at DESC)`).catch(() => {});
    await db.execute(sql`ALTER TABLE agent_approval_gates ADD COLUMN IF NOT EXISTS initiated_by VARCHAR NOT NULL DEFAULT 'user'`).catch(() => {});

    // ── agent_chat_messages: permanent per-agent conversation log (no TTL) ──
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS agent_chat_messages (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id VARCHAR NOT NULL REFERENCES discord_agents(id) ON DELETE CASCADE,
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role VARCHAR NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS agent_chat_messages_agent_user_idx
        ON agent_chat_messages(agent_id, user_id, created_at ASC)
    `).catch(() => {});

    // ── Coach channel sessions (persist sdkSessionId across server restarts) ──
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS coach_channel_sessions (
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        channel VARCHAR NOT NULL,
        sdk_session_id VARCHAR NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, channel)
      )
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS coach_channel_sessions_user_idx
        ON coach_channel_sessions (user_id)
    `).catch(() => {});

    // ── MCP server registry ────────────────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS mcp_servers (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR NOT NULL,
        transport VARCHAR NOT NULL DEFAULT 'stdio',
        command TEXT,
        url TEXT,
        auth_token TEXT,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        is_built_in BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS mcp_servers_user_idx ON mcp_servers (user_id)
    `).catch(() => {});
    await db.execute(sql`
      ALTER TABLE mcp_servers
        ADD COLUMN IF NOT EXISTS credential_mode VARCHAR NOT NULL DEFAULT 'direct',
        ADD COLUMN IF NOT EXISTS env_key VARCHAR
    `).catch(() => {});

    // ── Code Proposals (Task #452) ──────────────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS code_proposals (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        reason TEXT NOT NULL,
        file_path TEXT NOT NULL,
        original_content TEXT NOT NULL,
        proposed_content TEXT NOT NULL,
        status VARCHAR NOT NULL DEFAULT 'pending',
        rejection_note TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        applied_at TIMESTAMP
      )
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS code_proposals_user_idx ON code_proposals (user_id)
    `).catch(() => {});

    // ── User Skills (Task #502) ────────────────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_skills (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        emoji VARCHAR NOT NULL DEFAULT '⚡',
        description TEXT NOT NULL,
        instructions TEXT NOT NULL,
        is_built_in BOOLEAN NOT NULL DEFAULT FALSE,
        is_active BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS user_skills_user_idx ON user_skills (user_id)
    `).catch(() => {});
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS user_skills_builtin_name_uniq
        ON user_skills (user_id, name) WHERE is_built_in = TRUE
    `).catch(() => {});

    console.log("Database tables verified");
  } catch (error) {
    console.error("Failed to ensure database tables exist:", error);
    throw error;
  }
}
