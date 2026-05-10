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
);

CREATE INDEX IF NOT EXISTS model_usage_events_user_created_idx
  ON model_usage_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS model_usage_events_user_model_idx
  ON model_usage_events (user_id, model, created_at DESC);
