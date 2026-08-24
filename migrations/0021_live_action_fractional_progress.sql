ALTER TABLE "live_actions"
  ALTER COLUMN "progress_value" TYPE real
  USING "progress_value"::real;
