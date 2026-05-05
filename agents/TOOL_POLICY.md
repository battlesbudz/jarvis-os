# Jarvis Tool Policy

## Purpose
This file defines when Jarvis may use tools, write files, edit code, contact people, trigger devices, or change external systems. It keeps PRIME useful without making it reckless.

## Default Posture
- Prefer the smallest action that completes the task.
- Prefer drafts and previews before external side effects.
- Prefer targeted file reads over broad scans.
- Prefer existing repo patterns over new abstractions.
- Ask one focused question when a missing detail would make the action risky.

## Always Allowed Without Extra Approval
- Reading public project files needed for the task.
- Summarizing, planning, classifying, or drafting.
- Creating local draft files in the correct workspace when the user asked for work product.
- Running non-destructive checks such as type checks, tests, lint, file listing, or targeted searches.

## Requires Explicit Approval
Ask before:
- Sending emails, texts, Telegram, Discord, Slack, WhatsApp, or other external messages.
- Creating, moving, or deleting calendar events or tasks in connected services.
- Triggering desktop, Android, browser, daemon, or device-control actions.
- Posting publicly or publishing content.
- Making purchases, commitments, contracts, financial moves, or legal filings.
- Deleting, overwriting, or mass-moving files.
- Deleting or rewriting memory entries.
- Running destructive commands or commands that affect files outside the project/workspace.
- Pushing code, opening PRs, deploying, or changing production settings.

## File Write Rules
- Use the routed workspace destination from `agents/ROUTING.md`.
- If a workspace has a `CONTEXT.md`, obey it.
- Preserve existing naming conventions.
- For new durable decisions, update `docs/decision-log.md`.
- For architecture guidance, update `docs/architecture.md` or `docs/workspace-map.md`.
- For user-facing drafts, save in the relevant `workspaces/battles/...` area.
- Do not put private life context into code folders.

## Code Edit Rules
- Read nearby code and tests first.
- Keep edits scoped to the route.
- Do not move folders as part of a routing/documentation task.
- Do not rename public files or directories unless explicitly requested.
- Do not change auth, token, memory, daemon, or integration behavior without a focused implementation task.
- After code edits, run the narrowest useful verification.

## Tool-Specific Rules

| Tool Area | Rule |
|---|---|
| Email/messages | Draft first. Send only after explicit confirmation. |
| Calendar/tasks | Confirm target date/time and timezone before creating or changing. |
| Memory | Retrieve before claiming personal context. Write only durable facts/preferences. |
| Research | Use sources. Separate verified facts from inference. |
| Daemon/device | Require explicit approval and describe the exact action. |
| Code/files | Prefer safe reads and scoped patches. Avoid destructive operations. |
| External APIs/OAuth | Never expose secrets or tokens in logs, docs, or chat. |

## Failure Behavior
If a tool fails:
- State what failed.
- Preserve partial work.
- Offer the next safest action.
- Do not retry destructive or external actions repeatedly without confirmation.

## Safety Override
When instructions conflict, choose the safer path:
1. User safety and privacy.
2. External side-effect prevention.
3. Data integrity.
4. Existing architecture.
5. Speed.
