# Contributing to GamePlan / Jarvis

Thanks for your interest in contributing! GamePlan (a.k.a. Jarvis) is an
autonomous personal-assistant OS. We welcome bug reports, fixes, docs,
and ideas — but please read this guide first so your work has the
best chance of landing.

## Code of conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md).
By participating, you agree to uphold it.

## Project layout

This is a multi-surface codebase. Before you start, understand what's where:

| Path | What lives there |
|---|---|
| `app/` | Expo Router mobile/web app (React Native + expo-router) |
| `components/` | Shared UI components used by `app/` |
| `lib/` | Client-side helpers (auth, storage, notifications) |
| `server/` | Express.js backend, agent harness, integrations, DB |
| `server/agent/` | Agent runtime: tools, jobs, approvals, model routing |
| `server/memory/` | Memory retrieval, extraction, SOUL context |
| `server/channels/` | Telegram / Discord / Slack / WhatsApp integrations |
| `server/routes/` | Focused HTTP route modules (the modern layout) |
| `shared/schema.ts` | Drizzle ORM schema — the single source of truth for the DB |
| `dashboard/` | Next.js 16 Mission Control web dashboard |
| `desktop-connector/` | Tauri-based desktop connector (sandboxed shell/file/browser) |
| `daemon/` | Standalone Node.js desktop daemon (WebSocket-paired) |
| `android-daemon/` | Android Studio project for the APK |
| `migrations/` | Raw SQL migrations applied via Drizzle |
| `docs/` | Architecture, operations, and roadmap docs |
| `agents/` | Agent role contracts (PRIME, ROUTING, COACHING, …) |
| `AGENTS.md` | Repo-wide contract every agent (human or AI) reads first |
| `SOUL.md` | Jarvis identity / personality kernel |

## Before you write code

1. **Read [`AGENTS.md`](./AGENTS.md)** — it defines the workflow, safety
   boundaries, and approval rules every change must respect.
2. **Skim [`docs/architecture.md`](./docs/architecture.md)** and
   [`docs/workspace-map.md`](./docs/workspace-map.md)** — they'll save
   you from re-inventing the routing/auth/persistence layers.
3. **Search existing issues and PRs** to make sure the work isn't
   already in flight. If a similar PR exists, consider collaborating
   instead of duplicating.
4. **For non-trivial changes, open an issue first** describing:
   - The problem
   - The proposed approach
   - The risk
   This gives maintainers a chance to redirect before you invest time.

## Local development

### Prerequisites

- **Node.js 22.x** (see `.nvmrc`) and **npm 10.x**
- **PostgreSQL 16+** (local install or Docker)
- **Python 3.11+** (for the Nix/Replit shell, yt-dlp, and a few
  scripts in `scripts/`)
- On macOS, the Xcode command-line tools (`xcode-select --install`)
- On Linux, the deps listed in `replit.nix` (or use the Dockerfile)

### First run

```bash
# 1. Clone
git clone https://github.com/battlesbudz/Gameplanjarvisai.git
cd Gameplanjarvisai

# 2. Install deps (postinstall runs patch-package on 4 patches)
npm install

# 3. Configure env
cp .env.example .env
# …fill in DATABASE_URL, OPENAI_API_KEY, GOOGLE_* at minimum

# 4. Apply DB migrations
npm run db:push

# 5. Start the dev servers (three of them)
npm run server:dev        # Express on :5000
npm run expo:dev          # Metro bundler on :8081 (mobile/web)
cd dashboard && npm run dev  # Next.js dashboard on :3001
```

### Verifying your change

Before opening a PR, run:

```bash
npm run lint              # eslint
npm run server:build      # esbuild server bundle (catches type errors)
npm test                  # agent + script tests
npm run jarvis:doctor     # health / readiness check
```

If any of these fail locally, the PR CI will fail. Fix them first.

## How to write a good PR

- **One concern per PR.** Don't bundle a refactor with a feature with
  a doc rewrite. Smaller PRs land faster and are easier to revert.
- **Branch from `codex/replit-main-continuation`** (the active dev branch)
  unless the change is hotfix-only.
- **Match the existing style** in the file you're editing. We have
  ESLint configured but not Prettier; follow the patterns in neighboring
  files.
- **TypeScript strict mode is on** (`tsconfig.json` extends
  `expo/tsconfig.base` with `"strict": true`). No `any` unless there's
  a really good reason and a comment explaining why.
- **Don't commit secrets.** `.env`, `*.pem`, `*.jks`, `*.key` are all
  gitignored — keep it that way.
- **Don't commit build output.** `server_dist/`, `dist/`, `.expo/`,
  `web-build/`, `static-build/`, `attached_assets/`, `node_modules/`
  are gitignored. CI will yell at you if you bypass that.
- **Don't edit files in `server/integrations/` without prior
  discussion** — they wrap third-party APIs and the rate-limit /
  error-handling logic is load-bearing.
- **Schema changes** (`shared/schema.ts` + a new `migrations/NNNN_*.sql`)
  are high-impact. Always include both a forward migration and a note
  in the PR description about rollback.

## Commit messages

We don't enforce a strict format, but these conventions help:

```
<scope>(<area>): <one-line summary>

<body — explain WHY, not just what>

Refs: #123
```

Examples:

- `feat(agent): add Brave Search fallback for web_search tool`
- `fix(telegram): handle long replies with chunked sends`
- `docs(readme): document the OAuth callback flow`
- `chore(gitignore): untrack server_dist/`

## Safety-sensitive areas

These files are higher-risk and PRs touching them get closer review:

- `server/auth.ts`, `server/mobileAuthRoutes.ts`, `server/oauthRoutes.ts`
- `server/memory/` (anything that rewrites durable memory)
- `server/agent/agentPermissions.ts`, `server/agent/agentApproval.ts`
- `server/daemon/`, `daemon/`, `desktop-connector/`
- `shared/schema.ts` (DB schema)
- Any `*deploy*` or `*railway*` script
- `migrations/*.sql`

If your change touches one of these, expect a maintainer to ask
"how did you test this" and "how do you roll it back". Have an answer.

## Security

Please **do not** file public issues for security bugs. See
[`SECURITY.md`](./SECURITY.md) for the disclosure policy.

## Questions?

Open a discussion or drop a note in the relevant issue. There are no
stupid questions.
