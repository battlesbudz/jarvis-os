# Jarvis OS Dashboard

This is the Next.js mission-control surface for Jarvis OS. It gives maintainers and self-hosters a dense web view over tasks, projects, memory, calendar state, and visual/desktop control surfaces while the main Express runtime owns auth, data, jobs, and integrations.

## What It Shows

- Task queue and scheduled operations
- Project/objective views
- Memory search and detail inspection
- Calendar-oriented operations
- Visual office and connector-oriented controls

The dashboard talks to the Jarvis server through `app/api/proxy/[...path]/route.ts`. Keep data ownership in the Express server unless a dashboard-only concern is truly local UI state.

## Configuration

The dashboard reads:

| Variable | Default | Purpose |
|---|---|---|
| `JARVIS_API` | `http://localhost:5000` | Express server URL used by dashboard server-side API calls and proxy routes. |
| `DASHBOARD_SECRET` | none | Bearer token forwarded to protected Jarvis server endpoints. Set the same value in the dashboard and server environments. |

When run from this repository, the dashboard loads the parent `.env` and `.env.local` before reading these values. If the dashboard renders but data panels fail, first confirm the Express server is running, `JARVIS_API` points to it, and `DASHBOARD_SECRET` matches.

## Local Development

Start the Express server from the repo root first:

```bash
npm run server:dev
```

Then start the dashboard:

```bash
cd dashboard
npm install
npm run dev
```

Open [http://localhost:3001](http://localhost:3001).

The dashboard intentionally uses port `3001` so it can run beside the Expo/web app and Express API during development. It uses the same root `.env` as the Express server unless you explicitly set dashboard-specific environment variables in the shell or host.

## Verification

```bash
npm run build
```

For repo-level validation from the root:

```bash
npm --prefix dashboard run build
```

For a full local check, also run the root server checks:

```bash
npm run jarvis:doctor
npm run server:build
```

## Safety Notes

- Do not put provider keys, OAuth tokens, bot tokens, database URLs, or connector secrets in dashboard code.
- Treat views that expose memory, approvals, device controls, provider routing, or deployment controls as safety-sensitive.
- If a dashboard change adds a new action button, verify the matching server route still enforces auth, permissions, and approval boundaries.
