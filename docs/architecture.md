# Jarvis Architecture

## Purpose
This document makes the existing repo understandable to future humans and agents without forcing a folder refactor. It is a map, not a mandate to move files.

## Conceptual Split

| Layer | Existing Location | Meaning |
|---|---|---|
| Identity and routing | root `AGENTS.md`, `SOUL.md`, `agents/` | Natural-language brain: personality, workflow index, PRIME, routing, tool policy, specialist crews. |
| Agent orchestration | `server/agent/` | Runtime loop, tools, jobs, approvals, policies, subagents, project execution. |
| Memory | `server/memory/`, root `SOUL.md` | Retrieval, extraction, long-term continuity, personality anchor. |
| Adaptive intelligence | `server/intelligence/` | Ego, gut, emotional state, predictions, validation, skill writing. |
| Capabilities | `server/capabilities/` | What Jarvis knows it can do. |
| Channels | `server/channels/` | Where Jarvis talks: in-app, Discord, Telegram, Slack, WhatsApp, daemon. |
| Integrations | `server/integrations/` | External services and OAuth/API clients. |
| Client app | `app/`, `components/`, `lib/`, `hooks/`, `constants/` | Expo mobile/web experience. |
| Shared contract | `shared/` | Schema and shared models. |
| Workspace content | `workspaces/` | User/business/content/research/production operating areas. |

## Current Architecture Notes
- Root `SOUL.md` is the personality source of authority.
- Root `AGENTS.md` is the workflow and tool-usage index.
- `agents/PRIME.md` is the canonical master orchestrator contract.
- `agents/SOUL.md` remains only as a pointer to root `SOUL.md`.
- `server/routes.ts` is large and central. New route groups should prefer dedicated route modules when possible.
- `server/agent/` is intentionally broad today. Use `agents/ROUTING.md` to know which part matters before reading it.
- `workspaces/battles/` is the user-facing operating system layer for daily, business, content, research, and production work.

## Design Principle
Make routing visible before moving code. The fastest way to improve Jarvis is to help future agents know where to look, what to skip, which tools are allowed, and where outputs belong.

## Jarvis OS Foundation
The Jarvis OS Foundation is the reliability layer that sits above the existing server and agent modules. It does not replace the current architecture. It defines a readiness contract, a doctor command, a first-pass autonomy policy, and smoke tests that prove Jarvis can safely decide between inline answers, background jobs, and approval-gated actions.

This layer exists so Jarvis runtime capabilities can be added incrementally without turning setup and debugging into guesswork.

## Suggested Future Refactors
Do these only as separate implementation tasks with tests/checks:
- Consolidate duplicate identity anchors after verifying all loaders.
- Split large route handlers into focused route modules.
- Group `server/agent/` by orchestration, planning, execution, safety, quality, and tools.
- Move client/daemon folders under a `clients/` folder only after import/script/deploy paths are mapped.
