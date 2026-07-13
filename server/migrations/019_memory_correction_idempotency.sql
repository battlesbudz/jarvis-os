CREATE UNIQUE INDEX IF NOT EXISTS user_memories_runtime_correction_source_uidx
  ON user_memories(user_id, source_type, source_ref)
  WHERE source_type = 'runtime_memory_correction'
    AND source_ref IS NOT NULL;
