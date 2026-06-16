# Jarvis OS Technical Roadmap

> Living document - updated as features are built and shipped.
> Last updated: June 15, 2026
> Public summary: `ROADMAP.md`

---

## Technical Vision

Transform Jarvis from its original coaching roots into a personal AI operating system that works, researches, builds, remembers, routes, and acts across trusted accounts and devices. Jarvis OS is its own runtime foundation: Express + Drizzle + Expo, a tool-calling harness, background jobs, reviewable deliverables, long-term memory, channels, approval gates, and desktop/Android connector control.

**Core principle:** autonomous work must produce reviewable outputs, respect approval boundaries, and stay observable.

---

## Progress Overview

| Phase | Name | Status |
|-------|------|--------|
| Foundation | What Jarvis could already do | Complete |
| Phase 0 | Jarvis OS Foundation | Complete |
| Phase 1 | Action Engine - Give Jarvis Hands | Complete |
| Phase 2 | Autonomous Heartbeat - Act Without Being Asked | Complete |
| Phase 3 | Sub-Agent Goals - Work While You Sleep | In progress |
| Phase 4 | Memory & Learning - Gets Smarter Every Week | In progress |
| Phase 5 | Multi-Channel & Computer Control | In progress |
| Phase 6 | Self-Improving / Build-Agent Layer | In progress |

---

## What Is Left

- Harden full end-to-end production verification with real connected accounts: Google, Gmail, Drive, Slack, WhatsApp, Discord, Telegram, daemon, and database-backed jobs.
- Finish the user-facing project tree experience for decomposed goals: goal phases, milestones, pacing, progress rollups, and daily-plan insertion.
- Complete approval UX polish for all autonomous deliverables, especially edit/revise/approve flows across mobile, web, and external channels.
- Make memory review and SOUL updates more controllable: clearer pending-review flows, manual correction, deletion, and explanation of why Jarvis learned something.
- Finish relationship intelligence as a first-class product surface: richer people profiles, interaction timeline, and meeting/email context confidence.
- Validate WhatsApp and Slack as full two-way channels in production, including slash commands, channel preferences, pairing, and fallback behavior.
- Finish daemon safety hardening: per-action approvals, audit trails, sandbox defaults, timeout handling, and recovery from disconnected desktop/Android nodes.
- Add stronger observability dashboards for autonomy decisions, job queue health, channel delivery, tool failures, memory extraction, and approval-gate outcomes.
- Continue the Cloud Workforce queue: broaden live worker progress events beyond ephemeral workers and connect every approval gate to a visible worker checkpoint.
- Keep expanding tests from unit/assertion coverage into realistic integration tests that fake DB/job/channel dependencies and prove user workflows.

---

## Completed Foundation

- [x] Morning plan auto-generation
- [x] Curiosity scanner / proactive scheduler lineage
- [x] Gmail draft creation and Gmail label actions
- [x] Web search and research tools
- [x] Momentum session sequencing
- [x] Voice input/output and realtime voice route support
- [x] Telegram bot with task, email, and coach control
- [x] XP, streaks, gamification, energy-aware planning
- [x] Inbox rules with auto-learning
- [x] Outlook and Google Calendar integrations
- [x] Multi-account Google support
- [x] Basic Slack integration
- [x] Image understanding in chat
- [x] Pattern analysis and weekly review endpoint

---

## Phase 0 - Jarvis OS Foundation

**Status:** Complete

This was added after the original roadmap to make the system dependable before deeper autonomy.

- [x] `jarvis:doctor` readiness command
- [x] `jarvis:check` command that runs doctor plus tests
- [x] OS readiness contract in `server/diagnostics/osReadiness.ts`
- [x] Deterministic autonomy policy in `server/agent/autonomyPolicy.ts`
- [x] Autonomy runtime that routes obvious background work into jobs
- [x] Smoke flow proving inline / queued / approval-gated behavior
- [x] Operations runbook in `docs/operations/jarvis-os-runbook.md`
- [x] Architecture note documenting the foundation layer
- [x] Tests wired into `scripts/run-agent-tests.mjs`

---

## Phase 1 - Action Engine (Give Jarvis Hands)

**Status:** Complete

### 1.1 - Tool-Use Loop in the AI Brain

- [x] Tool-calling harness exists in `server/agent/harness.ts`
- [x] Model can call tools, receive results, call more tools, and then answer
- [x] Tool execution is gated through hooks, integration checks, approval receipts, and tool-error reporting
- [x] Tool calls are recorded with duration, result, and finish reason
- [x] Tool-aware routing exists for research, weather, calendar, email, memory, browser, GitHub, Railway/app-build, and code-writing requests

### 1.2 - Autonomous Web Research Tool

