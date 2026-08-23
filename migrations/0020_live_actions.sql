CREATE TABLE IF NOT EXISTS "live_actions" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "project_id" varchar,
  "parent_action_id" varchar REFERENCES "live_actions"("id") ON DELETE SET NULL,
  "lineage_type" varchar NOT NULL,
  "source_lineage_key" varchar NOT NULL,
  "source_type" varchar NOT NULL,
  "source_id" varchar NOT NULL,
  "kind" varchar NOT NULL,
  "title" text NOT NULL,
  "status" varchar NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "current_step" text,
  "progress_kind" varchar DEFAULT 'indeterminate' NOT NULL,
  "progress_value" integer,
  "progress_updated_at" timestamp,
  "attention" jsonb,
  "control_capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "artifact_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "error_category" varchar,
  "error_summary" text,
  "retry_eligible" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "started_at" timestamp,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS "live_actions_user_lineage_uidx"
  ON "live_actions" ("user_id", "lineage_type", "source_lineage_key");
CREATE INDEX IF NOT EXISTS "live_actions_user_status_updated_idx"
  ON "live_actions" ("user_id", "status", "updated_at" DESC);
CREATE INDEX IF NOT EXISTS "live_actions_source_idx"
  ON "live_actions" ("source_type", "source_id");

CREATE TABLE IF NOT EXISTS "live_action_events" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "action_id" varchar NOT NULL REFERENCES "live_actions"("id") ON DELETE CASCADE,
  "sequence" integer NOT NULL,
  "source_event_key" varchar NOT NULL,
  "event_type" varchar NOT NULL,
  "message" text,
  "safe_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "user_visible" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "live_action_events_action_sequence_uidx"
  ON "live_action_events" ("action_id", "sequence");
CREATE UNIQUE INDEX IF NOT EXISTS "live_action_events_action_source_uidx"
  ON "live_action_events" ("action_id", "source_event_key");
CREATE INDEX IF NOT EXISTS "live_action_events_action_created_idx"
  ON "live_action_events" ("action_id", "created_at");
