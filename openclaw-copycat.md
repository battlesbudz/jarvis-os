# OpenClaw Copycat — Jarvis Capability Gaps

## What Is This?
This document tracks the 8 capability gaps between Jarvis and OpenClaw's tool architecture, ordered by implementation priority. It is an actionable implementation checklist for bringing Jarvis to full parity.

---

## Gap 1 — Agent-Callable Memory Search ✅ DONE

**OpenClaw tools:** `memory_search` (semantic + keyword search across all memory files), `memory_get` (targeted read by filename / line range)

**OpenClaw memory files:**
- `MEMORY.md` — durable long-term facts, preferences, decisions; auto-loaded at every session start
- `memory/YYYY-MM-DD.md` — daily rolling context log; today's and yesterday's auto-injected into every session
- `DREAMS.md` — optional historical backfill / dream diary for the agent to review
- `USER.md` — user profile and preferences
- `AGENTS.md` — operating instructions + persona

**Jarvis equivalent:** SOUL profile blob injected wholesale into the system prompt. No runtime query capability. As memory grows, context bloat grows with it.

**Why it matters:** The agent can look up specific memories mid-task ("what are this user's preferred work hours?") without loading everything. Memory scales infinitely without bloating the context window.

---

## Gap 2 — Session Management Tools ✅ DONE

**OpenClaw tools:** `sessions_list`, `sessions_history`, `sessions_send`, `sessions_spawn`, `session_status`

**What they do:**
- `sessions_list` — list all active sessions with model, token counts, kind, and last message
- `sessions_history` — fetch the full transcript of any session (optionally including tool results)
- `sessions_send` — send a message into another active session programmatically
- `sessions_spawn` — spin up a child sub-agent session
- `session_status` — lightweight status readback for the current session; can override the per-session model

**Jarvis equivalent:** `spawnSubagent` only. Cannot list, query, or message existing sessions at runtime.

**Why it matters:** This is the backbone of multi-agent coordination. One agent can delegate to another, check on it, read its output, and route work — all from within a running conversation.

---

## Gap 3 — Direct URL Fetch Tool ✅ DONE

**OpenClaw tool:** `web_fetch` — fetches any URL and converts HTML to clean readable markdown/text; responses cached 15 min; `maxChars` configurable

**Jarvis equivalent:** `webSearch` (Tavily search by query), `researchTopic` (multi-step research loop). Neither can fetch a specific URL the user or agent already knows.

**Why it matters:** If a user shares a link, or the agent finds a URL during research, it can read it immediately without a search round-trip. One of the cheapest gaps to close, highest daily utility.

---

## Gap 4 — Browser Automation / Computer Use

**OpenClaw tool:** `browser` — full computer-use capability; navigates pages, clicks elements, fills forms, takes screenshots, interacts with any web app

**Jarvis equivalent:** Android daemon (screenshot + tap simulation) — optional, only when daemon is connected. No general-purpose browser tool.

**Why it matters:** Unlocks web tasks that have no API — restaurant bookings, form submissions, reading paywalled content, web app interactions.

---

## Gap 5 — Always-On Shell Execution

**OpenClaw tools:** `exec` / `bash` / `process` — always available on the host machine; approval-gated by default; background long-running processes supported; per-session override via /exec slash command

**Jarvis equivalent:** Desktop daemon exposes shell access — only when the daemon is actively connected. Nothing if daemon is offline.

**Why it matters:** A server-hosted Jarvis could run scripts, process local files, query local databases, and interact with local services autonomously without requiring the user's machine to be online.

---

## Gap 6 — Text-to-Speech Tool (tts)

**OpenClaw tool:** `tts` — converts replies to voice notes (ElevenLabs, OpenAI TTS, Edge TTS); Telegram delivers as round audio bubbles; per-session toggle `/tts on`; auto-voice mode configurable globally

