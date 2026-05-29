# OpenAI Cookbook Implementation Plan

## Purpose

Use the OpenAI Agents Cookbook direction as a practical implementation plan for evolving Jarvis from a chatbot-like assistant into a reliable agent operating system.

The core architectural lesson is:

```txt
Jarvis should not do everything.
Jarvis should decide who or what does everything.
```

Jarvis should act as a persistent orchestrator that can classify work, load selective context, call tools, manage state, delegate to specialists, require approvals, preserve traces, and improve through evals.

Primary OpenAI references:

- Agents Cookbook: https://developers.openai.com/cookbook/topic/agents
- Agent orchestration: https://developers.openai.com/api/docs/guides/agents/orchestration
- Results and state: https://developers.openai.com/api/docs/guides/agents/results
- MCP and connectors: https://developers.openai.com/api/docs/guides/tools-connectors-mcp
- Skills: https://developers.openai.com/api/docs/guides/tools-skills
- Voice agents: https://developers.openai.com/api/docs/guides/voice-agents
- Agent evals: https://developers.openai.com/api/docs/guides/agent-evals

## North Star

Jarvis is a personal operating system, not a single chatbot.

The durable runtime shape should be:

```txt
User request
-> PRIME orchestrator
-> classify task and risk
-> load minimal context
-> select route, tool, subagent, job, or approval gate
-> execute or prepare reviewable output
-> preserve state and trace
-> synthesize result
-> learn only through reviewable memory paths
```

The goal is not to create one giant prompt. The goal is to create a disciplined orchestration layer with specialized workers and observable state.

## Current Jarvis Alignment

Jarvis already has many of the right pieces:

- PRIME orchestration contracts
- agent harness
- tool policy
- approval gates
- subagent and crew concepts
- memory and SOUL systems
- context routing work
- background jobs
- deliverables
- channel surfaces
- daemon/device concepts
- Mind Trace and observability work
- Composio/MCP connector direction

The next step is to make these systems operate as one coherent agent OS loop.

## Implementation Principles

1. PRIME owns orchestration.
2. Specialists own narrow execution domains.
3. Context is loaded by route, not by habit.
4. Tools are capabilities with risk levels.
5. State is persisted for meaningful work.
6. Approvals are part of intelligence, not friction.
7. Memory is reviewable, correctable, and explainable.
8. Voice and daemon control sit on top of the same safe runtime.
9. Evals define improvement.
10. User trust beats speed.

## Phase 1: PRIME Runtime Decisions

### Goal

Make PRIME the explicit executive function for every substantial Jarvis task.

### Implement

- Add or harden a runtime decision object for substantial tasks:
  - `task_type`
  - `risk_level`
  - `route`
  - `task_state`
  - `required_context_packs`
  - `tools_allowed`
  - `approval_required`
  - `subagent_or_tool`
  - `output_destination`
  - `trace_id`

- Use these task states:
  - `answer_inline`
  - `agent_as_tool`
  - `handoff`
  - `needs_tool`
  - `needs_approval`
  - `queue_background_job`
  - `blocked_by_setup`
  - `refuse_or_redirect`

### Definition Of Done

- Every substantial task has a visible route decision.
- Mind Trace can show why the route was chosen.
- Approval-sensitive work cannot bypass PRIME.

## Phase 2: Handoffs And Subagents

### Goal

Separate "agent as tool" from "handoff."

### Implement

- Use `agent_as_tool` when PRIME calls a specialist for a bounded result and keeps final synthesis.
- Use `handoff` only when a specialist should own the next turn, session, or channel-specific flow.
- Define contracts for:
  - Daily Command agent
  - Memory Trust agent
  - Research agent
  - Code Operator agent
  - Business agent
  - Communications agent
  - Daemon/Device agent
  - Voice agent

Each contract should include:

- scope
- allowed tools
- forbidden actions
- context packs
- approval rules
- output format
- failure behavior
- eval workflows

