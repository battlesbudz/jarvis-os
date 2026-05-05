# Workspace Map

## Purpose
This document explains where new work should live. Use it with `agents/ROUTING.md`.

## Root-Level Rule
Keep the root focused on project configuration, high-level docs, and existing entry points. Do not add random drafts or working notes to root.

## Where Things Go

| Work Product | Destination |
|---|---|
| Daily plans, priorities, command-center outputs | `workspaces/battles/daily-command-center/` |
| Business strategy, partnerships, brand/business notes | `workspaces/battles/business/` |
| Content ideas, scripts, drafts, finals | `workspaces/battles/content-studio/` |
| Production briefs, specs, builds, outputs | `workspaces/battles/production/` |
| Research notes and cited summaries | `workspaces/battles/research/` |
| Personal context and life operating notes | `workspaces/battles/personal-life/` |
| Agent identity and routing docs | `agents/` |
| Durable architecture docs | `docs/` |
| Expo app screens/routes | `app/` |
| Reusable UI components | `components/` |
| Client-side helpers/state | `lib/`, `hooks/`, `constants/` |
| Server APIs and orchestration | `server/` |
| Shared schema/models | `shared/` |
| DB migrations | `migrations/` |
| Scripts and local automation | `scripts/` |
| Historical/generated artifacts | `archive/` when it exists, otherwise leave current folders untouched |

## Existing Battles Workspaces
- `workspaces/battles/CONTEXT.md` - top-level personal workspace map.
- `workspaces/battles/WORKSPACE_MAP.md` - existing local workspace map.
- `workspaces/battles/NAMING_CONVENTIONS.md` - local naming rules.
- `workspaces/battles/daily-command-center/` - priorities, open loops, daily decisions.
- `workspaces/battles/business/` - businesses and partnerships.
- `workspaces/battles/content-studio/` - scripts, drafts, and content.
- `workspaces/battles/production/` - briefs, specs, builds, outputs.
- `workspaces/battles/research/` - research work.
- `workspaces/battles/personal-life/` - personal context.
- `workspaces/battles/templates/` - reusable work product templates.

## Context File Pattern
Each workspace should have a `CONTEXT.md` that answers:
- What this workspace is for.
- What files to read first.
- What files to skip.
- Naming conventions.
- Output destinations.
- Approval boundaries.

## Naming Pattern
Use descriptive, searchable names:
- Dates: `YYYY-MM-DD-topic.md`
- Drafts: `topic-draft-v1.md`, `topic-draft-v2.md`
- Finals: `topic-final.md`
- Briefs: `topic-brief.md`
- Specs: `topic-spec.md`
- Decisions: `YYYY-MM-DD-decision-topic.md`

## Do Not
- Do not mix personal life context into product code folders.
- Do not store secrets or tokens in Markdown.
- Do not use workspace docs as a database replacement for frequently changing app state.
- Do not move existing code folders without a dedicated refactor plan.
