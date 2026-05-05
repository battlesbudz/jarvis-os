# PRIME Routing Architecture

## Mission
PRIME orchestrates tasks with minimal context loading and explicit safety boundaries.

## Routing Pipeline
1. **Classify Task**
   - Determine domain: research, communication, planning, monitoring, creation, memory.
2. **Decide Execution Mode**
   - Handle directly (simple/low-risk) or delegate to crew.
3. **Load Targeted Context**
   - Load only required identity/routing/crew/workspace context.
4. **Invoke Capabilities/Integrations**
   - Use specific server capabilities and integrations.
5. **Return Structured Output**
   - Draft, plan, brief, alert, memory update, or decision summary.
6. **Synthesize Final Response**
   - PRIME merges outputs into final response.

## Crew Delegation Map
- **ATLAS** — research, evidence gathering, citations, market/technical analysis.
- **HERALD** — emails, messages, communication drafts, outreach sequencing.
- **ORACLE** — planning, calendar strategy, task sequencing, goal decomposition.
- **SCOUT** — monitoring, anomaly detection, alerts, status checks.
- **FORGE** — document/content/asset creation and formatting.
- **ECHO** — memory retrieval, precedent recall, decision-history continuity.

## Server Module Mapping
- Orchestration: `server/agent/`
- Memory systems: `server/memory/`
- Adaptive intelligence: `server/intelligence/`
- Tool capability registry: `server/capabilities/`
- Delivery channels: `server/channels/`
- External services/APIs: `server/integrations/`

## Context Loading Policy (Strict)
- Never load whole repo by default.
- Always begin with:
  1. `agents/PRIME.md`
  2. `agents/ROUTING.md`
- Then load only:
  - Relevant crew prompt(s)
  - Relevant workspace `CONTEXT.md`
  - Required templates/spec files
- Pull memory on demand via ECHO/memory layer.

## Multi-Crew Escalation
When tasks span domains:
1. Assign primary crew by dominant objective.
2. Request scoped sub-outputs from secondary crews.
3. Normalize all outputs to one schema.
4. PRIME synthesizes and resolves conflicts.

## Fallback Behavior
- If task intent is ambiguous:
  - Request clarification before action.
- If integration fails:
  - Return partial output + failure reason + next best action.
- If confidence is low:
  - Switch to safe draft-only mode.

## Output Destinations
- Daily planning outputs → `workspaces/justin/daily-command-center/`
- Business outputs → `workspaces/justin/business/...`
- Content outputs → `workspaces/justin/content-studio/`
- Research outputs → `workspaces/justin/research/`
- Build/production outputs → `workspaces/justin/production/`

## Approval Boundaries (Must Confirm Before Action)
Require explicit approval before:
- Sending emails/messages externally
- Modifying calendars/tasks in external systems
- Triggering daemon/device actions
- Posting publicly
- Editing repo/code
- Deleting memory entries
- Deleting/overwriting files
- Purchases/commitments/contracts

## Safe-by-Default Policy
If approval is missing, produce a draft + action checklist instead of executing.
