-- Remove duplicate rows from proactive_questions_sent (keep the earliest sent_at per user+source)
-- so that the unique index below can be created without conflict on existing data.
DELETE FROM "proactive_questions_sent"
WHERE "id" NOT IN (
  SELECT DISTINCT ON ("user_id", "source_id") "id"
  FROM "proactive_questions_sent"
  ORDER BY "user_id", "source_id", "sent_at" ASC NULLS LAST
);
--> statement-breakpoint
-- Remove duplicate rows from proactive_schedule_log (keep earliest sentAt per user+type+date)
-- before the unique index is added, in case historical duplicates exist.
DELETE FROM "proactive_schedule_log"
WHERE "id" NOT IN (
  SELECT DISTINCT ON ("user_id", "message_type", "sent_date") "id"
  FROM "proactive_schedule_log"
  ORDER BY "user_id", "message_type", "sent_date", "sent_at" ASC NULLS LAST
);
--> statement-breakpoint
CREATE UNIQUE INDEX "proactive_questions_sent_user_source_idx" ON "proactive_questions_sent" USING btree ("user_id","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "proactive_schedule_log_uniq" ON "proactive_schedule_log" USING btree ("user_id","message_type","sent_date");
