# Deployed Jarvis QA Report - 2026-05-15

Production URL: https://gameplanjarvisai.up.railway.app

Test account: `battlesbudz@gmail.com`

Railway service: `Gameplanjarvisai` in `production`

Tester note: this was an observe-and-document pass only. No app fixes were made.

Fix note: a first local repair pass was started after this QA report. Items marked "Fixed locally" are source fixes in the branch and still need deployed-browser confirmation after the next push/deploy.

## Scope

This pass tested the deployed app through Chrome where possible, then used authenticated production endpoints to continue chat/tool/background-task testing after the browser automation session became unresponsive during a long chat sweep.

Covered areas:

- Login and deployed app load
- Mission Control tabs: Tasks, Calendar, Projects, Memory, Usage, Visual
- Bottom routes: Jarvis, Agents, Settings, Profile, Inbox, Goals, Scheduled
- Jarvis chat replies
- Chat-triggered tools: self-diagnose, connections, weather, memory search
- Chat-triggered background work: scheduled task creation, writing deliverable creation
- Operational endpoints: doctor, inbox, deliverables, jobs, scheduled tasks, integrations
- Railway application and HTTP logs from the test window

## High-Level Result

Jarvis is online and the core app loads. The doctor endpoint passes with warnings only, app chat can produce answers through the Codex OAuth route, background writing jobs can complete and create a deliverable, and scheduled tasks can be created.

The main problems are integration drift, inconsistent tool behavior, background duplicate handling, provider/usage observability gaps, and production database/schema errors in the vault/wiki writer.

## Test Artifacts Created

The QA pass intentionally created test artifacts:

- Two scheduled tasks titled `Browser QA scheduled probe` for May 16, 2026 at 9:37 AM America/New_York.
- One pending deliverable titled `Browser QA Probe Deliverable`.
- Several chat messages and memory extraction entries containing `Browser QA`.

The duplicate scheduled task happened because an earlier browser-driven chat sweep timed out from the automation side but continued running on the server, then the endpoint-level retry created another copy.

## What Worked

- Production app loaded and authenticated once a valid token was supplied.
- Mission Control, Calendar, Projects, Memory, Usage, Visual, Agents, Settings, Profile, Inbox, Goals, and Scheduled routes all rendered.
- `/api/doctor` returned `pass: 5`, `warn: 6`, `fail: 0`.
- `/api/auth/me`, `/api/agents`, `/api/inbox/items`, `/api/deliverables`, `/api/projects`, `/api/memories`, `/api/commitments`, `/api/calendar/status`, `/api/gmail/status`, `/api/discord/status`, `/api/slack/status`, `/api/jarvis/scheduled-tasks`, `/api/agent-jobs`, and `/api/agent-jobs/active` responded.
- Chat provider routing logs showed `provider=chatgpt-codex-oauth model=chatgpt-codex-oauth/auto`.
- Connection-status chat request returned a concise status list.
- Self-diagnose chat request returned a useful top-issues summary.
- Background writing job completed and produced a pending deliverable.
- Scheduled task creation worked.

## Findings

### 1. Google sign-in pop-up failed in Chrome

Severity: P1

Evidence:

- Login screen showed session expired.
- Browser console logged Google Identity Services pop-up failures: `Failed to open popup window... Maybe blocked by the browser?`
- UI warning said Google sign-in did not finish and the browser may have blocked the pop-up.

Impact:

Users can get stuck at login unless an existing session is already valid or another auth path is used.

Suggested future fix:

Review the web login flow and consider using the existing mobile/start callback flow or a redirect-based Google OAuth path for web, instead of depending on a pop-up.

### 2. Chat Enter key did not send reliably in the browser UI

Severity: P2

Evidence:

- Prompts submitted with `Enter` stayed in the textarea.
- The send icon submitted successfully.
- A later send-icon probe returned `QA_SEND_OK`.

Impact:

Users may think Jarvis is broken if they press Enter and nothing happens.

Suggested future fix:

Make Enter submit on desktop web, with Shift+Enter for newline.

### 3. Old chat failures remain visually noisy and make current responses hard to inspect

Severity: P2

Evidence:

