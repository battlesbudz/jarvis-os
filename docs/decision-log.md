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
