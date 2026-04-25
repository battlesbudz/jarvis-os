CREATE TABLE IF NOT EXISTS openclaw_build_log (
  id              VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature_name    VARCHAR NOT NULL,
  description     TEXT    NOT NULL,
  output_code     TEXT    NOT NULL DEFAULT '',
  success         BOOLEAN NOT NULL DEFAULT FALSE,
  smoke_test_passed BOOLEAN,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS openclaw_build_log_user_created_idx
  ON openclaw_build_log(user_id, created_at DESC);