- Jarvis chat history contains many old `Failed to get coach response` entries.
- The latest successful reply was present, but the page body text and visible chat history were dominated by older failed messages and open commitments.
- The Open Commitments list can hide the active chat until collapsed.

Impact:

It is hard to tell whether the current request worked, especially during QA or normal troubleshooting.

Suggested future fix:

Improve latest-message anchoring, collapse state persistence, and failure grouping.

### 4. Usage dashboard does not clearly show Codex OAuth chat usage

Severity: P1

Evidence:

- Usage tab showed `gpt-4o-mini`/OpenAI JobQueue calls.
- Railway logs during the same test window showed chat routing through `chatgpt-codex-oauth/auto`.
- JobQueue logs also include mixed labels, for example `provider=openai model=gpt-4o-mini` followed by router patch lines for Codex OAuth.

Impact:

The app can appear to be using the wrong brain even when Railway logs show Codex OAuth routing.

Suggested future fix:

Normalize model usage telemetry so Codex OAuth, fallback provider, original requested model, and final executed provider are all visible in the Usage tab.

### 5. Integration status is inconsistent across surfaces

Severity: P1

Evidence:

- Settings displayed Telegram and Discord as connected.
- Doctor warned `TELEGRAM_BOT_TOKEN is not set` and `DISCORD_BOT_TOKEN is not set`.
- Agent heartbeat logs reported `platform_dead=discord reason=DISCORD_BOT_TOKEN not configured` and `platform_dead=telegram reason=Telegram not configured`.
- `/api/discord/status` returned connected true for the user account, while bot-level Discord is not configured.
- Google/Gmail/Calendar are shown as disconnected in status endpoints, while some app-load logs showed `/api/calendar/google/events` returning `connected:true`.
- Inbox contains a high-priority alert saying Google integration is disconnected due to expired token.

Impact:

Jarvis can tell the user a channel is connected while the actual bot/tool path cannot run.

Suggested future fix:

Separate user account connection status from server capability readiness. The UI should show both "account linked" and "bot/tool runnable."

### 6. Weather tool failed a basic New York City request

Severity: P2

Evidence:

Prompt:

`Browser QA weather tool probe QA_WEATHER_DONE: use your weather tool to get tomorrow forecast for New York City.`

Response:

`Weather lookup failed: I couldn't find a weather location matching "New York, NY". Try a nearby city/state or a more specific borough like Manhattan, NY.`

Impact:

A common weather request fails even though the weather capability is available conceptually.

Suggested future fix:

Improve weather location normalization for common city names and aliases, especially `New York City`, `NYC`, and `New York, NY`.

### 7. Memory search found results in logs but the user-facing reply said no direct results

Severity: P2

Evidence:

- Prompt asked Jarvis to search memory for `router works` or `embeddings skipped`.
- Railway log: `[appchat] memory_search "router works embeddings skipped" ? 10 result(s)`.
- User-facing response: `I found no direct memory entries for "router works" or "embeddings skipped"...`
- Memory tab visibly showed entries for `Router works`, `Suggestions routed`, and `Embeddings skipped`.

Impact:

The memory tool can retrieve data, but the assistant may summarize it incorrectly.

Suggested future fix:

Inspect memory search result formatting passed into the harness and add a test that verifies exact visible memory entries can be reported back.

### 8. Scheduled task creation allows duplicate identical tasks

Severity: P2

Evidence:

- Two `Browser QA scheduled probe` tasks were created for the same user, title, and scheduled time.
- This happened because a timed-out browser chat request continued server-side and the endpoint retry created a second task.

Impact:

Retries or network timeouts can duplicate reminders/background tasks.

Suggested future fix:

Add idempotency or duplicate detection for scheduled task creation, probably by user/title/scheduledAt/time window.

### 9. Deliverable creation works, but the chat gate can produce false disambiguation

Severity: P2

Evidence:

- A background writing job completed and created `Browser QA Probe Deliverable`.
- A later direct deliverable prompt returned: `I'm about to search for "Create," which looks similar to "creative," a project I have in your profile...`

Impact:

Simple deliverable creation can be interrupted by unrelated entity matching.

Suggested future fix:

Tune entity disambiguation so command verbs like "create" are not matched against profile/project names.

### 10. Deliverable verification failed with invalid API key

Severity: P1

Evidence from Railway logs:

