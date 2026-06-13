# GamePlan / Jarvis AI 🧠⚡

<div align="center">
  <p><strong>Your Autonomous Personal AI Assistant for Productivity, Communication, and Executive Function</strong></p>
</div>

GamePlan (powered by the **Jarvis** autonomous agent) is a full-stack, multi-channel AI assistant designed to act on your behalf. Inspired by OpenClaw's architecture, Jarvis goes beyond reactive chat—it is a proactive, self-improving agent that manages your inbox, calendar, and daily routines, all while adapting to your unique personality and goals.

## 🚀 Key Features

- **Multi-Channel Presence:** Interact with Jarvis seamlessly via **Telegram, Slack, WhatsApp, Discord, or Web Chat**.
- **Autonomous Action Engine:** Jarvis doesn't just answer questions; it calls tools in a loop to perform real-world tasks like drafting emails, triaging your inbox, and conducting web research.
- **Proactive Executive Function:** Built with ADHD-friendly coaching in mind, featuring morning plan auto-generation, 30-minute curiosity scanners, and energy-aware task sequencing.
- **Deep Integrations:** Native connections to Gmail, Google Calendar, Outlook, and GitHub.
- **Inbox Triage Engine:** An autonomous background service that classifies deliverables every 3 minutes, handling routine items or escalating what needs your attention.
- **Self-Improving Memory:** Jarvis builds a structured user profile (personality, values, goals) from conversations and uses it to update its own "Soul" prompt.
- **Mobile First:** Built with React Native and Expo for a native mobile experience, alongside a Next.js desktop Mission Control dashboard.

## 🛠️ Tech Stack

- **Frontend:** React Native (Expo), React, TailwindCSS
- **Backend:** Node.js, Express, TypeScript
- **Database:** PostgreSQL with Drizzle ORM
- **AI/LLM:** OpenAI (GPT-4o/GPT-5-mini, Whisper, TTS Alloy)
- **Integrations:** Google APIs (Gmail, Calendar, Drive), Slack API, Telegram Bot API, GitHub API

## 📂 Project Structure

```text
├── app/               # React Native (Expo Router) frontend application
├── server/            # Express backend, Agent logic, and Integrations
├── shared/            # Shared TypeScript schemas and models (Drizzle)
├── dashboard/         # Next.js Mission Control dashboard
├── daemon/            # Background worker and local execution environment
└── JARVIS_ROADMAP.md  # Detailed project roadmap and status
```

## 🧠 The Jarvis Architecture

Jarvis operates on an **Agent Loop** (`server/agent/`). When triggered by a webhook, cron job, or direct message, Jarvis:
1. Gathers context from its long-term memory (`server/memory/`).
2. Evaluates the user's current emotional state and goals.
3. Enters a tool-calling loop, utilizing capabilities like `Gmail`, `Tavily Search`, or `Calendar`.
4. Executes actions autonomously or asks for permission if required by its configured `Soul`.

## 🤝 Contributing

Contributions are welcome! Please check out the [Issues](https://github.com/battlesbudz/Gameplanjarvisai/issues) tab or open a Pull Request.
1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📜 License

Distributed under the MIT License. See `LICENSE` for more information.
