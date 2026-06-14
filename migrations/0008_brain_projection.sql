CREATE TABLE IF NOT EXISTS brain_pages (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_type varchar NOT NULL,
  slug varchar NOT NULL,
  title text NOT NULL,
  compiled_truth text NOT NULL DEFAULT '',
  source_kind varchar NOT NULL,
  source_id varchar NOT NULL,
  provenance jsonb NOT NULL DEFAULT '[]'::jsonb,
  review_status varchar NOT NULL DEFAULT 'active',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS brain_pages_user_slug_idx ON brain_pages(user_id, slug);
CREATE INDEX IF NOT EXISTS brain_pages_user_type_idx ON brain_pages(user_id, page_type);

CREATE TABLE IF NOT EXISTS brain_timeline_entries (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_id varchar NOT NULL REFERENCES brain_pages(id) ON DELETE CASCADE,
  occurred_at timestamp,
  summary text NOT NULL,
  detail text,
  provenance jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS brain_timeline_user_page_idx ON brain_timeline_entries(user_id, page_id);
CREATE INDEX IF NOT EXISTS brain_timeline_occurred_idx ON brain_timeline_entries(occurred_at);

CREATE TABLE IF NOT EXISTS brain_content_chunks (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_id varchar NOT NULL REFERENCES brain_pages(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  embedding jsonb,
  provenance jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS brain_chunks_page_index_idx ON brain_content_chunks(page_id, chunk_index);
CREATE INDEX IF NOT EXISTS brain_chunks_user_page_idx ON brain_content_chunks(user_id, page_id);

CREATE TABLE IF NOT EXISTS brain_links (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_page_id varchar NOT NULL REFERENCES brain_pages(id) ON DELETE CASCADE,
  to_slug varchar NOT NULL,
  verb varchar NOT NULL,
  confidence integer NOT NULL DEFAULT 70,
  provenance jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS brain_links_unique_idx ON brain_links(user_id, from_page_id, to_slug, verb);
CREATE INDEX IF NOT EXISTS brain_links_user_to_slug_idx ON brain_links(user_id, to_slug);

CREATE TABLE IF NOT EXISTS brain_page_versions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_id varchar NOT NULL REFERENCES brain_pages(id) ON DELETE CASCADE,
  compiled_truth text NOT NULL,
  provenance jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS brain_page_versions_page_idx ON brain_page_versions(page_id);

CREATE TABLE IF NOT EXISTS brain_ingest_log (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_kind varchar NOT NULL,
  source_id varchar NOT NULL,
  content_hash varchar NOT NULL,
  status varchar NOT NULL DEFAULT 'processed',
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS brain_ingest_log_source_hash_idx ON brain_ingest_log(user_id, source_kind, source_id, content_hash);

CREATE TABLE IF NOT EXISTS brain_config (
  user_id varchar PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamp NOT NULL DEFAULT now()
);