`[JobQueue] verify unknown (timeout/error) for job ... verify_error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}`

Impact:

Deliverables can still be created, but verification status is null/unknown. This weakens the review queue and can hide real quality failures.

Suggested future fix:

Route deliverable verification through the same provider router/Codex OAuth path or configure the verifier key correctly.

### 11. Vault/wiki writes are failing due to a missing database constraint

Severity: P1

Evidence from Railway logs:

- `[Vault] updateWikiPage("jarvis-internal-logs") failed: error: there is no unique or exclusion constraint matching the ON CONFLICT specification`
- `[Vault] generateWikiIndex failed: error: there is no unique or exclusion constraint matching the ON CONFLICT specification`

Impact:

The "file system as brain" / vault wiki layer is not reliably persisting updates.

Suggested future fix:

Audit the vault/wiki table schema and add the unique constraint expected by the ON CONFLICT clause.

### 12. Provider health endpoint is unavailable

Severity: P2

Evidence:

`GET /api/admin/provider-health` returned `503` with `Admin secret not configured on this server.`

Impact:

Operational provider checks cannot be used in production unless the admin secret is configured.

Suggested future fix:

Either configure the admin secret or expose a non-secret read-only provider summary that is safe for the authenticated owner.

### 13. Memory tab displays impossible confidence percentages

Severity: P3

Evidence:

Memory tab showed entries with `5000%`.

Impact:

This makes memory quality look broken or unserious, even if the stored data is usable.

Suggested future fix:

Normalize confidence display. If stored confidence is `50`, show `50%`; if stored as `0.5`, show `50%`.

### 14. Agent status is split between "active" and "disabled/standby"

Severity: P2

Evidence:

- Agents route showed `4 active`.
- Visual route showed rooms as `STANDBY`, `next: disabled`.
- Doctor and heartbeat logs show Telegram/Discord bot capabilities are not configured.

Impact:

The app implies agents are active while their runtime channels may not actually execute.

Suggested future fix:

Make agent cards distinguish "agent definition exists", "agent enabled", "channel configured", and "heartbeat runnable."

### 15. Web app emits pre-auth 401 migration errors

Severity: P3

Evidence:

Console logged `[storage] runMigrations failed: Error: API error: 401` while the session was expired.

Impact:

Probably not user-visible after login, but it adds noise and can mask real web startup errors.

Suggested future fix:

Skip authenticated migrations until auth is known, or downgrade expected pre-auth 401s to debug-level logs.

### 16. Browser automation froze during a long chat sweep

Severity: QA limitation, not confirmed app bug

Evidence:

- A long Chrome automation call timed out and the browser automation channel stopped responding.
- Server-side work from that timed-out sweep continued and created real artifacts.

Impact:

Future QA should run chat probes one at a time or use endpoint-level test helpers for long-running tasks.

Suggested future fix:

Build a dedicated QA harness that can send chat prompts, track job IDs, and poll results without depending on UI automation for every long-running operation.

## Doctor Result

Latest doctor result:

- Pass: 5
- Warn: 6
- Fail: 0

Warnings:

- Anthropic key missing.
- Missing integration env vars: Anthropic, Discord bot, Telegram bot, Twilio, Google client secret, Microsoft OAuth, Supadata.
- Telegram channel not configured.
- Discord shared bot not configured.
- WhatsApp channel not configured.
- GitHub, Outlook, Slack, and WhatsApp present but not configured.

## Chat Capability Results

| Probe | Result | Notes |
| --- | --- | --- |
| Exact reply via send icon | Pass | Returned `QA_SEND_OK`. |
| Self diagnose | Pass with warnings | Returned top issues. |
| Connections | Pass with inconsistent underlying status | Reported Google expired/not connected, Telegram linked, Discord linked, daemon not connected. |
| Weather | Fail/degraded | Could not resolve New York City. |
| Memory search | Fail/degraded | Logs showed 10 results, response said no direct results. |
| Schedule task | Pass with duplicate risk | Created duplicate identical QA reminders due retry/timeout. |
| Deliverable creation | Pass with flakiness | Background job created deliverable; later prompt hit false disambiguation. |

## Suggested Serial Sub-Agent Fix Queue

