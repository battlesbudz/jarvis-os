# GamePlan - Daily Game Plan App

## Overview
A mobile app that generates personalized daily task checklists with AI-powered adaptive task sizing. Users can break tasks into smaller steps or combine them using a "detail level" slider (1-5), helping with executive dysfunction. The AI learns from 7-day completion history, life context, and Gmail signals to suggest appropriately-sized tasks.

## Tech Stack
- **Frontend**: Expo Router (React Native) with file-based routing
- **Backend**: Express.js (serves landing page and API)
- **AI**: OpenAI via Replit AI Integrations (gpt-5-mini) for task resizing, plan generation, and coaching
- **Database**: PostgreSQL with Drizzle ORM for user accounts and server-side data persistence
- **Auth**: JWT (jsonwebtoken) + Google OAuth (expo-auth-session) — Google Sign-In only; bcryptjs kept for legacy username/password accounts
- **State**: Server-side PostgreSQL (AsyncStorage only for auth token/user ID)
- **Styling**: React Native StyleSheet with Inter font family
- **Icons**: @expo/vector-icons (Ionicons)
- **Integrations**: Google Calendar, Outlook Calendar, Gmail (all via Replit OAuth connectors)

## Project Structure
- `app/(tabs)/` - Tab screens: index (Today), goals, insights, profile
- `app/(tabs)/_layout.tsx` - Tab navigation with NativeTabs (liquid glass) + classic fallback
- `components/` - Reusable components: TaskCard, GoalCard, ProgressRing, AddGoalSheet, TaskResizerSheet, LifeContextSheet, MarkdownText, RewardClaimModal
- `lib/storage.ts` - Server API data layer for tasks, goals, stats, completion history, chat history, life context (uses JWT auth token from auth-context)
- `server/db.ts` - Drizzle ORM PostgreSQL connection
- `server/dataRoutes.ts` - CRUD API routes for all user data categories
- `shared/schema.ts` - Drizzle schema: users, plans, goals, stats, brain_dump_inbox, energy_checkins, chat_history, life_context, timer_settings, user_preferences, completion_history, blocked_tasks, completed_calendar_ids, plan_snapshots
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

## Color Palette
- Primary: #6366F1 (indigo)
- Secondary: #8B5CF6 (purple)
- Accent: #EC4899 (pink)
- Success: #10B981 (green)
- Warning: #F59E0B (amber)
- Background: #FFFFFF, Surface: #F9FAFB

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

### ADHD / Executive Dysfunction Features
14. **Energy Check-in** - Morning modal on first daily app open; user selects energy level (1-5) and focus quality (Foggy/Steady/Sharp); stored in AsyncStorage; feeds into AI plan generation to adjust task difficulty. Has "Skip for today" option.
15. **Quick Capture / Brain Dump** - Floating + button on Today screen; opens BrainDumpModal for rapid thought capture; "Add to Today" creates a task immediately, "Save for Later" stores in inbox; inbox items shown at top of Today screen for later action.
16. **"Just One Thing" Mode** - "Overwhelmed?" button near task list header; opens JustOneThingModal showing exactly one prioritized task; energy check-in data influences task selection (low energy = low effort tasks); "Done" marks complete, "Pick Another" cycles tasks.
17. **Focus Timer** - Pomodoro-style timer at `/focus-timer` modal route; 25min work / 5min break cycles; circular progress ring; per-task launch from "Focus" button on TaskCard; haptic feedback + local notifications on session complete; settings persisted in AsyncStorage.
18. **Visual Time Blocks** - Toggle in Today header switches between list view and timeline view; timeline shows hours 6am–10pm with tasks pinned to their scheduled time; unscheduled tasks shown separately; view preference persisted.
19. **Transition Reminders** - Local notifications scheduled 10 min before tasks with a set `time`; enabled/disabled toggle in Profile; web-safe (lib/notifications.web.ts stub); focus timer fires completion nudge notifications.

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
- `POST /api/coach/checkin` - Takes goals, stats, history, lifeContext; returns {note}
- `POST /api/coach/suggestions` - Takes lastAssistantMessage, goals; returns {actions, followups}
- `GET /api/calendar/status` - Returns {google: bool, outlook: bool}
- `GET /api/calendar/google/events?date=YYYY-MM-DD` - Today's events from Google Calendar
- `GET /api/calendar/outlook/events?date=YYYY-MM-DD` - Today's events from Outlook
- `GET /api/gmail/status` - Returns {connected: bool}
- `GET /api/gmail/commitments` - Returns {connected: bool, items: EmailCommitment[]} (last 7 days, 20 emails max)
- `GET/PUT /api/data/plans/:date` - Per-user daily plan CRUD
- `GET /api/data/plans` - All plans for user
- `GET/PUT/DELETE /api/data/{goals,stats,brain-dump-inbox,chat-history,life-context,timer-settings,user-preferences,completion-history,blocked-tasks,plan-snapshots}` - Per-user data CRUD
- `GET/PUT /api/data/energy-checkins/:date` - Per-user daily energy checkin
- `GET/PUT /api/data/completed-calendar-ids/:date` - Per-user completed calendar event IDs

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
- Calendar/Gmail integrations (Google Calendar, Outlook, Gmail) are tied to Replit account-level OAuth at the infrastructure level (cannot be per-user); new users see calendar events from the configured connector
- Empty states: Today tab shows "No tasks yet" if no goals set; Goals tab shows "No goals yet" CTA

## Workflows
- `Start Backend` (port 5000) - Express server
- `Start Frontend` (port 8081) - Expo dev server