**Jarvis equivalent:** Voice-to-text input planned (Task #7); no agent-callable TTS for outbound responses.

**Why it matters:** For an ADHD-focused product, listening is often easier than reading. Voice responses on Telegram are a highly natural interaction — especially for coaching messages and daily plans.

---

## Gap 7 — Agent-Callable Cron Job Creation

**OpenClaw tool:** `cron` — agent creates one-shot or recurring scheduled jobs at runtime from within a conversation; supports isolated / main / custom / current session modes; agent can list, edit, disable, and delete its own scheduled jobs

**Session modes:**
- `isolated` — runs in a fresh dedicated context (best for reports)
- `main` — injects into the next heartbeat turn (best for reminders)
- `session:custom-id` — persistent named session that builds on prior history (best for daily standups)

**Jarvis equivalent:** `scheduleJarvisTask` — system-level heartbeat scheduler, developer-configured. Agent cannot create a new cron job mid-conversation.

**Why it matters:** The agent can say "I'll check on this in 4 hours" and actually create the job. Enables true autonomous follow-through without the developer pre-wiring every schedule.

---

## Gap 8 — Lobster Workflow Engine

**OpenClaw tool:** `lobster` — built-in multi-step branching workflow primitive; agent defines, inspects, pauses, and resumes structured workflow graphs

**Jarvis equivalent:** `goalDecomposer` + `spawnSubagent` chains. No structured workflow graph the agent can define, inspect, or resume across sessions.

**Why it matters:** Long-running autonomous plans (multi-day research projects, phased task execution, project management workflows) need resumable structure — not just fire-and-forget sub-agent chains.

---

## Summary Table

| Capability | OpenClaw Tool | Jarvis Equivalent | Gap |
|---|---|---|---|
| Search memory at runtime | `memory_search` / `memory_get` | `memory_search`, `memory_get` tools | ✅ CLOSED |
| Message another session | `sessions_send` | `sessions_send` tool | ✅ CLOSED |
| List / inspect active sessions | `sessions_list` / `sessions_history` | `sessions_list`, `sessions_history` tools | ✅ CLOSED |
| Fetch a specific URL | `web_fetch` | `web_fetch` tool | ✅ CLOSED |
| Browser automation | `browser` (always on) | Android daemon (optional) | PARTIAL |
| Shell execution | `exec` / `bash` (always on) | Desktop daemon (optional) | PARTIAL |
| Voice responses (TTS) | `tts` | None | YES |
| Agent-defined cron jobs | `cron` tool | None (system-only) | YES |
| Workflow engine | `lobster` | None | YES |
| Sub-agent spawning | `sessions_spawn` | `spawnSubagent` | PARTIAL |
| Image generation | `image_generate` | None | YES |

---

## Completed (Phase 1 — April 2026)

1. ✅ **Agent-callable memory search** — `memory_search` + `memory_get` tools; semantic hybrid search against `user_memories` DB; category filtering; in `telegramCoachTools`
2. ✅ **Session management tools** — `sessions_list`, `sessions_history`, `sessions_send`; built on top of `agentJobs` table; agent can now list, inspect, and spawn jobs at runtime
3. ✅ **`web_fetch` URL tool** — fetches any URL, strips HTML via cheerio, 15-min in-memory cache, 20k char limit; handles HTML/JSON/text content types

## Remaining Gaps (Next Priorities)

4. **TTS voice responses** — `tts` tool wrapping OpenAI TTS; Telegram voice bubble delivery; per-session `/tts on` toggle
5. **Agent-defined cron jobs** — `cron` tool that writes to `jarvis_scheduled_tasks`; supports isolated, main, and named-session modes; agent can list/disable/delete its own jobs
6. **Workflow engine (lobster)** — resumable multi-step plan graph the agent defines and can pause/resume across sessions; builds on `goalDecomposer` + `agentJobs`
7. **Browser automation** — always-on headless browser for form fills, paywalled content, web app interactions (no daemon dependency)

---

*Document generated from OpenClaw architecture analysis — April 2026*
