CREATE TABLE IF NOT EXISTS morning_voice_notes (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id),
  recorded_at DATE NOT NULL,
  transcript TEXT NOT NULL,
  mood_signal VARCHAR NOT NULL DEFAULT 'calm'
    CHECK (mood_signal IN ('calm', 'energized', 'stressed', 'overwhelmed', 'uncertain')),
  themes JSONB NOT NULL DEFAULT '[]'::jsonb,
  blockers JSONB NOT NULL DEFAULT '[]'::jsonb,
  wins JSONB NOT NULL DEFAULT '[]'::jsonb,
  intention TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, recorded_at)
);

CREATE INDEX IF NOT EXISTS idx_morning_voice_notes_user_id ON morning_voice_notes(user_id);