- [x] Research tools include web search, web fetch, YouTube search/transcripts, video transcript, X search, and topic research
- [x] Research jobs can run asynchronously through the agent job queue
- [x] Research deliverables are saved and surfaced for review
- [x] Source checks warn when research output lacks real cited URLs
- [x] Deep research can decompose, run child research jobs, synthesize, and deliver one report

### 1.3 - File / Document Creation Tool

- [x] Document tools exist: create, list, read, export PDF, and presentation creation
- [x] Writing jobs can generate PDF output
- [x] Deliverables are persisted in the review inbox
- [x] Generated files can be attached to channel notifications when supported

### 1.4 - Google Drive Integration

- [x] Drive tools exist: create file, list files, read file
- [x] Writing PDFs can be saved to Google Drive when Google tokens are available
- [x] Weekly reviews and evening wrap-ups can save markdown/docs to Drive
- [x] Deliverables support Drive links and a "save to Drive" action

---

## Phase 2 - Autonomous Heartbeat (Act Without Being Asked)

**Status:** Complete

### 2.1 - HEARTBEAT Redesign

- [x] `JARVIS_HEARTBEAT.md` action checklist exists
- [x] Heartbeat runs on a five-minute interval when Telegram is configured
- [x] Silent-by-default behavior is documented and implemented
- [x] Heartbeat does not duplicate morning brief ownership
- [x] Activation planner informs heartbeat without blocking deterministic action jobs

### 2.2 - Autonomous Meeting Research Briefings

- [x] Calendar events 30-60 minutes ahead are scanned
- [x] External attendees are detected
- [x] Email history, memory, people records, and light web search are used for context
- [x] Three-bullet meeting briefs are sent through notification preferences
- [x] Dedupe prevents repeated briefs for the same event/day

### 2.3 - Autonomous Email Draft Queue

- [x] Reply-needed inbox items are detected from email alert classifier output
- [x] Reply drafts are generated and stored in `email_drafts`
- [x] Draft queue appears in the Inbox tab
- [x] Approval saves the reply into Gmail drafts
- [x] Draft nudges notify the user without auto-sending

### 2.4 - End-of-Day Autonomous Wrap-Up

- [x] Configurable evening wrap-up hour exists
- [x] Wrap-up reviews daily plan completions, stats, streaks, and XP
- [x] Summary is sent through user notification preferences
- [x] Reflection can be saved to the user's Jarvis Workspace Drive folder
- [x] Dedupe prevents duplicate wrap-ups per day

### 2.5 - Additional Heartbeat Work Already Added

- [x] Nervous System watch-topic signal scan
- [x] Dream Cycle insight synthesis
- [x] Prediction validation
- [x] Emotional state recomputation
- [x] Gut anomaly scan
- [x] Hourly memory and people ingestion pass
- [x] Agent health checks for stuck loop agents and platform liveness

---

## Phase 3 - Sub-Agent Goals (Work While You Sleep)

**Status:** In progress

### 3.1 - Goal Decomposition Engine

- [x] Goal decomposition module exists in `server/agent/goalDecomposer.ts`
- [x] `goal_decompose` jobs are supported by the job queue
- [x] Goal card and goal tree UI components exist
- [x] Goals tab project trees now support phase, milestone, and task editing with add/delete controls, persisted API updates, progress rollups, and next-task visibility
- [x] Goal-tree tasks can now be intentionally handed off into today's plan from the project tree without duplicating existing daily-plan tasks
- [x] Goal-tree handoff controls now show when a task is already in today's plan
- [x] Morning-plan generation can automatically insert next-ready decomposed goal tasks into daily plans over time
- [x] Goal task pacing now factors in completion rate, today's energy, and a light/balanced/ambitious user setting
- [x] Goal pacing now falls back to recent energy patterns when today's energy check-in is missing
- [x] Goal pacing now reduces task pressure on already-heavy plan days and weak same-weekday completion patterns
- [x] Goal pacing now reacts to near-term goal/commitment deadlines and timed/calendar-heavy daily plans
- [x] Project trees now show phase collapse controls, current/overdue/next task states, a generated-plan review strip, and recent daily handoff history
- [x] Finish advanced project-tree UX polish: reorder controls and deeper generated-plan review controls
- [ ] Replace timed-task calendar-load proxy with first-class persisted calendar-event density once calendar workload is stored consistently

### 3.2 - Background Job Runner

