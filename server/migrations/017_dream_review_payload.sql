ALTER TABLE dream_insights
  ADD COLUMN IF NOT EXISTS insight_kind VARCHAR NOT NULL DEFAULT 'insight';

ALTER TABLE dream_insights
  ADD COLUMN IF NOT EXISTS review_payload JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS dream_insights_user_kind_idx
  ON dream_insights(user_id, insight_kind, created_at DESC);
