CREATE TABLE IF NOT EXISTS "webchat_invite_tokens" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "token" text NOT NULL UNIQUE,
  "user_id" varchar NOT NULL REFERENCES "users"("id"),
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
