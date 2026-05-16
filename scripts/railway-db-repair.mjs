import pg from "pg";

const { Pool } = pg;

const statements = [
  `DO $$
  BEGIN
    IF to_regclass('public.users') IS NOT NULL THEN
      ALTER TABLE public.users ADD COLUMN IF NOT EXISTS google_id text;
      ALTER TABLE public.users ADD COLUMN IF NOT EXISTS display_name text;
      ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email text;
      CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_unique_idx ON public.users (google_id) WHERE google_id IS NOT NULL;
    END IF;
  END$$`,

  `DO $$
  BEGIN
    IF to_regclass('public.jarvis_scheduled_tasks') IS NOT NULL THEN
      ALTER TABLE public.jarvis_scheduled_tasks ADD COLUMN IF NOT EXISTS needs_attention boolean NOT NULL DEFAULT false;
      ALTER TABLE public.jarvis_scheduled_tasks ADD COLUMN IF NOT EXISTS attention_question text;
    END IF;
  END$$`,

  `DO $$
  BEGIN
    IF to_regclass('public.inbox_rules') IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'inbox_rules'
          AND column_name = 'active'
          AND data_type <> 'boolean'
      )
    THEN
      ALTER TABLE public.inbox_rules ALTER COLUMN active DROP DEFAULT;
      ALTER TABLE public.inbox_rules
        ALTER COLUMN active TYPE boolean
        USING CASE
          WHEN active IS NULL THEN true
          WHEN lower(btrim(active::text)) IN ('true', 't', '1', 'yes', 'y', 'on', 'active', 'enabled') THEN true
          WHEN lower(btrim(active::text)) IN ('false', 'f', '0', 'no', 'n', 'off', 'inactive', 'disabled') THEN false
          WHEN btrim(active::text) = '' THEN true
          ELSE true
        END;
      ALTER TABLE public.inbox_rules ALTER COLUMN active SET DEFAULT true;
      ALTER TABLE public.inbox_rules ALTER COLUMN active SET NOT NULL;
    END IF;
  END$$`,

  `DO $$
  BEGIN
    IF to_regclass('public.inbox_rules') IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'inbox_rules'
          AND column_name = 'match_count'
          AND data_type <> 'integer'
      )
    THEN
      ALTER TABLE public.inbox_rules ALTER COLUMN match_count DROP DEFAULT;
      ALTER TABLE public.inbox_rules
        ALTER COLUMN match_count TYPE integer
        USING CASE
          WHEN match_count IS NULL THEN 0
          WHEN btrim(match_count::text) ~ '^[0-9]+$' THEN match_count::integer
          WHEN btrim(match_count::text) = '' THEN 0
          ELSE 0
        END;
      ALTER TABLE public.inbox_rules ALTER COLUMN match_count SET DEFAULT 0;
      ALTER TABLE public.inbox_rules ALTER COLUMN match_count SET NOT NULL;
    END IF;
  END$$`,

  `DO $$
  BEGIN
    IF to_regclass('public.discord_agents') IS NOT NULL THEN
      ALTER TABLE public.discord_agents ADD COLUMN IF NOT EXISTS mention_patterns jsonb;
      UPDATE public.discord_agents SET mention_patterns = '[]'::jsonb WHERE mention_patterns IS NULL;
      ALTER TABLE public.discord_agents ALTER COLUMN mention_patterns SET DEFAULT '[]'::jsonb;
      ALTER TABLE public.discord_agents ALTER COLUMN mention_patterns SET NOT NULL;
    END IF;
  END$$`,

  `DO $$
  BEGIN
    IF to_regclass('public.users') IS NOT NULL THEN
      CREATE TABLE IF NOT EXISTS public.transcript_jobs (
        id serial PRIMARY KEY,
        user_id varchar NOT NULL REFERENCES public.users(id),
        video_id text NOT NULL,
        supadata_job_id text NOT NULL,
        status text NOT NULL DEFAULT 'pending',
        result text,
        created_at timestamp DEFAULT now() NOT NULL,
        updated_at timestamp DEFAULT now() NOT NULL
      );
    END IF;
  END$$`,
];

export async function runRailwayDatabaseRepair(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    console.log("[railway-db-repair] DATABASE_URL is not set; skipping database repair");
    return;
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    for (const statement of statements) {
      await pool.query(statement);
    }
    console.log("[railway-db-repair] Database compatibility repair complete");
  } finally {
    await pool.end();
  }
}
