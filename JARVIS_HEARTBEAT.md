# Jarvis Heartbeat — Action Checklist

The heartbeat daemon reads this file on every tick (~5 min) and walks the
checklist top-to-bottom for each user. Each item is a small, bounded job.
For every job Jarvis decides one of three things:

  1. **act now** — perform the action and message the user with the result
  2. **queue for review** — generate a draft / proposal and put it in the
     Inbox "Draft Queue" so the user can approve in one tap
  3. **skip** — nothing to do this tick; stay silent

If nothing on the checklist fires, the heartbeat sends NO message — silence
is the correct behavior.

---

## Priority order

### 1. Pre-meeting research brief (30–60 min ahead)
For each calendar event starting in the next 30–60 minutes that has at least
one attendee or a substantive description:
- Pull what we already know about the attendees / topic from `user_memories`
- Pull any related emails in the last 7 days (subject keyword match)
- Optionally do a light web search for any external attendee or company
- Compose a tight 3-bullet brief (who, why it matters, suggested focus)
- **Action:** send to Telegram once per event per day

### 2. Autonomous email draft queue
For each unread inbox email surfaced as `urgent` / `reply needed` by the
email-alert classifier in the last cycle and not already drafted:
- Generate a polite, on-voice reply draft using the agent harness
- Save the draft to `email_drafts` with status `pending_approval`
- **Action:** queue for review (Inbox → Draft Queue). Do not auto-send.
  Send a single Telegram nudge of the form "1 draft waiting for review".

### 3. Evening wrap-up (configurable hour, default 21:00 local)
Once per day, after the user's configured wrap-up hour:
- Count today's completions (`plans` for today's date)
- Pull active streaks and XP from `stats`
- Compose a short reflection: what got done, what's still open, one
  observation, one prompt for tomorrow
- **Action:** send to Telegram AND save the reflection as a `.md` file
  to the user's "Jarvis Workspace" Drive folder

---

## Operating rules

- **Silent by default.** No Telegram pings unless an action fired.
- **Idempotent.** Each item must dedupe (per event, per email, per day) so
  the heartbeat can run as often as we like.
- **Bounded.** No item may run longer than ~30 s per user.
- **Logged.** Every fired action writes to `interaction_log` so the
  Telegram coach can answer "did you do X today?" honestly.
