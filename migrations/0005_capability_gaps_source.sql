ALTER TABLE "capability_gaps"
  ADD COLUMN IF NOT EXISTS "source" varchar DEFAULT 'chat';
