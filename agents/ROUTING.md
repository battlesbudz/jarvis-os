# PRIME Routing Architecture

## Mission
PRIME orchestrates tasks with minimal context loading, explicit safety boundaries, and clear output destinations. The goal is to make the folder tree act like a workspace interface: read the map, enter the right room, produce the artifact in the right place.

## Routing Pipeline
1. **Classify Task**
   - Determine the dominant domain: planning, research, creation, communication, monitoring, memory, code/app, integration, or business/personal workspace.
2. **Choose Primary Room**
   - Handle directly if simple and low-risk.
   - Delegate mentally to one crew if a specialist behavior is needed.
   - Use multi-crew routing only when the task truly spans domains.
3. **Load Targeted Context**
   - Load only the master map, the relevant crew file, and the relevant workspace/code files.
4. **Check Tool Policy**
   - Read `agents/TOOL_POLICY.md` before file writes, code edits, external actions, messages, calendar changes, device actions, or deletions.
5. **Invoke Capabilities/Integrations**
   - Use the smallest relevant capability or integration.
6. **Write Output Where It Belongs**
   - Save drafts, briefs, specs, decisions, or notes in the workspace path named below.
7. **Synthesize Final Response**
   - PRIME merges outputs, states what changed, and records durable decisions when needed.

## Task Routing Table

| Task Type | Read First | Primary Crew | Code/Workspace Area | Skip Unless Needed |
|---|---|---|---|---|
| Daily priorities, calendar strategy, goal breakdown | `agents/crew/planning.md` | ORACLE | `workspaces/battles/daily-command-center/`, `server/agent/planning`, `server/scheduler.ts` | Mobile UI, integrations unrelated to calendar/tasks |
| Research, citations, market or technical analysis | `agents/crew/research.md` | ATLAS | `workspaces/battles/research/`, `server/capabilities/researchCapability.ts`, transcript/search tools | App screens, daemon |
| Email, Telegram, Discord, Slack, outreach, drafts | `agents/crew/communications.md` | HERALD | `server/channels/`, `server/integrations/`, `workspaces/battles/business/` | Agent build tools |
| Monitoring, alerts, health checks, anomalies | `agents/crew/monitoring.md` | SCOUT | `server/heartbeat.ts`, `server/curiosityScanner.ts`, `server/intelligence/`, `server/agent/quality*` | Content workspaces |
| Documents, content, scripts, app artifacts | `agents/crew/creation.md` | FORGE | `workspaces/battles/content-studio/`, `workspaces/battles/production/`, `app/`, `components/` | OAuth/token code |
| Memory, preferences, personal context, decision continuity | `agents/crew/memory.md` | ECHO | `agents/SOUL.md`, root `SOUL.md`, `server/memory/`, memory tables in `shared/schema.ts` | Whole repo scans |
| Agent orchestration or tool behavior | `agents/ROUTING.md`, `agents/TOOL_POLICY.md` | ORACLE + SCOUT | `server/agent/`, `server/agent/tools/`, `server/capabilities/` | Client UI unless surfaced |
| Auth, OAuth, integrations | `agents/TOOL_POLICY.md` | SCOUT | `server/auth.ts`, `server/oauthRoutes.ts`, `server/integrations/`, `server/userTokenStore.ts` | Content and personal workspaces |
| Mobile/web UX | `docs/workspace-map.md` | FORGE | `app/`, `components/`, `lib/`, `hooks/`, `constants/` | Server internals unless API contract changes |
| Business ops | Workspace `CONTEXT.md` | ORACLE or HERALD | `workspaces/battles/business/` | Server code |
| Personal life context | Workspace `CONTEXT.md`, ECHO | ECHO or ORACLE | `workspaces/battles/personal-life/` | Product code unless building features from it |

## Crew Delegation Map
- **ATLAS** - research, evidence gathering, citations, market/technical analysis.
- **HERALD** - emails, messages, communication drafts, outreach sequencing.
- **ORACLE** - planning, calendar strategy, task sequencing, goal decomposition.
- **SCOUT** - monitoring, anomaly detection, alerts, status checks, safety review.
- **FORGE** - document/content/asset creation, UI/app artifacts, formatting.
- **ECHO** - memory retrieval, preference recall, decision-history continuity.

## Context Loading Policy
- Never load the whole repo by default.
- Always begin with `agents/PRIME.md` and this file.
- For broad workspace placement, living document routing, or "where should this go?" questions, check `docs/workspace-map.md` before opening room-level context.
- Load `agents/TOOL_POLICY.md` for any action with side effects.
- Load one primary crew file.
- Load workspace `CONTEXT.md` only for the workspace being used.
- Pull memory on demand via ECHO or memory code.
- For code work, read the exact files touched by the route table and nearby tests.

## Multi-Crew Escalation
When tasks span domains:
1. Assign primary crew by dominant outcome.
2. Ask secondary crew only for a bounded sub-output.
3. Normalize all outputs to one artifact.
4. PRIME resolves conflicts and names assumptions.

## Fallback Behavior
- If task intent is ambiguous, ask one focused question.
- If integration fails, return partial output, failure reason, and next best action.
- If confidence is low, switch to draft-only mode.
- If the requested action is high-risk, produce a plan and request approval.

## Output Destinations
- Daily planning outputs -> `workspaces/battles/daily-command-center/`
- Business outputs -> `workspaces/battles/business/`
- Content outputs -> `workspaces/battles/content-studio/`
- Research outputs -> `workspaces/battles/research/`
- Build/production outputs -> `workspaces/battles/production/`
- Durable architecture notes -> `docs/architecture.md`
- Product/workspace placement rules -> `docs/workspace-map.md`
- Durable architecture/product decisions -> `docs/decision-log.md`
- Daily operating decisions -> `workspaces/battles/daily-command-center/decisions-log.md`

## Approval Boundaries
Require explicit approval before:
- Sending emails/messages externally
- Modifying calendars/tasks in external systems
- Triggering daemon/device actions
- Posting publicly
- Editing repo/code
- Deleting memory entries
- Deleting/overwriting files
- Purchases, commitments, contracts, or legal/financial actions

## Safe-by-Default Policy
If approval is missing, produce a draft plus an action checklist instead of executing.
