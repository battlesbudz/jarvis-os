CREATE TABLE IF NOT EXISTS orchestration_traces (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trace_id VARCHAR NOT NULL UNIQUE,
  user_request TEXT NOT NULL,
  subtasks JSONB NOT NULL DEFAULT '[]'::jsonb,
  results JSONB NOT NULL DEFAULT '[]'::jsonb,
  final_answer TEXT NOT NULL DEFAULT '',
  total_retries INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMP,
  duration_ms INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
