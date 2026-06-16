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

Use this map when deciding what to run:

| Area touched | Minimum focused check |
|---|---|
| Provider routing, model selection, OpenAI-compatible providers, or ChatGPT subscription path | `npx tsx server/agent/__tests__/providerEnv.assert.ts`, `npx tsx server/agent/__tests__/modelRouter.assert.ts`, plus the nearest provider-specific test |
| OpenAI provider auth or hosted provider setup | `npx tsx server/agent/__tests__/openaiProviderAuthRoutes.assert.ts`, `npx tsx server/agent/__tests__/openaiProviderAuthRuntime.assert.ts` |
| Android daemon permissions, update URLs, APK download behavior, or daemon pairing | `node scripts/__tests__/androidDaemonUpdateConfig.test.mjs` |
| Desktop connector permissions, sidecar launch, local shell/file access, or watchdog behavior | `node scripts/__tests__/desktopConnectorTauriConfig.test.mjs`, `node scripts/__tests__/desktopDaemonWatchdog.test.mjs` |
| Settings UI provider controls, runtime diagnostics, or account/provider setup | `npx tsx server/agent/__tests__/webchatProviderSettings.assert.ts`, `npx tsx lib/__tests__/runtimeDiagnosticsUx.assert.ts` |
| Storage helpers in `lib/storage.ts` | Add or update a focused `lib/__tests__/storage*.assert.ts` test before changing behavior, then run it directly. |
| Memory, SOUL, G-Brain, context building, retrieval, or memory review | Run the nearest `server/memory/__tests__/*` or `server/agent/__tests__/memory*.assert.ts` test and document any database requirement. |
| Approval gates, external actions, tool permissions, or worker approval checkpoints | `npx tsx server/agent/__tests__/toolExecutionPolicy.assert.ts`, `npx tsx server/agent/__tests__/systemApprovalGate.assert.ts`, plus the nearest runtime approval test |
| Dashboard UI or dashboard API proxy behavior | `npm --prefix dashboard run build` |
| Public docs, contributor flow, screenshots, README, downloads, roadmap, or GitHub templates | `npm run docs:audit` |

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
