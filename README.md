# GamePlan / Jarvis

> An autonomous personal-assistant OS — adaptive task planning, multi-channel
> AI coach (Telegram / Discord / Slack / WhatsApp / web), computer-use via a
> sandboxed desktop daemon and Android APK, and a self-improving agent loop
> with approval-gated self-modification.

GamePlan (codename **Jarvis**) helps a single user turn scattered thoughts,
emails, calendar events, goals, and files into organized action — with memory
that compounds, a voice that adapts, and a clear audit trail of every
decision the agent makes.

This repository hosts:

- **`app/`** — Expo Router (React Native) mobile + web app
- **`server/`** — Express.js backend with an agent harness, memory layer, and integrations
- **`dashboard/`** — Next.js 16 Mission Control web dashboard
- **`desktop-connector/`** — Tauri-based desktop app (sandboxed shell, file, browser)
- **`daemon/`** — Standalone Node.js desktop daemon (WebSocket-paired)
- **`android-daemon/`** — Android Studio project that builds the device-control APK

## Why this exists

Most AI assistants are stateless chat windows. GamePlan is meant to be
**persistent** — it remembers, it watches for things you said you'd care
about, it drafts replies while you sleep, and it asks for permission before
doing anything irreversible. The product north star is a hardware-agnostic
Jarvis Core that runs across mobile, desktop, web, and ambient devices,
with the same identity, the same memory, and the same safety rules
everywhere.

## Quick start

```bash
# 1. Get the code
git clone https://github.com/battlesbudz/Gameplanjarvisai.git
cd Gameplanjarvisai

# 2. Install deps (Node 22+, npm 10+, PostgreSQL 16+)
nvm use            # or: nvm install
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env — at minimum set DATABASE_URL and OPENAI_API_KEY

# 4. Apply DB migrations
npm run db:push

# 5. Start the three dev processes
npm run server:dev        # Express API on :5000
npm run expo:dev          # Expo Metro bundler on :8081
cd dashboard && npm run dev && cd ..  # Next.js dashboard on :3001
```

Then open the Expo Go app on your phone and scan the QR code from the
Metro output, or visit `http://localhost:8081` in a browser.

## Architecture at a glance

```
                  ┌─────────────────────────────────────────────┐
                  │            Jarvis Core (server/)            │
                  │  ┌─────────┐  ┌──────┐  ┌──────────────┐  │
   Telegram  ───► │  │ Agent   │  │Memory│  │  Inbox Triage │  │
   Discord   ───► │  │ Harness │◄─┤Store │◄─┤  + Heartbeat  │  │
   Slack     ───► │  │ + Tools │  │+SOUL │  │  + Foresight  │  │
   WhatsApp  ───► │  └────┬────┘  └──────┘  └──────────────┘  │
   Web Chat  ───► │       │                                    │
                  │       ▼                                    │
   Expo App  ───► │  ┌─────────┐  ┌──────────┐  ┌───────────┐ │
   Dashboard ───► │  │Postgres │  │  OpenAI  │  │ Composio  │ │
                  │  │(Drizzle)│  │  GPT-5   │  │  Gmail,   │ │
                  │  └─────────┘  │  Whisper │  │  Calendar,│ │
                  │               │  TTS     │  │  Drive, … │ │
                  │               └──────────┘  └───────────┘ │
                  └─────────────────────┬───────────────────────┘
                                        │ WebSocket
                                        ▼
                          ┌──────────────────────────┐
                          │  Desktop Daemon          │
                          │  (sandboxed shell/file)  │
                          └────────────┬─────────────┘
                                       │ ADB / Accessibility
                                       ▼
                          ┌──────────────────────────┐
                          │  Android Daemon (APK)    │
                          │  (notifications, UI)    │
                          └──────────────────────────┘
```

For a deeper walkthrough, see [`docs/architecture.md`](./docs/architecture.md).

## Features

- **Adaptive task sizing** — AI re-estimates task duration based on your
  completion history, energy, and life context.
- **Smart plan generation** — daily plans that account for calendar
  conflicts, inbox signals, and the goals you're working toward.
- **Multi-channel AI coach** — talk to Jarvis on Telegram, Discord, Slack,
  WhatsApp, or the in-app chat. Same personality, same memory everywhere.
- **Memory that compounds** — facts about you, your work, your
  preferences, and your projects are extracted from conversations and
  surfaced contextually. Memories are reviewable, deletable, and
  provenance-aware.
- **Self-improving agent loop** — Jarvis can read its own source code,
  propose targeted improvements, and apply them — gated behind your
  explicit approval.
- **Computer use, sandboxed** — the desktop daemon can run shell commands,
  read/write files, and drive a browser inside a workspace you define. The
  Android daemon can read notifications and interact with apps.
