# Changelog

All notable public-facing changes to Jarvis OS are documented here.

This project is moving from rapid private development into a cleaner open-source shape. Early history is preserved in Git; this file tracks the public project surface from the `main` branch forward.

## [Unreleased]

### Changed

- Refined public documentation to describe Jarvis OS as a self-hostable personal AI operating system rather than a generic assistant.
- Documented the runtime architecture: agent harness, memory, background jobs, approval gates, connectors, channels, and deployment surfaces.
- Updated contributor and security guidance around provider routing, desktop/Android connectors, approval gates, and self-hosting.
- Removed stale branch/support language from public docs.
- Added a capability status matrix, local self-hosting guide, public roadmap, concrete compatibility identifier table, dashboard configuration notes, and focused contributor test map.
- Added public GBrain attribution in the README and acknowledgements file.

### Security

- Clarified that only `main` is supported for security fixes.
- Added self-hosting hardening guidance for secrets, database SSL, desktop connector roots, Android daemon permissions, and approval-gated actions.

## 2026-06 Public Main Promotion

- Promoted the continuation line of development into `main`.
- Closed obsolete historical PR branches.
- Kept public project documentation focused on current Jarvis OS capabilities and supported hosting paths.

## Earlier History

Earlier work includes the mobile app, Express runtime, memory system, channel adapters, background job queue, desktop/Android connectors, provider routing, and approval-gated autonomous tools. See the Git history for implementation detail.
