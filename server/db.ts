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

pool.on("error", (error) => {
  console.error("[db] idle PostgreSQL client error:", error);
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
      CREATE TABLE IF NOT EXISTS model_usage_events (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider VARCHAR NOT NULL,
        model TEXT NOT NULL,
        source VARCHAR NOT NULL DEFAULT 'unknown',
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        success BOOLEAN NOT NULL DEFAULT TRUE,
        estimated BOOLEAN NOT NULL DEFAULT TRUE,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS model_usage_events_user_created_idx
        ON model_usage_events (user_id, created_at DESC)
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS model_usage_events_user_model_idx
        ON model_usage_events (user_id, model, created_at DESC)
    `).catch(() => {});

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
      CREATE TABLE IF NOT EXISTS living_context_updates (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        target VARCHAR NOT NULL,
        path TEXT NOT NULL,
        topic TEXT NOT NULL,
        learned TEXT NOT NULL,
        normalized_learned TEXT NOT NULL,
        source_type VARCHAR NOT NULL DEFAULT 'conversation',
        source_ref TEXT,
        confidence INTEGER NOT NULL DEFAULT 70,
        status VARCHAR NOT NULL DEFAULT 'needs_review',
        fills_question TEXT,
        approval_sensitive BOOLEAN NOT NULL DEFAULT TRUE,
        notes TEXT,
        block TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS living_context_updates_user_target_fact_idx ON living_context_updates(user_id, target, normalized_learned)`).catch(() => {});
    await db.execute(sql`CREATE INDEX IF NOT EXISTS living_context_updates_user_target_created_idx ON living_context_updates(user_id, target, created_at)`).catch(() => {});
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
      CREATE TABLE IF NOT EXISTS composio_connected_accounts (
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        toolkit VARCHAR NOT NULL,
        auth_config_id VARCHAR NOT NULL,
        connected_account_id VARCHAR NOT NULL,
        status VARCHAR NOT NULL DEFAULT 'ACTIVE',
        account_email TEXT,
        account_name TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, connected_account_id)
      )
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS composio_connected_accounts_user_toolkit_idx
      ON composio_connected_accounts(user_id, toolkit)
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
        user_id VARCHAR PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        imported_at TIMESTAMP DEFAULT NOW(),
        memories_added INTEGER DEFAULT 0
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS inbox_rules (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR NOT NULL DEFAULT 'suppress',
        scope VARCHAR NOT NULL DEFAULT 'all',
        pattern TEXT NOT NULL,
        match_hints JSONB NOT NULL DEFAULT '{}'::jsonb,
        active BOOLEAN NOT NULL DEFAULT true,
        match_count INTEGER NOT NULL DEFAULT 0,
        source VARCHAR NOT NULL DEFAULT 'user',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inbox_rules' AND column_name = 'userId') THEN
          ALTER TABLE inbox_rules RENAME COLUMN "userId" TO user_id;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inbox_rules' AND column_name = 'matchHints') THEN
          ALTER TABLE inbox_rules RENAME COLUMN "matchHints" TO match_hints;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inbox_rules' AND column_name = 'matchCount') THEN
          ALTER TABLE inbox_rules RENAME COLUMN "matchCount" TO match_count;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inbox_rules' AND column_name = 'createdAt') THEN
          ALTER TABLE inbox_rules RENAME COLUMN "createdAt" TO created_at;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inbox_rules' AND column_name = 'updatedAt') THEN
          ALTER TABLE inbox_rules RENAME COLUMN "updatedAt" TO updated_at;
        END IF;
      END$$
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS inbox_items (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source_type VARCHAR NOT NULL,
        source_id VARCHAR NOT NULL,
        subject TEXT,
        sender TEXT,
        snippet TEXT,
        jarvis_reason TEXT,
        suggested_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
        matched_rule_id VARCHAR,
        status VARCHAR NOT NULL DEFAULT 'pending',
        acted_at TIMESTAMP,
        dismiss_count INTEGER NOT NULL DEFAULT 0,
        surfaced_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inbox_items' AND column_name = 'userId') THEN
          ALTER TABLE inbox_items RENAME COLUMN "userId" TO user_id;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inbox_items' AND column_name = 'sourceType') THEN
          ALTER TABLE inbox_items RENAME COLUMN "sourceType" TO source_type;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inbox_items' AND column_name = 'sourceId') THEN
          ALTER TABLE inbox_items RENAME COLUMN "sourceId" TO source_id;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inbox_items' AND column_name = 'jarvisReason') THEN
          ALTER TABLE inbox_items RENAME COLUMN "jarvisReason" TO jarvis_reason;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inbox_items' AND column_name = 'suggestedActions') THEN
          ALTER TABLE inbox_items RENAME COLUMN "suggestedActions" TO suggested_actions;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inbox_items' AND column_name = 'matchedRuleId') THEN
          ALTER TABLE inbox_items RENAME COLUMN "matchedRuleId" TO matched_rule_id;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inbox_items' AND column_name = 'actedAt') THEN
          ALTER TABLE inbox_items RENAME COLUMN "actedAt" TO acted_at;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inbox_items' AND column_name = 'dismissCount') THEN
          ALTER TABLE inbox_items RENAME COLUMN "dismissCount" TO dismiss_count;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inbox_items' AND column_name = 'createdAt') THEN
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inbox_items' AND column_name = 'surfaced_at') THEN
            ALTER TABLE inbox_items DROP COLUMN "createdAt";
          ELSE
            ALTER TABLE inbox_items RENAME COLUMN "createdAt" TO surfaced_at;
          END IF;
        END IF;
      END$$
    `);

    await db.execute(sql`ALTER TABLE inbox_items ADD COLUMN IF NOT EXISTS surfaced_at TIMESTAMP DEFAULT NOW()`);

    await db.execute(sql`
      DELETE FROM inbox_items a
      USING (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY user_id, source_id
                 ORDER BY surfaced_at ASC, id ASC
               ) AS rn
        FROM inbox_items
      ) b
      WHERE a.id = b.id AND b.rn > 1
    `);

    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS inbox_items_user_source_uidx
      ON inbox_items (user_id, source_id)
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
    // Shell command integration — cron + daemon_shell
    await db.execute(sql`ALTER TABLE jarvis_scheduled_tasks ADD COLUMN IF NOT EXISTS shell_command TEXT`).catch(() => {});
    await db.execute(sql`ALTER TABLE jarvis_scheduled_tasks ADD COLUMN IF NOT EXISTS last_shell_result JSONB`).catch(() => {});
    // Atomic claim column — prevents duplicate execution when tasks take >1 scheduler tick
    await db.execute(sql`ALTER TABLE jarvis_scheduled_tasks ADD COLUMN IF NOT EXISTS in_progress_at TIMESTAMP`).catch(() => {});
    // Pause/resume support — active=false skips a task in the scheduler
    await db.execute(sql`ALTER TABLE jarvis_scheduled_tasks ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true`).catch(() => {});

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
    await db.execute(sql`
      WITH ranked AS (
        SELECT
          ctid,
          row_number() OVER (
            PARTITION BY user_id, integration
            ORDER BY last_checked_at DESC NULLS LAST
          ) AS rn
        FROM integration_status
      )
      DELETE FROM integration_status
      WHERE ctid IN (SELECT ctid FROM ranked WHERE rn > 1)
    `).catch(() => {});
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS integration_status_user_integration_idx
        ON integration_status (user_id, integration)
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
    await db.execute(sql`ALTER TABLE discord_agents ADD COLUMN IF NOT EXISTS mention_patterns JSONB NOT NULL DEFAULT '[]'::jsonb`).catch(() => {});

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

    // ── agent_approval_policies: per-agent approval scope ─────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS agent_approval_policies (
        agent_id VARCHAR PRIMARY KEY REFERENCES discord_agents(id) ON DELETE CASCADE,
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        scope VARCHAR NOT NULL DEFAULT 'global',
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});

    // ── agent_approval_allowlist: per-agent tool allowlist patterns ────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS agent_approval_allowlist (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id VARCHAR NOT NULL REFERENCES discord_agents(id) ON DELETE CASCADE,
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        pattern VARCHAR NOT NULL,
        use_count INTEGER NOT NULL DEFAULT 0,
        last_used_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});
    await db.execute(sql`CREATE INDEX IF NOT EXISTS agent_approval_allowlist_agent_idx ON agent_approval_allowlist(agent_id)`).catch(() => {});

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

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS agent_chat_session_summaries (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        sdk_session_id VARCHAR NOT NULL REFERENCES agent_chat_sessions(sdk_session_id) ON DELETE CASCADE,
        agent_id VARCHAR NOT NULL REFERENCES discord_agents(id) ON DELETE CASCADE,
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        summary TEXT NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS agent_chat_session_summaries_session_idx
        ON agent_chat_session_summaries(sdk_session_id, created_at ASC)
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

    // Chat integration tables (used by server/replit_integrations/chat)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS conversations (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'New Chat',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role VARCHAR NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});

    // ── Write-budget log — circuit-breaker persistence across restarts ────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS write_budget_log (
        id         SERIAL PRIMARY KEY,
        written_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS write_budget_log_written_at_idx
        ON write_budget_log (written_at DESC)
    `).catch(() => {});

    // ── Write-budget warning deduplication — one alert per 60-minute window ──
    // Single-row state table (id always = 1).  The UPDATE-based claim in
    // safeWritePolicy.ts takes a row-level lock, making deduplication safe
    // under concurrent writes at Postgres's default READ COMMITTED isolation.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS write_budget_warnings (
        id        INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        warned_at TIMESTAMP NOT NULL DEFAULT '1970-01-01'
      )
    `).catch(() => {});
    // Ensure the singleton row exists (idempotent on restart).
    await db.execute(sql`
      INSERT INTO write_budget_warnings (id, warned_at)
      VALUES (1, '1970-01-01')
      ON CONFLICT DO NOTHING
    `).catch(() => {});

    // ── Self-heal audit log — persists audit history across container restarts ─
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS self_heal_audit_log (
        id              SERIAL PRIMARY KEY,
        timestamp       VARCHAR(64)  NOT NULL,
        file            TEXT         NOT NULL,
        reason          TEXT         NOT NULL DEFAULT '',
        verified        VARCHAR(256) NOT NULL DEFAULT 'pending',
        changes_summary VARCHAR(256) NOT NULL DEFAULT '',
        diff            TEXT         NOT NULL DEFAULT '',
        created_at      TIMESTAMP    NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS self_heal_audit_log_ts_idx
        ON self_heal_audit_log (timestamp DESC)
    `).catch(() => {});

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS learning_synthesis_log (
        id           SERIAL       PRIMARY KEY,
        created_at   TIMESTAMP    NOT NULL DEFAULT NOW(),
        bullet_count INTEGER      NOT NULL DEFAULT 0,
        bullets      JSONB        NOT NULL DEFAULT '[]'::jsonb,
        triggered_by VARCHAR(32)  NOT NULL DEFAULT 'manual',
        skipped      BOOLEAN      NOT NULL DEFAULT false,
        skip_reason  TEXT
      )
    `).catch(() => {});

    // ── Discord Confirm Tokens ───────────────────────────────────────────────
    // Persists pending Discord action confirmation tokens so they survive
    // server restarts.  One row per user; upserted on each new token.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS discord_confirm_tokens (
        user_id    VARCHAR NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        action     VARCHAR(64) NOT NULL,
        expires_at TIMESTAMP   NOT NULL,
        created_at TIMESTAMP   NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});

    // ── Deliverables — drive_link column ────────────────────────────────────
    await db.execute(sql`
      ALTER TABLE deliverables ADD COLUMN IF NOT EXISTS drive_link TEXT
    `).catch(() => {});

    // ── Web-chat invite tokens — short-lived links for sharing Jarvis access ──
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS webchat_invite_tokens (
        id         VARCHAR   PRIMARY KEY DEFAULT gen_random_uuid(),
        token      TEXT      NOT NULL UNIQUE,
        user_id    VARCHAR   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS webchat_invite_tokens_token_idx
        ON webchat_invite_tokens (token)
    `).catch(() => {});

    // ── Gateway devices — OpenClaw-style scoped browser/node pairing ─────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS gateway_device_pairing_requests (
        id               VARCHAR   PRIMARY KEY DEFAULT gen_random_uuid(),
        code             VARCHAR   NOT NULL UNIQUE,
        user_id          VARCHAR   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        label            TEXT      NOT NULL,
        kind             VARCHAR   NOT NULL DEFAULT 'browser',
        origin           TEXT,
        requested_scopes JSONB     NOT NULL DEFAULT '[]'::jsonb,
        metadata         JSONB     NOT NULL DEFAULT '{}'::jsonb,
        status           VARCHAR   NOT NULL DEFAULT 'pending',
        device_id        VARCHAR,
        created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
        expires_at       TIMESTAMP NOT NULL,
        resolved_at      TIMESTAMP
      )
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS gateway_pairing_user_status_idx
        ON gateway_device_pairing_requests (user_id, status, created_at DESC)
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS gateway_pairing_code_idx
        ON gateway_device_pairing_requests (code)
    `).catch(() => {});

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS gateway_devices (
        id             VARCHAR   PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id        VARCHAR   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        label          TEXT      NOT NULL,
        kind           VARCHAR   NOT NULL DEFAULT 'browser',
        token_hash     TEXT      NOT NULL UNIQUE,
        scopes         JSONB     NOT NULL DEFAULT '[]'::jsonb,
        metadata       JSONB     NOT NULL DEFAULT '{}'::jsonb,
        paired_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        last_seen_at   TIMESTAMP,
        revoked_at     TIMESTAMP
      )
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS gateway_devices_user_revoked_idx
        ON gateway_devices (user_id, revoked_at, paired_at DESC)
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS gateway_devices_token_hash_idx
        ON gateway_devices (token_hash)
    `).catch(() => {});

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS gateway_events (
        id           VARCHAR   PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id      VARCHAR   REFERENCES users(id) ON DELETE CASCADE,
        type         VARCHAR   NOT NULL,
        area         VARCHAR   NOT NULL DEFAULT 'gateway',
        severity     VARCHAR   NOT NULL DEFAULT 'info',
        title        TEXT      NOT NULL,
        message      TEXT,
        subject_type VARCHAR,
        subject_id   VARCHAR,
        actor_kind   VARCHAR,
        actor_id     VARCHAR,
        metadata     JSONB     NOT NULL DEFAULT '{}'::jsonb,
        created_at   TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS gateway_events_user_created_idx
        ON gateway_events (user_id, created_at DESC)
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS gateway_events_area_created_idx
        ON gateway_events (area, created_at DESC)
    `).catch(() => {});

    // ── Jarvis Projects — persistent 24/7 autonomous build projects ──────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS jarvis_projects (
        id                 VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id            VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title              TEXT,
        description        TEXT,
        goal               TEXT,
        plan               JSONB NOT NULL DEFAULT '[]',
        current_step_index INTEGER NOT NULL DEFAULT 0,
        status             VARCHAR NOT NULL DEFAULT 'draft',
        autonomous_mode    BOOLEAN NOT NULL DEFAULT FALSE,
        next_run_at        TIMESTAMP,
        question_pending   TEXT,
        question_asked_at  TIMESTAMP,
        question_meta      JSONB DEFAULT '{}',
        origin_channel     VARCHAR,
        last_progress_at   TIMESTAMP,
        consecutive_errors INTEGER NOT NULL DEFAULT 0,
        created_at         TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS jarvis_projects_user_idx
        ON jarvis_projects (user_id, created_at DESC)
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS jarvis_projects_status_idx
        ON jarvis_projects (status)
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS jarvis_projects_next_run_idx
        ON jarvis_projects (next_run_at) WHERE next_run_at IS NOT NULL
    `).catch(() => {});
    // columns added after initial table creation
    await db.execute(sql`ALTER TABLE jarvis_projects ADD COLUMN IF NOT EXISTS workspace_dir TEXT`).catch(() => {});
    await db.execute(sql`ALTER TABLE jarvis_projects ADD COLUMN IF NOT EXISTS app_framework VARCHAR`).catch(() => {});
    await db.execute(sql`ALTER TABLE jarvis_projects ADD COLUMN IF NOT EXISTS dev_server_port INTEGER`).catch(() => {});
    await db.execute(sql`ALTER TABLE jarvis_projects ADD COLUMN IF NOT EXISTS github_repo_url TEXT`).catch(() => {});

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS jarvis_project_sessions (
        id                   SERIAL PRIMARY KEY,
        project_id           VARCHAR NOT NULL REFERENCES jarvis_projects(id) ON DELETE CASCADE,
        session_number       INTEGER NOT NULL DEFAULT 1,
        steps_completed      INTEGER NOT NULL DEFAULT 0,
        step_labels          JSONB NOT NULL DEFAULT '[]',
        duration_ms          INTEGER,
        verification_retries INTEGER NOT NULL DEFAULT 0,
        status               VARCHAR NOT NULL DEFAULT 'complete',
        summary              TEXT,
        created_at           TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS jarvis_project_sessions_project_idx
        ON jarvis_project_sessions (project_id, session_number DESC)
    `).catch(() => {});

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS jarvis_project_files (
        project_id     VARCHAR NOT NULL REFERENCES jarvis_projects(id) ON DELETE CASCADE,
        file_path      TEXT NOT NULL,
        content_base64 TEXT NOT NULL,
        size_bytes     INTEGER NOT NULL DEFAULT 0,
        updated_at     TIMESTAMP NOT NULL DEFAULT NOW(),
        PRIMARY KEY (project_id, file_path)
      )
    `).catch(() => {});

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS jarvis_project_archives (
        project_id     VARCHAR PRIMARY KEY REFERENCES jarvis_projects(id) ON DELETE CASCADE,
        zip_base64     TEXT NOT NULL,
        size_bytes     INTEGER NOT NULL DEFAULT 0,
        created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});

    // ── Search-bar coordinate persistence ────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS search_bar_locations (
        user_id     VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        app_package VARCHAR(256) NOT NULL,
        coordinates_x INTEGER NOT NULL,
        coordinates_y INTEGER NOT NULL,
        updated_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, app_package)
      )
    `);
    await db.execute(sql`
      ALTER TABLE search_bar_locations
        ADD COLUMN IF NOT EXISTS discovered_resource_id VARCHAR(256)
    `);
    // coordinates_valid allows soft-invalidation of stale entries (coordinates_valid=false)
    // without losing the discovered_resource_id for the learnedResourceIds registry.
    await db.execute(sql`
      ALTER TABLE search_bar_locations
        ADD COLUMN IF NOT EXISTS coordinates_valid BOOLEAN NOT NULL DEFAULT TRUE
    `);

    // ── Memory Review Gate (Phase 6) ─────────────────────────────────────────
    await db.execute(sql`ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS pending_review BOOLEAN NOT NULL DEFAULT FALSE`).catch(() => {});
    await db.execute(sql`ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS review_status VARCHAR NOT NULL DEFAULT 'active'`).catch(() => {});

    // ── Skill Candidates (Task #872) ─────────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS skill_candidates (
        id                 VARCHAR   PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id            VARCHAR   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name               TEXT      NOT NULL,
        trigger_description TEXT     NOT NULL,
        instruction_text   TEXT      NOT NULL,
        source_type        VARCHAR   NOT NULL DEFAULT 'curator',
        status             VARCHAR   NOT NULL DEFAULT 'pending',
        created_at         TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS skill_candidates_user_status_idx
        ON skill_candidates (user_id, status)
    `).catch(() => {});

    // ── Build Sessions (Task #982) ────────────────────────────────────────────
    // Persists build-ack events so the suspended-build reminder fires even when
    // the ack message has scrolled past the 20-message rolling chat window.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS build_sessions (
        id                VARCHAR   PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id           VARCHAR   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        job_id            VARCHAR,
        ack_timestamp     BIGINT    NOT NULL,
        build_description TEXT      NOT NULL,
        reminded          BOOLEAN   NOT NULL DEFAULT FALSE,
        created_at        TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS build_sessions_user_reminded_idx
        ON build_sessions (user_id, reminded, created_at DESC)
    `).catch(() => {});

    // ── LLM Wiki — Karpathy-style compounding knowledge base (Task #1126) ────
    // Add new columns to knowledge_vault_pages for wiki page types, cross-refs,
    // tags, and archiving. Remove 5-slug hard-coded constraint (schema-side only).
    await db.execute(sql`ALTER TABLE knowledge_vault_pages ADD COLUMN IF NOT EXISTS page_type VARCHAR NOT NULL DEFAULT 'core'`).catch(() => {});
    await db.execute(sql`ALTER TABLE knowledge_vault_pages ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb`).catch(() => {});
    await db.execute(sql`ALTER TABLE knowledge_vault_pages ADD COLUMN IF NOT EXISTS cross_refs JSONB NOT NULL DEFAULT '[]'::jsonb`).catch(() => {});
    await db.execute(sql`ALTER TABLE knowledge_vault_pages ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP`).catch(() => {});
    await db.execute(sql`ALTER TABLE knowledge_vault_pages ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMP`).catch(() => {});
    // Drop any legacy CHECK constraint that may have enforced the old 5-slug limit
    await db.execute(sql`ALTER TABLE knowledge_vault_pages DROP CONSTRAINT IF EXISTS knowledge_vault_pages_slug_check`).catch(() => {});
    await db.execute(sql`ALTER TABLE knowledge_vault_pages DROP CONSTRAINT IF EXISTS knowledge_vault_pages_5_slugs_check`).catch(() => {});

    // wiki_lint_log — weekly lint run records
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS wiki_lint_log (
        id                   SERIAL    PRIMARY KEY,
        user_id              VARCHAR   NOT NULL REFERENCES users(id),
        ran_at               TIMESTAMP NOT NULL DEFAULT NOW(),
        pages_scanned        INTEGER   NOT NULL DEFAULT 0,
        pages_updated        INTEGER   NOT NULL DEFAULT 0,
        pages_archived       INTEGER   NOT NULL DEFAULT 0,
        contradictions_fixed INTEGER   NOT NULL DEFAULT 0,
        cross_links_added    INTEGER   NOT NULL DEFAULT 0,
        summary              TEXT      NOT NULL DEFAULT ''
      )
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS wiki_lint_log_user_ran_idx
        ON wiki_lint_log (user_id, ran_at DESC)
    `).catch(() => {});

    // Ensure knowledge_vault_pages table exists (it may have been created via push earlier)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS knowledge_vault_pages (
        id           SERIAL    PRIMARY KEY,
        user_id      VARCHAR   NOT NULL REFERENCES users(id),
        slug         TEXT      NOT NULL,
        title        TEXT      NOT NULL,
        content      TEXT      NOT NULL,
        page_type    VARCHAR   NOT NULL DEFAULT 'core',
        tags         JSONB     NOT NULL DEFAULT '[]'::jsonb,
        cross_refs   JSONB     NOT NULL DEFAULT '[]'::jsonb,
        archived_at      TIMESTAMP,
        last_accessed_at TIMESTAMP,
        generated_at     TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, slug)
      )
    `).catch(() => {});

    await db.execute(sql`
      DELETE FROM knowledge_vault_pages a
      USING knowledge_vault_pages b
      WHERE a.user_id = b.user_id
        AND a.slug = b.slug
        AND a.id < b.id
    `).catch(() => {});

    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS vault_user_slug_idx
      ON knowledge_vault_pages (user_id, slug)
    `).catch(() => {});

    console.log("Database tables verified");
  } catch (error) {
    console.error("Failed to ensure database tables exist:", error);
    throw error;
  }
}
