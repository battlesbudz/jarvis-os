# Jarvis Autonomous Agent Roadmap

> Living document — updated as features are built and shipped.
> Last updated: April 2026

---

## Vision

Transform Jarvis from a reactive coaching app into a fully autonomous AI agent that works, researches, builds, and acts on your behalf — even while you sleep. Inspired by OpenClaw's architecture but purpose-built for ADHD executive function coaching with your existing mobile app, calendar, email, and Telegram stack.

**Core principle:** Borrow heavily from OpenClaw's MIT-licensed source. Don't reinvent what's already been debugged.

---

## Progress Overview

| Phase | Name | Status |
|-------|------|--------|
| ✅ Foundation | What Jarvis can already do | COMPLETE |
| 🔵 Phase 1 | Action Engine — Give Jarvis Hands | PENDING |
| ⬜ Phase 2 | Autonomous Heartbeat — Act Without Being Asked | PENDING |
| ⬜ Phase 3 | Sub-Agent Goals — Work While You Sleep | PENDING |
| ⬜ Phase 4 | Memory & Learning — Gets Smarter Every Week | PENDING |
| ⬜ Phase 5 | Multi-Channel & Computer Control | PENDING |

---

## ✅ Already Complete (Foundation)

- [x] Morning plan auto-generation (7 AM daily)
- [x] Curiosity scanner (30-min proactive questions via Telegram)
- [x] Gmail draft creation
- [x] Web search via Tavily (on-demand)
- [x] Gmail label actions (archive, star, trash, mark read)
- [x] Momentum session sequencing (4-step ADHD nudge chain)
- [x] Voice input/output (Whisper + TTS Alloy)
- [x] Proactive meeting briefings (basic)
- [x] Telegram bot with full task + email control
- [x] XP, streaks, gamification
- [x] User memory (basic categories)
- [x] Energy-aware planning
- [x] Inbox rules with auto-learning (3-dismiss suppression)
- [x] Outlook calendar integration
- [x] Google Calendar integration
- [x] Multi-account Google (personal + work)
- [x] Slack integration (basic)
- [x] Image understanding in Telegram chat
- [x] Pattern analysis (last 30 days)
- [x] Weekly review endpoint

---

## 🔵 Phase 1 — Action Engine (Give Jarvis Hands)

> **Goal:** Upgrade the AI brain from one-shot responses to a real tool-calling loop. Give Jarvis the ability to produce real artifacts — documents, research, organized files.
> **Borrowing from OpenClaw:** `src/agent/` tool-calling loop, `src/tools/` harness and permission model.

### 1.1 — Tool-Use Loop in the AI Brain
- [ ] Replace one-shot OpenAI calls with a proper while-loop tool-calling harness
- [ ] Model can call tools, see results, call more tools, then respond
- [ ] All existing tools (Tavily, Gmail, Calendar) wired into the new harness
- [ ] Tool results fed back into context before final response

### 1.2 — Autonomous Web Research Tool
- [ ] Expand Tavily search so Jarvis can chain multiple searches independently
- [ ] Jarvis can research topics from goals, calendar events, and commitments without prompting
- [ ] Research results summarized and surfaced proactively
- [ ] Source citations included in output

### 1.3 — File / Document Creation Tool
- [ ] Jarvis can generate and save formatted documents (meeting notes, summaries, plans, brainstorms)
- [ ] Documents available for download from the app and sent via Telegram
- [ ] Templates: meeting prep, weekly review, goal breakdown, brainstorm doc

### 1.4 — Google Drive Integration
- [ ] Connect to Google Drive via existing Google OAuth
- [ ] Jarvis can create files in a designated "Jarvis Workspace" folder
- [ ] Can read existing docs for context (reference docs you point it to)
- [ ] File links sent back via Telegram and visible in the app

**Status:** ⬜ Not started

---

## ⬜ Phase 2 — Autonomous Heartbeat (Act Without Being Asked)

> **Goal:** Transform the existing curiosity scanner from a question-asker into a real action-taker.
> **Borrowing from OpenClaw:** `src/gateway/heartbeat.ts`, HEARTBEAT.md reader/executor pattern, action-before-message decision tree.

