-- Add shell_command, last_shell_result, and in_progress_at columns to jarvis_scheduled_tasks
-- shell_command: when set, the scheduler executes daemon_shell with this command when the job fires
-- last_shell_result: stores the exit code, stdout, stderr, duration, and timestamp of the last run
-- in_progress_at: set atomically when the scheduler claims a task; prevents duplicate execution
--   across ticks; tasks stuck >5 minutes (server crash) are eligible for re-claim

ALTER TABLE "jarvis_scheduled_tasks"
  ADD COLUMN IF NOT EXISTS "shell_command" text,
  ADD COLUMN IF NOT EXISTS "last_shell_result" jsonb,
  ADD COLUMN IF NOT EXISTS "in_progress_at" timestamp;
