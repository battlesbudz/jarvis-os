-- Migration: Add code_proposals table for Jarvis self-inspection & code proposal feature (Task #452)
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
);

CREATE INDEX IF NOT EXISTS code_proposals_user_idx ON code_proposals (user_id);
