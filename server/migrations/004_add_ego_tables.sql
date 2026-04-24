-- Jarvis Ego — Action Log
CREATE TABLE IF NOT EXISTS jarvis_action_log (
  id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_type VARCHAR NOT NULL,
  outcome     VARCHAR NOT NULL DEFAULT 'pending',
  metadata    JSONB   NOT NULL DEFAULT '{}',
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS jarvis_action_log_user_created_idx
  ON jarvis_action_log(user_id, created_at DESC);

-- Jarvis Ego — Weekly Reports
CREATE TABLE IF NOT EXISTS ego_weekly_reports (
  id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_of     VARCHAR NOT NULL,
  analysis    JSONB   NOT NULL DEFAULT '{}',
  report_text TEXT    NOT NULL DEFAULT '',
  delivered_at TIMESTAMP,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT ego_weekly_reports_user_week_idx UNIQUE (user_id, week_of)
);
