import pg from "pg";

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.log("[railway-prestart] DATABASE_URL is not set; skipping database repair");
  process.exit(0);
}

const pool = new Pool({ connectionString: databaseUrl });

const statements = [
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id text`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name text`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS email text`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_unique_idx ON users (google_id) WHERE google_id IS NOT NULL`,

  `ALTER TABLE jarvis_scheduled_tasks ADD COLUMN IF NOT EXISTS needs_attention boolean NOT NULL DEFAULT false`,
  `ALTER TABLE jarvis_scheduled_tasks ADD COLUMN IF NOT EXISTS attention_question text`,

  `CREATE TABLE IF NOT EXISTS transcript_jobs (
    id serial PRIMARY KEY,
    user_id varchar NOT NULL REFERENCES users(id),
    video_id text NOT NULL,
    supadata_job_id text NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    result text,
    created_at timestamp DEFAULT now() NOT NULL,
    updated_at timestamp DEFAULT now() NOT NULL
  )`,
];

try {
  for (const statement of statements) {
    await pool.query(statement);
  }
  console.log("[railway-prestart] Database compatibility repair complete");
} catch (error) {
  console.error("[railway-prestart] Database compatibility repair failed:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
