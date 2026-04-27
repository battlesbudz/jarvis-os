-- Migration 010: Add Jarvis self-debugging loop tables and columns

-- system_error_log: persists every unhandled error from Express, agent harness, and health checks
CREATE TABLE IF NOT EXISTS system_error_log (
  id           VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  source       TEXT NOT NULL,          -- module / tool name / capability id
  level        VARCHAR NOT NULL DEFAULT 'error',  -- 'error' | 'critical'
  message      TEXT NOT NULL,
  stack_trace  TEXT,
  context_json JSONB NOT NULL DEFAULT '{}',
  investigated BOOLEAN NOT NULL DEFAULT FALSE,
  user_id      VARCHAR REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS system_error_log_source_idx ON system_error_log (source, created_at DESC);
CREATE INDEX IF NOT EXISTS system_error_log_created_idx ON system_error_log (created_at DESC);

-- debug_context column on code_proposals: populated when a proposal originated from a debug session
ALTER TABLE code_proposals
  ADD COLUMN IF NOT EXISTS debug_context JSONB;
