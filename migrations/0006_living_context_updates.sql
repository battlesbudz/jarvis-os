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
);

CREATE UNIQUE INDEX IF NOT EXISTS living_context_updates_user_target_fact_idx
  ON living_context_updates(user_id, target, normalized_learned);

CREATE INDEX IF NOT EXISTS living_context_updates_user_target_created_idx
  ON living_context_updates(user_id, target, created_at);
