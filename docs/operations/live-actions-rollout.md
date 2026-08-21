# Active Project Capsule and Live Actions rollout

This runbook owns the rollout controls and baseline telemetry for the Active Project Capsule and Universal Live Action Card. The canonical project, job, approval, deliverable, and device owners remain unchanged.

## Feature flags

All flags default off and can be enabled independently.

| Flag | Owner | Enables |
|---|---|---|
| `JARVIS_PROJECT_CAPSULE` | Project context | Capsule resolution, rendering, and runtime injection added in PR 2 |
| `JARVIS_LIVE_ACTIONS_PROJECTOR` | Live-action server | Source-to-read-model projection added in PR 1 |
| `JARVIS_LIVE_ACTIONS_UI` | Client surfaces | Shared card UI added in PR 3 |
| `JARVIS_LIVE_ACTIONS_STREAM` | Live-action delivery | Cursor stream added in PR 3 |

Accepted enabled values are `1` and `true` (case-insensitive). Any other or missing value is disabled.

## Privacy-safe baselines

Authenticated clients and server instrumentation expose aggregate baselines at `GET /api/live-actions/baseline`. Observations can be submitted at `POST /api/live-actions/baseline` using only a fixed metric name, allowlisted surface, and bounded non-negative numeric value.

The baseline contract measures status-check follow-ups, eligible inbound turns, client hydration/foreground restoration latency, duplicate rendered representations, rendered-versus-canonical terminal-state drift, and acknowledgement-to-visible latency. Status checks and their inbound-turn denominator are recorded only at verified app, PRIME, and external-channel user-inbound boundaries; schedulers and other internal `runCoachAgent` callers do not opt in. Retriable external transports pass their stable event, message, update, or interaction ID so delivery retries do not inflate either count. Inbox, Projects, and Mission Control submit snapshots bounded to 100 rendered representations after each successful query refresh, providing a heartbeat shorter than the snapshot lifetime even when structural sharing preserves the rendered array. Hidden, blurred, or unmounted list surfaces submit an empty snapshot instead of counting cached rows as rendered. Each surface sends a monotonic snapshot sequence scoped to a client incarnation, and the server ignores delayed snapshots older than the latest accepted version from that client so an out-of-order heartbeat cannot restore stale cards or suppress another active client. The server uses process-keyed, short-lived HMAC fingerprints only to compare the same logical representation across recent surfaces and client incarnations, never stores raw representation or client IDs in metrics, and expires matching snapshots after five minutes. Both agent-job and project snapshots are checked against their user-scoped canonical owner state; terminal mismatches are counted only after the same fingerprint remains mismatched through the five-minute reconciliation window with no heartbeat gap greater than 90 seconds. Duplicate and terminal-drift observations record their corresponding rendered or audited-terminal denominators so per-user reports can calculate rates. Latency observations retain a fixed-size histogram with explicit 1,500 ms and 3,000 ms SLO boundaries and expose approximate p50/p95 without storing raw samples. The general client metric endpoint accepts only client-measured hydration and acknowledgement latency; duplication, denominator, drift, and overflow values are derived by the server from client-submitted snapshots. The current Inbox acknowledgement observation reports the first visibility of each active job per client session and intentionally includes time spent disconnected; values above the one-year aggregate bound are clamped and counted instead of dropped. Exact server-acknowledgement/card-render correlation replaces this approximation when the persistent projection ships. Telemetry never stores message text, prompts, titles, payloads, tokens, paths, or arbitrary metadata. Unknown surface values collapse to `unknown` so they cannot create high-cardinality labels. Per-user reports remain authenticated and user-scoped.

The operations-only `GET /api/operations/live-actions/baseline` export requires the production `JARVIS_OPERATIONS_EXPORT_SECRET` in the `x-operations-secret` header. It includes only server-observed metrics, currently cross-channel status-check follow-ups and their eligible inbound-turn denominator. Client-reported latency and representation metrics remain in authenticated per-user reports because an authenticated client can fabricate or replay those observations; they must not influence deployment-wide rollout decisions until device attestation or server-owned projection provides a trustworthy observation boundary. Aggregates are process-local and bounded; production dashboards should scrape this export before entries are evicted or a process restarts.

## Rollback

Set all four flags to `0` or remove them, then restart the server/client deployment. This disables the new projector, capsule, UI, and stream independently without deleting or mutating canonical project/job state. Baseline observation may remain enabled because it is read-only and does not affect execution. If telemetry itself must be stopped, remove client submissions or unregister the baseline route; no data migration or canonical-state repair is required.
