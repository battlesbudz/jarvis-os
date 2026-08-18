# Product Requirements Document: Trusted Execution

Remove duplicated approval friction while preserving bounded, observable, and recoverable execution

- **Product:** Jarvis OS
- **Status:** Proposed for implementation
- **Prepared:** August 16, 2026
- **Audience:** Product, core runtime, agent, mobile, connector, security, and QA contributors
- **Target:** Five sequential implementation PRs behind per-user feature flags
- **Source baseline:** Jarvis OS `main` at `30183c7`, which includes runtime reliability PR `#253` and the Active Project Capsule + Universal Live Action Card PRD `#261`, with the remaining integration dependencies and cross-PR sequencing listed in Section 17

> **Product decision:** A clear, authenticated, user-issued command is authorization for one bounded execution of that command. Jarvis must not ask the user to approve the same requested action again in another screen. Safety moves from repeated approval prompts to scoped authority, capability checks, idempotency, recoverability, audit, limits, clarification, and hard blocks.

## 1. Executive summary

Jarvis currently uses approval gates across the agent harness, tool hooks, background workers, deliverables, email, voice, Android actions, code tools, and self-improvement. Those gates protect real external side effects, but they also create duplicated work for the user. The user can explicitly request a research report, wait for the job, then be required to open Inbox and approve the completed result before it is saved to Documents. Similar detours can occur after the user has already explicitly requested an email, device action, code change, or other bounded operation.

Trusted Execution replaces this repeated-confirmation model with a structured execution-authority contract. The current authenticated command grants authority only to the task it describes. The runtime then chooses one of three outcomes:

| Outcome | Meaning | User experience |
|---|---|---|
| `execute` | The request is sufficiently specified, authorized, supported, and within safety limits | Start immediately and report progress/result |
| `clarify` | A material target, value, recipient, scope, or choice is missing | Ask one focused question in the originating conversation |
| `block` | The action cannot be made safe, exceeds authority or limits, or violates a hard policy | Explain the blocker and do not create an approval card |

There is no new `waiting_for_approval` outcome for direct commands. Authentication, ownership, provider scopes, Android/OS permissions, agent capabilities, path sandboxes, spend limits, secret protection, and other genuine authorization boundaries remain enforced.

The rollout is deliberately incremental. The first implementation PR introduces the authority model without changing production behavior. The second proves one complete background-report workflow. Later PRs expand the same central contract to channels, connected accounts, device actions, code workflows, and finally remove obsolete approval UX and legacy state.

## 2. Problem statement

### 2.1 User problem

- Jarvis asks for permission after the user already gave an explicit command.
- Background work can finish but remain unusable behind a deliverable approval action.
- Approval requests are separated from the conversation that created them.
- Voice and mobile users must leave their current flow, find Inbox or Approvals, and resume the task manually.
- A long-running task can appear blocked when it is actually complete and only awaiting administrative review.
- Different channels and tools apply different approval rules to equivalent commands.
- Retries and continuation paths make it difficult to know whether approving will resume once, duplicate work, or act on stale state.

### 2.2 System problem

Approval behavior is distributed across several owners:

- `server/agent/autonomyPolicy.ts` and `autonomyRuntime.ts`
- `server/agent/approvalToolRisk.ts`
- `server/agent/agentPolicyManager.ts`
- `server/agent/agentApproval.ts`
- `server/agent/toolCallHooks.ts`
- `server/agent/systemApprovalGate.ts`
- Agent SDK approval bridges and runtime protocol types
- Direct email approval routing
- Voice and Android submit confirmation gates
- Worker approval checkpoints
- Deliverable review state and Inbox UI
- Code/self-heal safe-write and proposal paths

Because permission to begin, permission to cause an external side effect, and optional review of a completed result share the same approval vocabulary, harmless work can be blocked and high-risk work can be protected inconsistently.

### 2.3 Why now

Recent work has improved app/voice continuity, memory routing, background-job context handoff, Android actions, and runtime diagnostics. These improvements expose approval friction as a system-level reliability problem rather than an isolated UI annoyance. Trusted Execution is also a prerequisite for Jarvis to feel like an ambient operating system: a voice command cannot be considered successfully handled if the user must later hunt through another screen to authorize the same command.

## 3. Product vision and principles

> **Vision:** Tell Jarvis what to do once. If the command is clear, authorized, and safely bounded, Jarvis starts immediately, finishes the work, and returns the result where the request originated.

| Principle | Requirement |
|---|---|
| One command, one authorization | Do not ask the user to approve an action already explicitly requested in the authenticated turn |
| Bounded authority | Authority is scoped to the user, task, targets, tools, time window, and attempt count |
| State over wording | Do not infer generic authorization from words such as “yes” or “do it” without a structured active task context |
| Clarify in place | Missing material information is resolved in the originating conversation, not through an Inbox approval card |
| Review is optional | Completed artifacts are immediately available; review, revise, discard, and Save to Drive are optional actions |
| Recoverability over ceremony | Use branches, backups, trash, undo, atomic writes, checkpoints, and rollback rather than duplicated confirmation |
| No silent scope expansion | Workers and subagents inherit only the authority required for their assigned step |
| Exactly-once side effects | Retries, reconnects, and continuation paths must not duplicate external actions |
| Observable execution | Every material action records who requested it, what authority covered it, what occurred, and the result |
| Hard boundaries remain hard | Authentication, ownership, secrets, provider scopes, device permissions, sandboxes, and prohibited actions cannot be bypassed |

## 4. Goals, non-goals, and scope

### 4.1 Goals

- Eliminate manual approval gates for clear authenticated user commands.
- Make background research, writing, planning, and document work start and deliver automatically.
- Use one execution-authority contract across app chat, voice, Telegram, Discord, connected accounts, workers, and device runtimes.
- Replace approval-wait states with execute, clarify, block, progress, failure, and terminal result states.
- Preserve user control through cancellation, activity history, limits, undo, rollback, and a kill switch.
- Prevent duplicate sends, submissions, purchases, posts, device actions, commits, pushes, or deployments.
- Retire legacy approval state without executing stale pending requests.

### 4.2 MVP scope

- Per-user Trusted Execution feature flags and emergency disable control.
- Structured authority issuance for authenticated direct commands.
- Authority propagation through the agent harness, tool calls, background jobs, and subagents.
- Background-report vertical slice with automatic Documents storage and result delivery.
- App chat, voice, Telegram, and Discord parity.
- Email/connected-account, Android daemon, code, GitHub, and deployment paths.
- Deliverable status separation, legacy approval migration, Activity/Exceptions UX, and diagnostics.

### 4.3 Non-goals

- Treating optimistic or “positive” wording as authorization.
- Bypassing Android, operating-system, OAuth, provider, repository, or account permissions.
- Giving every named agent unrestricted capabilities.
- Allowing unbounded deletion, credential exposure, arbitrary host-root access, or unlimited purchases.
- Automatically executing old pending approval requests during migration.
- Removing audit records, cancellation, review, revision, or rollback controls.
- Replacing the current job queue, tool registry, daemon bridge, or provider router.

## 5. Core concepts

### 5.1 Execution authority

A server-issued, user-scoped record derived either from a current authenticated direct command or from one validated run of a persisted standing grant. It is not a reusable blanket approval and is never supplied by an untrusted client as proof of authority.

Minimum contract:

```ts
interface ExecutionAuthority {
  id: string; // newly generated run-authority ID
  userId: string;
  sourceType: "direct_command" | "standing_grant";
  sourceTurnId?: string;
  sourceActionKey?: string;
  standingGrantId?: string;
  standingGrantVersion?: number;
  standingGrantCategory?: string;
  standingGrantLimitSnapshot?: Record<string, number | string | boolean>;
  standingGrantConsentSourceTurnId?: string;
  standingGrantTriggerLineageId?: string;
  triggerOccurrenceKey?: string;
  standingGrantUsageReservationId?: string;
  standingGrantUsageSnapshot?: Record<string, number | string | boolean>;
  globalExecutionEpoch: number;
  userExecutionEpoch: number;
  originChannel: string;
  taskId: string;
  intent: string;
  allowedActions: string[];
  allowedTargets: string[];
  riskTier: "low" | "medium" | "high";
  maxAttemptsPerStep: number; // parent ceiling; every child maxAttempts must be <= this value
  idempotencyLineageId: string;
  workflowPlanRevision: number;
  workflowPlanStatus: "planning" | "closed";
  requiredStepManifestHash?: string; // required when closed
  issuedAt: string;
  expiresAt: string; // deadline for starting/crossing the boundary of forward steps
  compensationExpiresAt: string; // separately bounded rollback deadline fixed at issuance
  forwardAdmissionStatus: "open" | "closed";
  forwardAdmissionClosedAt?: string;
  status: "active" | "compensating" | "completed" | "failed" | "cancelled" | "expired";
  reconciliationStatus: "none" | "required" | "resolved";
  terminalReasonRef?: string;
}

interface AuthorityExecutionStep {
  id: string;
  authorityId: string;
  stepKey: string; // stable within the authority across retry/reconstruction
  action: string;
  targetFingerprint: string;
  idempotencyKey: string;
  role: "forward" | "compensation";
  compensatesStepKeys?: string[]; // required for compensation; immutable closed-manifest references
  compensationTriggers?: ("forward_failure" | "workflow_incomplete_at_expiry")[]; // required for compensation
  maxAttempts: number;
  attemptCount: number; // durable number of attempts already started
  currentAttemptId?: string;
  status: "pending" | "consuming" | "consumed" | "retryable_failed" | "failed" | "cancelled" | "skipped" | "reconciliation_required";
  startedAt?: string;
  consumedAt?: string;
}

interface AuthorityExecutionAttempt {
  id: string;
  authorityExecutionStepId: string;
  attemptNumber: number;
  leaseOwnerId: string;
  leaseGeneration: number; // monotonically increasing fencing token
  leaseExpiresAt: string;
  boundaryState: "not_started" | "started" | "confirmed_no_effect" | "confirmed_effect" | "uncertain";
  status: "leased" | "completed" | "abandoned" | "reconciliation_required";
  boundaryStartedAt?: string;
  finishedAt?: string;
}
```

The persisted representation may use different names, but it must preserve these semantics. Direct-command authority requires `sourceType: "direct_command"`, a real `sourceTurnId`, and a stable trusted `sourceActionKey`. Standing execution requires `sourceType: "standing_grant"`, no fabricated source turn, and the stable grant and logical-trigger lineage IDs, immutable grant version, category, effective limit snapshot, authenticated consent source turn, stable trusted trigger-occurrence key, and any required usage reservation. Every authority snapshots the current global and per-user execution epochs. The execution-authority `id` is a separately generated run ID. Exactly one provenance variant is valid.

