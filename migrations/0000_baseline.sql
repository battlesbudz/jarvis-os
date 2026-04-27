CREATE TABLE "agent_approval_gates" (
	"id" varchar PRIMARY KEY NOT NULL,
	"agent_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"tool_name" varchar NOT NULL,
	"tool_args" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" text NOT NULL,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"resolved_at" timestamp,
	"resolved_by" varchar,
	"initiated_by" varchar DEFAULT 'user' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_chat_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"role" varchar NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_chat_sessions" (
	"sdk_session_id" varchar PRIMARY KEY NOT NULL,
	"agent_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_jobs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"agent_type" varchar NOT NULL,
	"title" text NOT NULL,
	"prompt" text NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar DEFAULT 'queued' NOT NULL,
	"result" jsonb,
	"error" text,
	"turns" integer DEFAULT 0,
	"tool_calls_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "agent_memories" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"content" text NOT NULL,
	"category" varchar DEFAULT 'fact' NOT NULL,
	"embedding" jsonb,
	"relevance_score" integer DEFAULT 50 NOT NULL,
	"confidence" integer DEFAULT 70 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_agent_id" varchar,
	"to_agent_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"message_type" varchar NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"delegation_depth" integer DEFAULT 0 NOT NULL,
	"task_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_workflows" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_step_index" integer DEFAULT 0 NOT NULL,
	"status" varchar DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blocked_tasks" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"data" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "brain_dump_inbox" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"data" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "channel_link_codes" (
	"code" varchar PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"channel" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "channel_links" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"channel" varchar NOT NULL,
	"address" varchar NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"linked_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "channel_preferences" (
	"user_id" varchar NOT NULL,
	"notification_type" varchar NOT NULL,
	"channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "channel_preferences_user_id_notification_type_pk" PRIMARY KEY("user_id","notification_type")
);
--> statement-breakpoint
CREATE TABLE "chat_history" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"data" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "chatgpt_imports" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"imported_at" timestamp DEFAULT now() NOT NULL,
	"memories_added" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coach_channel_sessions" (
	"user_id" varchar NOT NULL,
	"channel" varchar NOT NULL,
	"sdk_session_id" varchar NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "coach_channel_sessions_user_id_channel_pk" PRIMARY KEY("user_id","channel")
);
--> statement-breakpoint
CREATE TABLE "code_proposals" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"title" text NOT NULL,
	"reason" text NOT NULL,
	"file_path" text NOT NULL,
	"original_content" text NOT NULL,
	"proposed_content" text NOT NULL,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"rejection_note" text,
	"debug_context" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"applied_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "commitments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"content" text NOT NULL,
	"due_date" varchar,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"extracted_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"source_message" text
);
--> statement-breakpoint
CREATE TABLE "completed_calendar_ids" (
	"user_id" varchar NOT NULL,
	"date" varchar NOT NULL,
	"data" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "completed_calendar_ids_user_id_date_pk" PRIMARY KEY("user_id","date")
);
--> statement-breakpoint
CREATE TABLE "completion_history" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"data" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "deliverables" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"job_id" varchar,
	"agent_type" varchar NOT NULL,
	"type" varchar NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"body" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar DEFAULT 'pending_approval' NOT NULL,
	"triage_status" varchar DEFAULT 'needs_attention' NOT NULL,
	"triage_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"acted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "diagnostic_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"subsystem" varchar NOT NULL,
	"severity" varchar DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discord_agents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"name" varchar NOT NULL,
	"role" varchar DEFAULT 'custom' NOT NULL,
	"persona" text,
	"channel_id" varchar,
	"channel_name" varchar,
	"is_active" integer DEFAULT 1 NOT NULL,
	"loop_enabled" integer DEFAULT 0 NOT NULL,
	"loop_interval_minutes" integer DEFAULT 60,
	"loop_prompt" text,
	"last_loop_run" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"platforms" jsonb DEFAULT '["discord"]'::jsonb NOT NULL,
	"permissions" jsonb DEFAULT '{
    "can_search_web":true,"can_use_browser":false,"can_send_emails":false,
    "can_create_email_drafts":false,"can_read_email":false,"can_send_messages":true,
    "can_access_files":false,"can_take_screenshots":false,"can_open_apps":false,
    "can_call_user":false,"can_use_voice":false,"can_create_tasks":true,
    "can_create_other_agents":false,"can_access_global_memory":false
  }'::jsonb NOT NULL,
	"memory_scope" varchar DEFAULT 'agent_private' NOT NULL,
	"access_global_memory" boolean DEFAULT false NOT NULL,
	"allowed_users" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_conversations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"private_mode" boolean DEFAULT false NOT NULL,
	"platform_channels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"config_json" jsonb,
	"last_heartbeat_at" timestamp,
	"stuck_since" timestamp,
	"heartbeat_fail_count" integer DEFAULT 0 NOT NULL,
	"preferred_model" text,
	"mention_patterns" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discord_channel_schedules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"guild_id" varchar,
	"channel_id" varchar,
	"channel_name" varchar NOT NULL,
	"label" varchar NOT NULL,
	"cron_expression" varchar DEFAULT '0 7 * * *' NOT NULL,
	"prompt" text NOT NULL,
	"pipeline_next" varchar,
	"last_run" timestamp,
	"last_output" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discord_pending_approvals" (
	"message_id" varchar PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"channel_id" varchar NOT NULL,
	"guild_id" varchar,
	"type" varchar DEFAULT 'custom' NOT NULL,
	"content" text NOT NULL,
	"approve_emoji" varchar DEFAULT '✅' NOT NULL,
	"reject_emoji" varchar DEFAULT '❌' NOT NULL,
	"on_approve" jsonb NOT NULL,
	"on_reject" jsonb,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "dream_insights" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"dream_date" varchar NOT NULL,
	"insight_text" text NOT NULL,
	"confidence_score" integer DEFAULT 70 NOT NULL,
	"source_memory_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"shown_to_user" boolean DEFAULT false NOT NULL,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ego_weekly_reports" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"week_of" varchar NOT NULL,
	"analysis" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"report_text" text DEFAULT '' NOT NULL,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_drafts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"source_message_id" varchar,
	"from_sender" text,
	"original_subject" text,
	"draft_subject" text NOT NULL,
	"draft_body" text NOT NULL,
	"jarvis_reason" text,
	"status" varchar DEFAULT 'pending_approval' NOT NULL,
	"gmail_draft_id" varchar,
	"gmail_draft_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"acted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "energy_checkins" (
	"user_id" varchar NOT NULL,
	"date" varchar NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "energy_checkins_user_id_date_pk" PRIMARY KEY("user_id","date")
);
--> statement-breakpoint
CREATE TABLE "goal_trees" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"goal_id" varchar NOT NULL,
	"title" text NOT NULL,
	"tree" jsonb DEFAULT '{"phases":[]}'::jsonb NOT NULL,
	"status" varchar DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"data" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "gut_calibration" (
	"user_id" varchar NOT NULL,
	"signal_type" varchar NOT NULL,
	"confirmed_count" integer DEFAULT 0 NOT NULL,
	"dismissed_count" integer DEFAULT 0 NOT NULL,
	"ignored_count" integer DEFAULT 0 NOT NULL,
	"confirmation_rate" real,
	"gate_adjustment" integer DEFAULT 0 NOT NULL,
	"last_updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "gut_calibration_user_id_signal_type_pk" PRIMARY KEY("user_id","signal_type")
);
--> statement-breakpoint
CREATE TABLE "gut_signals" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"signal_type" varchar NOT NULL,
	"item_ref" varchar,
	"confidence_score" integer DEFAULT 50 NOT NULL,
	"explanation" text NOT NULL,
	"user_response" varchar,
	"responded_at" timestamp,
	"delivered_in_morning_brief" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"source_type" varchar NOT NULL,
	"source_id" varchar NOT NULL,
	"subject" text,
	"sender" text,
	"snippet" text,
	"jarvis_reason" text,
	"suggested_actions" jsonb,
	"status" varchar DEFAULT 'pending',
	"dismiss_count" integer DEFAULT 0,
	"matched_rule_id" varchar,
	"surfaced_at" timestamp DEFAULT now(),
	"acted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "inbox_rules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"type" varchar NOT NULL,
	"scope" varchar NOT NULL,
	"pattern" text NOT NULL,
	"match_hints" jsonb,
	"source" varchar NOT NULL,
	"match_count" integer DEFAULT 0,
	"active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "integration_status" (
	"user_id" varchar NOT NULL,
	"integration" varchar NOT NULL,
	"status" varchar DEFAULT 'unconfigured' NOT NULL,
	"last_checked_at" timestamp DEFAULT now() NOT NULL,
	"error_message" text,
	"expires_at" timestamp,
	CONSTRAINT "integration_status_user_id_integration_pk" PRIMARY KEY("user_id","integration")
);
--> statement-breakpoint
CREATE TABLE "interaction_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"channel" varchar NOT NULL,
	"direction" varchar NOT NULL,
	"content" text NOT NULL,
	"label" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jarvis_action_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"action_type" varchar NOT NULL,
	"outcome" varchar DEFAULT 'pending' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jarvis_predictions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"prediction_type" varchar NOT NULL,
	"target_datetime" timestamp NOT NULL,
	"target_date" varchar NOT NULL,
	"confidence_score" integer DEFAULT 50 NOT NULL,
	"basis_summary" text NOT NULL,
	"human_readable" text NOT NULL,
	"action_suggestion" text,
	"observation_count" integer DEFAULT 0 NOT NULL,
	"validated" boolean,
	"validation_note" text,
	"validated_at" timestamp,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jarvis_scheduled_tasks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"scheduled_at" timestamp NOT NULL,
	"recurrence" varchar,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jarvis_souls" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"manual_override" text,
	"generated_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "life_context" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "mcp_api_keys" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "mcp_rate_limits" (
	"bucket" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"window_start" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_servers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"name" varchar NOT NULL,
	"transport" varchar DEFAULT 'stdio' NOT NULL,
	"command" text,
	"url" text,
	"auth_token" text,
	"credential_mode" varchar DEFAULT 'direct' NOT NULL,
	"env_key" varchar,
	"enabled" boolean DEFAULT true NOT NULL,
	"is_built_in" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mobile_auth_sessions" (
	"session_id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "momentum_sessions" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"session_date" varchar DEFAULT '' NOT NULL,
	"completed_steps" integer DEFAULT 0 NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar DEFAULT 'active' NOT NULL,
	"last_step_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "morning_voice_notes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"recorded_at" date NOT NULL,
	"transcript" text NOT NULL,
	"mood_signal" varchar DEFAULT 'calm' NOT NULL,
	"themes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"blockers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"wins" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"intention" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nervous_system_signals" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"watch_id" varchar,
	"watch_label" text NOT NULL,
	"headline" text NOT NULL,
	"url" text,
	"snippet" text,
	"relevance_explanation" text,
	"relevance_score" integer DEFAULT 0 NOT NULL,
	"content_hash" varchar NOT NULL,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nervous_system_watches" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"label" text NOT NULL,
	"category" varchar DEFAULT 'keyword' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_checked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "openclaw_build_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"feature_name" varchar NOT NULL,
	"description" text NOT NULL,
	"output_code" text DEFAULT '' NOT NULL,
	"success" boolean DEFAULT false NOT NULL,
	"smoke_test_passed" boolean,
	"smoke_test_args" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orchestration_traces" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"trace_id" varchar NOT NULL,
	"user_request" text NOT NULL,
	"subtasks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"final_answer" text DEFAULT '' NOT NULL,
	"total_retries" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp,
	"duration_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "orchestration_traces_trace_id_unique" UNIQUE("trace_id")
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"name" text NOT NULL,
	"email" varchar,
	"relationship" text,
	"notes" text,
	"interaction_count" integer DEFAULT 0 NOT NULL,
	"last_interaction_at" timestamp,
	"next_interaction_at" timestamp,
	"upcoming_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_snapshots" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"user_id" varchar NOT NULL,
	"date" varchar NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "plans_user_id_date_pk" PRIMARY KEY("user_id","date")
);
--> statement-breakpoint
CREATE TABLE "proactive_questions_sent" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"source_type" varchar NOT NULL,
	"source_id" varchar NOT NULL,
	"question" text NOT NULL,
	"sent_at" timestamp DEFAULT now(),
	"answered_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "proactive_schedule_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"message_type" varchar NOT NULL,
	"sent_date" varchar NOT NULL,
	"sent_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "skill_packs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"heartbeat_rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tool_groups" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_store_visible" boolean DEFAULT false NOT NULL,
	"published_at" timestamp,
	"changelog" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stats" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "system_error_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"level" varchar DEFAULT 'error' NOT NULL,
	"message" text NOT NULL,
	"stack_trace" text,
	"context_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"investigated" boolean DEFAULT false NOT NULL,
	"user_id" varchar
);
--> statement-breakpoint
CREATE TABLE "telegram_group_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"chat_id" varchar NOT NULL,
	"chat_title" varchar,
	"from_user" varchar,
	"text" text NOT NULL,
	"message_date" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_link_codes" (
	"code" varchar PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_links" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"chat_id" varchar NOT NULL,
	"username" varchar,
	"linked_at" timestamp DEFAULT now() NOT NULL,
	"group_chat_ids" jsonb DEFAULT '[]'::jsonb
);
--> statement-breakpoint
CREATE TABLE "timer_settings" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_documents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"name" text NOT NULL,
	"mime_type" varchar NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"status" varchar DEFAULT 'processing' NOT NULL,
	"extracted_text" text,
	"summary" text,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_emotional_state" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"stress_score" integer DEFAULT 0 NOT NULL,
	"flow_score" integer DEFAULT 0 NOT NULL,
	"label" varchar DEFAULT 'calm' NOT NULL,
	"explanation" text,
	"signal_sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"manual_override" varchar,
	"manual_override_at" timestamp,
	"computed_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"consecutive_high_stress_cycles" integer DEFAULT 0 NOT NULL,
	"last_stress_checkin_at" timestamp,
	"baseline_stress" real,
	"baseline_flow" real,
	"pattern_note" text
);
--> statement-breakpoint
CREATE TABLE "user_emotional_state_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"stress_score" integer NOT NULL,
	"flow_score" integer NOT NULL,
	"label" varchar NOT NULL,
	"day_of_week" integer NOT NULL,
	"hour_of_day" integer NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_memories" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"content" text NOT NULL,
	"category" varchar DEFAULT 'fact' NOT NULL,
	"relevance_score" integer DEFAULT 50 NOT NULL,
	"confidence" integer DEFAULT 70 NOT NULL,
	"source_type" varchar DEFAULT 'manual' NOT NULL,
	"source_ref" varchar,
	"last_referenced_at" timestamp,
	"embedding" jsonb,
	"extracted_at" timestamp DEFAULT now() NOT NULL,
	"tier" varchar DEFAULT 'long_term' NOT NULL,
	"memory_type" varchar DEFAULT 'semantic' NOT NULL,
	"expires_at" timestamp,
	"access_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_skill_packs" (
	"user_id" varchar NOT NULL,
	"pack_id" varchar NOT NULL,
	"applied_version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"instruction_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_skill_packs_user_id_pack_id_pk" PRIMARY KEY("user_id","pack_id")
);
--> statement-breakpoint
CREATE TABLE "user_skills" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"name" text NOT NULL,
	"emoji" varchar DEFAULT '⚡' NOT NULL,
	"description" text NOT NULL,
	"instructions" text NOT NULL,
	"is_built_in" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password" text,
	"google_id" text,
	"display_name" text,
	"email" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_google_id_unique" UNIQUE("google_id")
);
--> statement-breakpoint
CREATE TABLE "website_crawls" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"status" varchar DEFAULT 'idle' NOT NULL,
	"page_count" integer DEFAULT 0 NOT NULL,
	"summary" text,
	"crawled_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "weekly_insights" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"week_of" varchar NOT NULL,
	"patterns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_approval_gates" ADD CONSTRAINT "agent_approval_gates_agent_id_discord_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."discord_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_approval_gates" ADD CONSTRAINT "agent_approval_gates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_chat_messages" ADD CONSTRAINT "agent_chat_messages_agent_id_discord_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."discord_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_chat_messages" ADD CONSTRAINT "agent_chat_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_chat_sessions" ADD CONSTRAINT "agent_chat_sessions_agent_id_discord_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."discord_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_chat_sessions" ADD CONSTRAINT "agent_chat_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memories" ADD CONSTRAINT "agent_memories_agent_id_discord_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."discord_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memories" ADD CONSTRAINT "agent_memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_from_agent_id_discord_agents_id_fk" FOREIGN KEY ("from_agent_id") REFERENCES "public"."discord_agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_to_agent_id_discord_agents_id_fk" FOREIGN KEY ("to_agent_id") REFERENCES "public"."discord_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_workflows" ADD CONSTRAINT "agent_workflows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocked_tasks" ADD CONSTRAINT "blocked_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_dump_inbox" ADD CONSTRAINT "brain_dump_inbox_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_link_codes" ADD CONSTRAINT "channel_link_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_links" ADD CONSTRAINT "channel_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_preferences" ADD CONSTRAINT "channel_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_history" ADD CONSTRAINT "chat_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatgpt_imports" ADD CONSTRAINT "chatgpt_imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_channel_sessions" ADD CONSTRAINT "coach_channel_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_proposals" ADD CONSTRAINT "code_proposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completed_calendar_ids" ADD CONSTRAINT "completed_calendar_ids_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completion_history" ADD CONSTRAINT "completion_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_job_id_agent_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_events" ADD CONSTRAINT "diagnostic_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_agents" ADD CONSTRAINT "discord_agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_channel_schedules" ADD CONSTRAINT "discord_channel_schedules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_pending_approvals" ADD CONSTRAINT "discord_pending_approvals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dream_insights" ADD CONSTRAINT "dream_insights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ego_weekly_reports" ADD CONSTRAINT "ego_weekly_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_drafts" ADD CONSTRAINT "email_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "energy_checkins" ADD CONSTRAINT "energy_checkins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_trees" ADD CONSTRAINT "goal_trees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gut_calibration" ADD CONSTRAINT "gut_calibration_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gut_signals" ADD CONSTRAINT "gut_signals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_rules" ADD CONSTRAINT "inbox_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_status" ADD CONSTRAINT "integration_status_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction_log" ADD CONSTRAINT "interaction_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jarvis_action_log" ADD CONSTRAINT "jarvis_action_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jarvis_predictions" ADD CONSTRAINT "jarvis_predictions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jarvis_scheduled_tasks" ADD CONSTRAINT "jarvis_scheduled_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jarvis_souls" ADD CONSTRAINT "jarvis_souls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "life_context" ADD CONSTRAINT "life_context_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_api_keys" ADD CONSTRAINT "mcp_api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "momentum_sessions" ADD CONSTRAINT "momentum_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "morning_voice_notes" ADD CONSTRAINT "morning_voice_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nervous_system_signals" ADD CONSTRAINT "nervous_system_signals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nervous_system_signals" ADD CONSTRAINT "nervous_system_signals_watch_id_nervous_system_watches_id_fk" FOREIGN KEY ("watch_id") REFERENCES "public"."nervous_system_watches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nervous_system_watches" ADD CONSTRAINT "nervous_system_watches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openclaw_build_log" ADD CONSTRAINT "openclaw_build_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestration_traces" ADD CONSTRAINT "orchestration_traces_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_snapshots" ADD CONSTRAINT "plan_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proactive_questions_sent" ADD CONSTRAINT "proactive_questions_sent_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proactive_schedule_log" ADD CONSTRAINT "proactive_schedule_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stats" ADD CONSTRAINT "stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_error_log" ADD CONSTRAINT "system_error_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_group_messages" ADD CONSTRAINT "telegram_group_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timer_settings" ADD CONSTRAINT "timer_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_documents" ADD CONSTRAINT "user_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_emotional_state" ADD CONSTRAINT "user_emotional_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_emotional_state_history" ADD CONSTRAINT "user_emotional_state_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memories" ADD CONSTRAINT "user_memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_skill_packs" ADD CONSTRAINT "user_skill_packs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_skill_packs" ADD CONSTRAINT "user_skill_packs_pack_id_skill_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."skill_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_skills" ADD CONSTRAINT "user_skills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_crawls" ADD CONSTRAINT "website_crawls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_insights" ADD CONSTRAINT "weekly_insights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_links_channel_address_idx" ON "channel_links" USING btree ("channel","address");--> statement-breakpoint
CREATE UNIQUE INDEX "ego_weekly_reports_user_week_idx" ON "ego_weekly_reports" USING btree ("user_id","week_of");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_items_user_source_idx" ON "inbox_items" USING btree ("user_id","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jarvis_predictions_user_type_date_idx" ON "jarvis_predictions" USING btree ("user_id","prediction_type","target_date");--> statement-breakpoint
CREATE UNIQUE INDEX "nervous_system_signals_hash_idx" ON "nervous_system_signals" USING btree ("user_id","content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_insights_user_week_idx" ON "weekly_insights" USING btree ("user_id","week_of");