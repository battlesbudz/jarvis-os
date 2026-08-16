# Capability Verification Matrix

Last updated: August 16, 2026

This matrix separates code existence from integration and production evidence. A capability is not production-ready merely because its module or unit tests exist.

| Capability | Implemented | Integrated | E2E verified | Production-ready | Current evidence / next proof |
|---|---:|---:|---:|---:|---|
| App chat with ChatGPT subscription | Yes | Yes | Automated hosted-runtime assertion | Partial | OAuth profile, refresh, and hosted Codex app-server paths are covered; repeat a signed-in Android production smoke after each auth/runtime change. |
| Android native app open | Yes | Yes | Focused runtime assertions | Partial | App resolution and daemon receipts are tested; retain real-device smoke coverage. |
| Android YouTube search | Yes | Yes | Deterministic route assertion | Partial | Search requests now force `android_youtube_search`; production proof still requires a real device receipt and visible results. |
| Calendar read | Yes | Yes | Provider-focused assertions | Partial | Google/Microsoft connections remain credential-dependent; test both providers in a deployed environment. |
| Calendar create | Yes | Yes | Validation/fallback assertion | Partial | Provider selection and timestamp order are deterministic; live create/cancel cleanup should be run for both providers. |
| Approval gates and Inbox | Yes | Yes | Unit and workflow assertions | Partial | Approval requests use a stable user + gate source identity; cross-channel restart/continuation remains a production smoke requirement. |
| Codex delegation | Yes | Yes | Gateway/local/hosted assertions | Partial | Local, gateway, and user-scoped hosted subscription paths exist; production proof still requires a deployed repository task and review of its receipt. |
| Document/PDF processing | Yes | Partial | Component assertions | No | Processing modules exist; add upload-to-correct-route E2E coverage so documents cannot be misclassified as email work. |
| Memory retrieval | Yes | Yes | Retrieval and permission assertions | Partial | Hybrid retrieval is covered; add exact conversation-history E2E verification across sessions and permission boundaries. |
| Capability gap analysis | Yes | Yes | Component assertions | Partial | Detection/proposal flow exists. `MAX_AUTO_BUILDS = 0` is an intentional review-only safety policy, not an implementation gap. |
| Background agents/jobs | Yes | Yes | Queue/worker assertions | Partial | Persistent jobs and deliverables are covered; repeat restart, notification, and approval-continuation production tests. |

## Status rules

- **Implemented**: owning code and contract exist.
- **Integrated**: reachable from a supported user/runtime surface.
- **E2E verified**: an automated or documented test crosses the real routing boundary; the evidence column states which.
- **Production-ready**: deployed behavior has repeatable live evidence, failure handling, and operational recovery. “Partial” means the capability is usable but still has a named hardening gap.

Update this file in the same PR whenever a change materially alters one of these statuses or its evidence.
