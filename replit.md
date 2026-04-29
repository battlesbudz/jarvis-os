# GamePlan - Daily Game Plan App

## Overview
GamePlan is a mobile application designed to enhance daily productivity and well-being by helping users manage tasks through AI-powered adaptive task sizing and personalized plan generation. It addresses executive dysfunction by allowing users to adjust task granularity and integrates with user contexts like completion history, life context, and email signals to generate relevant task suggestions and plans.

## User Preferences
I prefer iterative development with a focus on clear, concise communication. Please ask before making major architectural changes or introducing new dependencies. I value well-documented code and a consistent coding style. Do not make changes to files in the `server/integrations` directory unless explicitly requested.

## System Architecture
GamePlan is built with a mobile-first approach using **Expo Router (React Native)** for the frontend, providing a native look and feel with file-based routing. The backend is an **Express.js** server handling API requests and serving static content. **OpenAI's GPT-5-mini** is central to the AI functionalities, including task resizing, smart plan generation, and an interactive AI coach. Data persistence is managed by **PostgreSQL** with **Drizzle ORM**. Authentication relies on **JWT** for session management and **Google OAuth** for user sign-in.

Key architectural patterns and features include:
-   **Adaptive Task Sizing:** AI dynamically adjusts task difficulty and granularity based on user input and history.
-   **Smart Plan Generation:** AI constructs daily plans considering user goals, completion history, "Life Context" (onboarding questionnaire), and external signals like Gmail.
-   **Mission Control UI:** Features a 3-tab dark futuristic command center (`Mission Control`, `Jarvis`, `Settings`) with a dark color scheme (bg #07080F, cyan #00C8FF, violet #9B59FF). The Mission Control tab is a real-time dashboard with 6 panels: Schedule, Today, Inbox, Deliverables, Docs, and Memory.
-   **State Management:** Primarily server-side data persistence with PostgreSQL.
-   **Accountability Engine:** AI extracts commitments from user interactions, tracks due dates, and provides proactive check-ins and notifications.
-   **ADHD/Executive Dysfunction Support:** Includes features like Energy Check-in, Quick Capture, "Just One Thing" Mode, Focus Timer, Visual Time Blocks, Voice Interface, and Jarvis Autonomous Daily Planning.
-   **Gamification:** Incorporates an XP system, levels, badges, and real-world rewards to motivate users.
-   **Multi-User Support:** All user data is stored server-side and scoped by user ID, accessible across devices.
-   **Onboarding:** A guided onboarding flow captures initial user preferences and goals.

## Multi-Agent Ego System (Task #296)

Named sub-agents allow creating multiple specialized AI personas, each with isolated memory namespaces, permission profiles, and channel routing.

### Core Services
- **`server/agent/agentManager.ts`** — CRUD for named agents: `createAgent`, `listAgents`, `updateAgent`, `deleteAgent`, `assignChannel`, `getAgentForChannel`.
- **`server/agent/agentPermissions.ts`** — 14-flag permission system. `wrapToolsForAgent()` filters the tool list before the harness runs, emitting `tool_permission_denied` events for blocked tools.
- **`server/agent/agentMemory.ts`** — Per-agent private memory namespace in `agent_memories` table. Auto-summarization at 400+ entries. FTS search via `plainto_tsquery`.
- **`server/agent/runNamedAgent.ts`** — Main runner: loads agent, filters tools, retrieves memories + optional global soul, calls `runAgent()`, extracts memories post-conversation. Loop detection (max depth 3).
- **`server/agent/council.ts`** — Council mode: all agents respond in parallel (30s timeout each), main LLM synthesizes a unified answer.
- **`server/agent/agentBus.ts`** — Agent-to-agent async message bus persisted to `agent_messages`. `sendToAgent`, `broadcastToAgents`, `retryFailedMessages`.
- **`server/agent/agentApproval.ts`** — In-memory approval gate system for destructive tools. `requestApproval`, `awaitApproval`, `approveGate`, `rejectGate`.
- **`server/agent/agentLogger.ts`** — Structured JSON event logging for all agent lifecycle events.
- **`server/agent/agentConfigSchema.ts`** — JSON export/import schema for agent configs. `validateAgentConfig`, `exportAgentConfig`, `importConfigToCreateArgs`.
- **`server/agent/agentRoutes.ts`** — Full REST API mounted at `/api/agents` (list, create, get, update, delete, enable/disable, channel assignment, run, memories, messages, export/import, council, approvals).
- **`server/discord/agentCommands.ts`** — Discord `/agent` slash command (list, run, council, create, assign).
- **`server/agent/selfHealAudit.ts`** — Parser for `server/self-heal-audit.log`. Exports `readAuditEntries(limit)` and `countAuditEntries()`. Parses the append-only audit log written by `applyCodeChangeTool`.
- **`GET /api/self-heal/audit`** — REST endpoint returning last N parsed audit entries + total count. Protected by auth middleware.
- **Self-Repair History UI** — `SELF-REPAIRS` section on the Agents screen shows cards for each repair (file, reason, change summary, timestamp). Tapping a card opens a detail sheet with the full diff.
- **`/jarvis audit [count]`** — Discord slash command showing the last N self-repairs (default 5, max 10).

### Schema Extensions
- `discord_agents` extended with 11 new columns: `platforms`, `permissions`, `memory_scope`, `access_global_memory`, `allowed_users`, `allowed_conversations`, `private_mode`, `platform_channels`, `config_json`, `last_heartbeat_at`, `stuck_since`, `heartbeat_fail_count`.
- New tables: `agent_memories`, `agent_messages`.
- `shared/schema.ts` exports: `AgentPermissions`, `DEFAULT_AGENT_PERMISSIONS`, `AgentMemoryScope`, `AgentMemory`, `AgentMessage`.

### Heartbeat
`runAgentHealthCheck()` in `server/heartbeat.ts` runs every 5 min: checks loop-enabled agents for stale heartbeats, auto-disables after 3 consecutive failures.

### Mobile UI
New **Agents** tab (`app/(tabs)/agents.tsx`) with agent cards (role icons, channel badges, loop indicator), create sheet (name + role picker + persona), run modal (direct invocation), and council modal.

## Multi-Channel & Computer Control (Phase 5)

The coach is no longer Telegram-only. A channel abstraction layer (`server/channels/`) lets every notification and conversation flow through Telegram, WhatsApp (Twilio Business API), Slack DM (chat.postMessage + Events API + `/jarvis` slash command), and a paired desktop daemon — chosen per notification type via `channel_preferences`.

- **`coachAgent.ts`** — channel-agnostic `runCoachAgent({userId, userText, channelName, imageUrl})` extracted from the legacy Telegram path; loads goals/stats/calendar/email/SOUL block, runs the agent, persists chat history, returns `{reply, attachments}`.
- **Adapters** — `telegramChannel`, `whatsappChannel`, `slackChannel`, `daemonChannel` — each implements the `Channel` interface (`isConfigured`, `isLinkedFor`, `sendMessage`).
- **Registry** — `notifyUser(userId, notificationType, text, opts)` looks up `channel_preferences` and fans the message out in parallel; falls back to Telegram when no prefs exist.
- **Inbound webhooks** — `POST /api/channels/whatsapp/webhook` (Twilio form-encoded), `POST /api/slack/events` (URL verification + signature-verified message events), `POST /api/slack/commands` (`/jarvis plan|brain-dump|status`).
- **Link codes** — `channel_link_codes` issues short-lived 6/8-char codes for WhatsApp (text the code) and the desktop daemon (paste into the daemon CLI). Codes expire in 15 min and are single-use.

### Desktop Daemon
A standalone Node.js script in `daemon/jarvis-daemon.js` pairs to the server over a WebSocket (`/api/daemon/ws`). It exposes a sandboxed set of operations — `shell`, `notify`, `file_read`, `file_write`, `file_list`, `browser_mcp` — all confined to `JARVIS_DAEMON_ROOT` (default `~/jarvis-workspace`). The agent invokes them via the `daemon_action` tool, and `daemonChannel` uses the `notify` op to send native desktop notifications when channel preferences route a notification to the daemon. Pattern inspired by [OpenClaw](https://github.com/steipete/openclaw) (MIT, © 2025 Peter Steinberger).

### Playwright MCP Browser Integration
Browser automation is backed by `@playwright/mcp@0.0.70` — the official Playwright Model Context Protocol server — instead of a hand-rolled session manager.

- **`server/agent/mcp/playwrightMcpClient.ts`** — spawns one `@playwright/mcp` subprocess per user (stdio JSON-RPC). Sessions are lazy (first browser call creates them), idle-timeout after 5 min, and persist cookies/localStorage via per-user profile dirs in `~/.jarvis/browser-profiles/<userId>/`. Daemon routing: when a desktop daemon is connected and the `browser_local` permission is ON, tool calls are proxied through the daemon's local MCP server (real browser + user's existing logins) instead of the server-side headless instance.
- **Browser tools** — `browser_navigate`, `browser_click`, `browser_type`, `browser_screenshot`, `browser_extract`, `browser_close`, `browser_snapshot` (accessibility tree), `browser_wait_for`, `browser_select`, `browser_clear_session`.
- **`browser_local` permission** — opt-in daemon permission (default OFF) in `DaemonPermissions` / `DEFAULT_DAEMON_PERMISSIONS` in `bridge.ts`. Controls whether browser ops route through the user's local browser.
- **`browser_mcp` daemon op** — the daemon spawns a local `@playwright/mcp` server on first use and proxies MCP tool calls to it, returning structured results.
- **JS-rendering fallback in research** — `research_topic` detects Tavily results with sparse content (<200 chars, likely JS-rendered) and fetches up to 2 such URLs via `browser_navigate` to enrich the research output.

### Android Daemon APK
An Android APK (`android-daemon/`) pairs to the server and exposes phone-control ops:
- **android_open_app** — launch any app by package name (dispatched to main looper for Samsung OneUI compatibility)
- **android_browse** — open URLs in the default browser
- **android_screenshot** — capture screen via `AccessibilityService.takeScreenshot()` with reflection-based API 30 compat
- **android_read_screen** — read all text + clickable elements from the accessibility tree
- **android_tap** / **android_swipe** — gesture dispatch via GestureDescription
- **android_type** — type text into focused field; `submit: true` sends IME Enter (PhoneClaw pattern: reflection-based ACTION_IME_ENTER_COMPAT)
- **android_press_key** — system keys: back/home/recents/enter (enter = pressImeAction)
- **android_file_list** / **android_file_read** — access device storage
- **android_notifications_list** — list recent notifications received on the phone (served from server cache, zero round-trip)
- **notify** — post a local Android notification

**Notification Forwarding** (`JarvisNotificationListener`): A `NotificationListenerService` runs alongside the daemon. Every non-system notification is cached (last 60, newest-first) and pushed to the server as `{type:"notification_event"}` over the existing WebSocket. The server caches per-user (`userNotifications` map in `bridge.ts`). The AI can read the cache instantly via `android_notifications_list`.

Build: push to `android-daemon/**` → GitHub Actions auto-builds → overwrites `android-daemon-latest` release. APK URL: `ANDROID_APK_URL` env var.
Key files: `JarvisAccessibilityService.kt`, `JarvisNotificationListener.kt`, `OpHandler.kt`, `WebSocketService.kt`, `server/daemon/bridge.ts`.

### Profile UI
The Profile screen now has a "Connected Channels" section: WhatsApp link flow with code display, daemon pairing code with the exact CLI command, Slack DM connection status, and a notification-routing grid (notification type × channel checkboxes) backed by `GET/PUT /api/channels[/preferences]`.

## Agent Harness (Phase 1 — Action Engine)
Inspired by OpenClaw (MIT licensed, © 2025 Peter Steinberger). Located in `server/agent/`:
- **harness.ts** — OpenClaw-style tool-calling loop: runs up to N turns, executes tool calls in parallel, force-final-answers if maxTurns hit.
- **types.ts** — typed `AgentTool`, `ToolContext` (mutable shared state for inter-tool comms), `ToolResult`.
- **tools/** — typed registry: `webSearch` (search_web, research_topic), `gmailActions` (gmail_action, create_gmail_draft), `calendar` (fetch_calendar), `calendarCreate` (create_calendar_event — supports Google & Outlook), `fetchEmails` (fetch_emails — Gmail & Outlook), `sendEmail` (send_email — Gmail & Outlook), `connections` (check_connections, generate_reconnect_link), `manageTasks`, `documents`, `googleDriveTools` (Drive read accepts ID or full URL). Bundle `telegramCoachTools()` is used by all channel pipelines (`runCoachAgent`); the app-chat route (`/api/coach/chat`) mirrors these tools via `coachTools` + `executeCoachTool` in `server/routes.ts`.
- **OpenClaw Phase 1 tools (April 2026)** — `memory_search` (semantic + keyword hybrid search over `user_memories` with optional category filter), `memory_get` (read all memories in a category), `web_fetch` (fetch any URL → clean text, 15-min cache, cheerio HTML stripping, 20k char limit), `sessions_list` (list recent background jobs by status), `sessions_history` (full transcript + deliverable of any job by ID), `sessions_send` (spawn a named background agent session with a given type + prompt). All 6 are in `telegramCoachTools`. See `openclaw-copycat.md` for remaining gaps.
- **Artifact delivery** — `create_document` saves to the Documents library AND queues a `pendingAttachments` entry in `ctx.state`; the Telegram caller delivers the file via `sendTelegramDocument` so the user receives it in-channel.
- **YouTube transcript system (April 2026)** — `get_youtube_transcript` tool in `server/agent/tools/youtubeTranscript.ts`. Seven-strategy cascade: (1) InnerTube API (TVHTML5→iOS→ANDROID), (2) yt-dlp subtitle extraction, (3) timedtext XML, (4) youtube-transcript library — all in `server/lib/transcriptCache.ts`; (5) Playwright browser fallback; (6) local worker; (7) Tavily web-search last resort. **Audio transcription (Strategy 4b)**: when all subtitle strategies return empty, `transcriptCache.ts` downloads audio via yt-dlp, converts to mono 16kHz WAV via ffmpeg (both pre-installed), splits into ≤10-min chunks (≤23MB each), and transcribes with OpenAI `whisper-1`. Result labeled "AI-generated transcript". **Local worker audio path**: `scripts/jarvis-local-worker.js` tries subtitles first, then downloads audio on the user's PC and POSTs base64 chunks to `POST /api/local-worker/transcribe-audio?token=XXX` for server-side Whisper transcription — this avoids YouTube's IP blocks on both the download (user's PC) and transcription (server API key) sides. Playlist URLs rejected. Long transcripts (>40k chars) → `.txt` file attachment. `server/lib/localWorkerQueue.ts` holds in-memory job queue. Local worker API routes: `GET /api/local-worker/token`, `POST /api/local-worker/heartbeat`, `GET /api/local-worker/jobs/next`, `POST /api/local-worker/jobs/:id/complete|fail`, `POST /api/local-worker/transcribe-audio`.
- **sessions_cancel tool** — `server/agent/tools/sessionTools.ts`. Cancels background jobs by job ID: immediately for queued jobs, marks running jobs as "cancelling" for graceful shutdown.
- Google scopes now include `drive.file` and `gmail.modify`; existing users must reconnect Google to grant them.
- **Google Drive integration** — `server/driveRoutes.ts` exposes `/api/drive/status|enable|settings|disable`; Drive settings stored in `user_preferences.data` (driveEnabled, driveAutoSavePlans, driveAutoSaveWeekly, driveFolderId, driveFolderLink). Daily plans auto-saved in `scheduler.ts`; weekly reviews auto-saved in `memory/weeklyJob.ts`. Drive section in `app/(tabs)/profile.tsx` shows connection status, Jarvis Workspace folder link, and auto-save toggles.

## Prediction Engine (Jarvis Foresight)
Jarvis is now anticipatory — it generates forward-looking predictions daily from 60 days of historical data:
- **Pattern Analyser** (`server/intelligence/pattern-analyser.ts`) — Analyses energy check-ins by hour/day-of-week, task completion rates by category, email response latency by sender, and project stall risk from goal trees.
- **Predictor** (`server/intelligence/predictor.ts`) — Builds raw predictions with confidence scores, runs an LLM pass to translate them into human-readable, actionable predictions. Types: `energy_dip`, `procrastination_risk`, `email_overdue`, `project_stall`.
- **Schema** (`jarvis_predictions` table) — Stores each prediction with type, target datetime, confidence score, basis summary, human-readable text, action suggestion, and validation outcome.
- **Daily plan integration** — `scheduler.ts` runs the prediction engine before each morning plan build (`runPredictionEngineForAllUsers`). Predictions with confidence ≥ 65% are appended to the morning briefing notification.
- **Validation loop** — The heartbeat (`server/heartbeat.ts`) calls `validateExpiredPredictions` every tick. Energy dips and procrastination risks are auto-validated against actual check-ins and plan completions.
- **API** — `GET /api/predictions?date=`, `GET /api/predictions/week?startDate=`, `GET /api/predictions/accuracy`, `POST /api/predictions/run`.
- **App UI** — "JARVIS FORESIGHT" panel in the Today tab (`app/(tabs)/index.tsx`) shows today's predictions with confidence bars and observation counts. Only shown when predictions exist or are loading.
- **Confidence threshold** — Only predictions ≥ 55% are surfaced (configurable). Morning briefings only include ≥ 65%.

## Web Chat Interface (Task #744)
A browser-based chat UI is available at `/chat` on the Express server — no mobile app required.

- **Route** — `GET /chat` in `server/index.ts` reads `server/templates/chat.html`, injects `GOOGLE_WEB_CLIENT_ID` server-side, and returns the page. Registered before the SPA catch-all so it is not overridden by the Expo web build.
- **Auth** — Google Identity Services (GIS) library: user clicks "Continue with Google", receives an ID token, which is exchanged for a Jarvis JWT via `POST /api/auth/google`. JWT is stored in `localStorage`.
- **Chat UI** — Vanilla-JS single-page app inside `chat.html`. Sends `POST /api/coach/chat` with `messages`, `sdkSessionId` (for server-side prompt caching), and `originChannel: "webchat"`. Streams SSE tokens and renders them in real time.
- **History** — Conversation history is stored in `localStorage` per browser session.
- **Webchat channel** — `server/channels/webchatChannel.ts` registers "webchat" as a ChannelName. Background job results are delivered via `in_app` inbox (webchat channel delegates to inAppChannel). "webchat" added to `CHANNEL_NAMES` in `shared/schema.ts`.
- **Landing page** — "Chat with Jarvis in your browser" CTA button added to `server/templates/landing-page.html`.

## External Dependencies
-   **AI Services:** OpenAI (gpt-5-mini, Whisper, TTS "alloy")
-   **Database:** PostgreSQL
-   **ORM:** Drizzle ORM
-   **Authentication:** jsonwebtoken (JWT), expo-auth-session (Google OAuth), Google Identity Services (GIS)
-   **Calendar Integrations:** Google Calendar, Outlook Calendar (via Replit OAuth connectors)
-   **Communication Integrations:** Gmail, Slack (via Replit OAuth connectors), Telegram (Bot API)
-   **UI Icons:** @expo/vector-icons (Ionicons)

## Rich User Profile System
The coach builds an ever-growing user profile through structured memory categories stored in the `user_memories` table:
- **Categories**: personality, values, work_style, accomplishment, goal_discovered, relationship, pattern, preference, fact, goal, achievement
- **Automatic Extraction**: After every coach chat (both app and Telegram), a background LLM call extracts profile facts from the conversation
- **Structured Injection**: Memories are grouped by category and injected as a structured "What I Know About You" section into the coach system prompt
- **Deduplication**: Existing memories are passed to the extraction prompt to prevent duplicates

## Jarvis Scheduled Tasks
A new system for scheduling autonomous Jarvis actions:
- **Table**: `jarvis_scheduled_tasks` (id, userId, title, description, scheduledAt, recurrence, completedAt, createdAt)
- **API**: GET/POST `/api/jarvis/scheduled-tasks`, PATCH `/:id/complete`, DELETE `/:id`
- **Agent tool**: `schedule_jarvis_task` — lets Jarvis schedule its own future actions via natural language ("every Monday", "daily at 9am")
- **Frontend**: SCHEDULE panel in Mission Control shows upcoming tasks with overdue highlighting; + button opens create modal

## Inbox Rules Engine
A learnable, user-configurable rules engine for filtering emails and calendar events:
- **Tables**: `inbox_rules` (user/learned rules with pattern + matchHints), `inbox_items` (surfaced items awaiting action)
- **Rule types**: `surface` (always show) and `suppress` (hide), scoped to email/calendar/both
- **Matching**: Keyword-based matching on sender, domain, subject, snippet, location via `matchHints` JSON
- **Learning**: Auto-creates suppress rules after 3 dismissals from same sender domain; notifies via Telegram
- **Rule creation**: Plain-English descriptions parsed by LLM into structured matchHints
- **One-tap actions**: Archive, Star, Save as Task, Dismiss, Never Again (creates suppress rule)
- **Integration**: Rules applied in email scanner (telegramRoutes.ts) and curiosity scanner before surfacing/questioning
- **Frontend**: Inbox tab with badge count, Rules editor accessible from Profile settings
- **Key files**: `server/inboxRules.ts`, `server/inboxActions.ts`, `app/(tabs)/inbox.tsx`, `app/inbox-rules.tsx`

## Inbox Triage — Autonomous Classification (April 2026)
Autonomous inbox triage layer that classifies deliverables every 3 minutes:
- **Schema**: `deliverables` table now has `triage_status` (needs_attention / auto_handled / promoted_memory) and `triage_note`; `agent_approval_gates` has `initiated_by` (user / jarvis)
- **Auto-approve gates**: When `initiatedBy === 'jarvis'` and tool is not in `STRICTLY_IRREVERSIBLE_TOOLS` (send_email, gmail_action, daemon_action, discord_post, speak, sessions_send), gates are auto-approved at creation time via `setImmediate` event fire
- **Triage runner**: `server/inboxTriage.ts` — 3-min background loop, AI (gpt-4o-mini) classifies each pending deliverable as auto_handle / escalate / promote_memory; auto_handle marks approved, promote_memory writes to `user_memories` + marks soul stale
- **API**: `GET /api/deliverables?triageSection=auto_handled` returns recently auto-handled / promoted-memory items (last 48h)
- **Inbox UI**: "Needs your review" section for pending items; collapsible "Auto-handled" section showing handled items with triage badge + reason; badge count includes both inbox items + pending deliverables

## Jarvis Ego — Self-Awareness & Performance Tracking
Jarvis now tracks its own performance and delivers weekly self-reports:
- **Tables**: `jarvis_action_log` (every action Jarvis takes with outcome tracking), `ego_weekly_reports` (weekly analysis + natural-language self-report)
- **Action types tracked**: email_drafted, task_suggested, plan_built, proactive_message, meeting_brief, evening_wrap, dream_insight, nervous_system_signal
- **Ego analyser** (`server/intelligence/ego.ts`): computes completion rate, engagement rate, relationship health trend, most/least effective action types weekly
- **Self-correction**: if an action type has <25% engagement over the last 2 weeks, Jarvis writes a suppression preference to `jarvisSuppressedActions` in user_preferences and scales back
- **Weekly report**: generated every Sunday 18:00 UTC, delivered via the user's preferred channels + stored in-app
- **Soul feedback loop**: after each weekly analysis, durable findings (e.g. "user rarely acts on Monday task suggestions") are written as memories tagged `jarvis_self_knowledge`, then Soul is marked stale for regeneration
- **In-app dashboard**: "Jarvis Report" screen accessible from Settings → Jarvis Intelligence — shows action breakdown with engagement bar charts, most/least effective action types, relationship health, and all weekly self-reports
- **API routes**: `GET /api/ego/dashboard`, `GET /api/ego/reports`, `POST /api/ego/trigger`
- **Key files**: `server/intelligence/ego.ts`, `server/intelligence/actionLog.ts`, `app/jarvis-report.tsx`, `shared/schema.ts` (jarvisActionLog, egoWeeklyReports)

## Capability Module System (`server/capabilities/`)

The agent harness no longer hard-codes the integration-to-tool dependency map. Instead, each functional domain is encapsulated in a Capability module:

- **`server/capabilities/types.ts`** — Core interfaces: `Capability`, `IntegrationDependency`, `ConfigRequirement`, `CapabilityHealthStatus`
- **`server/capabilities/registry.ts`** — `CapabilityRegistry` class + `capabilityRegistry` singleton. Exposes `getIntegrationDeps()` (for harness) and `getHealthStatuses()` (for integrationValidator)
- **`server/capabilities/index.ts`** — Entry point: registers all 13 capability modules on import
- **Capability modules** (one per domain):
  - `calendarCapability` — Google Calendar tools
  - `emailCapability` — Gmail + Outlook send/fetch/draft tools
  - `coachingCapability` — Tasks, background jobs, scheduling
  - `researchCapability` — Web search, web fetch, YouTube
  - `discordCapability` — Discord post/channel/report tools
  - `browserCapability` — Headless browser (Playwright MCP)
  - `daemonCapability` — Desktop daemon action tool
  - `driveCapability` — Google Drive + Documents
  - `systemCapability` — Subagent, sessions, buildFeatureTool
  - `schedulingCapability` — Cron + Workflow tools
  - `mediaCapability` — TTS (ElevenLabs) + image generation
  - `memoryCapability` — Memory search/get
  - `connectionsCapability` — Reconnect tools + channel-only integrations (Telegram/Slack/WhatsApp/Outlook)
  - `codeCapability` — Sandboxed Python execution (`run_python` tool), gated behind `can_run_code` permission

**Harness integration**: `harness.ts` dynamically imports `capabilityRegistry` and calls `getIntegrationDeps()` to build the tool-exclusion map at runtime — no hardcoded map in harness.
**Validator integration**: `runValidationCycle()` calls `capabilityRegistry.getHealthStatuses()` at boot to log config-level issues (missing env vars) before the per-user OAuth pings run.

## Curiosity Scanner (Proactive Questions)
A background service (`server/curiosityScanner.ts`) runs every 30 minutes to proactively learn about the user:
- Fetches upcoming calendar events (today + tomorrow) and recent emails (last 24h)
- Uses AI to filter out noise (standups, newsletters) and generate curious questions about meaningful items
- Sends questions via Telegram (max 2 per scan to avoid spam)
- Tracks sent questions in `proactive_questions_sent` table to prevent repeats
- When user replies to a proactive question, the system marks it as answered and extracts profile facts from the response
## User Skills — Personalised Behaviour Instructions (Task #502)

Users can install or author their own "skills" — reusable instruction sets that Jarvis follows every session. Built-in skills cover common patterns (Morning Ritual, Stoic Coach, Deep Work Mode, etc.); custom skills let users write freeform instructions in plain English.

### Architecture
- **`shared/schema.ts`** — New `user_skills` table: `id, user_id, name, emoji, description, instructions, is_built_in, is_active, created_at, updated_at`.
- **`server/db.ts`** — `CREATE TABLE IF NOT EXISTS user_skills` DDL added to `ensureTablesExist()`.
- **`server/routes.ts`** — Four new endpoints under `/api/user-skills`:
  - `GET /api/user-skills` — List all skills; seeds the 10-skill built-in library for new users on first call (idempotent).
  - `POST /api/user-skills` — Create a custom skill (name, emoji, description, instructions).
  - `PATCH /api/user-skills/:id/toggle` — Toggle `is_active` on/off.
  - `DELETE /api/user-skills/:id` — Delete a custom skill (built-in skills are protected).
- **`server/agent/harness.ts`** — New injection block after the learnt-skills block: queries `user_skills` for `is_active=true` and appends `## Active Skills` section to the first system message every session.
- **`app/skills.tsx`** — Completely rewritten Skills screen with two sections: **Built-In Library** (10 curated skills with emoji, name, description, toggle) and **My Skills** (custom, with delete). "+ Create Skill" button opens a slide-up modal with emoji picker, name, description, and instructions fields plus a live system-prompt preview. Accessible from Settings → Skills.

### Built-In Skill Library
🌅 Morning Ritual · 💰 Finance Awareness · 🏛️ Stoic Coach · 🦅 Deadline Hawk · 🎯 Deep Work Mode · 📊 Weekly Review · 🙏 Gratitude Practice · 💪 Fitness Check-in · 🔍 Communication Filter · ⚡ Energy Management

### How Injection Works
Active DB skills are fetched in `runAgent()` inside `harness.ts` and appended to the first system message as an `## Active Skills` block. This runs after the existing learnt-skills (crystallized file-based) and before the behaviour-packs blocks, so user skills layer cleanly on top of the platform defaults. Injection is best-effort (wrapped in try/catch) so failures never block a conversation.

## GitHub Integration (Task #936)

Jarvis can connect to GitHub to monitor pull requests and CI status. Supports both OAuth (Device Flow) and manual Personal Access Tokens.

### Connection Methods
- **OAuth Device Flow** — Enabled when `GITHUB_CLIENT_ID` env var is set. User clicks "Connect with GitHub", gets a short user code, visits `github.com/login/device`, enters the code, and Jarvis polls automatically until authorization completes. Token stored with `accountEmail: "oauth"` in `user_tokens`.
- **PAT (Personal Access Token)** — Fallback method for users who prefer manual tokens. Token stored with `accountEmail: "pat"` in `user_tokens`.

### Architecture
- **`server/integrations/github.ts`** — `getGitHubSettings`, `saveGitHubSettings` (now accepts `tokenType?: "pat"|"oauth"`), `listOpenPRs`, `getPR`, `mergePR`, `getDiffSummary`. The `tokenType` field is stored in the `accountEmail` column and returned from `getGitHubSettings`.
- **`server/capabilities/githubCapability.ts`** — Capability module registering `list_github_prs`, `get_github_pr`, `merge_github_pr` tools in the `github` tool group.
- **`server/agent/tools/githubPrTools.ts`** — Tool implementations for PR operations.
- **Device Flow API routes** (in `server/routes.ts`):
  - `GET /api/github/oauth-available` — Returns `{ available: bool }` based on `GITHUB_CLIENT_ID` being set.
  - `POST /api/github/device/start` — Initiates Device Flow; returns `device_code`, `user_code`, `verification_uri`, `expires_in`, `interval`.
  - `POST /api/github/device/poll` — Polls GitHub for token; on success saves it and returns `{ status: "authorized" }`.
- **`app/(tabs)/settings.tsx`** — GitHub section shows "Connect with GitHub" button (OAuth) when available, with an inline code card showing the user code for entry at github.com/login/device. Falls back to PAT entry when OAuth is not configured.

### Configuration
Set the `GITHUB_CLIENT_ID` secret (from a GitHub OAuth App — Device Flow does not require a client secret) to enable the OAuth connect button. Without it, only PAT is available.

## Jarvis Self-Inspection & Code Proposals (Task #452)

Jarvis can now read its own source code, reason about it, propose targeted improvements, and apply approved changes — with the user always in the approval gate.

### Architecture
- **`server/agent/tools/selfEditTools.ts`** — Three tools: `list_source_files` (returns a filtered directory tree of allowed paths), `read_source_file` (reads a single file with a max 600-line cap and paging support), `propose_code_change` (writes a proposal record to the DB and creates an inbox notification — never writes files).
- **`server/capabilities/selfEditCapability.ts`** — Capability module wrapping the three tools, registered in the `system` tool group.
- **`server/agent/codeProposalsRoutes.ts`** — REST API at `/api/code-proposals`: GET list, GET detail, POST approve (re-validates path allow-list then writes file), POST reject (archives with optional note).
- **`shared/schema.ts`** — New `code_proposals` table with `id, user_id, title, reason, file_path, original_content, proposed_content, status, rejection_note, created_at, applied_at`.
- **`app/code-proposals.tsx`** — Code Proposals screen with status filter tabs (Pending / Applied / Archived), proposal cards, and a full-screen detail modal with a before/after diff view and Approve / Reject actions.
- **`app/(tabs)/settings.tsx`** — "Code Proposals" link added under the JARVIS INTELLIGENCE section.
- **`server/routes.ts`** — System prompt now includes self-edit tool instructions: when to use them, the sequential read→propose workflow, and the rule that files must never be written directly.

### Security Model
- Path allow-list enforced in two places: the `propose_code_change` tool (at proposal creation) and the `/approve` endpoint (at file write time).
- Allowed base directories: `server/`, `shared/`, `app/`, `components/`, `hooks/`, `constants/`, `lib/`.
- Absolute paths, `..` traversal, and paths outside the allow-list are rejected at both layers.
- The approval gate code (`codeProposalsRoutes.ts`) is explicitly excluded from the tool's self-modification instructions.

## Skill Curator — Auto-Learning Permanent Skills (Task #872)

Jarvis can now auto-detect habits from orchestration traces and interaction logs and turn them into permanent skills the user can review and activate.

### Database
- **`skill_candidates`** table — `id, user_id, name, trigger_description, instruction_text, source_type (curator|synthesiser), status (pending|accepted|edited|dismissed), created_at`.

### Backend Services
- **`server/intelligence/skillCurator.ts`** — `curateSkillsForUser(userId)` queries the past 7 days of orchestration traces and interaction logs, calls gpt-4o-mini to identify recurring patterns, and inserts them as `pending` skill candidates. `curateSkillsForAllUsers()` runs across all users. `emitSynthesiserCandidate(userId, bullet)` converts a learning-synthesiser bullet into a candidate (also via LLM).
- **`server/intelligence/learningSynthesiser.ts`** — When triggered by the scheduler, each synthesis bullet is emitted as a skill candidate via `emitSynthesiserCandidate`.
- **`server/scheduler.ts`** — `curateSkillsForAllUsers` runs in parallel with learning synthesis every Sunday at 4:30 AM.
- **`server/routes.ts`** — `GET /api/skills/candidates` (canonical; `/api/skill-candidates` is a legacy alias), `PATCH /api/skills/candidates/:id/review` (`{action: accept|edit|dismiss, name?, instructionText?}`). Accepted candidates are promoted to a new `user_skills` row with `isActive: true`. `PATCH /api/user-skills/:id` edits an existing custom skill (name/description/instructions/emoji).

### Frontend (Profile > My Skills)
- **`app/(tabs)/profile.tsx`** — New "My Skills" section with two sub-panels:
  - **Suggested** — pending candidates with Accept / Edit / Dismiss buttons. Edit opens an inline form to tweak name and instructions before accepting.
  - **Active Custom Skills** — all non-built-in user_skills with a toggle (active/inactive) and delete button.
  - Mirrors the Memory Review card design (`memoryRow` / `memoryEmptyCard` styles).
