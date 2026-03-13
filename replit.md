# GamePlan - Daily Game Plan App

## Overview
GamePlan is a mobile application designed to help users manage daily tasks through AI-powered adaptive task sizing and personalized plan generation. It aims to address executive dysfunction by allowing users to adjust task granularity and integrates with various user contexts like completion history, life context, and email signals to create relevant task suggestions. The project's vision is to enhance daily productivity and well-being through intelligent, personalized task management.

## Tech Stack
- **Frontend**: Expo Router (React Native) with file-based routing
- **Backend**: Express.js (serves landing page and API)
- **AI**: OpenAI via Replit AI Integrations (gpt-5-mini) for task resizing, plan generation, and coaching
- **Database**: PostgreSQL with Drizzle ORM for user accounts and server-side data persistence
- **Auth**: JWT (jsonwebtoken) + Google OAuth (expo-auth-session) — Google Sign-In only; bcryptjs kept for legacy username/password accounts
- **State**: Server-side PostgreSQL (AsyncStorage only for auth token/user ID)
- **Styling**: React Native StyleSheet with Inter font family
- **Icons**: @expo/vector-icons (Ionicons)
- **Integrations**: Google Calendar, Outlook Calendar, Gmail (all via Replit OAuth connectors), Slack (user OAuth), Telegram (bot token)

## Project Structure
- `app/(tabs)/` - Tab screens: index (Today), goals, insights, profile
- `app/(tabs)/_layout.tsx` - Tab navigation with NativeTabs (liquid glass) + classic fallback
- `components/` - Reusable components: TaskCard, GoalCard, ProgressRing, AddGoalSheet, TaskResizerSheet, LifeContextSheet, MarkdownText, RewardClaimModal, JarvisPlanModal
- `lib/storage.ts` - Server API data layer for tasks, goals, stats, completion history, chat history, life context (uses JWT auth token from auth-context)
- `server/db.ts` - Drizzle ORM PostgreSQL connection
- `server/dataRoutes.ts` - CRUD API routes for all user data categories
- `shared/schema.ts` - Drizzle schema: users, plans, goals, stats, brain_dump_inbox, energy_checkins, chat_history, life_context, timer_settings, user_preferences, completion_history, blocked_tasks, completed_calendar_ids, plan_snapshots, commitments, user_memories, telegram_links, telegram_link_codes, telegram_group_messages
- `lib/helpers.ts` - Category colors, icons, labels, date formatting utilities
- `lib/query-client.ts` - React Query client with apiRequest helper (sends Authorization header)
- `lib/auth-context.tsx` - Auth context provider (login, register, loginWithGoogle, logout, token persistence)
- `constants/colors.ts` - Theme colors (indigo primary, purple secondary)
- `server/ai.ts` - AI logic for resizeTask() and generateSmartPlan()
- `server/routes.ts` - All API endpoints (auth middleware applied)
- `server/auth.ts` - Auth endpoints (register, login, google, me) and JWT auth middleware; `/api/auth/google` verifies Google access token via userinfo API and upserts user
- `server/db.ts` - PostgreSQL connection with Drizzle ORM
- `shared/schema.ts` - Drizzle schema (users table with hashed passwords)
- `server/integrations/googleCalendar.ts` - Google Calendar client
- `server/integrations/outlook.ts` - Outlook calendar client
- `server/integrations/gmailClient.ts` - Gmail OAuth client (Replit connector token refresh)
- `server/integrations/gmail.ts` - checkGmailConnection(), getRecentEmailCommitments()
- `server/integrations/slack.ts` - getSlackMessages() Slack Web API client
- `server/integrations/telegram.ts` - Telegram Bot API client (sendMessage, setWebhook)
- `server/telegramRoutes.ts` - Telegram webhook, link-code, status, disconnect, messages, notify routes + proactive scheduler
- `server/scheduler.ts` - Daily auto-plan scheduler: startScheduler() runs at 7am, builds plans for users with empty plans via buildPlanForUser()

## User Preferences
I prefer iterative development with a focus on clear, concise communication. Please ask before making major architectural changes or introducing new dependencies. I value well-documented code and a consistent coding style. Do not make changes to files in the `server/integrations` directory unless explicitly requested.