The parent authority is the scope, provenance, cancellation, workflow-plan, and idempotency-lineage envelope; it is not consumed once as a substitute for its external steps. `maxAttemptsPerStep` is the authority-wide per-child ceiling, not an aggregate workflow retry pool. Each external or irreversible step beneath it has a durable child execution record with a stable step key, resolved action and target fingerprint, its own idempotency key, attempts, consumption state, result/recovery reference, and audit timestamps. Each child may choose a stricter `maxAttempts`, but manifest closure and every attempt-start transaction must reject `child.maxAttempts > parent.maxAttemptsPerStep`. A single-side-effect authority has exactly one manifested step.

Before any external/irreversible step can enter `consuming`, one transaction must persist every required or selected conditional external step, the ordered/dependency-aware step manifest, a manifest hash and revision, and an immutable `closed` marker on the parent. Read-only planning may occur while the plan is `planning`, and discovered steps may be atomically registered then, but no external step can be consumed and the parent cannot complete until closure. Closing the plan verifies every manifest key has exactly one child record unique on `(authorityId, stepKey)`; retry/reconstruction returns those same records. A closed plan cannot be reopened or extended. If execution later discovers a materially new external action or target, it must stop and obtain newly classified authority rather than append to the closed parent.

Final consumption locks the selected child step and rechecks the closed manifest membership/hash/revision, parent status, epochs, scope, dependency outcomes, applicable grant head, the role-specific admission deadline, and `child.maxAttempts <= parent.maxAttemptsPerStep`; a forward child requires `forwardAdmissionStatus: "open"` and database time before `expiresAt`, while compensation requires the transition and deadline rules below. Consuming one step neither consumes nor authorizes another. `attemptCount` starts at zero. One attempt-start transaction verifies both limits, increments the child count, creates an immutable attempt row with the same `attemptNumber`, a fresh monotonically increasing lease generation/fencing token, owner, expiry, and `boundaryState: "not_started"`, sets `currentAttemptId`, and moves the child from `pending` or `retryable_failed` to `consuming`. Retry and reconstruction reuse the persisted count and must not start when `attemptCount >= child.maxAttempts` or the child limit exceeds the parent ceiling.

The worker may renew the lease only while it still owns the current generation and the attempt is `not_started`. Immediately before an external/irreversible call, it must use compare-and-set to verify the unexpired current lease and move the attempt to `started`; side-effect adapters accept only that current fencing token and the step's stable idempotency key. A stale or superseded worker therefore cannot cross the boundary. For a provider that cannot enforce fencing or idempotency atomically, the server persists `started` before the call and treats loss of the response as uncertain rather than replayable.

An expired `consuming` lease is never replayed ad hoc. A recovery transaction fences the old generation and then chooses from durable evidence: when the attempt is still `not_started`, it records `confirmed_no_effect`/`abandoned` and moves the child to `retryable_failed` if attempts remain, otherwise it applies the definitive-failure transition below; when the boundary is `started` or proof is incomplete, it moves the child to `reconciliation_required`, sets the parent reconciliation flag, and blocks dependent steps. Reconciliation queries the provider by the stable idempotency key where supported and records either `confirmed_effect`/`consumed` or `confirmed_no_effect`/`retryable_failed`; an irreconcilable or exhausted attempt applies the same definitive-failure transition. Reconciliation cannot revive a terminal parent. A normal recoverable attempt failure follows the same evidence rules. A definitive failure or exhausted attempt budget atomically marks that step `failed`, records the sanitized failure/recovery reference, cancels every unstarted forward step with `upstream_failure`, and determines whether the closed manifest contains an applicable compensation step for a forward step with a confirmed effect. If none applies, the parent transitions directly to terminal `failed`. If compensation applies, the same transaction moves the parent from `active` to nonterminal `compensating`, preserves only those predeclared compensation children as executable, and marks nonapplicable compensation children `skipped`; ordinary forward work can never resume. Any step already past an uncertain boundary becomes or remains `reconciliation_required`, and compensation for that effect stays blocked until reconciliation proves whether it applies.

A compensation child is not newly discovered recovery work: it must be selected and persisted before manifest closure with `role: "compensation"`, immutable `compensatesStepKeys`, immutable `compensationTriggers`, action, target, dependencies, idempotency key, and attempt limit. It receives no broader scope than the original authority and uses the same child consumption, epoch/kill-switch, applicable grant-head, lease, fencing, retry, and reconciliation checks. The authority fixes both `expiresAt` and a bounded `compensationExpiresAt` at original issuance; the latter cannot be extended by a worker and may exceed `expiresAt` only by the policy-capped recovery interval required for the declared action. A forward attempt may start and compare-and-set its boundary to `started` only while `forwardAdmissionStatus` is `open` and database time is before `expiresAt`. At `expiresAt`, one transaction closes forward admission permanently, fences/cancels pre-effect attempts and unstarted forward children, and prevents every later forward boundary crossing. At the forward deadline, the transaction first evaluates the closed-manifest success predicate. Only if all required forward steps are durably `consumed` does that same transaction atomically mark every non-triggered compensation child `skipped` and choose `completed` before any expiry outcome. If any on-time forward outcome remains unresolved, its potentially applicable compensation stays `pending` and reserved; evaluation alone never skips it. Otherwise, if the parent is still `active`, the deadline transaction next preserves any on-time unresolved attempt. When none remains, it checks whether cancellation of the incomplete forward manifest leaves a `consumed`/confirmed-effect forward step with a predeclared compensation child whose immutable trigger includes `workflow_incomplete_at_expiry`. If so, it enters nonterminal `compensating` and preserves only those applicable rollback children/allocations. Only when neither unresolved work nor applicable compensation exists does it terminally expire; a historical resolved step without applicable rollback does not keep the parent alive. If the parent is already `compensating`, normal forward expiry only closes forward admission and never terminalizes or settles the parent; that phase remains governed by `compensationExpiresAt`, cancellation, kill-switch, or applicable grant invalidation. A forward attempt that durably crossed the boundary before the deadline and is still unresolved remains nonterminal while its result is recorded or reconciled; normal expiry must not settle its allocation, cancel potentially applicable compensation, or block the `active` to `compensating` transition. If that on-time attempt fails, a compensation step may enter `consuming` only when its referenced failure made it applicable, the parent is already `compensating`, and database time is before `compensationExpiresAt`. If the outcome arrives after `compensationExpiresAt`, no rollback starts and the parent terminally fails with manual recovery. Expiry of the recovery window cancels unstarted compensation, terminally fails the parent, and records manual recovery; neither deadline extends or revives forward authority. In `compensating`, only an applicable compensation child may enter `consuming`. A compensation failure cannot reactivate forward work or recursively invent another rollback. A compensation child in `reconciliation_required` keeps the parent nonterminal `compensating` with `reconciliationStatus: "required"` while database time remains before `compensationExpiresAt`; it is not a terminal child outcome. Reconciliation that proves no effect moves the child to `retryable_failed` and permits another bounded attempt only when attempts remain and the recovery deadline has not passed. Confirmed effect moves it to `consumed`; definitive failure or proven no effect with exhausted attempts moves it to `failed`. The parent becomes terminal `failed` only after every applicable compensation child is `consumed`, `failed`, or `cancelled`, or when `compensationExpiresAt` passes; an outcome still uncertain at that deadline remains audit-only `reconciliation_required`, but later reconciliation cannot retry after the expired window. The terminal record includes rollback outcome and any manual recovery reference. Cancellation or kill-switch invalidation still prevents unstarted compensation and records that manual recovery may be required.

Parent completion is derived only when the manifest is closed, every manifested required forward step is `consumed`, and every compensation step is atomically marked `skipped` because its failure condition did not occur, with no step failed, cancelled, consuming, or awaiting reconciliation. Parent failure is derived from any definitive manifested-step failure and becomes terminal only after the bounded compensation phase above is complete or no compensation applies; compensation never converts the failed operation into success. Parent cancellation/disablement is likewise distinct from completion: it marks all unstarted manifested steps, including compensation, cancelled while preserving completed-step audit history and surfacing any required manual recovery.

### 5.2 Standing autonomy grant

A user-configured policy for Jarvis-initiated actions that do not originate from a current direct command. Standing grants are persisted, user-owned, category- and limit-specific, versioned, expiring, and revocable. Examples include creating morning planning documents, labeling low-priority email, or running scheduled research. They are not implicit global permission. Standing grants never authorize a purchase or financial transaction: each transaction requires a current, explicit, authenticated user command scoped to that exact transaction, or it is blocked.

Creating a grant, replacing it, reactivating it, or increasing its actions, targets, duration, frequency, or limits requires a current explicit user action in an authenticated session. The server derives the user from that session and records immutable consent provenance, including the real consent source turn, actor user ID, timestamp, granted scope/limits, stable trusted consent-action key, and resulting grant version. Agents and workers may propose grant settings but cannot create, replace, reactivate, or broaden their own grants; client-supplied ownership or consent fields are never trusted. Automatic safety controls may revoke, expire, pause, or narrow a grant, never broaden it.

Every authenticated direct-command action and grant-consent mutation has a stable trusted `sourceActionKey` derived from server-owned origin identity, authenticated user, and action kind; it must remain the same across channel/client redelivery and must not be minted anew by each handler. One database transaction atomically inserts the unique `(userId, sourceActionKind, sourceActionKey)` claim together with the complete bounded authority record or immutable grant version and its recovery/audit reference. There is no separately committed claim without its target record. Duplicate handling therefore always returns or reconciles an existing durable authority/task/result or grant version. A crash before commit leaves neither record; a crash after commit leaves both and is recoverable by redelivery. A source path without stable origin identity must first establish one in server-owned persistence and cannot perform the action until it can be transactionally recorded.

Each eligible scheduled or proactive occurrence supplies a stable, trusted `triggerOccurrenceKey` that is deterministic across redelivery and distinct from the newly generated run-authority ID. Occurrence uniqueness is lineage-wide over `(standingGrantId, standingGrantTriggerLineageId, triggerOccurrenceKey)` and never includes the immutable grant version. A logical trigger keeps the same trigger-lineage ID across grant and trigger-configuration replacements. A genuinely new logical trigger requires explicit authenticated consent and a nonoverlapping effective boundary: old-lineage occurrences at or before the boundary remain owned by the old lineage, and new-lineage occurrences begin strictly after it. Event-driven replacements preserve the source event's occurrence key and reconcile it before activation so one external event cannot execute in both lineages.

