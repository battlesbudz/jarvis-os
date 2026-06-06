ALTER TABLE agent_build_log
  ADD COLUMN IF NOT EXISTS smoke_test_args JSONB;
