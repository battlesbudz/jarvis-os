ALTER TABLE user_memories
  ADD COLUMN IF NOT EXISTS pending_review BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE user_memories
  ADD COLUMN IF NOT EXISTS review_status VARCHAR NOT NULL DEFAULT 'active';

ALTER TABLE user_memories
  ADD COLUMN IF NOT EXISTS supersedes_memory_id VARCHAR;

ALTER TABLE user_memories
  ADD COLUMN IF NOT EXISTS corrected_by_memory_id VARCHAR;

CREATE INDEX IF NOT EXISTS user_memories_user_review_idx
  ON user_memories(user_id, review_status);

CREATE TABLE IF NOT EXISTS memory_working_context (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_type VARCHAR NOT NULL,
  scope_id VARCHAR NOT NULL,
  active_goal TEXT,
  current_step TEXT,
  last_event_id VARCHAR NOT NULL,
  content TEXT NOT NULL,
  state VARCHAR NOT NULL DEFAULT 'active',
  compacted_memory_id VARCHAR,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS memory_working_context_user_scope_idx
  ON memory_working_context(user_id, scope_type, scope_id);

CREATE INDEX IF NOT EXISTS memory_working_context_user_state_expiry_idx
  ON memory_working_context(user_id, state, expires_at);
