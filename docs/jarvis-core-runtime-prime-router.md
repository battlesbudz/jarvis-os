# Jarvis Core Runtime / PRIME Router Plan

Status: proof-of-concept wiring started; naming consolidated around PRIME runtime.

This document describes the target runtime architecture that marries the experimental OpenRouter Agent SDK workflows with the existing Jarvis brain instead of letting them become a separate sidecar path.

## Goal

All user-facing channels should eventually call one function before model routing, tool use, background jobs, crew delegation, approval gates, Agent SDK workflows, or daemon actions:

```ts
handlePrimeInput({
  userId,
  channel,
  message,
  metadata,
})
```

That function returns one of:

- direct response
- tool action
- approval request
- background job
- delegation
- blocked/setup response

`agents/PRIME.md` remains the orchestration contract. `server/agent/autonomyRuntime.ts` is the executable PRIME runtime entrypoint. The older `server/agent/jarvisCoreRuntime.ts` module is now only a compatibility shim.

## Current Entry-Point Audit

### App Chat

Current route:

```txt
POST /api/coach/chat
server/routes.ts
```

Before this proof, app chat directly tried:

1. OpenRouter Agent SDK reminder workflow
2. OpenRouter Agent SDK email workflow
3. direct reminder tool route
4. app chat autonomy route
5. full legacy chat/model/tool path

Proof wiring:

When `ENABLE_PRIME_RUNTIME=true` or `ENABLE_JARVIS_CORE_RUNTIME=true`, app chat first calls:

```ts
handlePrimeInput({ userId, channel, message, metadata })
```

If the PRIME runtime handles the request, the route returns its result. If PRIME is enabled but no proof route matches, app chat continues through the existing app chat path instead of running duplicate direct Agent SDK/tool preflights.

### Telegram

Current route:

```txt
server/telegramRoutes.ts
handleCoachReply(...)
runCoachAgent(...)
runAgent(...)
```

Telegram currently has its own streaming, batching, approval callbacks, slash command handling, TTS behavior, and named-agent routing.

Proof wiring:

- Telegram now calls `handlePrimeInput` after webhook/auth/pairing/needs-attention handling and before `runCoachAgent`.
- If PRIME handles the request, Telegram sends the PRIME reply and stops.
- If PRIME is disabled, the legacy direct Agent SDK preflight remains available to preserve current behavior.

### Discord

Current route:

```txt
POST /api/discord/interactions
server/discord/slashCommands.ts
```

Discord currently splits slash command chat, task commands, project commands, and status commands.

Status:

- Not refactored in this proof.
- `/jarvis chat` is the best next route to wire through `handlePrimeInput`.
- Top-level task slash commands can keep queue-specific behavior until Core Runtime has explicit command metadata support.

### Background Jobs

Current paths:

- `server/agent/jobClient.ts`
- `server/agent/jobQueue.ts`
- `server/agent/autonomyRuntime.ts`
- `server/channels/slashCommandRouter.ts`

Status:

- Not refactored in this proof.
- Core Runtime should classify and submit jobs through the existing job queue, not replace it.

### Approval Resume

Current route:

```txt
server/agent/deliverableReviewHttpRoutes.ts
```

Before this proof, review routes resumed Agent SDK approvals directly when the approval gate belonged to the prototype.

Proof wiring:

When `ENABLE_PRIME_RUNTIME=true` or `ENABLE_JARVIS_CORE_RUNTIME=true`, approval gate approve/reject first calls:

```ts
handlePrimeApprovalDecision({ gate, approved })
```

If it handles the gate, it returns the continuation. If not, the existing top-level approval and Agent SDK direct resume paths remain unchanged.

### Daemon Actions

Current paths:

- `server/agent/tools/daemon.ts`
- `server/daemon/bridge.ts`
- daemon channel/tool groups

Status:

- Not refactored in this proof.
- Daemon actions must remain approval-gated and sandboxed.
- Core Runtime should eventually classify daemon requests as high-risk before tool exposure.

## Runtime Module

Implemented:

```txt
server/agent/autonomyRuntime.ts
```

Exports:

```ts
handlePrimeInput(input, deps?)
handlePrimeApprovalDecision(input, deps?)
isPrimeRuntimeEnabled()
```

Compatibility aliases are exported for older imports:

```ts
handleJarvisInput(...)
handleJarvisApprovalDecision(...)
isJarvisCoreRuntimeEnabled()
```

Feature flag:

```txt
ENABLE_PRIME_RUNTIME=true
ENABLE_JARVIS_CORE_RUNTIME=true
```

The compatibility flag is retained so older local environments keep working. The Agent SDK worker remains separately gated by:

```txt
ENABLE_AGENT_SDK_RUNNER=true
```

This lets Jarvis test the unified runtime entrypoint without forcing the Agent SDK to own every request.

## OpenRouter Agent SDK Loop Direction

The experimental runner remains scoped to explicit workflows:

- draft-only email
- draft-and-send email with HITL approval
- internal reminder proof

The runner now records model selection metadata and attaches loop metadata to OpenRouter requests:

```txt
think -> tool -> observe -> continue -> HITL when needed
```

Long-horizon guards remain attached:

- max step count
- max cost
- persistent state accessor
- resume after restart
- Telegram progress updates
- completion notification

Model selection remains inside the Agent SDK runner for now, but borrows Jarvis task complexity/privacy classification. It does not replace the normal Jarvis model router.

## Final Architecture

```txt
Channel webhook / route
-> auth, signature, pairing, transport-specific parsing
-> handlePrimeInput(...)
   -> classify task
   -> classify risk
   -> choose route
   -> load minimal context
   -> choose model path
   -> expose allowed tools
   -> create approval/job/delegation/direct reply
-> channel formatter
-> send response
```

Approval resume:

```txt
Approval card/button
-> canonical approval gate update
-> handlePrimeApprovalDecision(...)
-> resume Agent SDK / top-level job / delegated worker
-> update deliverable/inbox/channel status
```

## Bypass List

Known paths that still bypass PRIME runtime:

- Discord `/jarvis chat`
- Discord top-level task commands
- Slack/WhatsApp channel paths if enabled
- daemon bridge requests
- scheduled/background jobs started internally
- most legacy app chat model/tool behavior after PRIME returns `handled:false`
- direct build-intent and autonomy short-circuits inside `coachAgent`

This is expected for the proof. The point is to create the seam and wire one or two routes, not refactor everything at once.

## Next Wiring Steps

1. Wire Discord `/jarvis chat` through PRIME runtime before `runCoachAgent`.
2. Move direct reminder route fully under PRIME runtime and remove duplicate legacy preflight after production smoke passes.
3. Add Mind Trace event capture from `handlePrimeInput` decisions.
4. Gradually move build-intent and autonomy short-circuit decisions from `coachAgent` into `handlePrimeInput`.
5. Add route tests for app chat with `ENABLE_JARVIS_CORE_RUNTIME=true`.
6. Add approval resume tests where review routes call Core Runtime first.
7. Add daemon classification only, without exposing new daemon powers.

## Non-Goals

- Do not rewrite PRIME.
- Do not replace the existing model router.
- Do not convert all tools to OpenRouter Agent SDK tools yet.
- Do not bypass approval gates.
- Do not let the Agent SDK send messages, email, calendar changes, or daemon actions without canonical Jarvis approval.