1. Auth and login reliability: fix/replace pop-up Google web sign-in.
2. Integration readiness model: separate account linked vs runnable capability.
3. Provider telemetry: make Usage show Codex OAuth and fallback paths correctly.
4. Weather location normalization.
5. Memory search result grounding.
6. Scheduled-task duplicate/idempotency guard.
7. Deliverable verification provider/key routing.
8. Vault/wiki database constraint for ON CONFLICT.
9. Agent status UI model.
10. Chat UX polish: Enter-to-send, latest-message anchoring, Open Commitments collapse persistence.

## Raw Evidence Locations

Temporary local files from this QA pass, if still present:

- `%TEMP%\\jarvis-qa-chat-results.json`
- `%TEMP%\\jarvis-qa-endpoint-results.json`
- `%TEMP%\\jarvis-qa-job-results.json`
- `%TEMP%\\jarvis-qa-railway-app-logs.jsonl`
- `%TEMP%\\jarvis-qa-railway-http-logs.jsonl`

These files may contain production response data but should not contain secrets. Do not commit them.

## Fix Pass 1 - Local Branch

Date: 2026-05-15

Status: the first batch of deterministic, low-risk fixes is complete locally. The remaining items are the larger integration/provider/UX work that should be handled in serial passes.

| Finding | Status | Local change | Verification |
| --- | --- | --- | --- |
| 2. Chat Enter key did not send reliably | Fixed locally | Desktop web Enter now submits chat; Shift+Enter remains available for newline behavior. | Covered by source review and server/build checks; needs browser confirmation after deploy. |
| 6. Weather tool failed New York City | Fixed locally | Weather lookup now normalizes common NYC aliases and scores geocoding results so `New York, NY` resolves to New York. | `npx.cmd tsx server/agent/__tests__/weatherLookup.test.ts` passed; `npm.cmd test` passed. |
| 7. Memory search reply contradicted retrieved results | Fixed locally | Memory search tool results now explicitly identify retrieved memories as authoritative records, and the Codex OAuth bridge reminds the brain not to contradict successful tool results. | `npm.cmd test` passed; needs deployed chat probe after deploy. |
| 8. Duplicate scheduled tasks | Fixed locally | Scheduled task creation now goes through a shared helper that detects active duplicates by user, normalized title, scheduled time, and recurrence. | `npm.cmd test` passed; endpoint needs production retry confirmation after deploy. |
| 9. False entity disambiguation on "create" | Fixed locally | Entity matching now ignores generic command verbs so `create` does not match `creative`. | `npx.cmd tsx server/agent/__tests__/entityCheck.test.ts` passed with a dummy `DATABASE_URL`; `npm.cmd test` passed. |
| 10. Deliverable verification invalid API key | Fixed locally | Background job verification now routes through the model router instead of the direct Anthropic verifier path, allowing Codex OAuth/fallback providers to handle verification. | `npm.cmd test` and `npm.cmd run server:build` passed; needs Railway job verification confirmation after deploy. |
| 11. Vault/wiki ON CONFLICT missing constraint | Fixed locally | Startup database verification now removes duplicate vault pages and creates the expected unique index on `(user_id, slug)`. | `npm.cmd run server:build` passed; needs Railway startup confirmation after deploy. |
| 13. Memory impossible confidence percentages | Fixed locally | Memory confidence display now treats `0.5` as 50% and `50` as 50%, clamped to 0-100%. | Covered by source review and build checks; needs browser confirmation after deploy. |
| 15. Pre-auth 401 migration noise | Fixed locally | Client migrations now skip authenticated preference reads until an auth token exists. | Covered by source review and build checks; needs logged-out browser confirmation after deploy. |

### Open Queue After Fix Pass 1

1. Auth and login reliability: replace or repair popup-dependent Google web sign-in.
2. Integration readiness model: separate "account linked" from "bot/tool runnable."
3. Provider telemetry: make Usage clearly show Codex OAuth, fallback provider, requested model, and final executed provider.
4. Provider health visibility: configure `ADMIN_SECRET` or expose a safe owner-only provider summary.
5. Agent status UI model: distinguish agent definition, enabled status, channel configured status, and heartbeat runtime status.
6. Chat history polish: latest-message anchoring, old failure grouping, and Open Commitments collapse persistence.
7. QA harness: build endpoint-level probes for long-running chat/tool/background tests.

