# The Development Cycle

This is Jarvis's durable workflow for changing his own source code without drifting, breaking production, or losing context. Treat this file as part of the File System as a Brain: when the development loop changes, update this document so future work starts from reality instead of memory.

## Goal

Jarvis should be able to move from idea to verified production change through one repeatable cycle:

1. Understand the request and current repo state.
2. Make a small, scoped source change.
3. Verify locally with tests and builds.
4. Commit and push to GitHub.
5. Deploy through Railway.
6. Test the live app in the browser or API.
7. Check Railway and local gateway logs.
8. Record what changed, what failed, and what remains.

## Source Of Truth

- GitHub repo: `battlesbudz/jarvis-os`
- Working branch: `codex/replit-main-continuation`
- Production host: `https://<jarvis-os-production-url>`
- Railway service: `jarvis-os`
- Railway app service id: `d1267be5-734d-4ba5-adee-994b17dd4d0b`
- Railway environment id: `4b92f062-e163-4af4-be18-7b3a6c19d44f`
- Local Codex OAuth gateway: `http://127.0.0.1:5000`
- Tailscale Funnel gateway: `https://battles-pc.tailf68942.ts.net`

Do not treat memory, chat history, or old plans as more authoritative than the repo plus current Railway state.

## Step 1: Start With Repo Reality

Run:

```powershell
git status --short
git branch --show-current
git log --oneline -5
```

Rules:

- Do not revert unrelated dirty files.
- Do not commit runtime logs, screenshots, local secrets, or generated build output unless explicitly asked.
- Existing untracked runtime files like `jarvis-oauth-gateway.log`, `jarvis-oauth-gateway.err.log`, and Cloudflare screenshots are evidence, not source.

## Step 2: Find The Existing Pattern

Before editing, search for the closest existing implementation:

```powershell
rg -n "keyword or route or tool name" server app shared docs
rg --files
```

Prefer current architecture:

- Express server routes in `server/`
- Drizzle schema in `shared/schema.ts`
- Agent harness, tools, routing, and providers in `server/agent/`
- Expo app screens in `app/`
- Operational docs in `docs/operations/`

## Step 3: Make The Smallest Useful Change

Implement the narrowest change that solves the actual failure or milestone.

Good changes:

- Add a missing route or provider shim.
- Route an AI path through the canonical provider router.
- Seed missing data needed by a foreign key.
- Add an assertion that protects the behavior.
- Update the relevant brain file.

Risky changes:

- Rewriting broad architecture during a setup fix.
- Adding a second brain loop instead of using `server/agent/harness.ts` and routing.
- Hiding failures instead of making them diagnosable.
- Changing Railway/database state without verifying after.

## Step 4: Verify Locally

Run the standard checks:

```powershell
npm.cmd test
npm.cmd run server:build
```

If the change touches database setup, run or inspect the doctor flow:

```powershell
npm.cmd run jarvis:doctor
```

For Codex OAuth gateway work:

```powershell
npm.cmd run jarvis:oauth:gateway -- --check
```

Expected result: tests pass, server build passes, and any doctor warnings are understood and documented.

## Step 5: Keep The Local Gateway Healthy

When production is configured to use Codex OAuth, the desktop gateway must be running.

Preferred setup: install the Windows login task so the gateway auto-starts and restarts if it crashes:

```powershell
npm.cmd run jarvis:oauth:gateway:install-startup
```

Start it:

```powershell
npm.cmd run jarvis:oauth:gateway
```

For foreground supervised mode:

```powershell
npm.cmd run jarvis:oauth:gateway:supervisor
```

If running in the background, verify it listens on port `5000`:

```powershell
Get-NetTCPConnection -LocalPort 5000 -State Listen
```

Verify the public Tailscale Funnel path:

```powershell
curl.exe -sS -w "`nSTATUS=%{http_code}`n" -X POST "https://battles-pc.tailf68942.ts.net/api/codex/provider-turn" -H "Authorization: Bearer <gateway-token>" -H "Content-Type: application/json" --data "{\"prompt\":\"Return exactly: OK\"}"
```

Expected response:

```json
{"content":"OK"}
```

Important: the PC must stay awake, Tailscale must stay running, Funnel must stay enabled, and the local gateway must stay alive.

Later note: revisit the phone-device side separately. The future work is to decide how the Android daemon, Tailscale, and phone Jarvis should coordinate with the desktop gateway without trying to make the phone tunnel directly into the ChatGPT app.

## Step 6: Commit And Push

Only commit source/docs/config changes that belong to the task.

```powershell
git status --short
git add <changed-source-files>
git commit -m "Short imperative summary"
git push
```

Before pushing, check that unwanted files are not staged:

```powershell
git diff --cached --name-only
```

