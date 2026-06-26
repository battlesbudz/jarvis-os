CREATE TABLE IF NOT EXISTS soul_edit_events (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target VARCHAR NOT NULL,
  status VARCHAR NOT NULL DEFAULT 'pending',
  old_value TEXT,
  new_value TEXT NOT NULL,
  source VARCHAR NOT NULL DEFAULT 'chat',
  source_ref TEXT,
  requested_by VARCHAR,
  approved_by VARCHAR,
  reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS soul_edit_events_user_status_created_idx
  ON soul_edit_events(user_id, status, created_at DESC);
