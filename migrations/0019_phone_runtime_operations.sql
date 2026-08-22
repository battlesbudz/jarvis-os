CREATE TABLE IF NOT EXISTS "phone_runtime_operations" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "session_id" varchar,
  "origin_channel" varchar DEFAULT 'appchat' NOT NULL,
  "goal" text NOT NULL,
  "status" varchar DEFAULT 'active' NOT NULL,
  "state" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp
);

CREATE INDEX IF NOT EXISTS "phone_runtime_operations_user_status_updated_idx"
  ON "phone_runtime_operations" ("user_id", "status", "updated_at" DESC);
CREATE INDEX IF NOT EXISTS "phone_runtime_operations_session_idx"
  ON "phone_runtime_operations" ("session_id");
