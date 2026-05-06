# Jarvis Workspace Map

## Purpose
This is the durable index for Jarvis's folder-brain. Use it with `agents/PRIME.md`, `agents/ROUTING.md`, and the nearest workspace `CONTEXT.md`.

This file answers:
- Where work belongs.
- Which files are canonical.
- Which files are living documents.
- Which files are approval-sensitive.
- Which files Jarvis may append to automatically.
- Which files require explicit approval before changing or acting on.

## Routing Order
1. Read `agents/PRIME.md`.
2. Read `agents/ROUTING.md`.
3. Use this map to choose the workspace and canonical files.
4. Read the target workspace `CONTEXT.md`.
5. Read the smallest matching work file.
6. Check `agents/TOOL_POLICY.md` before side effects, external actions, code edits, memory edits, or official business/compliance actions.

## Top-Level Workspace Index

| Area | Purpose | Read First | Canonical Outputs | Approval Sensitivity |
|---|---|---|---|---|
| `agents/` | Jarvis identity, routing, tool policy, crew behavior, reusable skills | `agents/PRIME.md`, `agents/ROUTING.md`, `agents/TOOL_POLICY.md` | Router docs, crew instructions, skills | High. Core behavior changes require explicit approval. |
| `workspaces/battles/` | Battles personal/business operating workspace | `workspaces/battles/CONTEXT.md` | Plans, decisions, business docs, research, production notes | Medium to high depending on room. |
| `workspaces/battles/daily-command-center/` | Current state, priorities, open loops, decisions, next actions | `workspaces/battles/daily-command-center/CONTEXT.md`, `current-state.md` | Daily plans, priority stacks, decision notes | Medium. Do not create external commitments without approval. |
| `workspaces/battles/business/` | Business operations for Battles Budz, Battle Brew, partnerships, offers | `workspaces/battles/business/CONTEXT.md` | Business plans, partner drafts, SOP drafts, investor notes | High. Finance, legal, compliance, outreach require approval. |
| `workspaces/battles/content-studio/` | Public-facing and internal content work | `workspaces/battles/content-studio/CONTEXT.md` | Ideas, scripts, drafts, final copy | Medium. Publishing/sending requires approval. |
| `workspaces/battles/production/` | Turning plans into briefs, specs, builds, outputs | `workspaces/battles/production/CONTEXT.md` | Briefs, specs, build notes, packaged outputs | Medium. External publishing or code changes require approval. |
| `workspaces/battles/research/` | Evidence, citations, market/legal/technical research | `workspaces/battles/research/CONTEXT.md` | Research briefs, source notes, recommendations | Medium. Treat legal/compliance findings as research, not advice. |
| `workspaces/battles/personal-life/` | Family, health, home, routines, finances, life admin | `workspaces/battles/personal-life/CONTEXT.md` | Personal plans, routines, private context | High. Sensitive personal or financial changes require approval. |
| `app/`, `components/`, `lib/`, `hooks/`, `constants/` | Expo/mobile/web user experience | relevant screen/component files | UI changes, app screens, client helpers | High when modifying code. Requires user approval. |
| `server/` | APIs, orchestration, memory, integrations, auth, agent tools | nearby route/tool/module files | Backend behavior and integrations | High. Auth, memory, integrations, external effects require care. |
| `shared/` | Shared schema and models | `shared/schema.ts` | DB schema and shared types | High. Schema changes affect persistence. |
| `migrations/` | Database migrations | latest migration number | SQL migrations | High. DB changes require approval and verification. |
| `docs/` | Durable architecture/product/workspace documentation | this file, `docs/architecture.md`, `docs/decision-log.md` | Architecture docs, decision logs, workspace maps | Medium. Durable docs should be accurate and sourced. |

## Battles Budz Living Document Index

These are the highest-priority living docs right now because Battles's current mission is final licensing, compliant operational readiness, product readiness, and first revenue.

