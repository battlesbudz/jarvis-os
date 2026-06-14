# Jarvis Action Ontology Checklist

Status date: 2026-06-01

Purpose: give Jarvis a durable decision layer that understands who should act, which tools are allowed, what needs approval, and why a tool/action path was chosen. This is the foundation for Jarvis owning more of his own feature work through Telegram/app chat while keeping human approval gates around risky writes.

## Current Decisions

- Jarvis should not treat every scheduled item as work he can execute.
- Human-only tasks belong to the user's task/reminder surface.
- Tool-executable automation belongs to explicit Jarvis action, cron, job, or worker paths.
- Jarvis may inspect, plan, propose, and eventually apply code changes, but risky writes, commits, pushes, deploys, external messages, purchases, and infrastructure changes require human approval.
- Each action should have a logged reason that explains why Jarvis chose that route.

## Action Types

- `user_task`: something Battles or another human must personally do.
- `jarvis_reminder`: Jarvis reminds, resurfaces, or nudges.
- `jarvis_read`: Jarvis reads, searches, summarizes, or analyzes data.
- `jarvis_draft`: Jarvis drafts content but does not send or apply it.
- `jarvis_external_write`: Jarvis changes an external system, sends a message, posts, edits a calendar, or updates a connected app.
- `jarvis_code_proposal`: Jarvis inspects his code and proposes a change for review.
- `jarvis_code_apply`: Jarvis applies repo changes after approval.
- `cloud_worker_task`: a scoped worker/sub-agent runs a bounded task.
- `system_admin`: deployment, env vars, Railway, database, secrets, startup, or infrastructure work.
- `blocked_physical_action`: physical-world work Jarvis cannot perform.

## Checklist

### Slice 0 - Stop Bad Scheduled Task Semantics

- [x] Add a durable `user_task` vs `jarvis_action` distinction for scheduled tasks.
- [x] Make personal scheduled tasks non-executable by default.
- [x] Keep explicit cron/automation paths executable as `jarvis_action`.
- [x] Prevent recurring personal tasks from duplicating by scheduled time.
- [x] Rename Mission Control scheduled sections so user tasks are not shown as worker-style execution.
- [x] Add tests for scheduled task semantics and recurring task parsing.
- [x] Delete the bad DoorDash scheduled-task rows from production.

### Slice 1 - Core Action Ontology Module

- [x] Add `server/agent/actionOntology.ts`.
- [x] Define the canonical action type enum.
- [x] Define actor ownership: `user`, `jarvis`, `worker`, `human_approval_required`, `blocked`.
- [x] Return allowed tool groups and priority tools from the ontology result.
- [x] Return an explicit `reason` for every classification.
- [x] Add focused tests for human-only, read-only, external-write, code, worker, system-admin, and blocked-physical examples.

### Slice 2 - Route Tool Selection Through Ontology

- [x] Route `toolAwareRouting` through the ontology for overlapping intents.
- [x] Keep existing Composio email/calendar routing intact.
- [x] Keep weather, research, browser, GitHub, Railway, diagnostics, and project routes intact.
- [x] Add tests proving the ontology does not regress existing tool-aware routes.
- [x] Add tests proving physical/user-owned tasks do not become autonomous actions.

### Slice 3 - Tool Choice Explanations

- [x] Add a standard `actionReason` field to route/tool decision payloads.
- [x] Log why Jarvis selected each tool path.
- [ ] Surface the reason in debug/Mind Trace views.
- [ ] Keep normal user chat concise; do not over-explain unless asked.

### Slice 4 - Tool Resolver and Lazy Tool Loading

- [x] Add `server/agent/toolResolver.ts`.
- [x] Resolve required, optional, and blocked tools from `ActionOntologyDecision`.
- [x] Keep the model prompt/tool list small by exposing only tools relevant to the current action type.
- [x] Preserve existing Composio email/calendar connected-account routes.
- [x] Block executable tools for `blocked_physical_action`.
- [x] Add tests proving DoorDash/user tasks only receive user-task tools.
- [x] Add tests proving Gmail read, email send, code self-improvement, system-admin, research, and cloud-worker actions receive only the expected tool families.
- [x] Route `toolAwareRouting` tool selection through the resolver.

### Slice 5 - Self-Code Ownership Workflow

- [ ] Define the `jarvis_code_proposal` flow.
- [ ] Define the `jarvis_code_apply` flow.
- [ ] Require a scoped implementation plan before code writes.
- [ ] Require approval before applying code changes.
- [ ] Require tests/build before final approval.
- [ ] Require approval before commit, push, deploy, or infrastructure changes.
- [ ] Add tests for code proposal vs code apply routing.

### Slice 6 - Worker Ownership Workflow

- [ ] Map `cloud_worker_task` to worker runtime jobs.
- [ ] Require worker type, scope, tools allowed, expected output, and stop condition.
- [ ] Add approval checkpoints for external writes from workers.
- [ ] Log worker progress into Mission Control.
- [ ] Add tests for worker task routing and approval-required checkpoints.

### Slice 7 - Memory of Tool Lessons

- [ ] Store durable routing lessons from corrected mistakes.
- [ ] Retrieve routing lessons before action classification.
- [ ] Add a lesson for DoorDash/human earning tasks as user-owned work.
- [ ] Add tests that retrieved lessons cannot override hard safety rules.

### Slice 8 - Cleanup and UI

- [ ] Add a simple "Why did Jarvis do this?" inspection surface.
- [ ] Make approval/review cards show action type and actor.
- [ ] Keep Mission Control free of duplicate worker/task concepts.
- [ ] Reconcile old docs and roadmap references once the ontology is live.

## Verification Standard

Each slice should stop after a reviewable checkpoint and run:

- Focused tests for the touched behavior.
- `npm.cmd run server:build`.
- `git diff --check`.
- `git status --short`.

Do not push until the slice is committed and the user explicitly approves publishing.
