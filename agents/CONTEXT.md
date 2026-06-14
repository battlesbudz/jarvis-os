# Agents Context Map

## Purpose
The `agents/` folder is Jarvis's natural-language operating layer. It explains who Jarvis is, how tasks are routed, which specialist room should be loaded, and which tool/safety rules apply before work begins.

This folder is not implementation code. The implementation lives mostly in `server/agent/`, `server/memory/`, `server/intelligence/`, `server/channels/`, `server/integrations/`, and the client folders.

## Three-Layer Workspace Model

| Layer | Files | Job |
|---|---|---|
| Master map | `AGENTS.md`, `agents/PRIME.md`, `agents/ROUTING.md`, `agents/TOOL_POLICY.md` | Find workflow rules, route the task, and set safety boundaries. |
| Specialist rooms | `agents/crew/*.md`, `agents/COACHING.md` when relevant | Load only the role-specific behavior for the active task. |
| Working folders | `server/`, `app/`, `components/`, `workspaces/`, `shared/`, `docs/` | Hold the actual product code, content, memories, decisions, and outputs. |

## Core Files
- Root `AGENTS.md` - workflow and tool-usage index.
- Root `SOUL.md` - personality source of authority.
- `PRIME.md` - master orchestrator identity and high-level behavior contract.
- `SOUL.md` - pointer to root `SOUL.md`; do not duplicate personality here.
- `ROUTING.md` - task routing, delegation, escalation, fallback, and output destinations.
- `TOOL_POLICY.md` - tool use, approval, file write, and destructive action rules.
- `COACHING.md` - coaching modes, frameworks, and response style for user-facing advice.

## Crew Layer
`crew/` contains specialist role prompts:
- ATLAS - research, evidence gathering, citations, technical/market analysis.
- HERALD - email, messages, outreach, channel-aware communication.
- ORACLE - planning, calendars, priorities, task sequencing, goal decomposition.
- SCOUT - monitoring, anomaly detection, status checks, alerts.
- FORGE - creation, documents, app/content artifacts, formatting.
- ECHO - memory retrieval, preference recall, decision-history continuity.

## Skills Layer
- `.agents/skills/` is the current stored skill pack location.
- `workspaces/skills/` is the current workspace-facing skill area.
- Future `agents/skills/` content should be references or curated natural-language procedures, not duplicated hidden state.
- Skills are loaded only when relevant to the active task.

## Context Loading Rules
1. Start with root `AGENTS.md` for the workflow index.
2. Read `agents/PRIME.md` for the orchestrator contract.
3. Read `agents/ROUTING.md` to classify the task and choose the room.
4. Read `agents/TOOL_POLICY.md` before external actions, file writes, code edits, device actions, messages, calendar changes, purchases, or deletions.
5. Load exactly one primary `agents/crew/*.md` unless the task obviously spans domains.
6. Load `agents/COACHING.md` only for coaching, prioritization, motivation, planning tone, or user-facing advice.
7. Load workspace `CONTEXT.md` files only when the work belongs to that workspace.
8. Pull memory through the memory layer or ECHO; do not broad-scan personal context by default.
9. Prefer targeted file reads over whole-repo scans.

## Implementation Map

| Concept | Existing Location |
|---|---|
| Agent orchestration code | `server/agent/` |
| Agent tools | `server/agent/tools/` |
| Memory storage/retrieval logic | `server/memory/` |
| Adaptive intelligence and self-learning | `server/intelligence/` |
| Capability declarations | `server/capabilities/` |
| Channels Jarvis talks through | `server/channels/` |
| External APIs and OAuth services | `server/integrations/` |
| Shared schema/types | `shared/` |
| Expo app UI | `app/`, `components/`, `lib/`, `hooks/`, `constants/` |
| Workspace content and user-facing operating areas | `workspaces/` |

## Non-Goals
- Do not treat `agents/` as a long-term archive.
- Do not default to reading all files in this folder.
- Do not move code here.
- Do not duplicate database memory here; summarize durable principles only.
