# Jarvis OS

Jarvis OS is a self-hostable personal AI operating system. It combines a mobile app, web control surfaces, an Express runtime, a tool-calling agent harness, long-term memory, background workers, approval gates, and optional desktop/Android connectors into one system for running a private assistant that can plan, research, communicate, remember, and act.

This is not a single chatbot wrapper. Jarvis is built around an operating model:

```text
user intent -> routing -> context + memory -> agent/tool harness
            -> approval policy -> execution -> deliverable/log/result
```

The goal is to make useful autonomous work observable and reviewable instead of letting an agent silently mutate accounts, files, devices, or code.

## What Jarvis Can Do

- **Personal command center:** Mobile-first Expo app with web surfaces for chat, profile, settings, goals, inbox, memory review, job status, and deliverables.
- **Agent runtime:** Tool-calling harness with model routing, provider fallback, task-specific agents, quality checks, and controlled background jobs.
- **Long-term memory:** Structured user memories, relationship records, SOUL/context files, G-Brain derived notes, memory review, and retrieval paths for personalization.
- **Autonomous work queue:** Persistent jobs for research, deep research, writing, planning, email drafting, goal decomposition, named-agent work, and build-feature workflows.
- **Reviewable outputs:** Deliverables, approval gates, draft/revise/approve flows, revision lineage, Drive export, and channel notifications.
- **Multi-channel presence:** Telegram, Discord, Slack, WhatsApp, in-app chat, web chat, email/calendar integrations, and external notification routing.
- **Provider routing:** OpenAI-compatible providers, Gemini, OpenRouter-style routing, stored provider profiles, and ChatGPT subscription use through the desktop connector/Codex OAuth path.
- **Desktop and Android control:** Optional Windows desktop connector plus Android daemon for local shell/file operations, screenshots, screen understanding, app navigation, notifications, and wake/talk mode.
- **Safety boundaries:** Approval receipts, tool policies, daemon permissions, forbidden action checks, audit logs, and fail-closed behavior for high-risk actions.
- **Deployment support:** Railway-oriented server deployment, Expo/Android builds, dashboard build, database migrations, and doctor/QA scripts.

## Architecture

```text
app/                 Expo Router mobile/web app
dashboard/           Next.js dashboard and mission-control surface
server/              Express server, auth, runtime, routes, integrations
server/agent/        Agent harness, workers, tools, model routing, approvals
server/channels/     Telegram, Discord, Slack, WhatsApp, webchat, in-app adapters
server/daemon/       Server-side bridge for desktop and Android connectors
server/gateway/      Runtime control plane for status, events, devices, and actions
server/memory/       Memory OS, retrieval, prompt context, derived brain support
shared/              Drizzle schema, shared models, runtime contracts
daemon/              Desktop daemon bridge
desktop-connector/   Packaged desktop connector app
android-daemon/      Android device-control daemon
docs/                Architecture, operations, deployment, and roadmap docs
```

## Requirements

- Node.js 22.x and npm 10.x
- PostgreSQL 16+
- A configured AI provider or ChatGPT subscription path
- Optional: Railway for hosted server deployment
- Optional: Expo/EAS for mobile builds
- Optional: Android Studio/Gradle for Android daemon work
- Optional: Windows PowerShell for desktop connector automation

## Local Setup

```bash
git clone https://github.com/battlesbudz/jarvis-os.git
cd jarvis-os
npm install
cp .env.example .env
npm run db:push
npm run server:dev
```

In another terminal, start the Expo app:

```bash
npm run expo:dev
```

For the dashboard:

```bash
cd dashboard
npm install
npm run dev
```

Run the readiness check:

```bash
npm run jarvis:doctor
```

Run the main assertion suite:

```bash
npm test
```

## Hosting

Jarvis is normally hosted as:

- **Express API/server** on Railway or another Node host
- **PostgreSQL** as the durable database
- **Expo/mobile client** pointed at the public API URL
- **Dashboard** as a separate Next.js app when needed
- **Desktop/Android connectors** paired back to the hosted server through secure pairing flows

Minimum production variables:

- `DATABASE_URL`
- `JWT_SECRET`
- `APP_BASE_URL`
- `EXPO_PUBLIC_DOMAIN`
- At least one AI/provider credential or a working ChatGPT subscription connector path
- Channel secrets only for the channels you enable

See [`docs/railway-setup.md`](docs/railway-setup.md), [`docs/operations/jarvis-os-runbook.md`](docs/operations/jarvis-os-runbook.md), and [`.env.example`](.env.example).

## Safety Model

Jarvis is designed for real accounts and real devices, so high-risk actions must stay gated:

- No automatic email sends, purchases, deploys, public posts, or destructive file operations without an approval path.
- Desktop and Android operations require explicit connector pairing and permissions.
- Secrets belong in `.env`, Railway variables, or provider secret stores, never in source control.
- Code-writing and self-repair tools must remain reviewable and approval-gated.

## Project Status

Jarvis OS is active software, not a polished one-click SaaS template. Many capabilities are implemented and used, but self-hosters should expect to configure providers, database state, OAuth apps, channel webhooks, and connector permissions.

The public `main` branch is the supported branch. See [`JARVIS_ROADMAP.md`](JARVIS_ROADMAP.md) for the current capability map and remaining hardening work.

## Contributing

Bug reports, documentation fixes, tests, and scoped capability improvements are welcome. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`SECURITY.md`](SECURITY.md) before opening a pull request.

## License

Jarvis OS is distributed under the MIT License. See [`LICENSE`](LICENSE).