- **Multi-agent** — specialized personas (PRIME, COACH, COUNCIL, and
  user-defined crew members) with isolated memory and tool permissions.
- **Predictions (Jarvis Foresight)** — daily forecasts of energy dips,
  procrastination risk, and inbox load. Validated against your actual day.
- **Inbox triage** — autonomous classification of emails and calendar
  events, with a draft-queue for things needing your voice.

## Configuration

All runtime config is via environment variables. **Start with
[`.env.example`](./.env.example)** — it documents all 212 referenced
variables, grouped into 13 sections. Most are optional; the `[REQUIRED]`
ones will crash the app on boot if missing.

| Category | Required? | Examples |
|---|---|---|
| Core runtime | ✅ | `DATABASE_URL`, `PORT`, `JWT_SECRET` |
| AI providers | ✅ at least one | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` |
| Auth (Google OAuth) | ✅ for sign-in | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Channels | optional | `TELEGRAM_BOT_TOKEN`, `DISCORD_BOT_TOKEN`, `SLACK_BOT_TOKEN`, `TWILIO_*` |
| Composio | optional | `COMPOSIO_API_KEY` |
| Android daemon | optional | `ANDROID_APK_URL`, `JARVIS_APP_KEYSTORE_*` |
| Tailscale / tunnels | optional | `TAILSCALE_AUTHKEY` |
| Media | optional | `YOUTUBE_INNERTUBE_API_KEY`, `TAVILY_API_KEY` |

## Deployment

The codebase supports three deployment targets (you only need one):

| Target | Use when | Setup |
|---|---|---|
| **Railway** (recommended) | Public production deploy | `railway.json` + `nixpacks.toml` + `npm run db:push` |
| **Replit** | Quick iteration, hosted dev | `.replit` + `replit.nix` + Secrets tab |
| **Docker** | Self-host / on-prem | `Dockerfile` (multi-stage) |

For self-hosting, the `Dockerfile` builds the server bundle in one stage
and runs from a slim Node image in the next. See `Dockerfile` for details.

## Development

```bash
npm run lint                  # eslint
npm run server:build          # esbuild server bundle
npm test                      # agent + script smoke tests
npm run jarvis:doctor         # health / readiness check
```

For end-to-end testing with Playwright, see `e2e/jarvis.spec.ts` and the
`playwright.config.ts`.

## Project conventions

- **Read [`AGENTS.md`](./AGENTS.md) first.** It's the workflow contract
  every agent (human or AI) follows when working in this repo. It defines
  the instruction hierarchy, safety boundaries, and Definition of Done.
- **Personality lives in [`SOUL.md`](./SOUL.md).** Don't put workflow /
  routing / tool policy in there.
- **One concern per PR.** Smaller PRs land faster and are easier to revert.
- **No irreversible side effects without approval.** The agent runtime
  enforces this; humans should too.

## Documentation

| Doc | What it covers |
|---|---|
| [`AGENTS.md`](./AGENTS.md) | Repo-wide contract for all agents |
| [`SOUL.md`](./SOUL.md) | Jarvis identity / personality kernel |
| [`JARVIS_ROADMAP.md`](./JARVIS_ROADMAP.md) | Current product direction |
| [`JARVIS_HEARTBEAT.md`](./JARVIS_HEARTBEAT.md) | The background agent loop |
| [`docs/architecture.md`](./docs/architecture.md) | System map |
| [`docs/workspace-map.md`](./docs/workspace-map.md) | Where to write what |
| [`docs/operations/`](./docs/operations) | Runbooks and recovery |
| [`docs/jarvis-wearable-os-master-roadmap.md`](./docs/jarvis-wearable-os-master-roadmap.md) | Long-term spatial/wearable direction |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | How to contribute |
| [`SECURITY.md`](./SECURITY.md) | Vulnerability disclosure |

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). tl;dr:

- Branch from `codex/replit-main-continuation`
- One concern per PR
- Don't edit `server/integrations/` without prior discussion
- Schema changes need a forward migration + a rollback note
- All `process.env.*` access should reference a key documented in
  `.env.example`

## License

[MIT](./LICENSE) © 2026 Battles Budz.

## Acknowledgements

Built on the shoulders of:

- [Expo](https://expo.dev) + [expo-router](https://docs.expo.dev/router/introduction/)
- [Express](https://expressjs.com) + [Drizzle ORM](https://orm.drizzle.team)
- [OpenAI](https://openai.com) (GPT-5-mini, Whisper, TTS)
- [Tauri](https://tauri.app) (desktop connector)
- [Playwright](https://playwright.dev) (browser automation)
- [Composio](https://composio.dev) (third-party tool integrations)
- [React Native](https://reactnative.dev) and a long list of community packages
  (full credit in `package.json`)
