# Agents Context Map

## Purpose
The `agents/` folder defines Jarvis's internal decision layer: identity, routing logic, specialist crews, and reusable prompt procedures.

## Core Files
- `PRIME.md` — master orchestrator identity and high-level behavior contract.
- `SOUL.md` — personality seed and memory anchor.
- `ROUTING.md` — task routing, delegation, escalation, fallback, and approval boundaries.

## Crew Layer
- `crew/` contains specialist role prompts:
  - ATLAS (research)
  - HERALD (communications)
  - ORACLE (planning)
  - SCOUT (monitoring)
  - FORGE (creation)
  - ECHO (memory)

## Skills Layer
- `skills/` contains reusable procedures/checklists/templates used by PRIME or crews.
- Skills are loaded only when needed for the active task.

## Context Loading Rules
1. PRIME classifies intent before loading context.
2. PRIME loads only the minimum required files.
3. Crew-specific context is loaded on delegation.
4. Workspace/business/personal context is loaded only when task-relevant.
5. Historical memory is fetched through memory systems, not broad file scans.

## Read Order (Default)
1. `agents/PRIME.md`
2. `agents/ROUTING.md`
3. Relevant `agents/crew/*.md`
4. Relevant `agents/skills/*`
5. Relevant workspace context docs

## Non-Goals
- Do not treat `agents/` as a long-term archive.
- Do not default to reading all files in this folder.
