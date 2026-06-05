CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE brain_content_chunks
  ADD COLUMN IF NOT EXISTS embedding_vector vector(1536);

CREATE INDEX IF NOT EXISTS brain_chunks_embedding_vector_idx
  ON brain_content_chunks
  USING ivfflat (embedding_vector vector_cosine_ops)
  WITH (lists = 100)
  WHERE embedding_vector IS NOT NULL;
