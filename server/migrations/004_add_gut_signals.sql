CREATE TABLE IF NOT EXISTS gut_signals (
  id VARCHAR NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  signal_type VARCHAR NOT NULL,
  item_ref VARCHAR,
  confidence_score INTEGER NOT NULL DEFAULT 50,
  explanation TEXT NOT NULL,
  user_response VARCHAR,
  responded_at TIMESTAMP,
  delivered_in_morning_brief BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gut_signals_user_created_idx ON gut_signals(user_id, created_at DESC);

ALTER TABLE user_emotional_state
  ADD COLUMN IF NOT EXISTS baseline_stress REAL,
  ADD COLUMN IF NOT EXISTS baseline_flow REAL,
  ADD COLUMN IF NOT EXISTS pattern_note TEXT;
