# Agent SDK HITL Prototype

This is a small experimental proof of concept for an Agent SDK-style human-in-the-loop email flow.

It is disabled by default and does not replace the current Jarvis model router, harness, email tools, approval system, or channel flows.

The prototype is now intended to run under the feature-flagged PRIME runtime seam when that runtime is enabled:

```txt
server/agent/autonomyRuntime.ts
```

See `docs/jarvis-core-runtime-prime-router.md` for the final channel-routing architecture.

## Feature Flag

Enable only for local/dev testing:

```powershell
$env:ENABLE_AGENT_SDK_RUNNER="true"
npm.cmd run server:dev
```

The default model provider is Jarvis, not OpenRouter hosted models:

```powershell
$env:AGENT_SDK_MODEL_PROVIDER="jarvis"
```

That means the experimental runner uses the SDK-style loop, state, tool, and HITL mechanics, but model calls go through the existing Jarvis model router/Codex gateway path. No `OPENROUTER_API_KEY` is required for that default mode.

Use OpenRouter hosted model routing only when explicitly testing that provider:

```powershell
$env:AGENT_SDK_MODEL_PROVIDER="openrouter"
$env:OPENROUTER_API_KEY="<set locally>"
```

Optional long-horizon ceilings:

```powershell
$env:OPENROUTER_AGENT_SDK_MAX_STEPS="20"
$env:OPENROUTER_AGENT_SDK_MAX_COST="0.25"
```

Optional Core Runtime proof flag:

```powershell
$env:ENABLE_PRIME_RUNTIME="true"
$env:ENABLE_JARVIS_CORE_RUNTIME="true"
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
-> Agent SDK runner starts
-> step count and cost ceilings are attached to the run
-> default model calls go through Jarvis model routing / Codex gateway
-> read_context may load small Jarvis context
-> draft_email creates an internal preview only
-> send_email is requested with requireApproval=true
-> run state is persisted under .jarvis/runtime/agent-sdk-runs/
-> Telegram receives progress updates for tool calls / long-running output
-> Jarvis approval gate is created
-> Telegram approval card is sent, with in-app fallback
-> approval resume can enter through PRIME runtime when enabled
-> Approve resumes and sends through existing sendEmailTool
-> Decline resumes/reports without sending
-> Telegram receives a completion/failure notification
```

## Safety

- `ENABLE_AGENT_SDK_RUNNER` defaults off.
- The existing Jarvis approval gate remains the canonical approval record.
- `sendEmailTool.execute` is only called after approval resumes.
- File-backed run state is experimental and uses atomic writes so a restart can resume with the same `StateAccessor`.
- Normal Gmail, Calendar, Composio, and Jarvis chat behavior remains unchanged unless the feature flag and explicit test workflow both match.

## Resume After Restart

The prototype persists `ConversationState` and local metadata for each run. A server process can resume an interrupted experimental email run by calling `resumeAgentSdkEmailWorkflowRun({ runId })`.

That resume path calls the configured model adapter with:

```ts
input: []
```

and the same file-backed `StateAccessor`, so the runner continues from the saved checkpoint instead of starting a new conversation. In `AGENT_SDK_MODEL_PROVIDER=jarvis` mode, approval resume executes the approved pending tool through Jarvis's local tool adapter without requiring OpenRouter.

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
OK: completion notification sent
OK: restart resume uses persisted state
OK: Telegram progress updates sent
OK: rejection prevents sending
```

## Golden Workflow Scorecard

Run the ten-workflow Agent SDK scorecard:

```powershell
npm.cmd run jarvis:qa:agent-sdk-golden
```

This script is intentionally conservative.

It does not claim that the SDK owns all ten golden workflows yet. It checks all ten workflows and reports one of:

- `sdk_passed_mocked`
- `sdk_partial_mocked`
- `current_jarvis_owned`
- `unsupported_by_sdk_v1`

Current status:

| Workflow | SDK status | Notes |
| --- | --- | --- |
| Plan my day around my calendar | `current_jarvis_owned` | Keep on Daily Command until calendar/plan draft tools are wrapped. |
| Draft a reply to an email | `sdk_partial_mocked` | SDK now proves draft-only with provided conversation context and adjacent email HITL send. It is still partial until provider email-thread reads exist. |
| Remind me to follow up | `sdk_partial_mocked` | SDK now proves explicit internal reminders through `create_internal_reminder`; existing scheduled tasks remain the durable owner. |
| Research a topic and save a report | `current_jarvis_owned` | Existing research/job/deliverable path remains owner. |
| Turn a goal into a project tree | `current_jarvis_owned` | Existing goal decomposition remains owner. |
| Move a goal task into today's plan | `current_jarvis_owned` | Existing goal handoff and daily plan merge remain owner. |
| Prepare a weekly review | `current_jarvis_owned` | Existing planning/memory surfaces remain owner. |
| Prepare me for my next meeting | `current_jarvis_owned` | Calendar/email read-only wrappers needed before SDK ownership. |
| Find what I said before | `unsupported_by_sdk_v1` | Needs provenance-aware memory search/read, not just `read_context`. |
| Diagnose why a feature failed | `current_jarvis_owned` | Existing diagnostics/Mind Trace/job observability remain owner. |

The next SDK expansion should be one workflow at a time:

1. Provider email-thread read support for draft replies.
2. DB-backed internal reminder smoke proving real scheduled-task persistence.
3. Read-only meeting prep.

Do not expand to broad autonomous tool conversion until these three have mocked and real-tool smoke coverage.

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

## Where To Pick Up

Start here:

- Runner: `src/agent/agentRunner.ts`
- Tools: `src/agent/toolRegistry.ts`
- HITL bridge: `src/agent/hitlApproval.ts`
- File state: `src/agent/runStore.ts`
- Focused assertions: `src/agent/__tests__/agentSdkHitl.assert.ts`
- Mocked HITL smoke: `scripts/agent-sdk-hitl-smoke.ts`
- Ten-workflow scorecard: `scripts/agent-sdk-golden-workflows.ts`
- Golden workflow definitions: `docs/operations/jarvis-golden-workflows.md`

The project direction is:

```txt
experimental email HITL
-> draft-only email reply with provided context
-> provider email-thread reads for reply drafts
-> internal reminders through existing scheduled tasks
-> DB-backed reminder smoke
-> read-only meeting prep
-> provenance-aware memory lookup
-> research/deliverable workflows
-> broader tool conversion only after evals prove stability
```

The rule of thumb: if a workflow can change the outside world, it needs an approval gate before the tool executes. If a workflow is not explicitly supported by the SDK runner, it must fall back to the existing Jarvis brain.
