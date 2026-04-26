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

**Harness integration**: `harness.ts` dynamically imports `capabilityRegistry` and calls `getIntegrationDeps()` to build the tool-exclusion map at runtime — no hardcoded map in harness.
**Validator integration**: `runValidationCycle()` calls `capabilityRegistry.getHealthStatuses()` at boot to log config-level issues (missing env vars) before the per-user OAuth pings run.

## Curiosity Scanner (Proactive Questions)
A background service (`server/curiosityScanner.ts`) runs every 30 minutes to proactively learn about the user:
- Fetches upcoming calendar events (today + tomorrow) and recent emails (last 24h)
- Uses AI to filter out noise (standups, newsletters) and generate curious questions about meaningful items
- Sends questions via Telegram (max 2 per scan to avoid spam)
- Tracks sent questions in `proactive_questions_sent` table to prevent repeats
- When user replies to a proactive question, the system marks it as answered and extracts profile facts from the response