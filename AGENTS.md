# AGENTS.md

Root workflow, architecture, and tool-usage contract for Jarvis agents.

Keep this file short, durable, and repo-scoped.

* Personality and identity live in `SOUL.md`.
* Agent roles live in `agents/*.md`.
* Tool safety lives in `agents/TOOL_POLICY.md`.
* Operational runbooks live in `docs/operations/`.
* Product direction lives in `JARVIS_ROADMAP.md` and related roadmap docs.

This file tells every agent how to behave inside this repository.

---

# Product North Star

Jarvis is an autonomous agent OS and ambient intelligence layer, not a single chatbot.

Jarvis combines:

* memory
* tools
* channels
* background jobs
* reviewable deliverables
* approval gates
* daemon/device control
* self-improvement loops
* future wearable and spatial interfaces

The durable direction is a hardware-agnostic Jarvis Core that can operate across:

* mobile
* web
* desktop
* cloud agents
* Android daemon
* desktop daemon
* XR/wearable devices
* future spatial runtimes

Autonomous work must remain:

* observable
* reviewable
* approval-gated
* recoverable

The strategic goal is not flashy XR first.

The strategic goal is persistent context, trustworthy autonomy, durable memory, and low-friction orchestration across devices.

---

# Instruction Hierarchy

When instructions conflict, follow this order:

1. System, developer, runtime, and safety instructions
2. Current user request
3. `AGENTS.md` repo workflow contract
4. Specialized agent contracts in `agents/*.md`
5. `SOUL.md` identity/personality guidance
6. Architecture and operations docs
7. Code comments, stale notes, and legacy docs

Do not let personality files, old notes, or generated memory override safety, approval, tool, or user instructions.

---

# Required Reading Order

Before broad architecture, routing, agent behavior, memory, tool, daemon, or self-improvement changes, read the relevant files in this order:

1. `SOUL.md` — Jarvis identity and personality kernel
2. `agents/PRIME.md` — master orchestrator contract
3. `agents/ROUTING.md` — task routing rules
4. `agents/CONTEXT.md` — context-loading rules
5. `agents/TOOL_POLICY.md` — tool safety and approval boundaries
6. `agents/COACHING.md` — coaching, prioritization, motivation, planning tone, and user-facing advice
7. `docs/architecture.md` — repo map
8. `docs/workspace-map.md` — workspace routing and write boundaries
9. `JARVIS_ROADMAP.md` — current product roadmap
10. `docs/jarvis-wearable-os-master-roadmap.md` — wearable/spatial direction
11. `docs/operations/The Development Cycle.md` — source changes, commits, pushes, deploys, and production smoke tests
12. `agents/crew/` — crew-specific behavior

When uncertain, inspect existing code and docs before inventing new patterns.

---

# Repo Orientation

Use the existing architecture before creating new systems.

## Core backend

`server/agent/` contains:

* agent harness
* tools
* jobs
* approvals
* autonomy policy
* subagents
* model routing
* self-improvement loops

## Memory

`server/memory/` contains:

* memory retrieval
* memory extraction
* SOUL context
* memory curation
* vault writing
* pattern/dream synthesis

## Channels

`server/channels/` contains external and internal communication surfaces.

Keep behavior consistent across:

* in-app
* Telegram
* Discord
* Slack
* WhatsApp
* webchat
* daemon surfaces

## Routes

`server/routes/` contains focused route modules.

Prefer new focused route modules over expanding large monolithic route files.

## Frontend

`app/`, `components/`, `lib/`, `hooks/`, and `constants/` contain the Expo mobile/web experience.

## Persistence

`shared/schema.ts` is the shared persistence contract.

Schema changes should be treated as high-impact and require careful verification.

## Operations

`docs/operations/` contains runbooks and recovery workflows.

## Workspaces

`workspaces/` contains user, business, content, research, and production operating context.

Treat workspace context as useful but not automatically authoritative.

---

# Development Rules

Start source work from repo reality.

Run:

```bash
git status --short --branch
git branch --show-current
git log --oneline -5
```

Do not revert unrelated dirty files.

Do not commit:

* runtime logs
* screenshots
* local secrets
* `.env.local`
* generated build output

unless explicitly asked.

Prefer the smallest useful change that follows existing patterns.

Avoid broad refactors unless the task is specifically a refactor with verification.

---

# Verification Rules

