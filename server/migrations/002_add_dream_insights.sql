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
);

CREATE INDEX IF NOT EXISTS idx_dream_insights_user_date ON dream_insights(user_id, dream_date);