### 2.1 — HEARTBEAT Redesign
- [ ] Replace curiosity scanner's question-only behavior with an action-first loop
- [ ] Introduce a `JARVIS_HEARTBEAT.md` priority checklist Jarvis reads every cycle
- [ ] On each tick: check list → decide → act or queue for review → optionally message you
- [ ] Silent heartbeats (no Telegram message) when nothing needs attention

### 2.2 — Autonomous Meeting Research Briefings
- [ ] Before any calendar event with an external person, Jarvis auto-researches them
- [ ] Checks email history, web search, and memories for context
- [ ] Sends a 3-bullet brief to Telegram 30 minutes before the meeting — unprompted
- [ ] Toggleable per meeting type

### 2.3 — Autonomous Email Draft Queue
- [ ] When Jarvis spots an email needing a reply (per inbox rules + commitments), it drafts it
- [ ] Draft queued for your approval — one tap to send, one tap to discard
- [ ] New "Draft Queue" section in the Inbox tab
- [ ] Draft shown with AI reasoning ("You said you'd follow up on this by Friday")

### 2.4 — End-of-Day Autonomous Wrap-Up
- [ ] At a user-configurable time (default 9 PM), Jarvis runs an end-of-day cycle
- [ ] Reviews completed tasks, updates XP and streaks
- [ ] Writes a brief daily reflection to Google Drive journal
- [ ] Sends an evening summary to Telegram

**Status:** ⬜ Not started
**Depends on:** Phase 1 complete

---

## ⬜ Phase 3 — Sub-Agent Goals (Work While You Sleep)

> **Goal:** Jarvis spins up focused background agents to research, plan, and produce deliverables autonomously.
> **Borrowing from OpenClaw:** `sessions_spawn` pattern (`src/agent/subagent.ts`), background job queue (`src/gateway/jobs.ts`), ACP harness for isolated sub-sessions.

### 3.1 — Goal Decomposition Engine
- [ ] When a new goal is added, Jarvis breaks it into a project tree (phases → milestones → tasks)
- [ ] Project tree visible in the Goals tab with progress tracking
- [ ] Tasks from the tree automatically inserted into daily plans over time
- [ ] Jarvis adjusts pacing based on your completion rate

### 3.2 — Background Job Runner
- [ ] Persistent job queue system (survives server restarts)
- [ ] Jobs can be: research tasks, document creation, email drafting, planning cycles
- [ ] Jobs run asynchronously — notified when complete, not interrupted while running
- [ ] Job status visible in app: queued → running → complete → delivered

### 3.3 — Sub-Agent Spawning
- [ ] For complex goals, Jarvis spawns specialized sub-agents with narrow jobs
- [ ] Agent types: Research Agent, Writing Agent, Planning Agent, Email Agent
- [ ] Sub-agents report back to main Jarvis brain; main brain synthesizes and responds
- [ ] Each sub-agent has its own isolated context window and tool access

### 3.4 — Deliverable Inbox
- [ ] New section in the app: everything Jarvis produced autonomously appears here
- [ ] Items: documents, research briefs, drafted emails, goal breakdowns, summaries
- [ ] Each item has: approve / edit / discard actions
- [ ] Nothing is sent or saved externally without your explicit approval

**Status:** ⬜ Not started
**Depends on:** Phase 2 complete

---

## ⬜ Phase 4 — Memory & Learning (Gets Smarter Every Week)

> **Goal:** Real structured memory that evolves — Jarvis knows you better after 60 days than day 1.
> **Borrowing from OpenClaw:** Hybrid vector+FTS memory layer (`src/memory/`), SOUL.md loader/injector (`src/agent/soul.ts`), memory category schema.

### 4.1 — Structured Long-Term Memory Store
- [ ] Upgrade the existing user memories system to a semantic memory store
- [ ] Memory categories: Work Patterns, Communication Style, Energy Rhythms, Goals History, Key Relationships, Values, Blockers
- [ ] Memory updated automatically after every session, plan completion, and heartbeat cycle
- [ ] Memories ranked by recency and relevance — stale memories decay

