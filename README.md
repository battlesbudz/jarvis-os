# Jarvis OS

<div align="center">
  <p><strong>Your autonomous personal AI assistant for productivity, communication, and executive function.</strong></p>
</div>

Jarvis OS is a full-stack, multi-channel AI assistant designed to act on your behalf. Jarvis goes beyond reactive chat: it is a proactive, self-improving agent that manages your inbox, calendar, and daily routines while adapting to your personality, goals, and working style.

## Key Features

- **Multi-channel presence:** Interact with Jarvis through Telegram, Slack, WhatsApp, Discord, or web chat.
- **Autonomous action engine:** Jarvis calls tools in a loop to perform real-world tasks like drafting emails, triaging your inbox, and conducting web research.
- **Proactive executive function:** ADHD-friendly coaching with morning plan generation, curiosity scanners, and energy-aware task sequencing.
- **Deep integrations:** Native connections to Gmail, Google Calendar, Outlook, and GitHub.
- **Inbox triage engine:** A background service classifies deliverables, handles routine items, and escalates what needs attention.
- **Self-improving memory:** Jarvis builds a structured user profile from conversations and uses it to personalize future behavior.
- **Mobile first:** Built with React Native and Expo, with a Next.js Mission Control dashboard.

## Tech Stack

- **Frontend:** React Native, Expo, React, TailwindCSS
- **Backend:** Node.js, Express, TypeScript
- **Database:** PostgreSQL with Drizzle ORM
- **AI/LLM:** OpenAI, Whisper, TTS
- **Integrations:** Google APIs, Slack API, Telegram Bot API, GitHub API

## Project Structure

```text
app/                React Native and Expo Router app
server/             Express backend, agent logic, integrations
shared/             Shared TypeScript schemas and models
dashboard/          Next.js Mission Control dashboard
daemon/             Desktop daemon and local execution bridge
android-daemon/     Android device-control daemon
docs/               Architecture, operations, and roadmap docs
JARVIS_ROADMAP.md   Project roadmap and status
```

## Quick Start

```bash
git clone https://github.com/battlesbudz/jarvis-os.git
cd jarvis-os
npm install
cp .env.example .env
npm run db:push
npm run server:dev
npm run expo:dev
cd dashboard && npm run dev
```

## Architecture

Jarvis operates on an agent loop in `server/agent/`. When triggered by a webhook, cron job, or direct message, Jarvis:

1. Gathers context from long-term memory.
2. Evaluates the user's current state and goals.
3. Enters a tool-calling loop for capabilities like email, calendar, search, and local daemon actions.
4. Executes allowed actions autonomously or asks for approval when required.

## Contributing

Contributions are welcome. Please check the [issues](https://github.com/battlesbudz/jarvis-os/issues) tab or open a pull request.

## License

Distributed under the MIT License. See `LICENSE` for more information.
