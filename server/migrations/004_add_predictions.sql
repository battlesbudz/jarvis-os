CREATE TABLE IF NOT EXISTS jarvis_predictions (
  id VARCHAR NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prediction_type VARCHAR NOT NULL,
  target_datetime TIMESTAMP NOT NULL,
  target_date VARCHAR NOT NULL,
  confidence_score INTEGER NOT NULL DEFAULT 50,
  basis_summary TEXT NOT NULL,
  human_readable TEXT NOT NULL,
  action_suggestion TEXT,
  observation_count INTEGER NOT NULL DEFAULT 0,
  validated BOOLEAN,
  validation_note TEXT,
  validated_at TIMESTAMP,
  delivered_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS jarvis_predictions_user_type_date_idx
  ON jarvis_predictions (user_id, prediction_type, target_date);
