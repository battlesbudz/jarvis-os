# Jarvis OS Workspace Map

## Purpose

This is the public contributor map for the Jarvis OS repository. It explains where product code, runtime behavior, docs, and deployment assets live without exposing deployment-specific private workspace content.

## Routing Order For Contributors

1. Read `README.md` for product shape and setup.
2. Read `docs/architecture.md` for runtime boundaries.
3. Read this map to choose the smallest owning area.
4. Read nearby code and tests before changing behavior.
5. Check `SECURITY.md` and `CONTRIBUTING.md` before touching provider routing, approvals, memory, connectors, channels, deployment, or device permissions.

## Top-Level Index

| Area | Purpose | Read First | Typical Changes | Sensitivity |
|---|---|---|---|---|
| `app/`, `components/`, `lib/`, `hooks/`, `constants/` | Expo mobile/web app | nearest screen or component | UI, navigation, client helpers | High when auth, settings, memory, device, or provider UI changes |
| `dashboard/` | Next.js dashboard | `dashboard/README.md` | task, project, memory, calendar, visual-office dashboard views | High when actions affect accounts, memory, approvals, or devices |
| `server/` | Express runtime | nearby route/module file | API routes, auth, integrations, channel handling | High |
| `server/agent/` | Agent harness and autonomy | `server/agent/harness.ts`, nearby tool/policy files | tools, jobs, workers, approvals, model routing | Very high |
| `server/memory/` | Memory OS and prompt context | nearby memory module | retrieval, memory writes, SOUL/G-Brain context | Very high |
| `server/channels/` | External channel adapters | channel-specific adapter | Telegram, Discord, Slack, WhatsApp, in-app/web chat | High |
| `server/daemon/`, `daemon/`, `desktop-connector/`, `android-daemon/` | Desktop and Android connectors | connector-specific docs/code | pairing, local shell/file/device actions, APKs | Very high |
| `shared/` | Drizzle schema and shared types | `shared/schema.ts` | database schema, shared contracts | Very high |
| `migrations/` | SQL migrations | latest migration | durable database changes | Very high |
| `docs/` | Durable public docs | `docs/README.md` | architecture, setup, operations, roadmap | Medium |
| `.github/` | GitHub automation | workflow/template being edited | issue forms, PR templates, CI, release builds | Medium to high |
| `downloads/` | APK release/download docs | `downloads/README.md` | APK resolution and release instructions | High when artifact paths or signing change |
| `workspaces/` | Optional deployment-specific operating context | deployment owner docs | local context packs or examples | Sensitive if it contains private user/business context |

## Public Workspace Boundary

The public repo should describe the workspace concept generically. It should not publish maintainer-local personal context, business plans, private operating notes, secrets, or machine-specific paths.

Recommended public examples:

- `workspaces/example/daily-command-center/`
- `workspaces/example/business/`
- `workspaces/example/research/`
- `workspaces/example/content-studio/`
- `workspaces/example/personal-life/`

Deployment-specific workspaces can use any naming scheme, but public docs should keep examples generic and scrubbed.

## File Write Boundaries

| File Type | Jarvis Or Contributors May Do | Must Review Before |
|---|---|---|
| Public docs | Clarify setup, safety, architecture, and operations | Publishing private paths, credentials, or maintainer-specific details |
| App/dashboard code | Make scoped UI improvements with tests | Auth, settings, memory, provider, approval, or device-control behavior |
| Server routes | Add/refactor focused routes with targeted checks | Auth, persistence, external actions, or user-visible side effects |
| Agent tools/policies | Add tests first, keep approvals explicit | Any high-risk tool, model routing, memory write, or autonomous action |
| Connector/daemon code | Keep permissions narrow and auditable | Shell/file/device actions, pairing, permissions, update paths |
| Database schema | Use migrations and verification | Production data compatibility |
| Secrets/env files | Update examples only | Real credentials, tokens, keystores, or database URLs |

## Do Not

- Do not store secrets, tokens, local connector state, database dumps, or keystores in source control.
- Do not mix private personal/business workspace details into public docs.
- Do not add automatic sends, deploys, purchases, destructive file operations, or device-control actions without explicit approval gates.
- Do not bypass the desktop connector/Codex OAuth path for ChatGPT subscription use.
- Do not make route, storage, provider, approval, memory, or daemon changes without targeted assertions.

## Maintenance Rule

Update this file when:

- A new top-level subsystem is added.
- Ownership boundaries change.
- A new safety-sensitive area is introduced.
- Public docs begin linking to a new setup, deployment, release, or connector path.
