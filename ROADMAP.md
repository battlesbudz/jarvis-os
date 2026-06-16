# Jarvis OS Public Roadmap

Last updated: June 15, 2026

This roadmap is for public readers and contributors. It names the product-level work needed to make Jarvis OS easier to install, verify, trust, and extend. The deeper technical roadmap remains in `JARVIS_ROADMAP.md`.

## Current Focus

| Area | Public status | Next improvement |
|---|---|---|
| Self-hosting | Supported, but still manual. | Make the local install path clearer, reduce required secrets, and improve first-run diagnostics. |
| Server/runtime | Implemented on `main`. | Keep hardening route ownership, job visibility, and approval-gated execution. |
| Mobile app | Implemented with Expo development and Android release paths. | Add better public screenshots, release notes, and setup verification. |
| Dashboard | Implemented as a separate Next.js app. | Improve API configuration docs, auth clarity, and richer demo screenshots. |
| Memory and G-Brain | Implemented with active hardening. | Improve user-facing review, correction, provenance, deletion, and explanation flows. |
| Provider routing | Implemented for multiple provider paths. | Make provider setup easier to understand and test without private maintainer assumptions. |
| Channels | Optional and credential-dependent. | Document per-channel setup and add clearer smoke checks. |
| Desktop and Android connectors | Implemented, optional, and high-risk. | Keep permission scopes narrow, improve release trust, and expand focused tests. |
| Public repo polish | In progress. | Continue scrubbing private/internal context and make contributor verification more obvious. |

## Near-Term Priorities

1. Make local self-hosting reproducible from a clean machine.
2. Add a capability/status table that stays aligned with implementation.
3. Expand public screenshots beyond dashboard-only views.
4. Document all staged-rename compatibility identifiers before changing them.
5. Add more focused tests for safety-sensitive paths.
6. Improve release/download docs for app and daemon APKs.
7. Keep public docs free of private workspace context and stale branch language.

## Not In This Pass

- Renaming installed mobile package IDs, URL schemes, OAuth callbacks, or existing update channels.
- Turning Jarvis OS into a hosted SaaS.
- Enabling autonomous external actions without approval.
- Moving private operator context into public docs.

## Detailed Technical Roadmap

See `JARVIS_ROADMAP.md` for implementation-level phases, subsystem notes, and remaining hardening work.