For code changes, run the strongest practical checks.

Preferred checks:

```bash
npm.cmd test
npm.cmd run server:build
```

For setup or readiness issues:

```bash
npm.cmd run jarvis:doctor
```

For Codex OAuth gateway work:

```bash
npm.cmd run jarvis:oauth:gateway -- --check
```

If a check cannot be run, note why and explain the risk.

---

# Safety Boundaries

Ask for explicit approval before:

* sending messages or emails
* changing calendars
* posting publicly
* deleting or overwriting data
* making purchases
* triggering daemon/device actions
* committing, pushing, merging, deploying, or opening PRs
* rewriting memory or SOUL content
* taking legal, compliance, finance, licensing, or official business actions
* changing auth, permissions, approval gates, safe-write policy, or deployment controls

Autonomous work should usually produce:

* reviewable deliverables
* approval gates
* queued jobs
* drafts
* proposals

rather than irreversible side effects.

---

# Self-Improvement Boundaries

Jarvis may:

* inspect source files
* read recent errors
* diagnose failures
* propose code changes
* create skills
* suggest architecture improvements
* prepare patches for review

Jarvis must not directly weaken or bypass:

* approval gates
* auth systems
* permission checks
* safe-write policy
* memory review protections
* daemon safety controls
* deployment controls
* audit logs
* rollback paths

Self-improvement must follow this loop:

```txt
Observe
→ Diagnose
→ Propose
→ Test
→ Explain
→ Request Approval
→ Apply
→ Monitor
→ Roll Back if Needed
```

Jarvis does not grade his own success without evidence.

Changes to self-editing, approvals, auth, daemon control, memory rewrite logic, or deployment behavior require explicit high-trust review.

---

# Architecture Principles

Use the existing Jarvis architecture before inventing a new one.

Route agent behavior through:

* `server/agent/harness.ts`
* model routing
* tool policy
* approval receipts
* job queues
* deliverable surfaces

Keep memory changes:

* reviewable
* provenance-aware
* correctable
* deletable
* explainable

Keep daemon and device powers:

* sandboxed
* logged
* approval-gated
* recoverable

Keep user-facing UX productized.

Avoid exposing raw CLI/setup details unless they are advanced fallback paths.

---

# Do Not

Do not bypass the existing harness, tool, approval, or job architecture.

Do not add unrestricted daemon powers.

Do not hardcode assumptions for one hardware vendor.

Do not build always-on camera or spatial memory before privacy, consent, retention, and review controls exist.

Do not move major folders without a dedicated refactor plan and checks.

Do not put workflow, routing, tool policy, or repo operations into `SOUL.md`.

Do not let autonomous agents directly perform irreversible actions without approval.

Do not allow self-improvement loops to modify their own guardrails without explicit review.

---

# Roadmap Priorities

Current roadmap focus is hardening the in-progress autonomy and ambient OS surfaces.

Prioritize:

1. Better observability for background jobs, deliverables, approvals, and retries
2. User-facing memory correction, deletion, provenance, and SOUL controls
3. Daemon safety, audit trails, sandbox defaults, and recovery
4. Connected-account workflow validation in production
5. Wearable OS event schema
6. Device adapter interfaces and capability negotiation
7. Wearable HUD foundations
8. Voice loop hardening
9. Manual vision capture
10. Spatial runtime primitives

Do not chase new surfaces before the core loop is reliable:

```txt
Sense
→ Remember
→ Synthesize
→ Decide
→ Act
→ Review
→ Learn
```

---

# Definition of Done

A change is not done until:

* the smallest useful implementation is complete
* existing architecture patterns are respected
* relevant tests/build checks have been run or skipped with a reason
* risks and follow-up work are noted
* user-facing behavior is summarized
* no unrelated files were modified
* approval boundaries remain intact

For autonomous or self-improving work, also confirm:

* what was changed
* why it was changed
* what evidence supports the change
* how it was verified
* how to roll it back

---

# Default Agent Behavior

When working in this repo:

1. Read the relevant contracts first.
2. Inspect existing implementation before proposing new systems.
3. Prefer small, durable changes.
4. Keep risky actions approval-gated.
5. Preserve user trust over speed.
6. Make work observable.
7. Leave the repo safer and clearer than you found it.

Jarvis is allowed to become more capable.

Jarvis is not allowed to become less accountable.
