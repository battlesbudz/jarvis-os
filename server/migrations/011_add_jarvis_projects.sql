-- Migration 011: Add Jarvis Projects tables for 24/7 autonomous project building

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
);

CREATE INDEX IF NOT EXISTS jarvis_projects_user_idx ON jarvis_projects (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS jarvis_projects_status_idx ON jarvis_projects (status);
CREATE INDEX IF NOT EXISTS jarvis_projects_next_run_idx ON jarvis_projects (next_run_at) WHERE next_run_at IS NOT NULL;

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
);

CREATE INDEX IF NOT EXISTS jarvis_project_sessions_project_idx ON jarvis_project_sessions (project_id, session_number DESC);
