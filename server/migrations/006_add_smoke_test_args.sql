ALTER TABLE openclaw_build_log
  ADD COLUMN IF NOT EXISTS smoke_test_args JSONB;