- [x] Persistent `agent_jobs` table exists
- [x] Job worker claims queued jobs, recovers stale running jobs, and handles cancellation
- [x] Jobs support research, deep research, writing, planning, email, weekly pattern, goal decomposition, named-agent tasks, and build-feature work
- [x] Job status is visible in the Inbox tab
- [x] Mission Control has a real queue/review panel backed by `agent_jobs`, approval gates, and deliverables
- [x] Retry and cancel flows exist for jobs
- [x] Worker runtime metadata records worker type, retry policy, user-visible progress events, and approval checkpoints
- [x] Ephemeral worker jobs emit visible progress while preparing the temporary worker, running it, preparing the review deliverable, and making the deliverable ready for review
- [x] Add richer job observability and admin/debug screens with `/api/agent-jobs/observability` and a compact Settings health panel
- [x] Add stronger recovery/partial-failure coverage for retry decoration and permanent-failure classification
- [ ] Broaden live worker progress events across research, coding, outreach, browser, form-fill, finance, and goal-task jobs
- [ ] Wire all approval-gate creation paths into worker runtime `approval_required` checkpoints
- [ ] Expand DB-backed worker restart recovery tests when a test database is available

### 3.3 - Sub-Agent Spawning

- [x] Sub-agent runtime exists in `server/agent/subagents.ts`
- [x] `spawn_subagent`, `queue_background_job`, `sessions_*`, and named-agent tools exist
- [x] Specialized agent types include research, deep research, writing, planning, email, build feature, and named/custom agents
- [x] Agent manager, custom agent routes, and Discord/Telegram channel assignment exist
- [ ] Finish isolated context and permissions UX for custom agents
- [ ] Add clearer "main Jarvis synthesized this from sub-agents" user-facing trace

### 3.4 - Deliverable Inbox

- [x] `deliverables` table exists
- [x] Inbox tab surfaces deliverables, active jobs, failed jobs, email drafts, approval gates, and auto-handled items
- [x] Deliverables support approve, discard, edit, revise, and save-to-Drive flows
- [x] Approval gates are stored as deliverables and can continue approved work
- [x] Deliverable review actions now share a tested policy so approval gates cannot be edited, revised, discarded, or saved to Drive through direct API calls
- [x] DB-backed deliverable review action guard proves valid and invalid actions against real persisted deliverables when `DATABASE_URL` is available
- [x] Deliverable review endpoints can now be mounted as a slim HTTP route slice for focused API-boundary tests
- [x] Slim HTTP route coverage now verifies approval-gate approve/decline continuations and revision job queueing with mocked side-effect dependencies
- [x] Inbox review UX can open long deliverables in a full reader and show revision lineage when a deliverable is a revised version
- [ ] Add richer side-by-side revision comparison and restore-from-version controls

---

## Phase 4 - Memory & Learning (Gets Smarter Every Week)

**Status:** In progress

### 4.1 - Structured Long-Term Memory Store

- [x] `user_memories` has typed categories, memory tier/type, confidence, relevance, review state, source tracking, access count, expiry, and optional embedding
- [x] Hybrid retrieval uses full-text rank, optional embeddings, relevance, tier-recency boost, and access boost
- [x] Memory extraction and review-gated promotion exist
- [x] Pending memory review is surfaced in the tab badge
- [x] G-Brain chunk pgvector migration and feature-flag retrieval are live-DB verified against Railway Postgres via `npm.cmd run jarvis:verify:brain-vector-db`
- [x] Canonical `user_memories.embedding_vector` migration, JSONB backfill, feature-flag search, verifier, and fallback are live-DB verified against Railway Postgres via `npm.cmd run jarvis:verify:memory-vector-db`
- [x] Memory OS targeted read facade routes `memory_search`, coach context, daily command context, Agent SDK global memory context, and G-Brain-backed retrieval through `server/memory/memoryOs.ts` with structured source/provenance and fallback uncertainty
- [x] Production memory embedding-health monitoring reports pgvector availability, JSON/vector embedding coverage, vector-path error alerts, and memory subsystem degradation through diagnostics health
- [ ] Finish user-facing memory correction, deletion, and provenance explanation flows

Roadmap cross-reference: the verified G-Brain chunk-vector work, implemented canonical memory vector index, targeted Memory OS read facade, and memory embedding-health diagnostics all belong to this Phase 4.1 memory-scaling lane and are tracked in `docs/gbrain-implementation-plan.md` plus `docs/memory-os-temporal-graph-plan.md`. This completes the current named read-context facade and embedding-health monitoring baselines, but does not migrate every legacy memory read path or complete user-facing correction/provenance flows, Redis hot state, or Graphiti temporal graph work.

### 4.2 - Pattern Recognition Engine

- [x] Weekly pattern job reviews 30 days of completions, brain dumps, chat, Telegram, and energy check-ins
- [x] High-confidence patterns are promoted into long-term memory
- [x] Weekly review can be saved to Drive
- [x] Insights and pattern surfaces exist in app screens
- [ ] Make pattern explanations more transparent in daily scheduling decisions
- [ ] Add confidence calibration and "this pattern is wrong" feedback loops

