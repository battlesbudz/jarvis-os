CREATE TABLE IF NOT EXISTS user_emotional_state (
  user_id VARCHAR NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  stress_score INTEGER NOT NULL DEFAULT 0,
  flow_score INTEGER NOT NULL DEFAULT 0,
  label VARCHAR NOT NULL DEFAULT 'calm',
  explanation TEXT,
  signal_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  manual_override VARCHAR,
  manual_override_at TIMESTAMP,
  computed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  consecutive_high_stress_cycles INTEGER NOT NULL DEFAULT 0,
  last_stress_checkin_at TIMESTAMP
);
