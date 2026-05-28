# Jarvis Golden Workflows

These workflows are lightweight smoke definitions for daily usefulness, memory trust, context routing, approvals, jobs, and deliverables.

They are not a separate product surface. They should be tested through the existing app, agent harness, memory layer, approval gates, job queue, deliverables, channels, and daily command APIs.

## 1. Plan My Day Around My Calendar

- User input: "Plan my day around my calendar and my top goals."
- Expected route: planning / daily command.
- Required context: `always_on_kernel`, `daily_planning_context`, `calendar_context`, goal/task context, latest dream metadata when available.
- Tools expected: calendar read, plan generation, goal handoff merge.
- Approval requirement: no approval for draft plan generation; approval required before changing external calendar/tasks.
- Expected output: merged daily plan, context warnings for disconnected calendar/email, status ready or blocked.
- Failure behavior: deterministic fallback task plus warning if model or connected context fails.
- Smoke check: `GET /api/daily-command/today` shows plan, warnings, reminders, jobs, approvals, and dream metadata.

## 2. Draft A Reply To An Email

- User input: "Draft a reply to this email."
- Expected route: communications.
- Required context: `always_on_kernel`, `email_context`, relevant people/memory context if available.
- Tools expected: email read/search and draft creation only.
- Approval requirement: no approval to draft; approval required before sending or creating provider-side drafts when policy requires it.
- Expected output: reviewable email draft in Inbox or chat preview.
- Failure behavior: state connector/setup issue and produce a manual draft if enough context exists.
- Smoke check: draft appears in the Inbox review surface with edit/discard/approve controls.

## 3. Remind Me To Follow Up

- User input: "Remind me to follow up with Bill tomorrow."
- Expected route: planning.
- Required context: `always_on_kernel`, `daily_planning_context`, optional calendar context.
- Tools expected: local task/reminder draft or queued reminder job.
- Approval requirement: approval required before creating or changing external calendar/task records.
- Expected output: reminder draft or internal scheduled task with clear due date.
- Failure behavior: ask one date/time clarification if needed; otherwise save a recoverable internal reminder.
- Smoke check: reminder appears in daily command/reminder status or scheduled tasks.

## 4. Research A Topic And Save A Report

- User input: "Research current cannabis retail trends and save a report."
- Expected route: research.
- Required context: `always_on_kernel`, `research_context`, `business_context` when Battles/compliance context matters.
- Tools expected: web/source search, research job queue, deliverable creation.
- Approval requirement: no approval to research; approval required before public posting, outreach, official filings, or business commitments.
- Expected output: cited deliverable in Inbox with source links and limitations.
- Failure behavior: partial report with source-failure notes or failed job marked retryable.
- Smoke check: job moves through queued/running/deliverable states and failed jobs show retry controls.

## 5. Turn A Goal Into A Project Tree

- User input: "Turn this goal into a project tree."
- Expected route: planning / goal decomposition.
- Required context: `always_on_kernel`, `daily_planning_context`, relevant goal history.
- Tools expected: goal decomposition job and project tree persistence.
- Approval requirement: no external approval unless the goal creates commitments or writes outside internal state.
- Expected output: phases, milestones, tasks, progress fields, and next actionable task.
- Failure behavior: preserve the original goal and surface failed decomposition as retryable.
- Smoke check: project tree shows phases, milestones, progress, and daily handoff controls.

## 6. Move A Goal Task Into Today's Plan

- User input: "Move the next task from this goal into today's plan."
- Expected route: planning / daily command.
- Required context: `always_on_kernel`, `daily_planning_context`, goal-tree context.
- Tools expected: goal task handoff merge helper.
- Approval requirement: no approval for internal plan update when user requested it; approval required before external task/calendar writes.
- Expected output: today's plan includes one non-duplicated goal task with source metadata.
- Failure behavior: explain why no next task was eligible or return a recoverable warning.
- Smoke check: `GET /api/daily-command/today` includes the task with goal/task source metadata.

## 7. Prepare A Weekly Review

- User input: "Prepare my weekly review."
- Expected route: planning / memory.
- Required context: `always_on_kernel`, `daily_planning_context`, `memory_context`, recent completions, commitments, dream/pattern insights.
- Tools expected: weekly review generation and optional deliverable creation.
- Approval requirement: no approval to draft; approval required before saving to external Drive if not already authorized by policy.
- Expected output: wins, misses, patterns, open loops, next-week focus.
- Failure behavior: partial review with missing-source warnings.
- Smoke check: output is reviewable and source limitations are visible.

## 8. Prepare Me For My Next Meeting

- User input: "Prepare me for my next meeting."
- Expected route: planning / communications.
- Required context: `always_on_kernel`, `calendar_context`, `email_context`, `memory_context`, people context.
- Tools expected: calendar read, email read/search, people/memory retrieval.
- Approval requirement: no approval to brief; approval required before messaging attendees or changing the event.
- Expected output: meeting brief with attendees, agenda signals, risks, and suggested questions.
- Failure behavior: if calendar is disconnected, return setup warning and ask for meeting details.
- Smoke check: brief names which sources were used and which were unavailable.

## 9. Find What I Said About Something Before

- User input: "What did I say about morning planning before?"
- Expected route: memory.
- Required context: `always_on_kernel`, `memory_context`, relevant SOUL sections if relationship/style is involved.
- Tools expected: memory search/read only.
- Approval requirement: no approval to retrieve; approval required before editing, deleting, or rewriting memory/SOUL.
- Expected output: answer with memory provenance, confidence, and uncertainty.
- Failure behavior: say no matching memory found and explain what would confirm it.
- Smoke check: `/api/mind-trace/preview` shows memory context and retrieved memory metadata when provided.

## 10. Diagnose Why A Feature Failed

- User input: "Diagnose why daily plan generation failed."
- Expected route: diagnostics / code or job observability depending on scope.
- Required context: `always_on_kernel`, `self_healing_context`, `code_work_context` if source inspection is needed, job/deliverable observability.
- Tools expected: logs, tests, job observability, targeted source inspection.
- Approval requirement: no approval for read-only diagnosis/checks; approval required before code edits, deploys, pushes, or changing critical guardrails.
- Expected output: root-cause hypothesis, evidence, next safe fix, and recovery action.
- Failure behavior: preserve partial findings and mark blocked setup if credentials/environment are missing.
- Smoke check: `/api/agent-jobs/observability`, `/api/mind-trace/recent`, and Inbox status show working, failed, retry, blocked, or approval states.

## Regression Gate

Before treating the daily loop as reliable, run:

```powershell
npm.cmd test
npm.cmd run server:build
```

For setup/readiness-sensitive changes, also run:

```powershell
npm.cmd run jarvis:doctor
```
