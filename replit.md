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
-   **Intuitive UI/UX:** Features a tab-based navigation (`Today`, `Inbox`, `Goals`, `Insights`, `Profile`) with a consistent indigo/purple color scheme.
-   **State Management:** Primarily server-side data persistence with PostgreSQL.
-   **Accountability Engine:** AI extracts commitments from user interactions, tracks due dates, and provides proactive check-ins and notifications.
-   **ADHD/Executive Dysfunction Support:** Includes features like Energy Check-in, Quick Capture, "Just One Thing" Mode, Focus Timer, Visual Time Blocks, Voice Interface, and Jarvis Autonomous Daily Planning.
-   **Gamification:** Incorporates an XP system, levels, badges, and real-world rewards to motivate users.
-   **Multi-User Support:** All user data is stored server-side and scoped by user ID, accessible across devices.
-   **Onboarding:** A guided onboarding flow captures initial user preferences and goals.

## Multi-Channel & Computer Control (Phase 5)

The coach is no longer Telegram-only. A channel abstraction layer (`server/channels/`) lets every notification and conversation flow through Telegram, WhatsApp (Twilio Business API), Slack DM (chat.postMessage + Events API + `/jarvis` slash command), and a paired desktop daemon — chosen per notification type via `channel_preferences`.

- **`coachAgent.ts`** — channel-agnostic `runCoachAgent({userId, userText, channelName, imageUrl})` extracted from the legacy Telegram path; loads goals/stats/calendar/email/SOUL block, runs the agent, persists chat history, returns `{reply, attachments}`.
- **Adapters** — `telegramChannel`, `whatsappChannel`, `slackChannel`, `daemonChannel` — each implements the `Channel` interface (`isConfigured`, `isLinkedFor`, `sendMessage`).
- **Registry** — `notifyUser(userId, notificationType, text, opts)` looks up `channel_preferences` and fans the message out in parallel; falls back to Telegram when no prefs exist.
- **Inbound webhooks** — `POST /api/channels/whatsapp/webhook` (Twilio form-encoded), `POST /api/slack/events` (URL verification + signature-verified message events), `POST /api/slack/commands` (`/jarvis plan|brain-dump|status`).
- **Link codes** — `channel_link_codes` issues short-lived 6/8-char codes for WhatsApp (text the code) and the desktop daemon (paste into the daemon CLI). Codes expire in 15 min and are single-use.

### Desktop Daemon
A standalone Node.js script in `daemon/jarvis-daemon.js` pairs to the server over a WebSocket (`/api/daemon/ws`). It exposes a sandboxed set of operations — `shell`, `notify`, `file_read`, `file_write`, `file_list` — all confined to `JARVIS_DAEMON_ROOT` (default `~/jarvis-workspace`). The agent invokes them via the `daemon_action` tool, and `daemonChannel` uses the `notify` op to send native desktop notifications when channel preferences route a notification to the daemon. Pattern inspired by [OpenClaw](https://github.com/steipete/openclaw) (MIT, © 2025 Peter Steinberger).

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
- **Artifact delivery** — `create_document` saves to the Documents library AND queues a `pendingAttachments` entry in `ctx.state`; the Telegram caller delivers the file via `sendTelegramDocument` so the user receives it in-channel.
- Google scopes now include `drive.file` and `gmail.modify`; existing users must reconnect Google to grant them.

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

## Curiosity Scanner (Proactive Questions)
A background service (`server/curiosityScanner.ts`) runs every 30 minutes to proactively learn about the user:
- Fetches upcoming calendar events (today + tomorrow) and recent emails (last 24h)
- Uses AI to filter out noise (standups, newsletters) and generate curious questions about meaningful items
- Sends questions via Telegram (max 2 per scan to avoid spam)
- Tracks sent questions in `proactive_questions_sent` table to prevent repeats
- When user replies to a proactive question, the system marks it as answered and extracts profile facts from the response