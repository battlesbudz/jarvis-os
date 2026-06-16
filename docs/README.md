# Jarvis OS Docs

This folder contains the public architecture, setup, operations, deployment, and roadmap documents for Jarvis OS. Read these before changing runtime behavior, safety boundaries, provider routing, memory, connectors, channels, or deployment scripts.

## Start Here

1. [`../README.md`](../README.md) - product overview, screenshots, architecture, and local setup.
2. [`self-hosting.md`](self-hosting.md) - clean local install, database setup, secrets, ports, and verification.
3. [`architecture.md`](architecture.md) - current system layout and boundaries.
4. [`workspace-map.md`](workspace-map.md) - where major code and context areas live.
5. [`operations/jarvis-os-runbook.md`](operations/jarvis-os-runbook.md) - startup, health checks, and safe autonomy operations.
6. [`../downloads/README.md`](../downloads/README.md) - APK download and release paths.
7. [`../ROADMAP.md`](../ROADMAP.md) - concise public roadmap.
8. [`../ACKNOWLEDGEMENTS.md`](../ACKNOWLEDGEMENTS.md) - public attribution for derived or materially inspired architecture.
9. [`../JARVIS_ROADMAP.md`](../JARVIS_ROADMAP.md) - detailed technical roadmap and implementation phases.

## Architecture And Runtime

- [`architecture.md`](architecture.md) - conceptual architecture, runtime flow, and folder map.
- [`workspace-map.md`](workspace-map.md) - generic workspace and code ownership map for contributors.
- [`decision-log.md`](decision-log.md) - durable repo-level decisions and constraints.
- [`public-compatibility.md`](public-compatibility.md) - staged rename and compatibility note for older identifiers.
- [`self-hosting.md`](self-hosting.md) - local install and verification path.

## Operations And Deployment

- [`operations/jarvis-os-runbook.md`](operations/jarvis-os-runbook.md) - readiness checks and safe autonomy flow.
- [`railway-setup.md`](railway-setup.md) - Railway deployment/setup notes.
- [`chatgpt-codex-oauth.md`](chatgpt-codex-oauth.md) - ChatGPT/Codex OAuth provider, gateway, and delegation notes.

## Memory And Agent System

- [`gbrain-implementation-plan.md`](gbrain-implementation-plan.md) - active implementation plan for the derived G-Brain second-brain layer.
- [`gbrain-spec-sheet.md`](gbrain-spec-sheet.md) - implementation spec and contract sheet for G-Brain tables, adapter behavior, projection, retrieval, and maintenance.
- [`memory-os-temporal-graph-plan.md`](memory-os-temporal-graph-plan.md) - broader Memory OS and temporal graph plan that G-Brain feeds into.
- [`jarvis-wearable-os-master-roadmap.md`](jarvis-wearable-os-master-roadmap.md) - wearable/spatial/ambient OS roadmap.

## Public Documentation Boundary

Public docs should explain Jarvis OS as a self-hostable project. They should not expose maintainer-local paths, private personal/business workspace details, credentials, tokens, or internal branch names. Historical internal plans may exist for maintainers, but they should not be linked from the public start path unless they are scrubbed for public readers.

## Notes For Maintainers And Agents

- Keep high-level context in docs and implementation-specific details near the code that owns them.
- Keep AutoResearch and other external improvement harnesses out of Jarvis product docs unless the document is explicitly about development tooling.
- Treat connector, daemon, provider-routing, approval, memory, and deployment changes as safety-sensitive.