## Fix Pass 2 - Local Branch

Date: 2026-05-15

Status: deterministic observability and readiness fixes are complete locally. These changes still need a production deploy and browser/API confirmation pass.

| Finding | Status | Local change | Verification |
| --- | --- | --- | --- |
| 4. Usage dashboard does not clearly show Codex OAuth chat usage | Fixed locally | App-chat usage recording now stores the router's executed provider name and fallback flag instead of re-guessing provider from model. The Usage screen also colors Codex/ChatGPT providers distinctly. | `npm.cmd test` passed before the final doc update; `npm.cmd run server:build` passed. Needs deployed Usage-tab confirmation. |
| 5. Integration status is inconsistent across surfaces | Partially fixed locally | `/api/integrations/status` now returns separate `accountLinked`, `serverConfigured`, `capabilityRunnable`, `blockedReason`, and `readiness` fields for each integration while preserving the original status fields. Startup also repairs the missing `integration_status` uniqueness needed by the validator upsert. | `npm.cmd run server:build` passed. Needs Railway startup/API confirmation. |
| 12. Provider health endpoint is unavailable | Fixed locally | Added authenticated owner-safe `GET /api/jarvis/provider-health`, including provider check results, route chains, and Codex OAuth gateway configuration status. The Usage screen now displays this summary without requiring `ADMIN_SECRET`. | `npm.cmd run server:build` passed. Needs deployed endpoint and Usage-tab confirmation. |
| 14. Agent status is split between "active" and "disabled/standby" | Partially fixed locally | Mission Control visual agent cards now distinguish `READY`, `STANDBY`, `PAUSED`, `ACTIVE`, and `ON-DEMAND`; disabled loops no longer display as standby with `next: disabled`. | Needs browser confirmation after deploy. |
| 16. Browser automation froze during a long chat sweep | Fixed locally | Added `npm run jarvis:qa:endpoints`, a token-based deployed endpoint QA harness with optional chat probing through `JARVIS_QA_RUN_CHAT=1`. | Script startup was verified; it exits with setup guidance when `JARVIS_QA_AUTH_TOKEN` is missing. Needs a real authenticated production run after deploy. |

### Open Queue After Fix Pass 2

1. Auth and login reliability: replace or repair popup-dependent Google web sign-in.
2. Agent status UI model: continue wiring channel configured/heartbeat runtime status into the Agents tab, not only Mission Control Visual.
3. Chat history polish: latest-message anchoring, old failure grouping, and Open Commitments collapse persistence.
4. Browser/API confirmation: deploy this branch, run `npm run jarvis:qa:endpoints` with `JARVIS_QA_AUTH_TOKEN`, optionally rerun with `JARVIS_QA_RUN_CHAT=1`, and confirm the Usage tab provider-health card.

## Fix Pass 3 - Local Branch

Date: 2026-05-15

Status: more of the UI-facing QA queue is complete locally. These changes still need deployed-browser confirmation.

| Finding | Status | Local change | Verification |
| --- | --- | --- | --- |
| 1. Google sign-in pop-up failed in Chrome | Code path fixed locally; environment config blocked in production | Web Google login now starts the existing server-side OAuth redirect flow directly instead of using the Google Identity Services popup token flow. A follow-up patch makes the redirect immediate so stale-session cleanup cannot stall the click. | Deployed Chrome confirmation reached Google, but Google rejected the app with `Error 400: redirect_uri_mismatch` for `https://gameplanjarvisai.up.railway.app/api/auth/mobile/callback`. The exact URI must be added to the Google Cloud OAuth client's authorized redirect URIs. |
| 3. Old chat failures remain visually noisy | Partially fixed locally | Jarvis chat now hides older repeated failed-response messages behind a divider, auto-anchors to the newest exchange when sending, and persists the Open Commitments collapsed state. | Needs browser confirmation after deploy. |
| 14. Agent status is split between "active" and "disabled/standby" | Further improved locally | The Agents tab now consumes integration readiness and shows runtime badges like disabled, heartbeat blocked, loop paused, listener, channel ready, or platform blocked on each agent card. | Needs browser confirmation after deploy. |