## System Architecture
GamePlan is built with a mobile-first approach using **Expo Router (React Native)** for the frontend, providing a native look and feel with file-based routing. The backend is an **Express.js** server handling API requests and serving static content. **OpenAI's GPT-5-mini** is central to the AI functionalities, including task resizing, smart plan generation, and an interactive AI coach. Data persistence is managed by **PostgreSQL** with **Drizzle ORM**. Authentication relies on **JWT** for session management and **Google OAuth** for user sign-in.


Key architectural patterns and features include:
-   **Adaptive Task Sizing:** AI dynamically adjusts task difficulty and granularity based on a detail level slider and user history.
-   **Smart Plan Generation:** AI constructs daily plans considering user goals, 7-day completion history, "Life Context" (onboarding questionnaire), and Gmail signals.
-   **Intuitive UI/UX:** Features a tab-based navigation (`Today`, `Goals`, `Insights`, `Profile`), a consistent indigo/purple color scheme, and accessible components like `TaskCard`, `GoalCard`, and various modals.
-   **State Management:** Primarily server-side data persistence with PostgreSQL, minimizing client-side state beyond authentication tokens.
-   **Accountability Engine:** AI extracts commitments from user interactions, tracks due dates, and provides proactive check-ins and push notifications for task completion and commitment reminders.
-   **ADHD/Executive Dysfunction Support:**
    -   **Energy Check-in:** Modifies task difficulty based on reported daily energy levels.
    -   **Quick Capture / Brain Dump:** Allows rapid task entry for later organization.
    -   **"Just One Thing" Mode:** Focuses user on a single prioritized task when overwhelmed.
    -   **Focus Timer:** Pomodoro-style timer integrated with tasks.
    -   **Visual Time Blocks:** Alternative task view to visualize scheduled tasks on a timeline.
    -   **Voice Interface:** Speech-to-text and text-to-speech for AI coach interaction.
    -   **Jarvis Autonomous Daily Planning:** AI generates a full, prioritized daily plan based on multiple data inputs.
-   **Gamification:** Includes an XP system, levels, badges, and real-world rewards to motivate users.

## Features
1. **Today Tab** - Daily checklist with progress ring, task categories, completion tracking; AI coaching check-in note shown daily
2. **AI Task Resizer** - Break tasks into smaller steps or simplify them with a detail level slider (1-5)
3. **Smart Plan Generation** - AI generates daily plans using goals + 7-day history + Life Context + Gmail signals
4. **Subtasks** - Tasks can have nested subtasks with progress bars; parent auto-completes when all subtasks done
5. **Completion History** - Rolling 7-day history feeds into AI for personalized sizing
6. **Goals Tab** - Create, edit, delete goals with progress tracking across categories
7. **Insights Tab** - Streaming AI coach chat (gpt-5-mini), persistent chat history, calendar context, markdown bubbles, action buttons (+Add task/+Set goal), follow-up chips, daily check-in card
8. **Profile Tab** - Level + XP bar, streak stats, badge achievements grid, About You section, Connected Apps (calendars + Gmail)
9. **Calendar Integrations** - Google Calendar + Outlook events appear as "Today's Events" on the Today tab
10. **Rewards System** - XP earned per task (10/15/20 pts by priority/goal-linked), level 1-10 with names, 7 badge types; animated "+XP" toast on completion
11. **Completed Section** - Both regular tasks AND calendar events move to the Completed section when checked off
12. **Life Context** - 5-question onboarding questionnaire (LifeContextSheet modal); answers stored in AsyncStorage; feeds into ALL AI calls (coach chat, plan generation, check-in, suggestions)
13. **Gmail Integration** - Connected via OAuth; reads recent inbox emails (subject + snippet only); surfaces commitment/deadline signals to AI coach and plan generator
14. **Slack Integration** - Connected via user OAuth (SLACK_CLIENT_ID/SLACK_CLIENT_SECRET required); reads recent messages from top 5 active channels/DMs (last 7 days, up to 30 messages each); surfaces to AI coach for commitment/follow-up identification; connect/disconnect in Profile tab
15. **Accountability Engine** - Commitment tracking: AI auto-extracts commitments from chat ("I'll do X by Friday"), stores in `commitments` table, shows in collapsible "Open Commitments" section on Coach tab with due date badges (green/orange/red). Proactive check-ins: on app open, Jarvis surfaces accountability message if tasks were left incomplete yesterday or commitments are overdue. Push notifications: evening accountability (8pm), mid-day nudge (1pm), commitment due-date reminders (10am), weekly review (Sunday 7pm). Weekly review endpoint generates structured review with wins/patterns/avoided/focus. Coach system prompt and daily check-in note now include open commitments for smarter coaching.
16. **Telegram Integration** - Bot-based Telegram connection for proactive messaging and two-way coaching chat. Link via 6-char code (Profile > Connected Apps > Telegram). Telegram webhook receives messages: linked users get full coach AI responses in Telegram (same conversation as in-app). Group messages from bot-joined groups stored as context for coach. Server-side proactive scheduler sends morning brief (8am), evening check-in (8pm), and weekly review (Sunday 7pm) via Telegram. Tables: `telegram_links`, `telegram_link_codes`, `telegram_group_messages`. Routes: webhook (unauthenticated), link-code, status, disconnect, messages, notify (all authenticated). Requires `TELEGRAM_BOT_TOKEN` secret.