Before any side effect, one database transaction locks or conditionally updates the grant's mutable head record, verifies with database time that it remains active, unexpired, unrevoked, and on the expected current version/state revision, claims lineage-wide occurrence uniqueness, reserves the occurrence's declared action, frequency, rate, quantity, and other consumable allowance, and creates the bounded authority plus recovery/audit references. Grant revocation, replacement, expiry, pause, or limit-reduction mutations lock/update that same head record and therefore conflict with stale issuance. Each external-step consumption at its irreversible/billable boundary also atomically revalidates the head, parent authority, and child step state; a mutation that won the race prevents that unstarted step and all later unstarted steps.

Conditional accounting succeeds only if every affected counter/window has sufficient remaining capacity; otherwise the occurrence is blocked or skipped and audited without an authority. Concurrent distinct occurrences serialize against the same counters and cannot over-allocate. Duplicate delivery returns or reconciles the existing reservation/task/result and cannot reserve again or mint another authority. A trigger source that cannot supply a trusted stable occurrence key is blocked or skipped and audited.

Usage reservations have `reserved`, `committed`, `released`, and `reconciliation_required` states. Commit occurs with the associated child step at its defined irreversible/billable boundary. Release is allowed only when no side effect began and uses compare-and-set semantics. An uncertain boundary outcome transitions from `reserved` to `reconciliation_required` and continues to count against allowance until resolved; it must not remain anonymously `reserved`. Retries reuse the same reservation and idempotency lineage. The authority snapshots configured limits, charged windows/counters, amount reserved, and remaining allowance after reservation.

Every terminal transition of a standing parent—completed, failed, user-cancelled, expired, kill-switch-invalidated, or grant revocation/replacement/expiry/pause/limit-reduction-driven cancellation—must settle every reservation or per-step allocation in the same transaction as the parent/step transition. The nonterminal forward-admission close at `expiresAt` releases proven-no-effect allocations for fenced/unstarted forward work but preserves committed or uncertain in-flight usage and keeps potentially applicable compensation allocations reserved, charged, and step-owned until the on-time attempt resolves or `compensationExpiresAt` closes recovery. The later nonterminal `active` to `compensating` transition classifies those allocations atomically: it releases unstarted forward and nonapplicable compensation allocations with durable proof that no side effect began, preserves `committed` forward effects, moves uncertain already-started allocations to `reconciliation_required` with an owner/deadline/recovery reference, and keeps only applicable compensation allocations `reserved`, owned by their persisted compensation steps, and bounded by `compensationExpiresAt`. Those retained allocations remain charged and cannot be reused by another occurrence. The eventual terminal transition commits, safely releases, or quarantines them; recovery-window expiry safely releases only proven-no-effect compensation allocations and otherwise requires reconciliation. When immediate evidence is unavailable, the conservative transition is `reconciliation_required`, never an anonymous plain `reserved`. No terminal parent may leave an allocation in plain `reserved`. Reconciliation later commits or safely releases the quarantined allocation without reactivating the terminal parent; until then it remains charged to the lineage-wide limit.

Usage accounting is keyed to the stable grant lineage, limit/counter identity, and canonical time window—not partitioned into fresh allowance by immutable version. Charged usage is the sum of `committed`, outstanding `reserved`, and `reconciliation_required` allocations; only `released` allocations restore capacity. Replacement, narrowing, expansion, reactivation, or other version changes carry all three charged states into every overlapping applicable window. Remaining capacity is computed from the new limit minus that lineage-wide charged usage and never increases merely because a version changed. If old and new window/counter semantics cannot be mapped conservatively, activation is deferred until the old window closes or the stricter overlapping accounting can be preserved; no mutation may silently reset active-window usage.

Tools and workers receive the run authority ID, never the reusable grant ID. Issuance validates the grant's authenticated owner, immutable consent provenance, active status, current version, expiry, category, action/target scope, limits, trigger eligibility, and hard policy, then snapshots the effective grant fields and links both the stable occurrence key and distinct run ID into the audit lineage. Revocation or expiry prevents new run issuance and cancels unstarted authorities from that grant; it cannot erase completed audit history.

### 5.3 Capability boundary

A real technical or ownership requirement that authority cannot override: authentication, agent permission flags, connected-account scopes, daemon pairing, Android grants, filesystem roots, repository ownership, protected secrets, provider availability, and budget ceilings.

### 5.4 Optional review

Review is an action available after work is complete. It may edit, revise, discard, rate, or export an output. Review does not determine whether a completed artifact exists or is available in Documents.

### 5.5 Safety block

A terminal refusal to execute the current formulation. Blocks apply when a request is outside the user's authority, dangerously broad, prohibited, impossible to bound, or cannot meet mandatory safety invariants. A block does not create an approval gate.

## 6. Authority resolution

### 6.1 Resolution order

1. Select exactly one trusted provenance path: a current authenticated direct command or an eligible server-observed trigger for a persisted standing grant.
2. For a direct command, validate the authenticated user, originating session/channel binding, real source turn, stable trusted source-action key, and conversation/task context.
3. For standing execution, validate authenticated consent provenance plus grant ownership, active/current version, expiry, category, limits, revocation state, trigger eligibility, and hard policy; reject financial actions before issuance.
4. Classify concrete targets, action types, requested outputs, and side effects against the selected source scope.
5. Check ownership, capabilities, provider scopes, device permissions, limits, and hard policy.
6. For a direct command, atomically create the unique source-action claim and complete authority/recovery record in one transaction; on duplicate delivery, return/reconcile that durable authority/task/result.
7. For a standing occurrence, in one transaction lock/revalidate the mutable grant head/current revision, claim `(stable grant ID, logical-trigger lineage ID, occurrence key)` across all grant versions, reserve all applicable lineage-wide usage counters/windows, and create the authority/recovery record; on duplicate delivery, reuse the existing reservation/run, and on stale grant state or insufficient allowance, block/skip without an authority.
8. Issue a new bounded run authority with the appropriate direct-turn or standing-grant provenance and usage-reservation snapshot; keep its run ID distinct from every source/occurrence key.
9. Return `clarify` only for a current direct request when a material field is missing; a standing trigger that cannot resolve inside its grant scope is blocked or skipped and audited.
10. Return `block` when no safe bounded execution exists.
11. Pass the run authority ID—not a free-form “approved” boolean, reusable standing-grant ID, source-action key, or trigger-occurrence key—to tools and workers.

### 6.2 Authority coverage

- One parent authority may cover a declared multi-step workflow, such as inspect, edit, test, commit, push, and open a PR, when those steps are part of the original task. Before commit or any other external step consumes, the full required/selected external-step manifest is persisted and atomically closed; every manifested step uses a distinct durable child execution record and idempotency key. Completing commit cannot consume push or PR creation, and retry/reconstruction reconciles each step independently.
- Every unique direct source action receives at most one authority/idempotency lineage, and every unique consent source action receives at most one immutable grant mutation/version; redelivery reconciles the existing record.
- Every unique standing occurrence receives at most one usage reservation, authority, and idempotency lineage, atomically bound across versions to the stable grant and logical-trigger lineages plus occurrence key; grant replacement and redelivery reconcile that same run. Concurrent different occurrences atomically debit shared counters/windows and cannot exceed the grant. It inherits no action, target, category, duration, attempt, or limit beyond the post-reservation snapshot.
- Grant revocation, expiry, replacement, pause, or limit reduction serializes against issuance/consumption through the same mutable grant-head lock or conditional revision, blocks future issuance and unstarted covered actions, and cannot be bypassed by a stale precheck. Retries remain bound to the original immutable snapshot and may only reconcile already-started work without expanding scope.
- Grant versions share lineage-wide active-window accounting. Committed, reserved, and reconciliation-required usage carries into replacement, narrowing, expansion, or reactivation; a version change never resets frequency, rate, action, or quantity allowance.
- A child job receives only the actions and targets necessary for its assigned step and retains the parent provenance lineage.
- A change of recipient, account, repository, deployment target, deletion scope, or other material target requires a new classification from the current conversation.
- Every purchase or financial transaction requires fresh direct authority from a current explicit authenticated user command for that exact transaction; standing, scheduled, proactive, or inherited authority cannot cover it.
- `expiresAt` closes admission for new forward starts/boundary crossings; it is not an unconditional terminal transition. The deadline transaction closes `forwardAdmissionStatus`, fences pre-effect work, and cancels unstarted forward children. The deadline transaction derives closed-manifest completion first: only if every required forward step is durably `consumed` does it atomically mark unused compensation `skipped` and complete the parent; otherwise all potentially applicable compensation stays `pending` until the unresolved forward outcome is known. Only otherwise, if the parent is `active`, it first preserves any on-time unresolved attempt; when none remains, confirmed effects with a compensation child triggered by `workflow_incomplete_at_expiry` move it to nonterminal `compensating`. It becomes terminal `expired` only when the manifest is incomplete and no unresolved attempt or applicable predeclared rollback remains. A parent already in `compensating` is excluded from normal-expiry terminalization and remains nonterminal until compensation resolves or its recovery deadline/control invalidation applies. An on-time attempt remains nonterminal only while its result/reconciliation is unresolved, after which the same transaction determines completion, terminal expiry/failure, or entry into `compensating`. Only its predeclared rollback may then run, until the separately issued, policy-capped `compensationExpiresAt`; a late result cannot extend either deadline or revive forward work. Successful closed manifests complete with required forward entries `consumed` and compensation entries `skipped`. Failed workflows become terminal after bounded compensation resolves, is blocked, or expires. Terminal parents never start another step, and standing-parent terminal transitions atomically settle every allocation.
- The parent's `maxAttemptsPerStep` is a per-child ceiling. Manifest closure and attempt start reject a child above it; every attempt transaction enforces the child count and parent ceiling together.
- A retry may reuse the same idempotency lineage but must not repeat a successfully completed side effect. Expired `consuming` leases are fenced and recovered from durable boundary evidence: proven pre-effect attempts may retry, while started or uncertain attempts quarantine for reconciliation.

### 6.3 Clarification requirements

Clarify only when the missing information materially changes the side effect. Examples:

- Recipient is missing or ambiguous.
- In a current direct purchase request, the item, exact price or price ceiling, quantity, or payment account is unspecified. Without a current direct transaction-specific request, block instead of clarifying or using a standing grant.
- Calendar date, time, timezone, attendee, or duration is unresolved.
- A deletion target cannot be resolved to a bounded recoverable set.
- Multiple repositories, devices, accounts, or deployment environments match.

Do not clarify merely because an action was historically labeled high risk.

## 7. Safety model

### 7.1 Controls retained

- Authentication and server-side ownership checks
- Per-agent capability and channel permissions
- OAuth/provider scopes and connection health
- Android/OS permission grants and daemon pairing
- Filesystem roots and executable allowlists
- Secret and credential redaction
- Spend, quantity, rate, and transaction limits
- Repository and deployment target validation
- Idempotency and deduplication
- Atomic writes, branches, backups, trash, undo, and rollback
- Action audit records and production diagnostics
- User cancellation plus global and per-user emergency disable with revocation epochs

### 7.2 Action treatment matrix

| Action | Clear direct command | Missing material detail | Outside authority or hard limit |
|---|---|---|---|
| Research/write/plan | Execute immediately | Clarify requested subject/output only when necessary | Block unsupported or prohibited work |
| Create a document/PDF | Execute, save, and return it | Clarify format only when it changes the task materially | Report storage/provider blocker |
| Send email/message | Send once when recipient and content are resolved | Clarify recipient/content/account | Block unauthorized account or prohibited content |
| Calendar change | Execute once when event fields resolve | Clarify material event fields | Block ownership/scope failure |
| Android/device action | Execute when paired, permitted, and bounded | Clarify target/app/device | Block missing OS permission or unsafe device scope |
| Delete exact recoverable item | Move to trash and expose Undo | Clarify target | Block root-wide, unbounded, or nonrecoverable deletion |
| Purchase/financial action | Execute only from a current explicit authenticated command scoped to that exact transaction and within configured limits | Clarify item, amount, quantity, or account only within that current direct request | Block standing, scheduled, proactive, inherited, over-limit, or unsupported transaction authority |
| Code/PR workflow | Execute declared steps in a scoped branch/workspace | Clarify repo/target when ambiguous | Block secret exposure, foreign ownership, or unsafe host scope |
| Deploy | Execute declared environment with checkpoint and rollback | Clarify target environment | Block unauthorized production or missing recovery path |

### 7.3 Hard blocks

The initial hard-block set includes:

- Credential, token, cookie, private-key, or secret exfiltration
- Disabling authentication, audit, kill switches, ownership checks, or mandatory sandboxes through an autonomous task
- Recursive or root-level destruction without a narrowly resolved recoverable target
- Acting as another user or accessing another user's records
- Exceeding configured purchase, spend, rate, or deployment limits
- Attempting a purchase or financial transaction without current, direct, transaction-specific authenticated user authority, including through a standing grant, scheduled task, proactive action, or inherited child authority
- Operating an unpaired device, unowned repository, or unauthorized provider account
- Replaying a consumed child execution step to repeat its external side effect

## 8. Background work and deliverables

### 8.1 Required experience

For a command such as “Research this and give me the report as a PDF”:

1. Acknowledge and queue the job immediately.
2. Preserve the relevant recent conversation context and requested output format.
3. Display truthful running progress.
4. Generate the requested artifact.
5. Save the completed artifact to Documents automatically.
6. Return an attachment or direct link through the originating channel.
7. Keep optional review, revise, discard, and Save to Drive controls.
8. Create no approval gate or pending-approval deliverable.

### 8.2 State separation

Deliverables must separate availability from optional review.

| Dimension | Example values |
|---|---|
| Execution | `queued`, `running`, `succeeded`, `failed`, `cancelled` |
| Availability | `preparing`, `ready`, `unavailable` |
| Review | `unreviewed`, `accepted`, `revised`, `discarded` |
| Export | `not_requested`, `saving`, `saved`, `failed` |

Do not reuse `pending_approval` to mean “completed but not reviewed.”

### 8.3 Delivery reliability

- Document creation and job completion must be transactionally linked or reconciled.
- Notifications may retry, but artifact creation must remain idempotent.
- If PDF rendering fails, return a truthful Markdown or supported document fallback.
- A provider upload failure must not hide the local Jarvis document.
- App reconnect must reconstruct the completed result without requiring the original in-memory stream.

## 9. Channel and tool behavior

### 9.1 Channel parity

Equivalent authenticated commands must receive the same authority decision across app chat, app voice, webchat, Telegram, Discord, Slack, WhatsApp, and supported daemon surfaces. Channel adapters may change presentation, never execution policy.

Every enabled ingress adapter must pass a stable, server-trusted source identity into the central authority resolver. Slack uses the verified Events API `event_id` for events and the provider command/trigger identity for slash commands; WhatsApp uses Twilio's signature-verified `MessageSid`; Telegram and Discord use their verified provider update/message/interaction IDs; app chat, app voice, and authenticated webchat use a server-persisted turn/submission ID bound to the authenticated user/session. That identity is normalized with the authenticated user and action kind into `sourceActionKey` and remains stable across acknowledgement retries, webhook redelivery, reconnect, and process restart. Request timestamps, handler-generated UUIDs, SDK session IDs, and message text hashes are not acceptable substitutes.

Trusted Execution remains disabled for an adapter until that adapter has both stable ingress identity and authenticated/linked-user binding. Public or invite webchat sessions are not direct-command authority merely because they target an owner's chat; they must be explicitly bound to an authenticated user authority model or remain outside Trusted Execution. An adapter without the required identity must use its existing disabled/legacy path and must not mint a new authority, silently retain a covered local approval rule, or enable its Trusted Execution flag.

### 9.2 Email and connected accounts

- “Draft an email” creates a draft only.
- “Send an email” sends once when recipient, subject, body, provider, and account are resolved.
- Direct-email special routing must use the central authority contract rather than create its own approval gate.
- Provider auth failure returns a setup blocker and preserves the prepared content.

### 9.3 Voice and Android

- Voice transcript confidence and intent resolution occur before authority issuance.
- Low-confidence material fields trigger conversational clarification.
- Android submit-capable actions use the same authority as typed commands.
- Android permissions, notification-listener state, accessibility state, pairing, and supported-action checks remain mandatory.
- Confirmation overlays are not shown merely because a clear command may submit external state.

### 9.4 Code, GitHub, and deployment

- The original command may authorize a declared workflow through edit, test, commit, push, PR, review request, and deploy; each external write is registered and consumed through its own durable child execution record beneath the parent authority.
- Git operations remain scoped to the resolved repository and branch.
- Destructive git operations and force pushes remain hard-blocked unless separately and safely specified by product policy.
- Code workers use branches/worktrees, focused staging, verification, and rollback points.
- A failed check stops the workflow in `failed` or `blocked`, not `waiting_for_approval`.
- Each external write uses an idempotency lineage or verifiable completed-state check.

## 10. Functional requirements

### 10.1 Core authority

| ID | Requirement | Acceptance statement |
|---|---|---|
| TE-001 | Direct command authority | An authenticated, sufficiently specified command issues one server-owned bounded authority record |
| TE-002 | Three outcomes | New direct requests resolve only to execute, clarify, or block before execution starts |
| TE-003 | No duplicate approval | A direct command never creates an approval gate solely to reconfirm the same requested action |
| TE-004 | Structured coverage | Tools validate authority by user, task, action, target, expiry, status, and attempt count |
| TE-005 | No generic phrase bypass | “Yes,” “approved,” or “do it” without an active structured task cannot authorize an unrelated action |
| TE-006 | Child scope | Workers/subagents receive no broader authority than their assigned action and targets |
| TE-007 | Exactly once | A completed external side effect cannot repeat because of retry, reconnect, duplicate event, or stale continuation |
| TE-008 | Cancellation | The user can cancel active authority and prevent unstarted covered actions |
| TE-009 | Kill switch | Trusted Execution can be disabled per user and globally without deploying code; disablement increments a revocation epoch, invalidates all unstarted older-epoch authorities, and cannot be undone by re-enabling |
| TE-010 | Audit | Material execution records authority ID, source type, real source turn or standing-grant/version/consent/occurrence lineage, actor, target fingerprint, effective limit snapshot, result, and timestamps without secrets |
| TE-011 | Standing-run issuance | Each eligible unique standing occurrence produces at most one distinct bounded run authority after consent, grant ownership, version, status, expiry, scope, limits, revocation, occurrence, and hard-policy validation |
| TE-012 | Standing lifecycle invalidation | Revocation, expiry, replacement, pause, or limit reduction prevents new standing-run issuance, cancels unstarted covered actions, settles their reservations, and preserves completed audit history |
| TE-013 | Standing-grant consent | Creation, replacement, reactivation, or scope/limit expansion requires a current explicit authenticated user action with immutable consent provenance; agents/workers cannot grant or expand their own future authority |
| TE-014 | Trigger deduplication | `(standingGrantId, standingGrantTriggerLineageId, triggerOccurrenceKey)` is atomically unique across all grant versions and separate from the run-authority ID; replacement/redelivery reconciles the existing run without duplicate execution |
| TE-015 | Authenticated-source deduplication | Stable trusted direct-action and consent-action keys are atomically unique per authenticated user/action kind; redelivery reconciles the existing authority/task/result or grant version |
| TE-016 | Standing-limit reservation | Live grant revalidation, occurrence claim, authority/recovery creation, and reservation of every applicable frequency/rate/quantity counter are transactional; concurrent distinct occurrences cannot exceed lineage allowance |
| TE-017 | Atomic source records | Each direct/consent source claim and its complete authority or immutable grant-version/recovery record commit together; crashes cannot leave an orphan claim |
| TE-018 | Grant lifecycle serialization | Issuance and final unstarted-authority consumption lock/revalidate the same mutable grant head/revision used by revoke, replace, expire, pause, and limit mutations |
| TE-019 | Cross-version usage | Active-window committed, reserved, and reconciliation-required usage is lineage-wide and carried across every grant version; only released usage restores capacity, and mutation cannot reset or increase remaining allowance except through an explicitly larger limit minus all charged usage |
| TE-020 | Cross-version occurrence deduplication | Occurrence uniqueness uses stable grant and logical-trigger lineage IDs plus occurrence key, excluding grant version; replacement/redelivery cannot execute one occurrence twice |
| TE-021 | Kill-switch consumption | Final child-step consumption atomically checks the parent authority, enabled state, and matching global/user revocation epochs; disablement invalidates unstarted steps/authorities and re-enable never revives them |
| TE-022 | Per-step consumption | Every external/irreversible step has a stable unique `(authorityId, stepKey)`, separate idempotency key, attempts, consumption/reconciliation state, and result audit; consuming one workflow step never consumes or implicitly authorizes another |
| TE-023 | Closed required-step manifest | Before the first external step consumes, one transaction persists every required/selected forward and conditional compensation step and closes an immutable hashed/revisioned manifest; successful parent completion requires every required forward entry `consumed` and every non-triggered compensation entry `skipped`, and a later material step requires newly classified authority |
| TE-024 | Failure and bounded compensation | A retryable attempt failure remains bounded by attempts; a definitive/exhausted forward step cancels unstarted forward work and either terminally fails the parent or enters `compensating` only for applicable rollback children frozen into the closed manifest. Compensation uses the same authority checks, cannot resume forward work or turn failure into success, and the parent becomes terminal `failed` after rollback resolves or requires manual recovery |
| TE-025 | Reservation settlement | Every standing-parent terminal transition atomically releases proven no-effect allocations, preserves committed effects, moves uncertain allocations to reconciliation-required with ownership/deadline, and leaves no plain reserved allocation orphaned; the nonterminal `compensating` transition retains only applicable step-owned compensation reservations until use or terminal settlement |
| TE-026 | Abandoned-attempt recovery | Every consuming attempt has a renewable pre-effect lease and monotonic fencing token; expiry fences the old worker, retries only with durable proof of no effect, and quarantines started or uncertain outcomes for reconciliation |
| TE-027 | Parent retry ceiling | `maxAttemptsPerStep` is the authority-wide per-child ceiling; manifest closure and attempt start transactionally reject any child limit above it and enforce both limits on every attempt |
| TE-028 | Admission and compensation expiry | Original issuance fixes forward `expiresAt` and policy-capped `compensationExpiresAt`. Normal expiry atomically closes new forward admission, derives completion first, preserves on-time unresolved work, enters `compensating` when an incomplete manifest leaves a confirmed effect with rollback predeclared for that trigger, and expires only otherwise. Compensation reconciliation stays nonterminal until resolved or recovery expiry; neither deadline revives forward authority |