### Open Queue After Fix Pass 3

1. Browser/API confirmation: deploy this branch, run the authenticated endpoint QA harness, verify Google login from a signed-out Chrome session, and inspect Usage, Agents, Visual, and Jarvis chat.
2. Deeper chat history polish if needed after browser review: grouping by date/session and a manual "show hidden failures" affordance.
3. Continue wiring readiness details into any remaining Settings/Profile surfaces that still only show "connected."

## Fix Pass 4 - Deployed Confirmation

Date: 2026-05-15

Status: deployed to Railway and partially confirmed in Chrome. The app starts, the Google button now enters the redirect flow, and the old database constraint failure is no longer present in startup logs. Full authenticated browser and endpoint QA remains blocked until Google OAuth redirect configuration is corrected or a QA bearer token is provided.

Deployment:

- Railway service: `Gameplanjarvisai`
- Production URL: `https://gameplanjarvisai.up.railway.app`
- Deployment action: `railway up --detach --service Gameplanjarvisai -m "qa: fix web google redirect"`
- Follow-up deployment action: `railway up --detach --service Gameplanjarvisai -m "qa: clarify google oauth readiness"`
- Latest deployment id: `80aeb379-369e-4f81-abaf-1bab05f20935`
- Build and healthcheck: passed

Verification:

| Area | Result | Evidence |
| --- | --- | --- |
| Local tests | Pass | `npm.cmd test` passed. |
| Server bundle | Pass | `npm.cmd run server:build` passed. |
| Diff hygiene | Pass with line-ending warnings only | `git diff --check` reported CRLF warnings but no whitespace errors. |
| Railway startup | Pass with warnings | Server started and `/` healthcheck passed. Doctor reported `4 passed`, `5 warned`, `0 failed`. |
| Vault/wiki ON CONFLICT constraint | Confirmed improved | Startup logs no longer showed the previous `there is no unique or exclusion constraint matching the ON CONFLICT specification` vault/wiki error. |
| Google login button | Code path confirmed, provider config blocked | Chrome click reached Google OAuth. Google returned `Error 400: redirect_uri_mismatch` for `https://gameplanjarvisai.up.railway.app/api/auth/mobile/callback`. Railway variable key check also showed `GOOGLE_WEB_CLIENT_ID` is present but `GOOGLE_CLIENT_SECRET` is not present. |
| Endpoint QA harness | Blocked | `node scripts/deployed-jarvis-endpoint-qa.mjs` exits with `Missing JARVIS_QA_AUTH_TOKEN`. |
| Google readiness wording | Improved and deployed | Capability checks now understand `GOOGLE_WEB_CLIENT_ID` as the deployed client id. After deployment, Railway startup logs no longer listed calendar/email/drive as unhealthy due to generic missing Google OAuth credentials; the remaining Google blocker is the missing client secret plus redirect URI configuration. |

Follow-up correction:

- Web login now tries the original Google popup token login first. This preserves the path that worked without `GOOGLE_CLIENT_SECRET`.
- The redirect fallback now reuses the existing Google callback URI, `https://gameplanjarvisai.up.railway.app/api/oauth/google/callback`, instead of introducing `/api/auth/mobile/callback`.
- Production fallback URL was checked with `curl.exe -I /api/auth/mobile/start...`; the Google `redirect_uri` is now `/api/oauth/google/callback`.
- If the popup is blocked and the fallback is used, Railway still needs `GOOGLE_CLIENT_SECRET` to exchange the authorization code.

New/remaining blockers:

1. For popup-based web login, no new Google redirect URI is needed.
2. For redirect fallback and Google tool integrations, add the matching OAuth client secret to Railway as `GOOGLE_CLIENT_SECRET`. Without this, `/api/oauth/google/callback` cannot exchange Google's auth code for tokens.
3. Run the endpoint QA harness with `JARVIS_QA_AUTH_TOKEN` after login works, then rerun with `JARVIS_QA_RUN_CHAT=1` for chat/tool/background probes.
4. Re-check Usage, Agents, Visual, and Jarvis chat in the deployed browser session after authentication succeeds.
5. Follow up on the Railway prestart Drizzle warning: `column "active" cannot be cast automatically to type boolean`. The server still starts, but schema push is not fully clean.
