# GamePlan - Daily Game Plan App

## Overview
GamePlan is a mobile application designed to enhance daily productivity and well-being. It uses AI to adaptively size tasks and generate personalized plans, specifically addressing executive dysfunction. The application integrates user history, life context, and external signals (like emails) to provide relevant task suggestions and an interactive AI coach. Its business vision is to provide a comprehensive, AI-powered personal assistant that helps users achieve their goals by optimizing their daily routines, improving focus, and fostering positive habits.

## User Preferences
I prefer iterative development with a focus on clear, concise communication. Please ask before making major architectural changes or introducing new dependencies. I value well-documented code and a consistent coding style. Do not make changes to files in the `server/integrations` directory unless explicitly requested.

## System Architecture
GamePlan is a mobile-first application built with **Expo Router (React Native)** for the frontend, providing a native user experience and file-based routing. The backend utilizes **Express.js** for API handling. **OpenAI's GPT-5-mini** powers core AI functionalities, including adaptive task sizing, smart plan generation, and an interactive AI coach. Data is stored in **PostgreSQL** with **Drizzle ORM**. Authentication is handled via **JWT** for sessions and **Google OAuth** for user sign-in.

**Key Architectural Decisions and Features:**

-   **Adaptive Task Sizing & Smart Plan Generation:** AI dynamically adjusts task granularity and creates daily plans based on user input, goals, completion history, and "Life Context" derived from an onboarding questionnaire and external signals like Gmail.
-   **Mission Control UI:** A five-section dashboard (Tasks, Calendar, Projects, Memory, Visual) with a consistent design language. Green (`#22c55e`) is the primary accent, purple (`#a855f7`) for selection, and a near-black background (`#09090f`). It features a "JARVIS COMMAND" header, a pixel-art VisionSprite character, and a live "PRIME ONLINE" status indicator. The Tasks tab is a Kanban board, Calendar displays a combined schedule, and Memory provides a date-grouped journal.
-   **Multi-Agent Ego System:** Supports specialized AI personas with isolated memory, permissions, and communication channels. Includes features for agent management, inter-agent messaging, tool permissioning, and approval flows for sensitive actions.
-   **Multi-Channel & Computer Control:** The AI coach operates across multiple communication channels including Telegram, WhatsApp, Slack, and a desktop daemon. A channel abstraction layer allows user preferences to dictate notification routing.
    -   **Desktop Daemon:** A standalone Node.js script that pairs with the server via WebSocket, exposing sandboxed operations like shell commands, file access, and browser control confined to a user-defined workspace.
    -   **Playwright MCP Browser Integration:** Utilizes `@playwright/mcp` for robust browser automation, allowing the AI to interact with web content.
    -   **Android Daemon APK:** An Android application that extends AI control to mobile devices, enabling app launching, screen interaction, notification forwarding, and file system access.
-   **Agent Harness:** An OpenClaw-inspired tool-calling loop that executes AI-driven actions. It includes a comprehensive set of tools for web search, Gmail, calendar management, task management, document creation, Google Drive interaction, and YouTube transcript retrieval (including audio transcription fallback using Whisper).
-   **Prediction Engine (Jarvis Foresight):** Analyzes historical user data (energy levels, task completion, email response) to generate daily predictions (e.g., `energy_dip`, `procrastination_risk`). These predictions are integrated into daily plans and validated against user actions.
-   **Web Chat Interface:** Provides a browser-based chat UI at `/chat`, allowing users to interact with Jarvis without the mobile app, featuring Google Identity Services for authentication and SSE for real-time responses.
-   **Rich User Profile System:** Builds a detailed user profile through structured memory categories (e.g., personality, values, goals) extracted automatically from conversations and used to inform the AI's system prompt.
-   **Jarvis Scheduled Tasks:** Enables Jarvis to schedule its own autonomous tasks, allowing for natural language task scheduling and integration with the Mission Control UI.
-   **Inbox Rules Engine:** A learnable, user-configurable system for filtering emails and calendar events based on keywords, sender, and other criteria. It supports `surface` and `suppress` rules, with automated learning from user dismissals.
-   **Inbox Triage — Autonomous Classification:** An AI-powered system that classifies deliverables every 3 minutes, automatically handling routine items or escalating those requiring user attention.
-   **Jarvis Ego — Self-Awareness & Performance Tracking:** Jarvis tracks its own actions and outcomes, generating weekly self-reports on performance metrics like completion and engagement rates. It uses this data for self-correction and to update its "Soul" (self-knowledge).
-   **Capability Module System:** A modular architecture where functional domains (e.g., calendar, email, research, browser, daemon, code) are encapsulated as independent capability modules. This allows for dynamic tool integration and validation.
-   **Curiosity Scanner:** A background service that proactively learns about the user by analyzing upcoming calendar events and recent emails, generating curious questions to gather more profile facts.
-   **User Skills:** Allows users to install or author custom "skills" (reusable instruction sets) that Jarvis follows every session, enhancing personalization. Built-in skills cover common routines, and custom skills can be defined via a UI.
-   **GitHub Integration:** Connects to GitHub via OAuth Device Flow or Personal Access Tokens to monitor pull requests and CI status, with tools for listing, getting, and merging PRs.
-   **Jarvis Self-Inspection & Code Proposals:** Jarvis can read its own source code, reason about it, propose targeted improvements, and apply approved changes through a user-controlled approval gate, ensuring secure and audited self-modification.
-   **Skill Curator:** Automatically detects habits and recurring patterns from orchestration traces and interaction logs, proposing them as permanent skills for user review and activation.
-   **JARVIS COMMAND — Next.js Mission Control Dashboard:** A separate Next.js 16 web dashboard providing a desktop-class Mission Control interface. It includes Kanban boards for tasks, a calendar, project goal tracking, a searchable memory viewer, and a visual office for agents.

## External Dependencies
-   **AI Services:** OpenAI (GPT-5-mini, Whisper, TTS "alloy")
-   **Database:** PostgreSQL
-   **ORM:** Drizzle ORM
-   **Authentication:** jsonwebtoken (JWT), expo-auth-session (Google OAuth), Google Identity Services (GIS)
-   **Calendar Integrations:** Google Calendar, Outlook Calendar
-   **Communication Integrations:** Gmail, Slack, Telegram, Twilio (WhatsApp)
-   **UI Icons:** @expo/vector-icons (Ionicons)
-   **Browser Automation:** @playwright/mcp
-   **Code Execution:** Sandboxed Python (via `run_python` tool)
-   **Version Control:** GitHub