### 10.2 Background jobs and artifacts

| ID | Requirement | Acceptance statement |
|---|---|---|
| TE-101 | Immediate start | Supported research/writing/planning work queues without an approval gate |
| TE-102 | Context preservation | Referential follow-ups carry bounded recent subject and output requirements into the job |
| TE-103 | Automatic availability | Successful requested files are stored in Documents and available immediately |
| TE-104 | Origin delivery | Completion returns the artifact/link through the originating channel |
| TE-105 | Optional review | Review and revision do not control whether the artifact exists or is accessible |
| TE-106 | Failure truthfulness | Failed rendering, upload, or delivery reports the exact available fallback and retry state |
| TE-107 | Reconnect | App restart reconstructs the same job and artifact state without duplicate records |

### 10.3 Channels and actions

| ID | Requirement | Acceptance statement |
|---|---|---|
| TE-201 | Channel consistency | The same command and user context produce the same authority decision across supported channels |
| TE-202 | Email intent | Draft and send intents remain distinct; sends occur exactly once |
| TE-203 | Device capability | Missing Android/OS permission is reported as setup, not approval |
| TE-204 | Conversational clarification | Missing material details are requested in the originating conversation |
| TE-205 | No channel-local gates | Voice, Android, email, and Agent SDK paths cannot independently create reconfirmation gates for covered commands |
| TE-206 | Stable authenticated ingress | App chat/voice, authenticated webchat, Telegram, Discord, Slack, WhatsApp, and daemon adapters cannot enable Trusted Execution until verified provider/server event identity and linked authenticated ownership produce one stable source-action key across redelivery |

### 10.4 Recoverability and migration

| ID | Requirement | Acceptance statement |
|---|---|---|
| TE-301 | Recoverable deletion | Supported deletion defaults to trash/undo and records recovery metadata |
| TE-302 | Code isolation | Code changes occur on a resolved branch/worktree with focused staging and verification |
| TE-303 | Deployment recovery | Supported deployments capture prior state and expose automatic/manual rollback |
| TE-304 | Legacy safety | Pending approval gates present at migration are expired/cancelled and never auto-executed |
| TE-305 | UI migration | New work displays Running, Completed, Failed, Blocked, or Needs clarification—never Waiting approval |
| TE-306 | Compatibility | Rollback to legacy behavior remains possible until the final cleanup release is verified |
| TE-307 | Canonical contract parity | Before enablement, `agents/TOOL_POLICY.md`, `agents/PRIME.md`, `agents/ROUTING.md`, AGENTS/security/contributor docs, and enforcing agent tests all describe the shipped authority/retry policy without contradictory confirmation gates |

## 11. Data and API requirements

### 11.1 Persistence

PR 1 must decide whether to extend an existing runtime/audit table or add a focused execution-authority table. Whichever design is selected must support:

- User ownership and exactly one source-provenance variant: real direct source turn or standing grant ID/version/category/limit snapshot/consent source turn/stable trigger-occurrence key
- Immutable standing-grant consent versions and authenticated actor/source-turn/stable consent-action provenance for creation, replacement, reactivation, and expansion
- Transactional atomic uniqueness for authenticated direct and consent source actions over `(userId, sourceActionKind, sourceActionKey)`, committed with the complete resulting authority/recovery record or immutable grant version so orphan claims cannot exist
- A mutable standing-grant head with active status, current version, state revision, expiry/revocation/pause state, and lock/CAS semantics shared by issuance, final consumption, and every lifecycle mutation
- Atomic occurrence uniqueness for `(standingGrantId, standingGrantTriggerLineageId, triggerOccurrenceKey)` across all immutable grant versions, committed with the distinct run-authority/recovery record and idempotency lineage
- Version-independent logical-trigger lineage, configuration history, and explicit nonoverlapping effective boundaries/reconciliation for genuine trigger replacement
- Transactional standing-grant usage reservations and authoritative lineage-wide counters/windows for action, frequency, rate, quantity, and other configured limits, including reservation lifecycle, reconciliation state, and cross-version carry-forward
- Parent/child task and grant/occurrence/run audit lineage
- A parent workflow-plan revision/status, immutable closure marker and manifest hash, plus the complete ordered/dependency-aware required/selected external-step set persisted before any step consumes
- Durable child execution-step records unique by `(authorityId, stepKey)`, one for every closed-manifest entry, each with resolved action, target fingerprint, independent idempotency key, immutable `role` (`forward` or `compensation`), immutable `compensatesStepKeys` and `compensationTriggers` for compensation, child attempt limit bounded by the parent's `maxAttemptsPerStep`, durable attempt count/current attempt, consumption/reconciliation state, result/recovery reference, and timestamps
- Immutable per-attempt rows with attempt number, lease owner/expiry, monotonic fencing generation, durable pre-effect/started/effect evidence, status, and timestamps; only the current unexpired generation may renew or cross the boundary
- Allowed action and target scope
- Risk and limit metadata
- Parent idempotency lineage plus per-step idempotency and attempt tracking
- Parent active/compensating/completed/failed/cancelled/expired state, forward `expiresAt`, fixed `compensationExpiresAt`, durable open/closed forward-admission state and closure timestamp, terminal reason/recovery reference, and reconciliation none/required/resolved state; per-step pending/consuming/consumed/retryable-failed/failed/cancelled/skipped/reconciliation-required state
- Global and per-user enabled state plus monotonic revocation epochs snapshotted on every authority
- Created, started, completed, failed, and cancelled timestamps
- Sanitized result/audit references

### 11.2 API behavior

- Ignore body-supplied user IDs; derive ownership from authentication.
- Do not accept client-supplied `approved: true`, grant ownership, consent provenance, or authority as trusted input.
- Standing-grant mutation endpoints derive the actor from the authenticated session; agents/workers cannot call creation, replacement, reactivation, or expansion paths as the consenting user.
- Atomically commit each stable direct-action or consent-action claim together with its complete authority/recovery record or immutable grant version; redelivery returns/reconciles that original durable record.
- In the same transaction, lock and revalidate the live grant head/current revision, claim the standing occurrence across versions by stable grant/trigger lineage, reserve all applicable lineage-wide usage, and create the authority/recovery record before side effects.
- Grant lifecycle mutations use the same head lock/revision as issuance and final authority consumption; stale issuance or consumption fails closed.
- Global/per-user disable transactions increment monotonic revocation epochs and logically invalidate/cancel every unstarted authority and child step with an older snapshot. Final tool/step consumption atomically verifies enabled state, both epoch snapshots, parent authority state, child step state, applicable grant head, role-specific admission state, and the appropriate forward or compensation deadline before crossing that step's irreversible boundary.
- Re-enabling does not decrement epochs or revive old authorities; new work requires newly issued authority. Workers/tools cannot rely on cached switch state. Work already past an irreversible boundary is reconciled/audited and all unstarted covered steps are cancelled.
- Carry committed, reserved, and reconciliation-required usage through overlapping active windows across versions; only released usage restores capacity, and incompatible window changes defer rather than reset counters.
- Return a stable task/action ID with acknowledgements.
- Expose cancel, status, activity, result, and recovery operations where supported.
- During read-only planning, atomically register discovered external steps under an active `planning` parent. Before any external step consumes, atomically verify complete child coverage and close the ordered/dependency-aware manifest with its hash/revision; a closed plan cannot be reopened, and later material external work requires newly classified authority.
- Use manifest membership plus uniqueness and versioning/compare-and-set semantics for each child step's consumption and side-effect completion; duplicate registration/consumption reconciles the original step. Successful parent completion requires a closed manifest with every required forward entry `consumed`, every non-triggered compensation entry `skipped`, and none failed, cancelled, consuming, or awaiting reconciliation.
- At manifest closure and every attempt start, verify `child.maxAttempts <= parent.maxAttemptsPerStep`; in the same attempt-start transaction enforce the child's remaining count, increment it, create the leased/fenced attempt row, and select it as current.
- Side-effect adapters require the current fencing generation and stable idempotency key. Lease renewal is allowed only for the current owner while `boundaryState` is `not_started`; boundary crossing compare-and-sets that state to `started` before the call. On lease expiry, atomically fence the old generation: durable proof of `not_started` may become `retryable_failed`, while `started` or incomplete evidence becomes `reconciliation_required` and blocks dependent work until provider/idempotency reconciliation resolves it.
- When retry policy/attempts are exhausted or a forward step is definitively unrecoverable, one transaction marks the step failed, stores sanitized failure/recovery references, cancels every unstarted forward step as `upstream_failure`, and either terminally fails the parent or moves it to `compensating` for only the applicable compensation children already frozen into the closed manifest. Nonapplicable compensation children become `skipped`; uncertain already-started steps block dependent compensation pending reconciliation. A compensation child awaiting reconciliation keeps the parent nonterminal `compensating`; proven no effect may retry only within remaining attempts and `compensationExpiresAt`, confirmed effect completes the rollback child, and definitive/exhausted/deadline outcomes terminally fail with any uncertainty retained for audit-only reconciliation. Compensation and reconciliation cannot revive or resume forward work, and the final parent outcome remains `failed`.
- At forward `expiresAt`, atomically close forward admission and first evaluate the closed-manifest completion predicate. Only when every required forward step is durably consumed may that transaction mark unused compensation `skipped` and choose `completed`; otherwise it preserves potentially applicable compensation as `pending` and reserved while unresolved outcomes remain. Only when completion is not possible, fence/cancel pre-effect attempts and unstarted forward children, safely release their proven-no-effect allocations, and preserve allocations for on-time started/uncertain attempts plus potentially applicable compensation as charged and step-owned. After unresolved on-time outcomes are excluded or resolved, atomically enter `compensating` instead of `expired` whenever confirmed effects have a closed-manifest compensation child triggered by `workflow_incomplete_at_expiry`; terminal expiry is allowed only when no such applicable rollback exists. Do not terminalize or settle the parent while an on-time outcome remains unresolved; when no such unresolved attempt exists and the parent remains `active`—including when earlier crossed attempts are already consumed/resolved—atomically complete when still possible or terminally expire/fail and settle. If the parent is already `compensating`, normal expiry does not terminalize or settle it; retain its applicable allocations until compensation outcome, recovery expiry, or control invalidation. A later result transaction likewise completes/expires/fails or enters `compensating` within the fixed recovery window.
- The nonterminal standing-parent transition to `compensating` classifies allocations without a capacity reset: release proven-no-effect unstarted forward/nonapplicable compensation allocations, preserve committed and reconciliation-required usage, and retain applicable compensation reservations as charged, step-owned allocations through `compensationExpiresAt`. Every eventual terminal transition—completion, failure, terminal expiry after in-flight resolution, recovery expiry, user cancellation, kill-switch invalidation, or grant revocation/replacement/expiry/pause/limit-reduction invalidation—then classifies every remaining allocation: release proven no-effect, preserve committed, and move uncertain to `reconciliation_required` with owner/deadline/recovery metadata. It cannot leave plain `reserved` allowance behind.
- Redact raw tool payloads, message bodies, filesystem paths, credentials, and device data from general diagnostics.

