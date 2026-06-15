# Self-Hosting Jarvis OS

This guide is the shortest path to a local Jarvis OS install that can start, talk to its database, run the dashboard, and report its own readiness. Optional channels, connectors, APK releases, and production hosting can be added after the core checks pass.

## Prerequisites

- Node.js 22.x and npm 10.x
- PostgreSQL 16+
- Git
- At least one model/provider path:
  - an API key such as `OPENAI_API_KEY`, `GOOGLE_GEMINI_API_KEY`, or an OpenAI-compatible provider key, or
  - a configured ChatGPT subscription connector/Codex OAuth path

## 1. Clone And Install

```bash
git clone https://github.com/battlesbudz/jarvis-os.git
cd jarvis-os
npm install
cp .env.example .env
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp` if needed. Use `npm.cmd` if `npm` is blocked by script execution policy.

## 2. Create A Local Database

Create a database with your preferred Postgres tool. With the standard Postgres CLI:

```bash
createdb jarvis_os_dev
```

Set `DATABASE_URL` in `.env` to match your local credentials:

```text
DATABASE_URL=postgres://postgres:postgres@localhost:5432/jarvis_os_dev
```

If your local username, password, host, port, or database name differ, use those values instead.

## 3. Generate Local Secrets

Generate a persistent JWT secret:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Put the output in `.env`:

```text
JWT_SECRET=replace-with-generated-value
APP_BASE_URL=http://localhost:5000
EXPO_PUBLIC_DOMAIN=localhost:5000
JARVIS_API=http://localhost:5000
DASHBOARD_SECRET=replace-with-another-long-random-value
```

For local development, one provider key is enough to start testing basic model-backed flows. Leave channel secrets blank until you are ready to configure that channel.

## 4. Prepare The Database

```bash
npm run db:push
```

This applies the current schema to the configured database.

## 5. Start The Server

```bash
npm run server:dev
```

The local Express API defaults to `http://localhost:5000`.

## 6. Start The App

In a second terminal:

```bash
npm run expo:dev
```

This starts the Expo development server for the mobile/web app.

## 7. Start The Dashboard

In a third terminal:

```bash
cd dashboard
npm install
npm run dev
```

Open `http://localhost:3001`. The dashboard proxies API calls to `JARVIS_API`, defaulting to `http://localhost:5000`, and uses `DASHBOARD_SECRET` as a bearer token when calling the server.

## 8. Verify The Install

From the repository root:

```bash
npm run jarvis:doctor
npm test
npm run server:build
npm --prefix dashboard run build
```

You are ready for local development when:

- `jarvis:doctor` reports no core blockers.
- The server starts without database connection errors.
- The dashboard build passes.
- Tests pass, with database-specific tests skipped unless you explicitly opt into a test database.

## Optional Next Steps

- Configure Railway or another Node host using `docs/railway-setup.md`.
- Configure channel credentials only for the channels you plan to use.
- Pair the desktop connector or Android daemon only after reviewing `SECURITY.md`.
- Build APK artifacts using `downloads/README.md`.

## Troubleshooting

- If `npm` is blocked on Windows, run the same command with `npm.cmd`.
- If database tests are skipped, that is expected unless `JARVIS_TEST_DATABASE_URL` is set or `JARVIS_RUN_DB_TESTS_WITH_DATABASE_URL=1` is explicitly enabled.
- If the dashboard loads but data calls fail, confirm the server is running, `JARVIS_API` points to the server, and `DASHBOARD_SECRET` matches between the dashboard and server environment.
- If provider-backed chat fails, confirm at least one provider credential or subscription connector path is configured.
