# Decision Log

This file records durable architecture and product decisions so future Jarvis sessions do not re-litigate the same questions.

## 2026-05-05 - Treat PRIME as the Master Router

Decision: `agents/PRIME.md` remains the canonical master identity/router file. It is conceptually equivalent to a workspace `CLAUDE.md`, but the product-native name is PRIME.

Reason: Jarvis already uses PRIME language in the code and docs. Renaming it would create churn without improving routing.

Implication: Future agents should read `agents/PRIME.md`, then `agents/ROUTING.md`, then `agents/TOOL_POLICY.md` as needed.

## 2026-05-05 - Add Routing Layer Before Moving Folders

Decision: Improve navigability with additive Markdown maps before moving existing folders.

Reason: The repo has many deployment, import, and runtime assumptions. Moving `dashboard`, `daemon`, `android-daemon`, `server/agent`, or identity files should be a separate refactor with checks.

Implication: New docs can guide future work immediately while preserving the current naming architecture.

## 2026-05-26 - Split SOUL and AGENTS Responsibilities

Decision: Root `SOUL.md` is the personality source of authority. Root `AGENTS.md` is the workflow and tool-usage index. `agents/SOUL.md` remains only as a pointer back to root `SOUL.md`.

Reason: Keeping personality short and separate from workflow rules reduces prompt bloat and makes behavioral updates easier to review.

Implication: Future workflow, routing, tool, and crew guidance belongs in `AGENTS.md` or the referenced `agents/` files, not in `SOUL.md`.

## 2026-05-28 - Treat Root SOUL As The Base Identity Kernel

Decision: Root `SOUL.md` defines Jarvis's base identity, temperament, memory philosophy, communication style, and safety stance before any specific user relationship. DB-backed `JARVIS_SOUL` stores the learned per-user relationship and current user context. Root `AGENTS.md` remains the workflow, routing, tool policy, and role-instruction index.

Reason: Jarvis needs a stable identity kernel without mixing in user-specific relationship memory or low-level operating instructions. The split keeps identity durable while preserving reviewable operational policy in `AGENTS.md` and the `agents/` files.

Implication: Root `SOUL.md` may state broad safety principles such as approval-gated high-risk action, but detailed routes, tool instructions, channel behavior, implementation paths, and crew guidance still belong outside `SOUL.md`.

## 2026-05-28 - Keep PRIME Structural And Move Coaching Detail Out

Decision: `agents/PRIME.md` is the master orchestration contract only. Detailed coaching modes now live in `agents/COACHING.md`; side-effect rules remain in `agents/TOOL_POLICY.md`; task routing remains in `agents/ROUTING.md`.

Reason: PRIME had accumulated coaching styles, tool-specific actuation scripts, and placeholder sections that conflicted with approval-gated autonomy. Keeping PRIME structural makes the routing stack easier to audit and safer to execute.

Implication: Future additions should not turn PRIME back into a dumping ground. Add route details to `agents/ROUTING.md`, safety policy to `agents/TOOL_POLICY.md`, coaching tone to `agents/COACHING.md`, and durable architecture decisions here.