### 11.3 Legacy compatibility

- Existing approval endpoints remain readable during migration.
- No new direct-command approval gates are created when the relevant Trusted Execution flag is enabled.
- Pending legacy gates are shown as legacy items until the final migration expires them.
- Old approval receipts cannot be treated as new reusable authority.
- Production flags cannot enable until canonical agent contracts and their enforcement fixtures are reconciled: `agents/TOOL_POLICY.md`, `agents/PRIME.md`, and `agents/ROUTING.md` must match the central authority, per-step retry, financial, capability, and hard-block rules. `SOUL.md` remains identity/personality-only.

## 12. User experience

### 12.1 Acknowledgement copy

Preferred:

> I started the research job. I’ll return the completed PDF here and save it to Documents.

Avoid:

> Open Inbox when it finishes, approve the deliverable, and then save it to Documents.

### 12.2 Status vocabulary

| State | User-facing label | Primary action |
|---|---|---|
| queued/running | Working | View progress or Cancel |
| clarification needed | Needs information | Answer in conversation |
| capability/setup missing | Setup required | Open relevant connection/permission setup |
| policy/authority violation | Blocked | View reason and safe alternative |
| succeeded | Completed | Open result; optional Review/Revise/Export |
| failed | Failed | Retry when safe or view recovery guidance |
| cancelled | Cancelled | Restart as a new request if desired |

### 12.3 Activity and Exceptions

The current Approvals surface becomes Activity and Exceptions after legacy migration. It shows:

- Running and recently completed work
- Clarification requests linked to their originating conversations
- Setup and capability blockers
- Hard blocks and safe alternatives
- Failures, retries, and recovery actions
- Material action audit summaries
- Optional artifact review

It must not become a new disguised approval queue.

## 13. Golden workflow matrix

| Workflow | Expected path | Critical assertion |
|---|---|---|
| Research report from app chat | execute → queued → running → completed | PDF/document is returned and stored; zero approval rows |
| Referential voice report request | execute → queued → running → completed | Prior subject and requested file format are preserved |
| Fully specified email send | execute → sent | Exactly one send; no approval card |
| Email draft request | execute → draft ready | No send occurs |
| Ambiguous email recipient | clarify → execute | Clarification stays in originating conversation |
| Open a notification | execute → completed | Android permission/capability is verified; no submit overlay |
| Missing notification permission | setup required | No false approval and no claim of execution |
| Delete exact generated file | execute → trash → completed | Undo restores the item |
| Delete broad root/workspace | block | No partial deletion occurs |
| Fix, test, and open PR | plan/close manifest → commit step → push step → PR step → completed/failed | Commit, push, and PR records all exist before commit consumes; each has independent consumption/idempotency state, so retry resumes at the first unconsumed step and creates one PR |
| Push definitively fails after commit | push failed → parent failed → PR step cancelled | Completed commit remains audited; no PR starts, uncertain external outcomes reconcile without reactivating the workflow |
| Standing step fails before side effect | parent failed → no-effect allocation released | Allowance returns atomically; no plain reserved allocation remains |
| Standing step outcome is uncertain | terminal parent → allocation reconciliation required | Allowance remains charged with owner/deadline across grant versions until outcome commits or safely releases |
| Standing authority cancelled/expired/disabled/paused/limit-reduced before effect | terminal transition → no-effect allocations released | Same settlement transaction runs for every terminal cause; uncertain allocations quarantine rather than remain reserved |
| Retry after network timeout | resume/reconcile | No duplicate email, post, job, artifact, or PR |
| Worker crashes after leasing but before an external call | expire lease → fence old generation → confirmed no effect → bounded retry | Stale worker cannot cross the boundary; child and parent attempt ceilings remain enforced |
| Worker disappears after external boundary starts | expire lease → reconciliation required | No blind replay; dependent steps wait while provider/idempotency evidence confirms effect or no effect |
| App restart during job | reconstruct → running/completed | Same task ID and authoritative state |
| Authenticated standing-grant creation | explicit user consent → immutable grant version | Real actor/source-turn/scope/limit/source-action consent provenance; redelivery returns the same version and agent proposals cannot self-authorize |
| Crash during direct/consent record creation | retry transaction → one durable authority or grant version | Source claim and target/recovery record commit together; no orphan claim exists |
| Duplicate direct-command delivery | reconcile existing authority/task/result | Atomic authenticated source-action/record transaction prevents a second authority or side effect |
| Duplicate grant-consent delivery | reconcile existing immutable grant version | Atomic authenticated consent-action/version transaction prevents another grant/version |
| Valid scheduled research occurrence | lineage occurrence claim → distinct authority → queued → completed | One authority per stable grant/trigger lineage/occurrence across versions; separate run ID; no fabricated turn or reusable grant credential |
| Grant replacement before occurrence redelivery | reconcile old-lineage occurrence/run/result | Version-independent occurrence uniqueness prevents a second authority or side effect |
| Duplicate trigger delivery | reconcile existing reservation/run/result | Atomic uniqueness prevents a second reservation, authority, or side effect |
| Concurrent distinct standing occurrences near a shared limit | one transaction reserves; others reserve only remaining capacity or block | Frequency/rate/quantity allowance cannot be over-allocated |
| Revoke/replace races standing issuance or consumption | one grant-head transaction wins; stale operation fails closed | No authority or unstarted side effect proceeds from a stale grant revision |
| Narrow/replace during active usage window | lineage usage carries forward → recompute remaining | New version cannot reset committed/reserved/reconciliation-required allowance; incompatible window change defers safely |
| Revoked or stale standing grant | block/skip → audited | No new authority or work starts; completed history remains |
| Kill switch races queued authority consumption | disable epoch or consumption transaction wins | If disable wins, older-epoch authority is cancelled before side effect; if irreversible consumption won, result is reconciled and remaining steps cancel |
| Trusted Execution re-enabled | new authority required | Monotonic epoch mismatch keeps previously invalidated authorities dead |
| Trusted Execution disabled | legacy policy | Kill switch takes effect without deployment |

## 14. Testing requirements

### 14.1 Automated tests

