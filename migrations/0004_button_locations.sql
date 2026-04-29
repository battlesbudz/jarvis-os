CREATE TABLE IF NOT EXISTS "button_locations" (
  "id" serial PRIMARY KEY,
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "app_package" varchar(256) NOT NULL,
  "screen_context" varchar(256) NOT NULL DEFAULT '',
  "element_label" text NOT NULL,
  "coordinates_x" integer NOT NULL,
  "coordinates_y" integer NOT NULL,
  "screenshot_hash" varchar(256),
  "screenshot_path" text,
  "confidence" real NOT NULL DEFAULT 0.5,
  "last_confirmed_at" timestamp,
  "stale" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
