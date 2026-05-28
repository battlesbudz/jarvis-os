# OpenRouter Agent SDK HITL Prototype

This is a small experimental proof of concept for an OpenRouter Agent SDK human-in-the-loop email flow.

It is disabled by default and does not replace the current Jarvis model router, harness, email tools, approval system, or channel flows.

## Feature Flag

Enable only for local/dev testing:

```powershell
$env:ENABLE_AGENT_SDK_RUNNER="true"
$env:OPENROUTER_API_KEY="<set locally>"
npm.cmd run server:dev
```

The prototype only routes explicit requests that ask Jarvis to draft/write/compose and send an email.

Examples:

```txt
Draft and send an email to test@example.com saying this is a Jarvis Agent SDK approval test.
Can you draft/send an email to Sam?
```

Everything else continues through the normal Jarvis path.

## Flow

```txt
User asks to draft and send an email
-> OpenRouter Agent SDK runner starts
-> read_context may load small Jarvis context
-> draft_email creates an internal preview only
-> send_email is requested with requireApproval=true
-> run state is persisted under .jarvis/runtime/agent-sdk-runs/
-> Jarvis approval gate is created
-> Telegram approval card is sent, with in-app fallback
-> Approve resumes and sends through existing sendEmailTool
-> Decline resumes/reports without sending
```

## Safety

- `ENABLE_AGENT_SDK_RUNNER` defaults off.
- The existing Jarvis approval gate remains the canonical approval record.
- `sendEmailTool.execute` is only called after approval resumes.
- File-backed run state is experimental and not durable production infrastructure.
- Normal Gmail, Calendar, Composio, and Jarvis chat behavior remains unchanged unless the feature flag and explicit test workflow both match.

## Mocked Smoke

Run the local mocked smoke. It does not call OpenRouter and does not send real email.

```powershell
npm.cmd run jarvis:qa:agent-sdk-hitl
```

Expected:

```txt
OK: draft generated
OK: approval requested
OK: paused run persisted
OK: approval resumes and sends
OK: rejection prevents sending
```

## Real Local Smoke

1. Enable the feature flag and OpenRouter key.
2. Start the server.
3. Use Telegram or the app chat with:

```txt
Draft and send an email to test@example.com saying this is a Jarvis Agent SDK approval test.
```

Expected:

- Jarvis drafts.
- Telegram receives approve/decline controls.
- Approve resumes and sends through the existing email tool.
- Decline does not send.

Use a safe test recipient and account. This prototype is intentionally narrow.