- Authority schema, source-discriminator, and decision contract tests
- Authentication and cross-user ownership tests
- Standing-grant authenticated consent, agent self-grant rejection, immutable version, ownership/category/limit provenance, revocation, expiry, replacement, pause, limit-reduction, expansion, reservation-settlement, and audit-lineage tests
- Crash-injection tests before/after commit proving direct/consent source claims cannot exist without their complete authority/recovery record or immutable grant version
- Concurrent redelivery tests for direct commands and grant-consent mutations proving one authority/task/result or immutable grant version per authenticated source action
- Concurrent revoke/replace/expire/pause/limit-reduction versus issuance and final-consumption tests proving stale grant revisions fail closed
- Concurrent duplicate/redelivery-and-replacement tests proving lineage-wide occurrence uniqueness across grant versions and exactly one reservation/run authority/side effect
- Concurrent different-occurrence tests proving transactional frequency/rate/quantity reservation never exceeds lineage-wide limits
- Cross-version active-window rollover tests for replacement, narrowing, expansion, reactivation, committed/reserved/reconciliation-required usage, reconciliation resolution, and incompatible window semantics
- Global/per-user kill-switch race tests at issuance, queueing, final child-step consumption, and tool side-effect boundaries, including re-enable non-revival and cached-state rejection
- Multi-step workflow tests proving commit, push, PR creation, review request, and deploy are all persisted in a hashed/revisioned closed manifest before the first external consumption, have independent durable step/idempotency state, and cannot cause premature parent completion
- Planning/closure race and crash tests proving no external step consumes from an open/incomplete manifest, closure requires one child per manifest key, a closed plan cannot be extended/reopened, and a newly discovered material step requires new authority
- Retryable-versus-definitive failure and attempt-exhaustion tests proving atomic cancellation of unstarted forward work, preservation of completed-step history, quarantine of uncertain started steps, entry into `compensating` only for applicable predeclared rollback children, nonterminal compensation reconciliation, proven-no-effect retry only within attempts/recovery deadline, confirmed-effect completion, skip-on-success/nonapplicability behavior, terminal failed outcome after rollback/deadline, and no parent or forward-work revival
- Crash/lease tests before lease acquisition, after attempt commit, during renewal, immediately before boundary compare-and-set, and after boundary start proving monotonic fencing rejects stale workers, only proven no-effect attempts retry, uncertain outcomes quarantine, and restart cannot strand a child in `consuming`
- Parent/child attempt-limit tests proving manifest closure and concurrent attempt starts reject `child.maxAttempts > parent.maxAttemptsPerStep`, enforce both limits transactionally, and cannot exceed the persisted child count after restart
- Standing reservation tests for `active` to `compensating` proving applicable compensation reservations remain step-owned and charged while unstarted forward/nonapplicable allocations safely release, plus terminal-transition tests for completion, definitive failure, user cancellation, forward/recovery expiry, kill-switch invalidation, and grant revocation/replacement/expiry/pause/limit-reduction invalidation proving committed-effect preservation, uncertain transition to reconciliation-required with owner/deadline, and zero orphan plain-reserved allocations
- Cross-version reconciliation-required tests proving uncertain usage remains lineage-charged through replacement/narrowing/reactivation and restores capacity only after a safe release
- Retry tests proving execution resumes after completed steps only while the parent remains active, cancellation/disablement blocks unstarted manifested steps, and duplicate planning registration reconciles
- Reservation commit, safe release, uncertain-outcome retention, retry reuse, and reconciliation tests
- Tests proving tools reject reusable grant IDs and occurrence keys and accept only distinct bounded run-authority IDs
- Action/target scope tests
- Forward-expiry race, compensation-expiry, cancellation, attempt-limit, and child-delegation tests proving `expiresAt` atomically closes new forward admission, derives completion before expiry only when all required forward steps are consumed and then skips rollback, keeps potentially applicable compensation pending/reserved when an on-time outcome is unresolved, fences pre-effect attempts otherwise, preserves only an on-time unresolved started/uncertain attempt and its allocations until result/reconciliation, enters `compensating` when incomplete expiry leaves a confirmed effect with a matching predeclared rollback trigger, terminally expires an `active` parent only when no unresolved attempt or applicable rollback remains, never terminalizes an already-`compensating` parent, permits only applicable predeclared rollback until fixed `compensationExpiresAt`, and blocks late forward crossings and post-recovery-deadline rollback without revival
- Idempotency tests for every external side-effect class
- Concurrent retry and out-of-order event tests
- Background job, deliverable, Documents, and notification integration tests
- App chat, app voice, authenticated webchat, Telegram, Discord, Slack, WhatsApp, and daemon parity/redelivery fixtures, including provider event-ID normalization, linked-user binding, process restart, and fail-closed flags when a stable source identity is unavailable
- Email draft-versus-send tests
- Android permission, disconnect, submit, timeout, and retry tests
- Code branch, focused staging, failed-check, push, PR, and deployment rollback tests, including a closed manifest whose deployment failure cancels later forward work but executes exactly one predeclared rollback, plus success and kill-switch cases that respectively skip or block that rollback
- Canonical agent-contract parity tests/fixtures and documentation audit covering `agents/TOOL_POLICY.md`, `agents/PRIME.md`, `agents/ROUTING.md`, AGENTS/security/contributor/runtime docs, and confirmation/retry behavior before enablement
- Migration tests proving stale pending gates never execute
- UI tests proving optional review is not required for artifact access

### 14.2 Real-system acceptance

- Real connected Google or Microsoft email account using a designated test recipient
- Real Android device with notification/accessibility permissions toggled through supported states
- Real background PDF generation and Documents retrieval
- GitHub test repository or bounded branch workflow
- Staging deployment with forced failure and verified rollback
- App/voice restart during active work

### 14.3 Required checks per implementation PR

- Nearest focused tests for changed files
- `npm test`
- `npm run server:build`
- `npm run docs:audit` when public docs change
- Database migration verification when schema changes
- `git diff --check`
- Clean `@codex review` after all fixes

## 15. Analytics and success metrics

### 15.1 Events

- `execution_authority_issued`, `completed`, `failed`, `cancelled`, `expired`
- `authority_workflow_plan_closed`, `authority_workflow_plan_incomplete_blocked`, `authority_workflow_plan_extension_blocked`
- `authority_step_registered`, `authority_step_consuming`, `authority_step_consumed`, `authority_step_retryable_failed`, `authority_step_failed`, `authority_step_cancelled`, `authority_step_skipped`, `authority_step_reconciliation_required`, `authority_attempt_leased`, `authority_attempt_fenced`, `authority_attempt_abandoned_no_effect`, `authority_attempt_uncertain`, `authority_reconciliation_resolved`
- `trusted_source_action_claimed`, `trusted_source_action_deduplicated`
- `standing_grant_created`, `standing_grant_replaced`, `standing_grant_narrowed`, `standing_grant_revoked`
- `standing_grant_usage_reserved`, `standing_grant_usage_committed`, `standing_grant_usage_released`, `standing_grant_usage_reconciliation_required`
- `standing_grant_stale_revision_blocked`, `standing_grant_usage_carried_forward`, `standing_grant_occurrence_deduplicated_across_version`
- `trusted_execution_global_disabled`, `trusted_execution_user_disabled`, `trusted_execution_epoch_mismatch_blocked`
- `standing_grant_run_issued`, `standing_grant_run_deduplicated`, `standing_grant_run_blocked`
- `trusted_execution_execute`, `clarify`, `block`
- `trusted_execution_capability_blocked`
- `trusted_execution_duplicate_prevented`
- `trusted_execution_compensation_started`, `compensation_completed`, `compensation_failed`, `compensation_expired`, `compensation_manual_recovery_required`
- `artifact_auto_stored`, `artifact_origin_delivered`, `artifact_delivery_failed`
- `legacy_approval_expired`

### 15.2 Targets

| Outcome | Target | Guardrail |
|---|---|---|
| Direct-command approval friction | Zero new approval gates for enabled covered workflows | No increase in unauthorized actions |
| Research handoff | 95% of successful requested files available in Documents and origin channel | No false completion claims |
| Stuck approval jobs | Zero enabled jobs waiting on reconfirmation | Setup/clarification states remain truthful |
| Duplicate side effects | Zero in golden and production reconciliation | Retries remain available |
| Clarification quality | One focused question for material ambiguity | No unnecessary questioning for clear commands |
| Recovery | 100% of supported destructive/code/deploy golden flows expose recovery evidence | Hard blocks remain intact |
| Cross-channel consistency | 100% agreement in shared intent fixtures | Channel adapters do not override policy |

## 16. Rollout and five-PR implementation sequence

Implementation PRs are sequential. Each starts from the newly updated `main` after the prior PR merges and receives a clean Codex review before merge.

### PR 1 — Central Trusted Execution policy

**Goal:** Introduce the authority model and central decision path with production behavior unchanged by default.

**Primary areas:**

- `server/agent/autonomyPolicy.ts`
- `server/agent/autonomyRuntime.ts`
- `server/agent/approvalToolRisk.ts`
- `server/agent/agentPolicyManager.ts`
- `server/agent/systemApprovalGate.ts`
- `server/agent/toolCallHooks.ts`
- `server/agent/actionOntology.ts`
- `server/core/runtime/`
- `server/core/tools/`
- Shared schema/migrations as selected

**Required output:** Authority issuance/validation, execute/clarify/block decisions, per-user flags, kill switch, audit contract, and compatibility tests. Flags remain off.

**Must not include:** Approval UI removal, mass route migration, or production enablement.

### PR 2 — Automatic background work and deliverables

**Goal:** Prove the complete research/report vertical slice for the designated user.

**Primary areas:**

- `server/agent/appCoachChatAutonomy.ts`
- `server/agent/autonomyRuntime.ts`
- `server/agent/backgroundJobHandoff.ts`
- `server/agent/jobQueue.ts`
- Deliverable review and Documents routes
- Inbox/Documents result presentation

**Required output:** Immediate queueing, context preservation, automatic artifact storage, origin-channel completion delivery, optional review, and zero approval rows.

**Must not include:** General email, Android, code, or deployment execution migration.

### PR 3 — Channels, email, voice, and Android

**Goal:** Route external-action commands across supported conversation/device surfaces through the central authority contract.

**Primary areas:**

- Direct email and Agent SDK action routes
- Voice approval/risk modules
- Shared voice gate types
- Android submit/action routing
- App chat, app voice, authenticated webchat, Telegram, Discord, Slack, WhatsApp, and daemon adapters
- `server/channels/slackWebhook.ts` and `server/channels/whatsappWebhook.ts`, including verified provider event/message identity forwarded through `runCoachAgent`
- Authenticated webchat submission/turn route and shared coach/runtime input contract

**Required output:** Channel parity, stable authenticated source-action identity across redelivery, exactly-once send/submit behavior, conversational clarification, setup/capability blockers, and per-adapter fail-closed enablement until identity fixtures pass.

**Must not include:** General code self-heal or deployment automation changes.

### PR 4 — Code, device, and deployment recoverability

**Goal:** Permit declared code/device/deployment workflows without repeated approval while strengthening recovery.

**Primary areas:**

- Safe-write and code-apply tools
- Self-heal/build-feature workflows
- Project shell and GitHub tools
- Daemon filesystem/shell controls
- Deployment tools and diagnostics

**Required output:** Branch/worktree isolation, atomic writes, trash/undo, idempotent GitHub writes, deployment checkpoints, rollback, and hard-block tests.

**Must not include:** Final legacy schema/UI removal until production evidence exists.

### PR 5 — Legacy migration, Activity UX, and enablement

**Goal:** Remove obsolete approval friction after every covered execution path is proven.

**Primary areas:**

- Approval and deliverable migrations
- Inbox, Approvals, Mission Control, Settings, and diagnostics UI
- Worker state vocabulary
- Canonical agent contracts and enforcement fixtures: `agents/TOOL_POLICY.md`, `agents/PRIME.md`, and `agents/ROUTING.md`
- `AGENTS.md`, `SECURITY.md`, `CONTRIBUTING.md`, architecture, roadmap, and operations docs
- `SOUL.md` only if identity or personality language must change; workflow, approval, tool, and runtime policy must remain outside `SOUL.md`

