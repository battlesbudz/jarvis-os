CREATE TABLE IF NOT EXISTS "agent_chat_session_summaries" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "sdk_session_id" varchar NOT NULL REFERENCES "agent_chat_sessions"("sdk_session_id") ON DELETE cascade,
  "agent_id" varchar NOT NULL REFERENCES "discord_agents"("id") ON DELETE cascade,
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "summary" text NOT NULL,
  "message_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "agent_chat_session_summaries_session_idx"
  ON "agent_chat_session_summaries" ("sdk_session_id", "created_at" ASC);