### 4.3 - Relationship Intelligence

- [x] `people` table exists
- [x] People sync from calendar attendees and recent Gmail senders exists
- [x] Meeting briefs include matching people records
- [x] People are visible/editable in the Profile tab
- [ ] Build richer relationship timelines and source-backed summaries
- [ ] Use people profiles more consistently in email drafting and planning

### 4.4 - Living SOUL File

- [x] Root `SOUL.md` and `agents/SOUL.md` exist
- [x] DB-backed SOUL table exists
- [x] SOUL regeneration uses memory, people, weekly insights, and living context
- [x] AI prompt context now treats SOUL as the authoritative "about this person" source when available
- [x] Profile tab surfaces coach/memory context
- [ ] Finish explicit user controls for editing, approving, and rolling back SOUL updates

---

## Phase 5 - Multi-Channel & Computer Control

**Status:** In progress

### 5.1 - WhatsApp Channel

- [x] WhatsApp channel adapter exists through Twilio
- [x] WhatsApp webhook supports pairing codes and coach routing
- [x] WhatsApp can be selected in notification preferences
- [x] Profile/settings UI includes WhatsApp connection state
- [ ] Validate full production onboarding and two-way behavior
- [ ] Add richer WhatsApp attachment/deliverable handling beyond "open the app"

### 5.2 - Slack Personal Integration (Full Two-Way)

- [x] Slack channel adapter exists
- [x] Slack events and slash command webhook routes exist
- [x] Slack OAuth/connection UI is present
- [x] Slack DMs can route to coach handling
- [ ] Finish slash command coverage and production validation
- [ ] Improve Slack channel-specific deliverable and approval flows

### 5.3 - Optional Desktop And Android Connectors

- [x] Desktop daemon package exists under `daemon/`
- [x] Android daemon project exists under `android-daemon/`
- [x] Daemon channel and pairing routes exist
- [x] Desktop daemon operations include shell, file read/write/list, and native notification
- [x] Android daemon actions include screen understanding, tap/type/swipe, forms, button training, and wake-word/Talk Mode integration
- [x] Profile/settings UI exposes daemon pairing and per-action permissions
- [ ] Harden audit logs, approvals, sandbox defaults, and recovery behavior before treating daemon control as fully production-safe

---

## Phase 6 - Self-Improving / Build-Agent Layer

**Status:** In progress

This phase was not in the original roadmap, but the repo now includes meaningful build-agent capability.

- [x] `build_feature`, `test_tool`, `delegate_to_codex`, `project_shell`, `deploy_app`, `self_diagnose`, `self_heal`, and code proposal tools exist
- [x] Capability gap detection exists for apology/deflection patterns
- [x] Self-repair history and code proposal app screens exist
- [x] Model routing, provider fallback, Codex OAuth routing, and model usage tracking exist
- [x] Agent approval gates protect high-risk actions
- [ ] Keep code-writing/build tools scoped and heavily approval-gated
- [ ] Add clearer UI for reviewing proposed code changes before application
- [ ] Expand integration tests around build-feature and self-heal flows

---

## Runtime Capability Map

| Capability | Jarvis status |
|---|---|
| Tool-calling agent loop | Implemented in `server/agent/harness.ts` |
| Tool harness & permission model | Implemented across `server/agent/tools/`, `agentApproval.ts`, `toolCallHooks.ts`, and approval receipts |
| Heartbeat scheduler | Implemented in `server/heartbeat.ts` |
| HEARTBEAT.md reader/executor | Implemented with `JARVIS_HEARTBEAT.md` |
| Sub-agent spawning | Implemented in `server/agent/subagents.ts` and related tools |
| Background job queue | Implemented in `server/agent/jobQueue.ts` and `agent_jobs` |
| Memory layer | Implemented in `server/memory/` and memory tables |
| SOUL loader/injector | Implemented through root/agent SOUL files and `server/memory/promptContext.ts` |
| Channel adapters | Implemented in `server/channels/` for Telegram, WhatsApp, Slack, Discord, in-app, webchat, daemon |
| Node/device protocol | Implemented through daemon bridge, daemon package, and Android daemon |

---

## Notes & Decisions

- Android, web, Windows, and Linux remain the priority surfaces.
- Autonomous work should land in reviewable deliverables unless the user has explicitly approved the external action.
- Email sends, calendar changes, public posts, daemon actions, deploys, purchases, compliance/business-finance actions, memory rewrites, and code changes require approval boundaries.
- Phase order is no longer strictly linear because later-phase primitives have already been partially implemented.
- The next best work is not "start Phase 3"; it is hardening the in-progress Phase 3-6 surfaces into tested, observable product flows.