**Required output:** Safe expiry of old gates, Activity/Exceptions experience, dead-code cleanup, dashboard metrics, and tested rollback switch. Before production flag rollout, reconcile the canonical agent contracts and their runtime/prompt enforcement tests so draft-first email, device/GitHub/deployment confirmation, and external-retry rules use the new bounded authority contract without weakening authentication, capabilities, financial restrictions, or hard blocks.

**Must not include:** Automatic execution of any legacy pending request.

## 17. Dependencies and sequencing constraints

The implementation must not begin from a stale `main`. Runtime reliability PR `#253` and the documentation-only Active Project Capsule + Universal Live Action Card PR `#261` are already integrated in source baseline `30183c7`. The following work overlaps the planned file ownership and must be sequenced explicitly:

| PR | Overlap | Required treatment |
|---|---|---|
| `#261` — Active Project Capsule + Universal Live Action Card PRD | Shared schemas/migrations, job and deliverable adapters, Inbox/Mission Control UI, and lifecycle vocabulary including `waiting_approval` | Treat Live Action Card state as a projection/read model, not execution authority. Merge Trusted Execution PR 1's canonical authority contract before the Live Action Card implementation's shared-schema migration; then make its adapters project Trusted Execution states. `waiting_approval` may remain only for legacy or uncovered flows until Trusted Execution PR 5 migrates them. Land the Live Action Card UI before Trusted Execution PR 5 removes legacy approval UI, and reuse those components rather than creating parallel status models. |
| `#255` — memory save/correction routing | Memory review semantics and approval language | Settle before final policy and migration behavior |
| `#258` — background report handoff | `autonomyRuntime.ts`, `jobQueue.ts`, background context/PDF flow | Merge and use as PR 2 baseline; its lifecycle events must feed the Live Action Card projection through the shared adapter contract rather than a second canonical status store |
| `#260` — Android notification/search reliability | Android action ontology, diagnostics, device behavior | Merge and use as PR 3 baseline; device execution state must project through the same shared lifecycle vocabulary |

Before either implementation sequence edits shared schemas, migrations, adapters, or status enums, its issue must link both PRDs and record the ownership/mapping decision above. Trusted Execution owns authorization, consumption, retries, terminal outcomes, and removal of covered approval gates. Active Project Capsule + Universal Live Action Card owns the user-visible read model and controls, sourced from canonical execution records. Any conflict is resolved in that direction before code lands.

The documentation-only PR for this PRD may merge independently. Implementation branches must be created from current `main` only after their listed dependencies land and must be rebased after every preceding Trusted Execution PR.

## 18. PRD-to-issues decomposition

After this PRD merges, create one parent issue and five child issues.

### Parent issue

**Title:** Implement Trusted Execution and remove duplicated approval friction

The parent issue links this PRD, tracks dependencies, and contains a checklist for the five child issues. It does not own implementation code.

### Child issues

1. Implement central Trusted Execution authority and policy.
2. Make background work and deliverables automatic.
3. Migrate channels, email, voice, and Android actions.
4. Add recoverable code, device, and deployment execution.
5. Migrate legacy approvals and launch Activity/Exceptions UX.

Each implementation PR closes exactly one child issue. Every child issue repeats its owned files, out-of-scope files, acceptance criteria, tests, dependency, rollback, and definition of done from this PRD.

## 19. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Command grants overly broad authority | Unintended external action | Structured action/target scope, short expiry, child narrowing, limits |
| Agent creates or expands its own standing grant | Unauthorized future side effects | Explicit authenticated user mutation, immutable consent provenance, server-derived actor, agent/worker write prohibition |
| Crash splits a source claim from its target record | Permanently stuck or unsafely reset action | Claim and complete authority/recovery record or grant version commit in one transaction; redelivery reconciles |
| Channel/client redelivers direct or consent action | Duplicate authority, side effect, or grant version | Stable authenticated source-action key, atomic record transaction, reconciliation |
| Scheduler redelivers or replaces around one occurrence | Duplicate standing action | Stable grant/trigger lineage occurrence key across versions, separate run ID, reconciliation |
| Grant mutation races issuance/consumption | Stale authority or post-revocation action | Shared mutable-head lock/revision, in-transaction revalidation, fail-closed conflict |
| Grant version resets an active usage window | Excess allowance after narrowing/replacement | Lineage-wide counters, carry-forward of committed/reserved/reconciliation-required usage, conservative mapping or deferred activation |
| Kill switch changes after authority issuance | Queued external action continues after emergency stop | Monotonic global/user epochs, invalidation of unstarted authority, atomic final-consumption recheck, no revival on re-enable |
| Concurrent standing occurrences exceed a shared limit | Unauthorized excess actions/quantity/rate | Transactional occurrence claim plus conditional usage reservation, authoritative counters/windows, reservation reconciliation |
| Canonical agent contracts retain legacy confirmation rules | Runtime/prompt behavior conflicts with Trusted Execution after enablement | PR 5 owns TOOL_POLICY/PRIME/ROUTING plus enforcement fixtures; parity gate blocks flags until reconciled |
| Any standing terminal path orphans reserved allowance | Grant capacity leaks indefinitely or uncertain effects are misclassified | One settlement transaction for completion/failure/cancel/expiry/kill-switch/grant revoke/replace/expire/pause/limit-reduction; release/commit/reconciliation-required classification with owner/deadline |
| Grant version drops reconciliation-required usage | Replacement restores capacity while an uncertain effect may have occurred | Count committed, reserved, and reconciliation-required lineage-wide across versions; only release restores capacity |
| Definitive forward failure cancels declared rollback | Failed deployment or code change cannot recover automatically | Freeze compensation children into the manifest; cancel only unstarted forward work; allow only applicable bounded compensation; terminally fail after rollback; never revive forward work |
| Forward completion, partial effect, or compensation overlaps a deadline | Success can be mislabeled expired, or a partial external effect can escape declared rollback | At forward expiry complete only after durable success; otherwise retain unresolved/potential compensation and enter rollback for confirmed effects with an immutable incomplete-expiry trigger before choosing terminal expiry |
| Compensating transition releases standing allowance | Another occurrence reuses capacity still needed for rollback | Keep applicable compensation reservations charged and step-owned until compensation use or terminal settlement; safely release only proven-no-effect allocations |
| Parent completes before later workflow steps are registered | Push/PR cannot run or unsafe plan reopening is required | Persist complete required/selected step manifest and child records, atomically close before consumption, derive completion only from the closed set |
| One parent consumption state covers several external steps | Completed commit blocks push/PR, or retry repeats an earlier step | Durable per-step records, unique stable step keys, independent idempotency/consumption, parent-derived completion |
| Retry duplicates a side effect | Duplicate email, post, purchase, PR, or deployment | Per-step idempotency keys, completed-state reconciliation, atomic child-step consumption |
| Worker crashes while a child remains consuming | Workflow strands forever or an ad hoc retry duplicates an effect | Per-attempt lease, monotonic fencing, durable boundary evidence, proven-no-effect retry, uncertain-outcome quarantine/reconciliation |
| Child retry limit exceeds parent authority | External action exceeds the authority's declared attempt bound | Parent `maxAttemptsPerStep` ceiling, manifest validation, transactional enforcement with durable child count |
| Channel bypasses central policy or loses ingress identity | Inconsistent policy or duplicate authority on webhook redelivery | Shared authority service; provider/server event IDs; authenticated linked-user binding; Slack/WhatsApp/webchat parity fixtures; fail-closed per-adapter flags; forbid local gates |
| Legacy gate resumes stale work | Unexpected delayed action | Expire/cancel; never auto-execute migration records |
| Approval removal weakens genuine permissions | Unauthorized account/device access | Preserve authentication, ownership, scopes, pairing, and OS grants |
| Destructive command causes data loss | Irrecoverable loss | Trash/undo, backups, branches, rollback, and hard blocks |
| Broad rollout hides defects | Production incidents | Flags default off, designated-user vertical slice, per-PR evidence |
| Optional review becomes hidden gate | Friction returns under new name | Separate execution, availability, review, and export states |
| Audit leaks sensitive payloads | Privacy/security exposure | Allowlisted metadata, target fingerprints, redaction, bounded retention |
| Current open PRs conflict | Lost fixes and review churn | Settle dependencies, sequential branches, rebase from updated main |

## 20. Definition of done

Trusted Execution is complete when:

- All TE requirements have passing automated coverage.
- Covered direct commands create zero reconfirmation approval gates.
- Background report requests return usable artifacts automatically.
- App chat, app voice, authenticated webchat, Telegram, Discord, Slack, WhatsApp, daemon, connected-account, Android, code, and deployment paths use the same authority service where supported; unsupported/unidentified adapters remain explicitly disabled.
- Retries and reconnects cannot duplicate covered side effects.
- Ambiguity is handled in the originating conversation.
- Capability/setup failures and hard blocks are truthful and visible.
- Existing pending gates are expired without execution.
- Activity/Exceptions replaces approval-wait UX for new work.
- Recovery evidence exists for deletion, code changes, and deployment workflows.
- The per-user and global kill switches are production verified.
- Metrics show no unauthorized-action or duplicate-side-effect regression.
- `AGENTS.md`, `SOUL.md`, `SECURITY.md`, `CONTRIBUTING.md`, runtime protocol, architecture, roadmap, and operations docs match shipped behavior.
- Every implementation PR has passing required checks and a clean `@codex review` before merge.

## Appendix A — Initial implementation decisions

The following decisions are settled by this PRD:

- The user's explicit authenticated command is the authorization for that bounded command.
- New direct-command runtime decisions use execute, clarify, or block—not waiting approval.
- Generic affirmative wording is not reusable authority.
- Completed artifacts are available before optional review.
- Authority is server-owned, scoped, expiring, cancellable, and idempotent.
- Real capability and ownership boundaries remain enforced.
- Legacy pending approvals never auto-execute during migration.
- The rollout uses five sequential implementation PRs and per-user flags.

## Appendix B — Engineering decisions for PR 1

PR 1 may choose implementation details without changing the product contract:

- Extend an existing runtime/audit table or create a focused authority table.
- Use signed opaque authority references, database lookup, or both between trusted server components.
- Select exact risk-tier labels and default expiry by action class.
- Select the feature-flag storage mechanism and designated-user rollout control.
- Select audit retention and target-fingerprint format.
- Select the compatibility adapter that lets legacy approval-aware tools accept central authority during migration.

Any choice must preserve server-side ownership, least authority, exactly-once side effects, redaction, cancellation, rollback, and the acceptance requirements above.
