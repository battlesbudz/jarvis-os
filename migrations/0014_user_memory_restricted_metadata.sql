ALTER TABLE user_memories
  ADD COLUMN IF NOT EXISTS sensitivity VARCHAR NOT NULL DEFAULT 'normal';

ALTER TABLE user_memories
  ADD COLUMN IF NOT EXISTS provenance JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS user_memories_user_sensitivity_idx
  ON user_memories(user_id, sensitivity);
