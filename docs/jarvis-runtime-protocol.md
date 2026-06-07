# Jarvis Runtime Protocol

Jarvis Runtime Protocol is the typed language used by Jarvis Core Runtime. It is designed to keep the runtime in charge: models may suggest decisions, but runtime validation, policy, tools, approvals, and memory services decide what can actually happen.

## Lifecycle

```text
JarvisEvent
  -> ContextPacket
  -> RuntimeDecision
  -> ToolIntent preflight
  -> ApprovalRequirement
  -> response, trace, safe memory review
```

## Protocol Objects

### JarvisEvent

Represents an incoming user, channel, job, or device event.

Required fields:

- `eventId`
- `source`
- `userId`
- `message`
- `createdAt`

### ContextPacket

Represents structured context available to a runtime decision.

Required fields:

- `packetId`
- `userId`
- `query`
- `createdAt`
- `sources`
- `provenance`
- `uncertainty`

Context packets should list what was available and what was missing. They should not become prompt soup.

### RuntimeDecision

Represents the runtime's validated decision for one event.

Required fields:

- `decisionId`
- `eventId`
- `userId`
- `intent`
- `confidence`
- `riskTier`
- `responseMode`
- `tools`
- `approval`
- `modelRoute`
- `trace`

Invalid decisions fail closed. A missing approval directive or invalid risk tier must not default to execution.

### ToolIntent

Represents a proposed tool call before execution.

Tool intents are not tool execution. Runtime policy and preflight must still decide whether the tool can run.

### ApprovalRequirement

Represents whether an action needs user review before execution.

Approval is part of the decision, not an afterthought. Risky actions should return `approval_required`, `blocked`, or `degraded` rather than executing directly.

### ModelRoute

Records why a model/provider was selected.

The model route is infrastructure. Jarvis identity and policy must not depend on one provider.

### MindTraceRef

Links a runtime decision to the existing Mind Trace system.

Core Runtime v0.1 adapts existing `JarvisMindTrace` records rather than replacing them.

### RuntimeError

Represents validation, preflight, provider, policy, or tool failure.

Errors should be traceable and recoverable whenever possible.

## Fail-Closed Rules

- A model may suggest a tool call; only runtime may execute it.
- A model may suggest a memory update; only Memory OS may write it.
- A model may suggest an email; approval and tool policy decide whether it can be drafted, saved, or sent.
- A daemon may expose a capability; device policy decides whether Jarvis may use it.
- Invalid protocol output must become `blocked` or `degraded`, never direct execution.

## v0.1 Adapter

The first adapter converts existing Mind Trace records into protocol decisions. This gives Jarvis a seed trace format without changing the harness.

```text
JarvisMindTrace
  -> RuntimeDecision
  -> validation
  -> future runtime event trace
```

This is the seed crystal for future Tool Gateway, Memory Context Adapter, Model Router, and Autonomy Governor work.
