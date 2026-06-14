# Contributing to Jarvis OS

Jarvis OS is a personal AI operating system with real integrations, durable memory, background workers, approval gates, and optional device connectors. Contributions are welcome, but changes must preserve the safety model and be small enough to review.

## Good First Contributions

- Documentation fixes and setup clarifications
- Focused tests around existing routes, tools, provider routing, memory behavior, or connector permissions
- Bug fixes with a clear reproduction
- Small UX improvements that do not change safety boundaries
- Deployment/readiness improvements for Railway, Expo, Android, or local development

For larger features, open an issue first. Explain the user problem, expected behavior, risk, and proposed acceptance checks.

## Development Setup

Prerequisites:

- Node.js 22.x and npm 10.x
- PostgreSQL 16+
- A local `.env` based on `.env.example`
- Optional provider/channel credentials for the specific feature you are testing

Start the server:

```bash
npm install
npm run db:push
npm run server:dev
```

Start the Expo app:

```bash
npm run expo:dev
```

Start the dashboard:

```bash
cd dashboard
npm install
npm run dev
```

## Project Orientation

Before changing code, read:

- [`README.md`](README.md) for the product and hosting overview
- [`docs/architecture.md`](docs/architecture.md) for system boundaries
- [`docs/workspace-map.md`](docs/workspace-map.md) for code ownership
- [`docs/operations/jarvis-os-runbook.md`](docs/operations/jarvis-os-runbook.md) for runtime checks
- [`SECURITY.md`](SECURITY.md) for the safety model

## Branches

Branch from `main`:

```bash
git checkout main
git pull origin main
git checkout -b fix/short-description
```

Keep branches scoped. Avoid mixing docs, refactors, behavior changes, and dependency updates in one PR unless they are directly connected.

## Safety Rules

Do not:

- Commit `.env`, tokens, keystores, database dumps, logs with secrets, or generated private artifacts.
- Weaken approval gates for email sends, calendar writes, public posts, purchases, deploys, daemon actions, memory rewrites, or code changes.
- Add automatic pushing, deployment, or destructive host-device behavior.
- Route ChatGPT subscription work around the desktop connector/Codex OAuth safety path.
- Change daemon or Android permissions without focused tests.

If your change touches provider routing, daemon permissions, Android control, settings UI, storage, approval gates, or memory behavior, add or update targeted assertions.

## Verification

Run the narrowest relevant checks first, then the broader checks when the change is ready:

```bash
npm run server:build
npm run jarvis:doctor
npm test
```

Dashboard changes:

```bash
cd dashboard
npm run build
```

Android/connector changes may require emulator, Gradle, or desktop connector checks. Document anything you could not run.

## Pull Requests

Every PR should include:

- What changed
- Why it changed
- User-visible behavior
- Safety/approval impact
- Tests or checks run
- Remaining risk

Prefer draft PRs for broad changes. Keep final PRs reviewable and do not mark speculative work as production-ready.