### ADHD / Executive Dysfunction Features
14. **Energy Check-in** - Morning modal on first daily app open; user selects energy level (1-5) and focus quality (Foggy/Steady/Sharp); stored in AsyncStorage; feeds into AI plan generation to adjust task difficulty. Has "Skip for today" option.
15. **Quick Capture / Brain Dump** - Floating + button on Today screen; opens BrainDumpModal for rapid thought capture; "Add to Today" creates a task immediately, "Save for Later" stores in inbox; inbox items shown at top of Today screen for later action.
16. **"Just One Thing" Mode** - "Overwhelmed?" button near task list header; opens JustOneThingModal showing exactly one prioritized task; energy check-in data influences task selection (low energy = low effort tasks); "Done" marks complete, "Pick Another" cycles tasks.
17. **Focus Timer** - Pomodoro-style timer at `/focus-timer` modal route; 25min work / 5min break cycles; circular progress ring; per-task launch from "Focus" button on TaskCard; haptic feedback + local notifications on session complete; settings persisted in AsyncStorage.
18. **Visual Time Blocks** - Toggle in Today header switches between list view and timeline view; timeline shows hours 6am–10pm with tasks pinned to their scheduled time; unscheduled tasks shown separately; view preference persisted.
19. **Transition Reminders** - Local notifications scheduled 10 min before tasks with a set `time`; enabled/disabled toggle in Profile; web-safe (lib/notifications.web.ts stub); focus timer fires completion nudge notifications.
20. **Voice Interface** - Mic button in Coach input bar records speech (expo-av), transcribes via Whisper (POST /api/coach/transcribe), auto-sends to coach. Speaker button on last assistant message plays TTS response aloud (POST /api/coach/speak, OpenAI TTS "alloy" voice). Works on iOS/Android/web.
21. **Jarvis Autonomous Daily Planning** - "Build My Day" button (empty state) or "Jarvis" pill (To Do header) triggers Jarvis to analyze goals, calendar, emails, brain dump, and completion history to build a prioritized 4-7 task plan. Preview modal (JarvisPlanModal) shows reasoning + proposed tasks with Accept/Start Over options. Accepted tasks are prepended to today's plan with undo support.
22. **Coach Memory** - After each coach conversation, a background AI call extracts 0-3 notable facts about the user (goals, patterns, preferences, achievements). Stored in `user_memories` DB table per user. Injected into coach system prompt as "What I Know About You" section. Profile tab shows Coach Memory card where users can view and delete individual memories. Deduplication via AI prompt that includes existing memories.
23. **Auto-Daily Plan Scheduler** - Server-side scheduler (`server/scheduler.ts`) runs at 7am daily, auto-builds plans for all users with empty plans using `buildPlanForUser()`. Stores `autoBuiltPlan` metadata in userPreferences (date, topTask, reasoning, taskCount). Morning notification shows top task when auto-plan exists. Dismiss endpoint at `POST /api/data/auto-built-plan/dismiss`. Manual "Build My Day" still works as override.

