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