### Definition Of Done

- PRIME can delegate without handing over unsafe authority.
- Subagents do not need the original chat history to understand their task.
- Final synthesis remains accountable.

## Phase 3: State As A Runtime Object

### Goal

Make meaningful Jarvis work resumable, inspectable, and explainable.

### Implement

Persist state for meaningful responses/actions:

- request id
- user id
- channel
- task type
- route
- risk level
- selected context packs
- memories retrieved
- SOUL sections used
- tools called
- approval gate ids
- job ids
- deliverable ids
- errors or blocked setup
- confidence or uncertainty notes
- final outcome

Connect this state to Mind Trace.

### Definition Of Done

- User or developer can answer: "Why did Jarvis do this?"
- Failed or interrupted work can resume from durable state.
- Sensitive values are redacted.

## Phase 4: Context Router V1

### Goal

Stop loading every instruction, memory, and roadmap file every turn.

### Implement

Create route-selected context packs:

- `always_on_kernel`
- `daily_planning_context`
- `memory_context`
- `email_context`
- `calendar_context`
- `code_work_context`
- `self_healing_context`
- `research_context`
- `business_context`
- `daemon_context`
- `voice_context`

For each substantial request, classify:

- task type
- risk level
- required packs
- forbidden packs
- tool permissions
- approval requirement
- output destination

### Definition Of Done

- Simple turns use a tiny always-on kernel.
- Substantial tasks load only relevant route context.
- Mind Trace reports loaded context packs and approximate budget.

## Phase 5: Skills As Capability Packs

### Goal

Turn Jarvis abilities into installable, testable capability modules.

### Implement

Create a skill-pack format with:

- manifest
- trigger patterns
- instructions
- allowed tools
- context packs
- safety boundaries
- user-facing surfaces
- eval workflows
- version

Initial skill packs:

- Daily Command
- Gmail/Calendar
- Founder
- Cannabis Business
- Grower
- Veteran
- Research
- Code Operator

### Definition Of Done

- Skills are discoverable by the router.
- Skills do not silently expand permissions.
- Skills have at least one golden workflow eval.

## Phase 6: Unified Capability Registry

### Goal

Make native tools, MCP tools, Composio connectors, daemon tools, and browser tools visible through one risk-aware registry.

### Implement

For every capability, track:

- capability id
- provider
- connected status
- read/write risk
- approval requirement
- required account or credential
- test action
- failure mode
- retry behavior
- audit behavior

Use this registry for:

- Gmail
- Google Calendar
- Outlook
- Slack
- Google Drive
- browser/computer use
- Android daemon
- desktop daemon
- memory writes
- deployments

### Definition Of Done

- Jarvis can say which connected accounts/tools are available.
- Risky writes require approval.
- Failed capability setup becomes a clear blocked state.

## Phase 7: Evals And Golden Workflows

### Goal

Measure whether Jarvis is becoming more useful.

### Implement

Create golden workflow evals for:

1. Plan my day around my calendar.
2. Remind me in one hour.
3. Summarize my inbox.
4. Draft a reply to an email.
5. Schedule or prepare for a meeting.
6. Move a goal task into today's plan.
7. Find what I said about something before.
8. Correct or delete a memory.
9. Research a topic and save a report.
10. Diagnose why a feature failed.
11. Recover a failed job.
12. Explain why Jarvis did or learned something.

Track:

- task success rate
- human correction rate
- tool failure rate
- approval correctness
- memory recall accuracy
- route accuracy
- context budget
- time to completion
- retry recovery success

### Definition Of Done

- Golden workflows are runnable as tests or smoke scripts.
- Failures produce actionable traces.
- Improvements can be measured over time.

### Current Agent SDK Status

Phase 7 starts with a mocked OpenRouter Agent SDK scorecard, not a full migration.

Run:

```powershell
npm.cmd run jarvis:qa:agent-sdk-golden
```

Current status:

- SDK v1 proves the narrow email HITL send-approval slice in mocked mode.
- SDK v1 now also proves draft-only email replies when the source context is provided in the conversation.
- The broader "draft a reply to an email" golden workflow is still only partially covered because SDK v1 does not yet read a provider email thread.
- Daily planning, reminders, research, goal handoff, weekly review, meeting prep, and diagnostics remain owned by the existing Jarvis architecture.
- Memory lookup is unsupported by SDK v1 until the SDK path returns provenance, confidence, and source metadata.

Next implementation order:

1. Provider email-thread read support for draft replies.
2. Internal reminder creation.
3. Read-only meeting prep.
4. Provenance-aware memory lookup.

Do not broaden Agent SDK ownership without mocked evals, safe real-tool smoke coverage, approval checks, restart-resume behavior, and clear status reporting.

## Phase 8: Daily Command Reliability

### Goal

Make Jarvis useful every day before expanding speculative surfaces.

### Implement

Harden the daily loop:

```txt
Sense
-> Remember
-> Synthesize
-> Decide
-> Act
-> Review
-> Learn
```

Focus on:

- morning plan
- inbox and attention triage
- task handoff
- reminder creation
- approval visibility
- failed job recovery
- evening wrap-up
- dream synthesis
- memory review

### Definition Of Done

- A user can rely on Jarvis for one daily operating loop.
- Status is visible: working, ready, waiting approval, blocked, failed, recovering.
- Missed or failed steps are recoverable.

## Phase 9: Voice Runtime

### Goal

Make voice an interface over the same safe runtime, not a separate brain.

### Implement

- Route voice requests through PRIME.
- Reuse the same tools, approvals, state, and Mind Trace.
- Support interruption and repair.
- Keep risky actions behind clear spoken or visible approval.
- Start with push-to-talk and durable sessions before always-on ambient mode.

### Definition Of Done

- Voice can plan, query memory, create reminders, and draft work.
- Voice cannot bypass approval gates.
- Voice sessions preserve state across interruptions.

## Phase 10: Daemon And Device Control

### Goal

Make device action operational without weakening safety.

### Implement

- Treat daemon actions as high-risk capabilities.
- Require sandboxing, logging, approval, and rollback where possible.
- Add capability negotiation per device.
- Avoid vendor-specific assumptions.
- Do not build always-on camera/spatial memory before privacy, consent, retention, and review controls exist.

### Definition Of Done

- Device actions are observable and approval-gated.
- Failed daemon actions are recoverable.
- Jarvis cannot gain unrestricted daemon powers.

## Recommended Build Order

1. PRIME runtime decision object
2. Mind Trace integration for real harness/tool/memory events
3. Context Router V1
4. Unified capability registry
5. Composio/MCP connector hardening
6. Subagent contracts
7. Golden workflow evals
8. Daily Command reliability
9. Memory Trust UX
10. Voice runtime
11. Daemon/device control

## Risks

- Building voice or daemon control before traceability and approvals are reliable.
- Letting skills expand into hidden permission changes.
- Treating memory as automatically true.
- Loading every doc and memory every turn.
- Letting subagents bypass PRIME.
- Confusing connector availability with action approval.
- Optimizing for impressive demos over daily usefulness.

## Success Criteria

Jarvis is aligned with the OpenAI agent architecture direction when:

- PRIME routes work instead of one prompt doing everything.
- Subagents and skills are narrow, testable, and safe.
- Context loading is selective.
- State is persisted and resumable.
- Mind Trace explains meaningful actions.
- Connectors and tools are risk-aware.
- Approvals are obvious.
- Daily usefulness is measured with evals.
- Memory is visible, correctable, and explainable.
- Voice and daemon control reuse the same safe operating system.

The practical end state is not "Jarvis sounds smarter."

The practical end state is:

```txt
Jarvis remembers better,
routes better,
acts more safely,
recovers from failures,
and proves his work.
```
