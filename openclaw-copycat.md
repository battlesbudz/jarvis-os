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

## Gap 4 — Browser Automation / Computer Use ✅ DONE

**OpenClaw tool:** `browser` — full computer-use capability; navigates pages, clicks elements, fills forms, takes screenshots, interacts with any web app

**Jarvis tools (Task #152):**
- `browser_navigate` — opens a URL in a per-user headless Chromium session (Playwright); returns page title + first 3000 chars of visible text
- `browser_click` — clicks an element by visible text label or CSS selector; returns updated page title + URL
- `browser_type` — locates a field by label / placeholder / selector, clears it, types text, optionally presses Enter
- `browser_screenshot` — captures viewport or full-page PNG, returns as base64 (agent can inspect visually)
- `browser_extract` — extracts all visible text stripped of scripts/styles; handles JS-rendered SPAs that web_fetch cannot read
- `browser_close` — explicitly closes the session (auto-closes after 5 min inactivity)

**Session manager:** `server/agent/browser/sessionManager.ts` — one Chromium browser + page per user; idle sessions reaped every 60s; launched with `--no-sandbox --disable-gpu` for server environments

**System deps installed:** glib, nss, nspr, atk, at-spi2-atk, libdrm, libxcb, libxkbcommon, libX11, libXcomposite, libXdamage, libXext, libXfixes, libXrandr, mesa, alsa-lib, pango, cairo, expat

**Post-merge:** `scripts/post-merge.sh` includes `npx playwright install chromium` (idempotent)

**Why it matters:** Unlocks web tasks that have no API — restaurant bookings, form submissions, reading paywalled content, web app interactions.

---

## Gap 5 — Always-On Shell Execution

**OpenClaw tools:** `exec` / `bash` / `process` — always available on the host machine; approval-gated by default; background long-running processes supported; per-session override via /exec slash command

**Jarvis equivalent:** Desktop daemon exposes shell access — only when the daemon is actively connected. Nothing if daemon is offline.

**Why it matters:** A server-hosted Jarvis could run scripts, process local files, query local databases, and interact with local services autonomously without requiring the user's machine to be online.

---

## Gap 6 — Text-to-Speech Tool (tts) ✅ DONE

**OpenClaw tool:** `tts` — converts replies to voice notes (ElevenLabs, OpenAI TTS, Edge TTS); Telegram delivers as round audio bubbles; per-session toggle `/tts on`; auto-voice mode configurable globally

**Jarvis equivalent:** Voice-to-text input planned (Task #7); no agent-callable TTS for outbound responses.

**Why it matters:** For an ADHD-focused product, listening is often easier than reading. Voice responses on Telegram are a highly natural interaction — especially for coaching messages and daily plans.

---

## Gap 7 — Agent-Callable Cron Job Creation ✅ DONE

**OpenClaw tool:** `cron` — agent creates one-shot or recurring scheduled jobs at runtime from within a conversation; supports isolated / main / custom / current session modes; agent can list, edit, disable, and delete its own scheduled jobs

**Jarvis tools (Task #150):**
- `cron_create` — natural-language time parsing ("in 4 hours", "tomorrow 9am", "every Monday at 9am"); auto-derives `scheduledAt` + `recurrence` from a single `when` arg; writes to `jarvis_scheduled_tasks`
- `cron_list` — lists upcoming (or all) jobs with IDs, titles, next-run times, recurrence
- `cron_delete` — cancels a job by ID (user-scoped)
- `cron_update` — patches title / description / when / recurrence with same NL parsing

**Files:** `server/agent/tools/cronTools.ts`, registered in `server/agent/tools/index.ts`

**Why it matters:** The agent can say "I'll check on this in 4 hours" and actually create the job. Enables true autonomous follow-through without the developer pre-wiring every schedule.

---

## Gap 8 — Lobster Workflow Engine ✅ DONE

**OpenClaw tool:** `lobster` — built-in multi-step branching workflow primitive; agent defines, inspects, pauses, and resumes structured workflow graphs

**Jarvis tools (Task #151):**
- `workflow_create` — defines a named workflow with an ordered list of steps (title + prompt + optional agent_type per step); inserts into `agent_workflows`; returns workflow ID
- `workflow_run` — starts the next pending step: builds enriched prompt (injects all prior step outputs), queues a background job, marks workflow `paused_waiting`; auto-advances on completion
- `workflow_status` — returns all step statuses, job IDs, and full outputs of completed steps
- `workflow_pause` — halts auto-advance after the current step finishes
- `workflow_resume` — continues from the next pending step
- `workflow_list` — lists all active/paused (or all including complete) workflows with IDs

**Auto-advance hook:** `server/agent/workflowEngine.ts::onWorkflowJobComplete` is called from `server/agent/jobQueue.ts::processJob` after every job completes; automatically queues the next step and notifies user when all steps are done.

**Schema:** `agent_workflows` table (id, userId, title, description, steps JSONB, currentStepIndex, status, createdAt, updatedAt)

**Files:** `server/agent/workflowEngine.ts`, `server/agent/tools/workflowTools.ts`, `shared/schema.ts`, `server/agent/jobQueue.ts`, `server/agent/tools/index.ts`

---

## Summary Table

| Capability | OpenClaw Tool | Jarvis Equivalent | Gap |
|---|---|---|---|
| Search memory at runtime | `memory_search` / `memory_get` | `memory_search`, `memory_get` tools | ✅ CLOSED |
| Message another session | `sessions_send` | `sessions_send` tool | ✅ CLOSED |
| List / inspect active sessions | `sessions_list` / `sessions_history` | `sessions_list`, `sessions_history` tools | ✅ CLOSED |
| Fetch a specific URL | `web_fetch` | `web_fetch` tool | ✅ CLOSED |
| Browser automation | `browser` (always on) | `browser_*` tools (6, Playwright/Chromium) | ✅ CLOSED |
| Shell execution | `exec` / `bash` (always on) | Desktop daemon (optional) | PARTIAL |
| Voice responses (TTS) | `tts` | `speak` tool + `/tts on\|off\|voice` | ✅ CLOSED |
| Agent-defined cron jobs | `cron` tool | `cron_*` tools (4) | ✅ CLOSED |
| Workflow engine | `lobster` | `workflow_*` tools (6) | ✅ CLOSED |
| Sub-agent spawning | `sessions_spawn` | `spawnSubagent` | PARTIAL |
| Image generation | `image_generate` | None | YES |

---

## Completed (Phase 1 — April 2026)

1. ✅ **Agent-callable memory search** — `memory_search` + `memory_get` tools; semantic hybrid search against `user_memories` DB; category filtering; in `telegramCoachTools`
2. ✅ **Session management tools** — `sessions_list`, `sessions_history`, `sessions_send`; built on top of `agentJobs` table; agent can now list, inspect, and spawn jobs at runtime
3. ✅ **`web_fetch` URL tool** — fetches any URL, strips HTML via cheerio, 15-min in-memory cache, 20k char limit; handles HTML/JSON/text content types

## Remaining Gaps (Next Priorities)

4. ✅ **TTS voice responses** — `speak` agent tool (MP3→OGG-Opus via ffmpeg, `sendVoice` Telegram round bubble); `/tts on|off|voice <name>` commands; auto-voice mode in `handleCoachReply`; 6 voices (alloy, echo, fable, onyx, nova, shimmer); graceful text fallback
5. **Agent-defined cron jobs** — `cron` tool that writes to `jarvis_scheduled_tasks`; supports isolated, main, and named-session modes; agent can list/disable/delete its own jobs
6. **Workflow engine (lobster)** — resumable multi-step plan graph the agent defines and can pause/resume across sessions; builds on `goalDecomposer` + `agentJobs`
7. **Browser automation** — always-on headless browser for form fills, paywalled content, web app interactions (no daemon dependency)

---

*Document generated from OpenClaw architecture analysis — April 2026*
