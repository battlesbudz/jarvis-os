CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE user_memories
  ADD COLUMN IF NOT EXISTS embedding_vector vector(1536);

ALTER TABLE user_memories
  ADD COLUMN IF NOT EXISTS pending_review BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE user_memories
  ADD COLUMN IF NOT EXISTS review_status VARCHAR NOT NULL DEFAULT 'active';

UPDATE user_memories
SET embedding_vector = embedding::text::vector(1536)
WHERE embedding_vector IS NULL
  AND embedding IS NOT NULL
  AND jsonb_typeof(embedding) = 'array'
  AND jsonb_array_length(embedding) = 1536;

CREATE INDEX IF NOT EXISTS user_memories_embedding_vector_idx
  ON user_memories
  USING ivfflat (embedding_vector vector_cosine_ops)
  WITH (lists = 100)
  WHERE embedding_vector IS NOT NULL
    AND pending_review = FALSE
    AND review_status IN ('active', 'kept', 'edited');