### 4.2 — Pattern Recognition Engine
- [ ] After 30+ days of data, run a weekly pattern analysis (Sunday night)
- [ ] Identifies: peak productivity windows, task avoidance patterns, energy triggers, streak breakers
- [ ] Insights surfaced in the Insights tab and used to adjust scheduling
- [ ] Jarvis explains its reasoning: "I scheduled deep work before noon because that's when you complete 73% of your hard tasks"

### 4.3 — Relationship Intelligence
- [ ] Build lightweight profiles on people in your calendar and email
- [ ] Profile: role/context, email history summary, upcoming interactions, last touched
- [ ] Used automatically in meeting briefings and email drafting
- [ ] Viewable in app under a new "People" section

### 4.4 — Living SOUL File
- [ ] Jarvis maintains a `JARVIS_SOUL.md` — your values, preferences, behavioral rules, communication style
- [ ] Updated automatically as Jarvis learns more about you
- [ ] Viewable and editable in the app (Profile tab)
- [ ] Injected into every AI prompt as the core identity context (replaces current "life context" field)

**Status:** ⬜ Not started
**Depends on:** Phase 3 complete

---

## ⬜ Phase 5 — Multi-Channel & Computer Control

> **Goal:** Access Jarvis from wherever you naturally live. Optional local daemon for true computer control (Android + desktop, no Apple).
> **Borrowing from OpenClaw:** Channel adapter interface (`src/channels/`), node/device pairing WebSocket protocol (`src/devices/`), daemon gateway architecture.

### 5.1 — WhatsApp Channel
- [ ] Add WhatsApp as a second messaging channel alongside Telegram
- [ ] Full Jarvis experience: task management, coach chat, briefings, approvals
- [ ] Uses WhatsApp Business API or Twilio WhatsApp gateway
- [ ] User can choose preferred channel per notification type

### 5.2 — Slack Personal Integration (Full Two-Way)
- [ ] Upgrade existing Slack connection to a full two-way channel
- [ ] Jarvis posts briefings, deliverables, and reminders to your personal Slack
- [ ] Receives and responds to DMs within Slack workspace
- [ ] Slash commands: `/jarvis plan`, `/jarvis brain-dump`, `/jarvis status`

### 5.3 — Optional Local Daemon (OpenClaw Bridge)
- [ ] Lightweight local Node.js script that runs on your Windows/Linux/Android machine
- [ ] Connects to Jarvis's cloud API via WebSocket (mirrors OpenClaw's node protocol)
- [ ] Gives Jarvis ability to: run shell commands, read/write local files, control desktop apps
- [ ] Strictly opt-in, sandboxed, with explicit permission per action type
- [ ] Android and desktop only — no Apple/iOS

**Status:** ⬜ Not started
**Depends on:** Phase 4 complete

---

## OpenClaw Code Reference

Key OpenClaw source paths to adapt (MIT licensed — keep `Copyright (c) 2025 Peter Steinberger`):

| What to borrow | OpenClaw path | Jarvis phase |
|---|---|---|
| Tool-calling agent loop | `src/agent/` | Phase 1.1 |
| Tool harness & permission model | `src/tools/` | Phase 1.1 |
| Heartbeat scheduler | `src/gateway/heartbeat.ts` | Phase 2.1 |
| HEARTBEAT.md reader/executor | `src/gateway/` | Phase 2.1 |
| Sub-agent spawning | `src/agent/subagent.ts` | Phase 3.3 |
| Background job queue | `src/gateway/jobs.ts` | Phase 3.2 |
| Memory layer (SQLite + FTS5) | `src/memory/` | Phase 4.1 |
| SOUL.md loader/injector | `src/agent/soul.ts` | Phase 4.4 |
| Channel adapter interface | `src/channels/` | Phase 5.1–5.2 |
| Node/device WebSocket protocol | `src/devices/` | Phase 5.3 |

---

## Notes & Decisions

- **No Apple/iOS features** — Android, web, Windows/Linux only for local daemon
- **Phase order is strict** — each phase's capabilities are dependencies for the next
- **Deliverable inbox (Phase 3.4) is a hard gate** — nothing autonomous is sent externally without your explicit approval
- **OpenClaw code is adapted, not copied verbatim** — Jarvis stays on Express + Drizzle + Expo stack

---

*To update this file: switch to Build mode and ask Jarvis agent to mark a feature complete or adjust the plan.*