| Business Area | Canonical File | Use For | Living Updates | Approval Needed Before |
|---|---|---|---|---|
| Licensing / OCM | `workspaces/battles/business/battles-budz/licensing/2026-05-05-licensing-readiness-checklist-draft-v1.md` | Final approval status, OCM requirements, application blockers, regulator notes | Yes, target `licensing_readiness` | Regulatory communication, official documents, licensing claims |
| Compliance | `workspaces/battles/business/battles-budz/compliance/2026-05-05-compliance-readiness-checklist-draft-v1.md` | SOPs, recordkeeping, inventory tracking, testing, packaging, labeling, training | Yes, target `compliance_readiness` | SOP adoption, compliance procedures, official compliance decisions |
| Facility | `workspaces/battles/business/battles-budz/facility/2026-05-05-facility-readiness-checklist-draft-v1.md` | Facility readiness, inspection, buildout, security, equipment, site blockers | Yes, target `facility_readiness` | Spending, contractor commitments, facility commitments |
| Products | `workspaces/battles/business/battles-budz/products/2026-05-05-product-readiness-matrix-draft-v1.md` | Pre-rolls, Battle Brew tea, edibles, first batch planning, product blockers | Yes, target `product_readiness` | Final formulas, pricing, packaging/labeling, production commitments |
| Revenue | `workspaces/battles/business/battles-budz/revenue/2026-05-05-first-revenue-action-plan-draft-v1.md` | Retail, distribution, processors, cultivators, first sale path, funding needs | Yes, target `first_revenue_plan` | Outreach, contracts, pricing, funding terms, sales commitments |
| Current State | `workspaces/battles/daily-command-center/current-state.md` | Cross-workspace priorities, current operating focus, pressure points | Yes, target `current_state` | Major priority shifts or real-world commitments |
| Battles Budz Context | `workspaces/battles/business/battles-budz/CONTEXT.md` | Local routing and priority stack for Battles Budz | Yes, target `battles_budz_context` | Business strategy changes that affect Jarvis behavior |

## Living Update Rules
Jarvis may append dated, source-backed "Learned Updates" to allow-listed Battles docs when:
- Battles directly states or confirms a relevant fact.
- A connected email, document, or source clearly provides relevant context.
- The update maps to one of the allow-listed living document targets.
- The update is stored as draft context with source, confidence, and approval boundary.

Jarvis must not use living updates to:
- Send messages.
- Make purchases.
- Commit to pricing, contracts, funding, loans, or agreements.
- Submit licensing/compliance documents.
- Adopt SOPs as official.
- Delete or overwrite context.
- Treat draft notes as legal, financial, or compliance advice.

Living updates are persisted in Postgres through `living_context_updates` and rehydrated into markdown when Jarvis reads or appends an allow-listed file.

## Open Questions Jarvis Should Fill Over Time

| Question | Best Target | Why It Matters |
|---|---|---|
| What is the exact current OCM/final licensing status? | `licensing_readiness` | Determines the shortest path to operation. |
| What does OCM still need before final approval? | `licensing_readiness` | Identifies blockers and required proof. |
| What is the facility inspection status and date? | `facility_readiness` | Drives readiness sequencing. |
| What facility items are still incomplete? | `facility_readiness` | Clarifies buildout, security, equipment, and site blockers. |
| Which SOPs are drafted, missing, or needing review? | `compliance_readiness` | Determines operating readiness and compliance risk. |
| What inventory, recordkeeping, testing, packaging, and labeling requirements are confirmed? | `compliance_readiness` | Prevents product/revenue planning from outrunning compliance. |
| Which product can reach market first: pre-rolls, Battle Brew, or edibles? | `product_readiness` | Focuses execution on revenue. |
| What product inputs, partners, processes, or approvals are blocking first batch? | `product_readiness` | Turns product ideas into production steps. |
| Which retailers, distributors, processors, or cultivators are realistic near-term partners? | `first_revenue_plan` | Creates a path to first compliant sale. |
| What funding gap blocks production or market entry? | `first_revenue_plan` | Keeps funding tied to execution rather than vague runway. |
| What personal financial pressure affects business sequencing? | `current_state` or `personal-life/` | Helps Jarvis plan realistically without exposing personal context broadly. |

## File Write Boundaries

| File Type | Jarvis May Do | Jarvis Must Ask Before |
|---|---|---|
| Draft workspace docs | Create or append when asked or when living-update rules apply | Deleting, overwriting, or treating as official |
| Living readiness docs | Append learned updates only | Rewriting core content, removing context, marking official |
| `agents/PRIME.md` | Read for identity/routing | Any edit |
| `agents/ROUTING.md` | Read and propose improvements | Any edit unless explicitly approved |
| `agents/TOOL_POLICY.md` | Read for safety | Any edit |
| `agents/SOUL.md`, root `SOUL.md` | Read when durable identity is relevant | Any edit |
| Code files | Read targeted files for context | Any code modification, commit, push, PR, deploy |
| Memory records | Retrieve when relevant | Delete, rewrite, or save sensitive memory |
| External systems | Draft and preview | Send, schedule, post, purchase, commit, or trigger devices |

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
- Do not store secrets or tokens in markdown.
- Do not add random drafts or working notes to the repo root.
- Do not move existing code folders without a dedicated refactor plan.
- Do not duplicate the full contents of workspace `CONTEXT.md` files here.
- Do not treat this map as a database; it is the routing index, not the source for fast-changing app state.

## Maintenance Rule
Update this file when:
- A new canonical workspace is added.
- A living document target is added or removed.
- Approval boundaries change.
- A workspace `CONTEXT.md` changes in a way that affects routing.
- A new business priority becomes more important than Battles Budz readiness.
