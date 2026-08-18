CREATE TABLE IF NOT EXISTS deliverable_artifacts (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  deliverable_id varchar NOT NULL REFERENCES deliverables(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename text NOT NULL,
  mime_type varchar NOT NULL,
  size_bytes integer NOT NULL,
  data bytea NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS deliverable_artifacts_deliverable_uidx
  ON deliverable_artifacts(deliverable_id);
