# Composio Production Smoke Checklist

Production URL: `https://<jarvis-os-production-url>`

Script entrypoint:

```powershell
$env:JARVIS_QA_BASE_URL = "https://<jarvis-os-production-url>"
$env:JARVIS_QA_AUTH_TOKEN = "<owner bearer token without Bearer prefix>"
npm.cmd run jarvis:qa:composio
```

Open Chrome and print the manual checklist without endpoint calls:

```powershell
npm.cmd run jarvis:qa:composio -- --manual-only --open-chrome
```

## Required Environment

- Railway production must have `COMPOSIO_API_KEY`.
- Gmail and Google Calendar auth configs must exist in Composio.
- Jarvis must expose `/api/connections/status`, `/api/connections/connect-link`, `/api/connections/composio/callback`, `/api/connections/callback`, `/api/connections/disconnect`, and `/api/connections/test`.
- The app must register Composio agent tools for list connections, search tools, get tool schema, and execute tool.
- Chrome must be available for the browser pass.
- Use an owner QA bearer token for endpoint smoke. Do not scrape browser storage into logs.

## Chrome Smoke

1. Open production in Chrome and log in as the owner.
2. Open Profile or Settings and confirm Connected Accounts says Composio, not One.
3. If setup is incomplete, confirm the UI says `COMPOSIO_API_KEY` or the missing auth config by name.
4. Click Gmail connect link and complete OAuth through Composio hosted authentication.
5. Confirm the callback returns to Jarvis with `status=success` and a connected account id.
6. Repeat the connect-link flow for Google Calendar.
7. Run Test Connection and confirm Gmail and Google Calendar are active.
8. Ask Jarvis to read recent Gmail. Confirm Composio tools run without approval.
9. Ask Jarvis to send, delete, or modify Gmail. Confirm the first execution is blocked pending approval.
10. Approve only a harmless draft/write test and confirm execution succeeds after the approval marker.
11. Ask Jarvis to read tomorrow's Google Calendar. Confirm Composio calendar tools run without approval.
12. Ask Jarvis to create, edit, or delete a calendar event. Confirm it is blocked pending approval.
13. If a Composio-backed job fails, retry it from the failed-job surface and confirm the retry keeps the same approval gate.
14. Open Memory Review and confirm no pending Composio details are saved as durable memory without review.
15. Disconnect the Gmail and Calendar test accounts and confirm status updates immediately.

## Endpoint Smoke

Run the script once with the owner token:

```powershell
npm.cmd run jarvis:qa:composio
```

Optional connect-link session creation:

```powershell
npm.cmd run jarvis:qa:composio -- --include-connect-link
```

Expected results:

- `status` returns HTTP 200 and reports Composio readiness.
- `test` returns HTTP 200 only when Gmail and Google Calendar connections are active.
- Connect-link calls return redirect URLs and do not execute Gmail or Calendar actions.
- Missing or invalid `COMPOSIO_API_KEY` produces an actionable setup error, not a generic 500.

## Log Review

Check Railway logs after the Chrome pass:

```powershell
railway.cmd logs --service d1267be5-734d-4ba5-adee-994b17dd4d0b --environment 4b92f062-e163-4af4-be18-7b3a6c19d44f --lines 200
```

Look for:

- Composio connection status and callback logs.
- Gmail and Google Calendar tool execution logs.
- Approval-blocked write attempts before external side effects.
- Failed-job retry logs that preserve approval state.
- Memory review logs for any Composio-derived memory candidates.

Do not send real email or create real calendar events during smoke unless the user explicitly approves the exact action.
