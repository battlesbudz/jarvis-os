# Multi-Agent Worktrees

Use project-local git worktrees under `.worktrees/` when multiple Codex agents need to work on Jarvis at the same time.

Conventions:

- Main coordination checkout: project root on `codex/replit-main-continuation`.
- Agent A worktree: `.worktrees/agent-a` on branch `codex/agent-a`.
- Agent B worktree: `.worktrees/agent-b` on branch `codex/agent-b`.
- Keep each agent on a separate branch and assign non-overlapping files when possible.
- Before merging an agent branch back, run `npm.cmd test` and `npm.cmd run server:build` from that worktree.
- Do not edit inside another agent's worktree unless that agent is finished or the work is being intentionally handed off.

Useful commands:

```powershell
git worktree list
git -C .worktrees/agent-a status --short
git -C .worktrees/agent-b status --short
```
