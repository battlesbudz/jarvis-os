# Battles Workspace Context

## Purpose
This is the top-level personal operating workspace for Battles. It gives Jarvis a durable map for daily execution, business work, content, production, research, and personal-life planning without requiring the agent to scan every folder.

Use this file as the room selector. Do not use it as the place to store deep details, drafts, private notes, or completed work.

## When PRIME Should Use This
- The user asks for help deciding where something belongs.
- The user asks "what should I do next?" and the task spans multiple areas.
- The user provides a loose idea that could become business, content, research, or production work.
- The user wants a new workspace artifact created.
- Jarvis needs to route a task before loading a domain-specific `CONTEXT.md`.

## Workspace Rooms
| Room | Use For | Primary Crew | Typical Outputs |
|---|---|---|---|
| `daily-command-center/` | Priorities, open loops, decisions, current state, next actions | ORACLE, SCOUT | Daily plans, priority stacks, decision notes |
| `business/` | Battles Budz, Battle Brew, Homegrower Circle, partnerships, ops | ORACLE, HERALD, ATLAS | SOPs, investor updates, partner briefs, compliance notes |
| `content-studio/` | Ideas, scripts, drafts, final copy, repurposing | FORGE, HERALD | Scripts, posts, email variants, content packages |
| `production/` | Turning plans into deliverable briefs, specs, builds, outputs | FORGE, ORACLE | Briefs, specs, build notes, packaged deliverables |
| `research/` | Evidence, citations, market/legal/technical exploration | ATLAS | Research briefs, source notes, recommendations |
| `personal-life/` | Family, health, home, routines, finances, life admin | ECHO, ORACLE | Checklists, trackers, routines, personal plans |
| `templates/` | Reusable artifact scaffolds | FORGE, HERALD, ATLAS | Draft templates and standardized formats |

## Read First
1. `docs/workspace-map.md`
2. `NAMING_CONVENTIONS.md`
3. The target room `CONTEXT.md`
4. The smallest set of existing files needed to continue the task

## Current Highest-Priority Living Docs
Battles Budz readiness docs are the top living workspace documents right now. For licensing, compliance, facility, product readiness, or first-revenue facts, route through `docs/workspace-map.md` and the Battles Budz `CONTEXT.md` before reading or appending to a readiness file.

## Routing Rules
- If the request is about today's focus, decisions, commitments, or "next step", route to `daily-command-center/`.
- If the request names Battles Budz, Battle Brew, Homegrower Circle, customers, partners, investors, vendors, offers, licensing, or operations, route to `business/`.
- If the request is meant to become public-facing writing, route to `content-studio/`.
- If the request is about making a deliverable, app artifact, packaged output, brief, spec, or build, route to `production/`.
- If the request needs evidence, legal caution, citations, competitors, market facts, or technical standards, route to `research/`.
- If the request is about life admin, family, health, home, routines, or finances, route to `personal-life/`.
- If the task uses a repeated format, check `templates/` before inventing a new structure.

## Scope Discipline
- Load only the relevant room and the one matching `CONTEXT.md`.
- Do not load personal-life files for business work unless the user asks for scheduling or life/business tradeoffs.
- Do not load business-line folders unrelated to the named business.
- Do not load research history unless the task needs evidence or citations.
- Do not turn this workspace into application source code; code belongs in repo code folders, and planning artifacts belong here.

## Output Rule
All new outputs should go into the narrowest matching destination folder. If a task is unclear, create a short note in `daily-command-center/open-loops.md` or ask one focused question before creating a new artifact.

## Handoff Back To PRIME
When finishing a workspace task, tell PRIME:
- What room was used.
- What file was read or created.
- What decision or next action should be remembered.
- Whether any follow-up belongs in another room.