## Authentication
- **Login screen**: `/login` route with Google Sign-In button
- **Web sign-in**: Uses Google Identity Services (GIS) — loads `accounts.google.com/gsi/client` script, calls `google.accounts.id.prompt()` to show Google's own popup, receives ID token via JS callback, sends to `POST /api/auth/google`
- **Native sign-in**: Uses expo-auth-session with Google's OAuth endpoints to obtain an access token, sends to `POST /api/auth/google`
- **Endpoints**: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/google`, `GET /api/auth/me`
- **JWT tokens**: 30-day expiry, stored in AsyncStorage, sent as `Authorization: Bearer <token>`
- **Auth middleware**: All `/api/*` routes (except `/api/auth/*`) require valid JWT
- **AuthProvider**: Wraps entire app in `_layout.tsx`, exposes `useAuth()` hook with `login`, `register`, `loginWithGoogle`, `logout`, `isAuthenticated`, `userId`, `username`
- **Logout**: Available in Profile > Settings section

### Google Sign-In Setup (Authorized JavaScript Origins)
For web Google Sign-In to work, the Replit dev domain must be added to **Authorized JavaScript origins** in Google Cloud Console:
1. Go to [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)
2. Edit the OAuth 2.0 Client ID used by this app
3. Under "Authorized JavaScript origins", add: `https://<your-replit-dev-domain>` (the domain shown in the browser when running the app)
4. No redirect URIs are needed for GIS — it uses a JavaScript callback, not a redirect

## API Endpoints
- `POST /api/ai/resize-task` - Takes taskTitle, detailLevel (1-5), direction (smaller/bigger), history
- `POST /api/ai/generate-plan` - Takes goals, history, dayOfWeek, lifeContext, gmailItems; returns tasks + insight
- `POST /api/coach/chat` - Streaming SSE; takes messages, goals, stats, history, calendarEvents, lifeContext, gmailItems
- `POST /api/coach/build-plan` - Takes goals, calendarEvents, gmailItems, brainDump, completionHistory, energyLevel, coachingMode, existingTasks, date; returns {reasoning, tasks[]} — Jarvis autonomous daily planning
- `POST /api/coach/checkin` - Takes goals, stats, history, lifeContext; returns {note}
- `POST /api/coach/suggestions` - Takes lastAssistantMessage, goals; returns {actions, followups}
- `POST /api/coach/transcribe` - Takes {audio: base64}; returns {text} (speech-to-text via Whisper)
- `POST /api/coach/speak` - Takes {text, voice?}; returns {audio: base64} (text-to-speech via OpenAI TTS)
- `GET /api/calendar/status` - Returns {google: bool, outlook: bool}
- `GET /api/calendar/google/events?date=YYYY-MM-DD` - Today's events from Google Calendar
- `GET /api/calendar/outlook/events?date=YYYY-MM-DD` - Today's events from Outlook
- `GET /api/gmail/status` - Returns {connected: bool}
- `GET /api/gmail/commitments` - Returns {connected: bool, items: EmailCommitment[]} (last 7 days, 20 emails max)
- `GET /api/slack/status` - Returns {slack: bool}
- `GET /api/slack/messages` - Returns {connected: bool, messages: SlackMessage[]} (last 7 days, top 5 channels, up to 30 msgs each)
- `GET/PUT /api/data/plans/:date` - Per-user daily plan CRUD
- `GET /api/data/plans` - All plans for user
- `GET/PUT/DELETE /api/data/{goals,stats,brain-dump-inbox,chat-history,life-context,timer-settings,user-preferences,completion-history,blocked-tasks,plan-snapshots}` - Per-user data CRUD
- `POST /api/data/auto-built-plan/dismiss` - Marks autoBuiltPlan as dismissed in userPreferences
- `GET/PUT /api/data/energy-checkins/:date` - Per-user daily energy checkin
- `GET/PUT /api/data/completed-calendar-ids/:date` - Per-user completed calendar event IDs
- `GET /api/commitments` - Pending commitments for user
- `PUT /api/commitments/:id` - Update commitment status (done/skipped/pending)
- `DELETE /api/commitments/:id` - Delete a commitment
- `POST /api/commitments/extract` - AI extracts commitments from user message text
- `POST /api/coach/proactive` - Generates proactive accountability message from Jarvis (streaming SSE)
- `POST /api/coach/weekly-review` - Generates structured weekly review (headline, wins, patterns, avoided, nextWeekFocus)
- `POST /api/telegram/webhook` - Telegram bot webhook (no auth); handles linking, chat, group messages
- `POST /api/telegram/link-code` - Generate 6-char link code for Telegram account linking
- `GET /api/telegram/status` - Returns {connected, username, configured}
- `DELETE /api/telegram/disconnect` - Unlink Telegram account
- `GET /api/telegram/messages` - Returns group messages from last 7 days
- `POST /api/telegram/notify` - Send a notification to user's linked Telegram

## Rewards System
- XP: regular task +10, high priority +15, goal-linked +20, calendar event +10
- Levels 1-10: Beginner → GamePlan Pro (thresholds: 0/100/250/500/1000/2000/3500/5000/7500/10000)
- Badges: first_step, on_a_roll (3-day streak), week_warrior (7-day), centurion (100 tasks), goal_getter, calendar_pro, perfect_day
- XpToast: animated yellow pill "+N XP" on task completion; animated purple pill (ribbon icon) on badge unlock (1.8s delay after XP toast)
- ALL_REWARDS: 25 real-world rewards across 5 tiers (50/150/400/800/2000 XP thresholds)
- TIER_COLORS: {1: '#10B981', 2: '#6366F1', 3: '#F59E0B', 4: '#EC4899', 5: '#8B5CF6'}
- RewardClaimModal: full-screen celebration modal, spring-animated icon, floating sparkle particles

## Task Management (Edit, Delete, Reorder, Sub-tasks)
- Edit icon (pencil) on each incomplete task card opens `TaskEditSheet` modal
- TaskEditSheet fields: title, description, priority chips, category chips, time, sub-tasks section
- Sub-tasks: add manually via text input + "Add" button; remove with X button; existing AI-subtasks editable
- Delete: two-step inline confirmation (no native Alert) — "Delete Task" → shows "Delete this task? Cancel / Delete"
- Drag-to-reorder: long-press (300ms) any task in "To Do" to drag it to a new position; uses `react-native-draggable-flatlist` v4
- New storage functions: `updateTask`, `deleteTask`, `reorderTasks`, `addSubtaskManually` in `lib/storage.ts`
- Edit/delete only available on incomplete non-calendar tasks; completed section is read-only

## Onboarding & Multi-User Support
- New users are redirected to `/onboarding` on first launch (checked via `gameplan_onboarding_complete` in AsyncStorage)
- Onboarding flow: 7 steps — name → 4 life context questions (skippable) → first goal → connect apps info
- User name stored in `gameplan_user_name`, displayed in Today greeting ("Good morning, [name]") and Profile title
- Users authenticate with username/password; JWT token persists across restarts
- All user data (tasks, goals, stats, life context, chat history) is stored server-side in PostgreSQL, scoped by user ID — accessible from any device
- Calendar/Gmail integrations (Google Calendar, Outlook, Gmail) use Replit OAuth connectors but are scoped per-user: the first user who checks status when connectors are available is stored as the integration owner in the `integration_owner` table; only that user sees integrations as connected and can access calendar events / Gmail data; all other users see "Not connected"
- Empty states: Today tab shows "No tasks yet" if no goals set; Goals tab shows "No goals yet" CTA

## Workflows
- `Start Backend` (port 5000) - Express server
- `Start Frontend` (port 8081) - Expo dev server

## External Dependencies
-   **AI Services:** OpenAI (gpt-5-mini for various AI functionalities, Whisper for speech-to-text, TTS "alloy" for text-to-speech)
-   **Database:** PostgreSQL
-   **ORM:** Drizzle ORM
-   **Authentication:** JWT (jsonwebtoken), Google OAuth (expo-auth-session), Google Identity Services (GIS)
-   **Calendar Integrations:** Google Calendar, Outlook Calendar (via Replit OAuth connectors)
-   **Communication Integrations:** Gmail, Slack (via Replit OAuth connectors)
-   **UI Icons:** @expo/vector-icons (Ionicons)

