ALTER TABLE "jarvis_scheduled_tasks"
  ADD COLUMN IF NOT EXISTS "task_kind" varchar NOT NULL DEFAULT 'user_task';

UPDATE "jarvis_scheduled_tasks"
SET "task_kind" = 'jarvis_action'
WHERE "shell_command" IS NOT NULL
  AND "shell_command" <> '';