Do not commit:

- `.env.local`
- gateway logs
- screenshots
- `server_dist/index.js` unless intentionally tracking generated output
- temporary browser or Railway debug artifacts

## Step 7: Deploy On Railway

For deterministic deploys from the current local repo:

```powershell
$env:RAILWAY_CALLER='skill:use-railway@1.2.1'
$env:RAILWAY_AGENT_SESSION='railway-skill-YYYYMMDD-purpose'
railway.cmd up --detach --service d1267be5-734d-4ba5-adee-994b17dd4d0b --environment 4b92f062-e163-4af4-be18-7b3a6c19d44f --message "Deploy summary"
```

Then poll:

```powershell
railway.cmd deployment list --service d1267be5-734d-4ba5-adee-994b17dd4d0b --environment 4b92f062-e163-4af4-be18-7b3a6c19d44f --limit 3 --json
```

Expected result: latest intended deployment reaches `SUCCESS`.

## Step 8: Read Railway Logs

Check runtime logs after every deploy:

```powershell
railway.cmd logs --service d1267be5-734d-4ba5-adee-994b17dd4d0b --environment 4b92f062-e163-4af4-be18-7b3a6c19d44f --lines 160
```

Look for:

- Startup doctor result.
- Provider route lines, especially `chatgpt-codex-oauth`.
- Database migration prompts or constraint errors.
- Session persistence errors.
- Tool or integration degradation.

Known acceptable warnings:

- Missing Telegram or Discord token if those channels are intentionally unconfigured.
- Gmail invalid credentials when Google OAuth needs reconnecting.
- Chromium unavailable on Railway if browser automation is not required in that deployment.

Known not acceptable:

- `spawn codex ENOENT` in Railway.
- `Codex gateway returned 502` after the local gateway is supposed to be online.
- Drizzle waiting on an interactive schema prompt.
- Foreign key errors during normal app chat.
- Production chat returning `Failed to get coach response`.

## Step 9: Test The Live App

Preferred API smoke test for app chat:

```powershell
curl.exe -sS -N -m 240 -X POST "https://<jarvis-os-production-url>/api/coach/chat" -H "Authorization: Bearer <valid-user-token>" -H "Content-Type: application/json" --data "{\"messages\":[{\"role\":\"user\",\"content\":\"Please reply with exactly: LIVE_CHAT_OK\"}],\"coachingMode\":\"sharp\",\"originChannel\":\"appchat\"}"
```

Expected stream:

```text
data: {"content":"LIVE_CHAT_OK"}
data: {"type":"session_init","sdkSessionId":"..."}
data: [DONE]
```

Browser smoke test:

1. Open the production app.
2. Log in if needed.
3. Click the Jarvis tab.
4. Send a basic prompt.
5. Confirm the response appears.
6. Check Railway logs for hidden errors.

## Step 10: Fix Immediately If Verification Fails

Use the failure evidence, not guesses.

Examples:

- `502` from Codex gateway: check local gateway process, Tailscale Funnel, and gateway token.
- Groq `413`: context/tool schema is too large; trim or use the Codex router path.
- Gmail `401`: user needs OAuth reconnect; do not treat as main brain failure.
- Session FK error: seed or use a real agent id.
- Drizzle prompt: inspect data, add safe constraints manually when clean, or make migration non-interactive.

After fixing, repeat the cycle from local verification onward.

## Step 11: Update The Brain

At the end of any meaningful development cycle, update the relevant markdown file:

- `docs/operations/The Development Cycle.md` for workflow changes.
- `docs/operations/jarvis-os-runbook.md` for operational recovery.
- `docs/architecture.md` for architecture changes.
- `docs/superpowers/plans/2026-05-15-jarvis-os-foundation.md` for foundation-plan status.
- `docs/decision-log.md` for important choices and tradeoffs.

The final report should include:

- What changed.
- What was verified.
- What is still degraded.
- What should happen next.

## Current Hybrid Codex Loop

The current best path is:

```text
Jarvis app on Railway
  -> model router selects chatgpt-codex-oauth
  -> Railway calls Tailscale Funnel URL
  -> local desktop gateway receives /api/codex/provider-turn
  -> local gateway runs Codex through the logged-in ChatGPT/Codex account
  -> response returns to Railway
  -> Jarvis streams the answer back to the app
```

This gives Jarvis Codex as the main brain while keeping the app available from the cloud. It is powerful, but it depends on the desktop gateway being online.

## Definition Of Done

A change is done when:

- Source change is committed and pushed.
- Local tests pass.
- Server build passes.
- Railway deploy is `SUCCESS`.
- Live app or API smoke test passes.
- Logs show no new critical errors.
- Any remaining warnings are named clearly.
- The relevant brain file is updated.
