# Jarvis OS Docs Index

This folder contains architecture, operation, deployment, and roadmap documents for Jarvis OS. Read these before changing runtime behavior, safety boundaries, provider routing, memory, connectors, channels, or deployment scripts.

## Core Orientation

- `architecture.md` - current system layout and boundaries.
- `workspace-map.md` - where major code and context areas live.
- `decision-log.md` - durable repo-level decisions and constraints.
- `operations/jarvis-os-runbook.md` - startup, health checks, and safe autonomy operations.

## Roadmaps And Plans

- `../JARVIS_ROADMAP.md` - main autonomous-agent roadmap and current remaining work.
- `jarvis-wearable-os-master-roadmap.md` - wearable/spatial/ambient OS roadmap, reviewed against the current implementation.
- `gbrain-implementation-plan.md` - active implementation plan for the derived G-Brain second-brain layer.
- `gbrain-spec-sheet.md` - implementation spec and contract sheet for G-Brain tables, adapter behavior, projection, retrieval, and maintenance.
- `memory-os-temporal-graph-plan.md` - broader Memory OS and temporal graph plan that G-Brain feeds into.
- `superpowers/plans/2026-05-15-jarvis-os-foundation.md` - completed Jarvis OS foundation implementation plan and follow-up status.

## Integrations And Deployment

- `chatgpt-codex-oauth.md` - ChatGPT/Codex OAuth provider, gateway, and delegation notes.
- `railway-setup.md` - Railway deployment/setup notes.

## Notes For Maintainers And Agents

- Keep high-level context in docs and implementation-specific details near the code that owns them.
- Keep AutoResearch and other external improvement harnesses out of Jarvis product docs unless the document is explicitly about development tooling.
- Treat connector, daemon, provider-routing, approval, memory, and deployment changes as safety-sensitive.
