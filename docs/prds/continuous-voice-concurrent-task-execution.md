# Continuous Voice and Concurrent Task Execution

## Status

Proposed product requirements for Jarvis OS.

## Outcome

Jarvis should hold a natural, interruptible voice conversation while independently executing the user's tasks through the canonical agent and tool runtime.

A clear authenticated user command is sufficient authority to act within Trusted Execution's safety contract. Before voice may retrieve or disclose private user context or authorize side effects, authentication includes verified speaker presence or a current protected OS/device reauthentication; a paired daemon socket alone identifies the account but not the speaker. Jarvis should say okay and do the work without routine follow-up questions. For destructive requests, it chooses a bounded recoverable path when one exists; root-wide or nonrecoverable destruction remains blocked and cannot be converted into executable authority by a voice warning or affirmative response. Irreversibility by itself is not destructive.

The result should feel like one continuous assistant rather than separate voice, chat, tool, and background-job products.

## Product principles

1. **The command is the authorization.** A clear authenticated command authorizes one bounded execution of the requested work, subject to Trusted Execution's capability, clarification, and destructive-step boundaries.
2. **Default to action, not routine questions.** Tool use, duration, background execution, and crossing app surfaces are not reasons to ask again. Materially missing side-effect fields use Trusted Execution's single focused clarification path.
3. **Voice is a control surface, not a second agent.** Voice submits commands to and observes the same execution owners used by chat and other channels.
4. **Conversation and work have independent lifecycles.** Stopping speech does not cancel a task. Ending Talk Mode does not abandon accepted work.
5. **Interruptibility is end to end.** Probable user speech ducks playback promptly. After intent classification, content-bearing interruption cancels obsolete queued speech and continuation generation, while a playback-only command preserves canonical response generation. A candidate rejected as echo/background noise, or producing no committed utterance, resumes playback from the acknowledged frontier without discarding queued chunks.
6. **Progress is truthful and quiet.** Jarvis speaks meaningful milestones, questions, failures, and completion—not private reasoning or every tool call.
7. **Fallbacks preserve usefulness.** Unsupported devices fall back to the existing turn-based voice loop without losing the task.

## Existing foundation

This feature must reuse the current canonical implementations and declared dependencies:

- PR #215: in-app local voice loop, TTS playback, cleanup, and tap interruption.
- PR #217: immediate Talk Mode session start.
- PR #228: Android on-device speech recognition and native TTS fallback.
- PR #254: continuation-aware Android endpointing.
- PR #259: required wearable communication-device route-manager dependency; wearable routing in this feature remains deferred until it lands.
- Epic #262: persistent Live Action status, progress, controls, and artifact presentation.
- Issue #269 and its child work: Trusted Execution authority, idempotency, and channel parity.

This feature must not create another job queue, approval system, project store, tool router, or source of execution truth.

## User experience

### Long-running work

The user says:

> Jarvis, research cultivation HVAC systems under $40,000 and prepare a PDF.

Jarvis acknowledges the request verbally, starts the durable task immediately, and remains conversationally available. The user may ask for status, change a bounded preference, discuss something unrelated, or stop Talk Mode without cancelling the work. Jarvis returns the completed artifact through the originating conversation and normal Documents/Live Action surfaces.

### Natural interruption

While Jarvis is speaking, the user begins talking. Jarvis ducks or stops playback quickly, discards unsaid queued speech, captures the new utterance, and responds using the conversation state that was actually heard. Each speakable response chunk has a stable ID and stores its exact normalized `spokenText` separately from canonical displayed content. A per-response spoken-delivery frontier records `{ chunkId, spokenCharacterOffset }`. Playback range callbacks advance the offset monotonically within `spokenText`; chunk completion advances it to that spoken string's boundary. Probable user speech requests ducking, but callbacks continue to advance acknowledged delivery while output remains audibly rendered. At the playback engine's actual audible duck/stop transition, it atomically snapshots and fences the frontier; callbacks after that boundary cannot advance acknowledged delivery. On a committed interruption, Jarvis derives `heardAssistantText` only from the fenced acknowledged prefixes for the next model turn. Canonical text remains displayed and may be marked interrupted, but Markdown, URLs, code, or other omitted/unspoken content never enters heard context. If the interruption candidate is rejected as Jarvis playback, echo, or background noise—or recognition produces no committed utterance—callbacks after the fence are discarded and the response resumes from the snapshotted frontier with its queued chunks intact.

### Destructive boundary

The user requests an action that could destroy substantial user-owned state, such as wiping a drive or recursively deleting files. Jarvis first narrows the request to a bounded recoverable path—such as trash, backup, version history, or a precisely scoped rollback—when Trusted Execution permits one. If no recoverable target satisfies the request, Jarvis blocks the destructive operation and explains the concrete boundary. A voice warning or affirmative response never overrides that hard block. Ordinary actions are not treated as destructive merely because they are technically irreversible or have external effects.

### Separate speech and task controls

- "Stop talking" stops current playback and suppresses all remaining TTS chunks for that response; canonical text generation and display continue, and the next response may speak normally.
- "Stop listening" pauses microphone capture only.
- "Stop the HVAC research" cancels that task.
- "Pause all local work" pauses eligible local execution without fabricating task completion.
- Ending Talk Mode leaves accepted durable work running.

## Authorization and guardrail contract

### Execute without additional confirmation

After a clear authenticated command, Jarvis proceeds automatically. This includes:

- research, reading, analysis, planning, summarization, drafting, and background work;
- creating and editing documents, reports, code, branches, artifacts, and project state;
- invoking tools, workers, applications, browsers, connected accounts, and device controls needed for the task;
- sending messages or email, publishing or submitting content, merging code, and making appointments when requested;
- purchases and orders from a current direct request when the item, exact price or ceiling, quantity, and payment account are resolved, subject to configured limits and provider-required authentication or transaction controls;
- status checks, retries that preserve idempotency, and delivery of requested results;
- actions that can ordinarily be corrected, deleted, cancelled, refunded, reverted, or explained afterward.

Long duration, multiple tools, external effects, background execution, model choice, or crossing app surfaces must not create a Jarvis approval prompt. The user's command is the authorization.

### Act without follow-up questions

Jarvis does not ask routine clarifying questions. It uses the current conversation, active project or task, saved preferences, tool-visible state, and reasonable defaults to select the most likely interpretation and proceed.

When uncertainty does not materially change a side effect, Jarvis:

1. chooses a reasonable non-destructive interpretation;
2. prefers a path with recovery, version history, cancellation, refund, or correction when available;
3. completes all useful work it can;
4. reports any material assumption with the result instead of asking permission first.

Before a mutation, Jarvis follows Trusted Execution's `clarify` path when a material target, recipient, value, scope, account, or choice remains missing or ambiguous after using available context. It asks one focused question in the originating conversation; it does not guess and report the assumption after causing the side effect. If no safe bounded execution can be identified, Jarvis records a concise block instead of creating a generic approval request.

### Preserve destructive hard blocks

Voice uses the canonical Trusted Execution matrix; it does not create a separate confirmation override. Requests for exact recoverable deletion may execute through trash, backup, version history, or another bounded recovery path. Recursive, root-level, or otherwise nonrecoverable destruction without a safe target remains blocked even when the original command is explicit or the user later affirms a warning.

The following are not destructive merely because they have external effects or are technically irreversible:

- sending a message or email;
- posting, publishing, or submitting content;
- placing an order or making an ordinary purchase that can normally be cancelled, returned, disputed, or refunded;
- editing or deleting an individual message or post;
- creating, editing, committing, pushing, merging, deploying, scheduling, or navigating;
- any action with a practical correction, cancellation, rollback, refund, trash, backup, or version-history path.

If a destructive request can be safely narrowed, Jarvis identifies and executes the recoverable bounded interpretation. Otherwise it explains the hard block. A voice response cannot expand authority, disable a capability boundary, or turn a prohibited destructive step into executable work.
### Block

Jarvis blocks actions that cannot be safely or lawfully performed, exceed authenticated ownership or provider permissions, violate a global/user kill switch, or cannot identify a safe target. A block must explain the concrete boundary and must not be disguised as an approval request.

## Functional requirements

### Continuous audio session

- Android owns one explicit Talk Mode audio session and one authoritative state machine.
- The session supports capture, playback, interruption, route changes, backgrounding, and recovery.
- Partial recognition results are available for responsiveness, but only committed transcript segments from a protected authenticated turn enter canonical conversation history. Unverified public-mode transcripts remain isolated and ephemeral.
- The recognizer preserves confidence and N-best alternative evidence when available and forwards material-slot uncertainty to Trusted Execution. A nonempty best hypothesis is not sufficient authority when confidence is below the route's validated threshold or alternatives disagree on a target, recipient, account, repository, environment, item, amount, price ceiling, quantity, date, time, timezone, attendee, duration, scope, or choice; that field uses the single focused `clarify` path before authority issuance.
- Acoustic echo cancellation, noise suppression, and automatic gain control are enabled when supported and validated per route.
- Voice activity detection distinguishes probable user speech from Jarvis playback.
- Bluetooth and hearing-aid communication routes are enabled only in PR 6 after PR #259 lands and must reuse its wearable route manager.
- Devices that cannot sustain reliable duplex audio fall back to interruption-aware turn-taking.

### Voice authentication

- Account/device pairing is transport identity, not speaker authentication, and cannot by itself issue side-effecting voice authority.
- Before a committed voice command can retrieve or speak private user context or authorize an external or irreversible step, the session proves user presence through supported speaker verification with liveness or a current protected OS/device reauthentication scoped to that voice session.
- Each private or side-effecting turn revalidates presence when its transcript commits. Speaker verification is turn-scoped; an OS/device reauthentication may create a non-renewable protected-presence lease of at most 30 seconds, and speech alone cannot extend it.
- Device lock, app/session backgrounding, route or device transfer, loss of the verified speaker/presence signal, or Talk Mode restart revokes the lease immediately. Background Talk Mode returns to public non-user-scoped behavior until fresh protected verification succeeds.
- Revocation synchronously fences private output: current private playback stops, queued private TTS is cancelled or withheld, and pending private display/notification content is hidden from the unprotected surface. Private output may resume from its acknowledged frontier only after fresh verification; it cannot continue across the revocation boundary.
- Media playback, Jarvis output, unverified nearby speech, and stale authentication cannot become an authenticated source turn.
- If protected verification is unavailable or stale, voice is limited to public, non-user-scoped conversation plus verification/setup guidance. It cannot read notifications, memory, calendar, messages, task or agent status, artifacts, account data, or other private context; invoke user-scoped tools; or perform preparatory work derived from that data. Jarvis reports setup or reauthentication required rather than creating a duplicate approval prompt.
- Unverified public mode uses a separate ephemeral conversation with no durable chat/session, memory extraction, living-context, task, artifact, or profile writes. Its utterances and responses are never merged into authenticated history after verification; successful verification starts a fresh protected turn. Security telemetry may record only redacted event metadata needed to detect abuse, not reusable transcript content.
- The authority audit records the protected authentication method and session reference without retaining a reusable biometric secret.

### Streaming response and speech

- The canonical agent response stream is segmented into bounded, speakable phrases with stable per-response chunk IDs.
- Speakable streaming runs use an explicit harness mode in which emitted canonical chunks and the final returned reply are the same response. The existing Android post-stream quality-revision path must be bypassed for that mode or moved before any chunk can reach display or TTS; it cannot silently replace text that the user has already seen, heard, or acknowledged. Non-voice streaming behavior remains unchanged.
- Every TTS adapter reports playback range progress as a stable character offset within the current chunk's stored normalized `spokenText` and reports completion at that spoken string's boundary. The response's spoken-delivery frontier advances monotonically only for audibly rendered output. Tentative interruption atomically snapshots and fences the frontier when playback actually crosses into ducked or stopped output, after acknowledging callbacks for the audible detector-to-duck interval; callbacks received after that boundary cannot advance it, and rejection resumes from the snapshot. Queued, skipped, failed, ducked, and unplayed portions do not advance acknowledged delivery.
- Before the next model turn, the canonical history projection substitutes the interrupted assistant turn's content with its exact acknowledged `heardAssistantText` (or equivalently masks the unacknowledged suffix) across live client history and recovered server history. The full displayed response may remain persisted for UI and audit, but it must not also enter model input in parallel; speech normalization never reuses an offset as a position in Markdown or other canonical text.
- TTS may begin before the full response is complete.
- Markdown, URLs, code, tool payloads, and incomplete structural fragments are normalized or omitted from speech without changing the displayed response. Authenticated chunks persist the resulting `spokenText` used for delivery acknowledgement; unverified public-mode chunks keep it only in isolated in-memory session state and discard it with that ephemeral response.
- One selected higher-quality streaming TTS path is added; Android native TTS remains the offline/failure fallback.
- A content-bearing user interruption cancels current playback, unsent speech chunks, and unnecessary continuation generation after the utterance is classified. A playback-only command such as "stop talking" sets response-scoped speech suppression, stops audio and queued speech, prevents later chunks from entering TTS for that response, and preserves canonical response generation and displayed text.
- A rejected interruption candidate or candidate with no committed utterance clears tentative ducking and resumes the same response from its acknowledged spoken-delivery frontier without dropping or duplicating queued chunks.
- No generic provider factory or parallel response pipeline is introduced.

### Concurrent task execution

- Substantial work receives one durable task/action identity.
- Voice acknowledgement is not task completion.
- Tool execution continues independently of microphone and playback state.
- Reconnects, duplicate transcripts, and repeated status questions cannot duplicate external effects.
- Every amendment carries a stable authenticated source-action identity and enters through the task lifecycle lock shared with cancellation and every completion or failure transition. Duplicate transcript or reconnect delivery returns the original amendment result instead of applying it again, and the lock rejects new amendments once terminal admission closes or the task is cancelling or terminal.
- Under that lock, the voice session may attach a non-side-effecting amendment only when it remains inside the task's existing open scope.
- An amendment that adds an external or irreversible step or changes any material side-effect field is reclassified from the amendment's authenticated source turn. Material fields include target, recipient, account, repository, environment, item, amount or price ceiling, quantity, date, time, timezone, attendee, duration, scope, and choice. The amendment receives a new bounded authority linked to the same task and cannot reopen or extend the original closed manifest. Authority issuance and task linking use the same locked, deduplicated amendment transaction.
- Every task terminal transition acquires that lifecycle lock, closes amendment admission, and snapshots all linked authorities after winning the lock. Task success requires every required original and amendment-linked operation in that snapshot to have a successful terminal outcome; pending, failed, cancelled, or reconciliation-required amendment work prevents a false `completed` result. Before task failure becomes terminal, the same transaction closes forward admission and cancels or fences every unstarted step across all remaining linked nonterminal authorities. Already-started uncertain outcomes become `reconciliation_required` and are surfaced with recovery guidance; neither they nor later reconciliation can resume the failed task.
- Materially different work creates a separate task instead of silently mutating the first.
- Task cancellation, speech cancellation, and microphone pause are distinct commands.
- Task cancellation locks the task and enumerates every linked authority, including terminal authorities and their consumed effects. In one transaction it atomically closes forward admission and cancels or fences every unstarted covered step across all nonterminal authorities before terminalizing the task. The cancellation result preserves and surfaces already-consumed effects with their recovery or manual-rollback guidance. Already-started attempts with uncertain outcomes become `reconciliation_required` with an explicit uncertain-outcome and manual-recovery warning; the task and remaining linked authorities may then reach terminal `cancelled` without waiting indefinitely, and later reconciliation cannot reactivate them.

### Progress conversation

- Voice consumes sanitized Live Action projections rather than internal logs or model reasoning.
- The user can ask what Jarvis is doing, what completed, what failed, and what needs input.
- Spoken updates are limited to meaningful state changes and user-configured preferences.
- When a task needs a material side-effect field, its needs-input status identifies the focused question without blocking unrelated conversation; a block is reserved for cases with no safe bounded execution.
- Completion includes the real artifact or destination when one exists.
- Read-only status questions may use the strongest current task binding and report the chosen task. Ambiguous cancellation, pause, or amendment commands use Trusted Execution's focused clarification path before mutating a task.

### Resource coordination

- Interactive voice receives priority over local-heavy background inference.
- Eligible local work may enter an explicit resource-paused state and resume later.
- Cloud, remote, or low-contention work continues when safe.
- Resource pressure must not cause false completion, duplicate execution, or loss of accepted work.
- Route loss, provider loss, and process death reconcile from durable task and session state.

## Non-functional requirements

### Performance targets

Measured on the supported Android baseline and reported by route. Interruption latency starts at the first audio frame classified as probable user speech by the on-device detector and ends when output ducking begins. First-audio latency starts when Android commits the final user transcript immediately after endpointing and ends when the first assistant audio frame is rendered to the selected output route; it includes client dispatch, uplink, server queue/model time, downlink, TTS startup, and route buffering, but excludes the user's speech before endpointing. Task-progress latency starts when the server durably accepts the task and assigns its action ID and ends when the sanitized progress projection reaches the active surface.

- probable user interruption ducks or stops playback within 250 ms at p95;
- partial transcript presentation begins within 500 ms of a recognizer partial at p95;
- first spoken audio for an ordinary network-backed response begins within 1.8 seconds at p95 when the provider is healthy;
- meaningful task progress reaches the active voice/chat surface within five seconds;
- reconnect never creates a second execution for the same accepted command.

Targets are rollout gates, not reasons to fabricate progress or truncate correct answers.

### Privacy and security

- Microphone use remains visible through Android system indicators and the foreground service where required.
- Raw audio is not retained beyond the existing explicit diagnostic or user-save behavior.
- Partial transcripts do not enter durable history until committed.
- Live Action speech excludes secrets, credentials, raw shell commands, unrestricted logs, and hidden reasoning.
- Authentication, ownership, provider scopes, device permissions, sandboxes, rate limits, audit records, and kill switches remain enforced.
- Relaxing duplicate confirmation must not weaken those actual trust boundaries.

### Accessibility

- Every spoken state and control has an equivalent visible state and accessible control.
- Captions expose committed transcripts and spoken assistant content.
- Status does not rely on animation, color, or sound alone.
- Reduced-motion and mute modes preserve task control and completion delivery.

## State and ownership model

The canonical owners remain separate:

- **Voice session:** microphone, playback, partial transcript, route, tentative interruption/ducking state, response-scoped speech suppression, stored normalized `spokenText`, acknowledged `heardAssistantText`, and the per-response spoken-delivery frontier `{ chunkId, spokenCharacterOffset }` derived from range-progress and completion acknowledgements.
- **Conversation:** committed user and assistant messages.
- **Execution authority:** the command-derived bounded permission, destructive hard-block enforcement, expiry, and idempotency.
- **Task owner:** plan, tools, retries, cancellation, result, and artifacts.
- **Live Action projection:** sanitized progress and controls for presentation only.

No owner may infer another owner's terminal state. For example, a voice disconnect cannot mark a task failed, and a completed spoken acknowledgement cannot mark the task succeeded. A task-cancellation command coordinates both owners through Trusted Execution under a task lock shared with amendment issuance. It snapshots all linked authorities and consumed effects for the cancellation result, then closes forward admission and fences unstarted steps across every linked nonterminal authority before cancellation becomes terminal, so no concurrent amendment can attach new authority after enumeration. Completed effects remain visible with recovery or manual-rollback guidance. Started attempts with unresolved outcomes move to `reconciliation_required`; terminal cancellation exposes uncertainty and recovery guidance, and later reconciliation updates only audit/recovery state without reactivating the task or any authority.

## Failure and fallback behavior

- Duplex audio unavailable: use the existing turn-based loop.
- Premium/streaming TTS unavailable: use Android native TTS.
- Partial STT unavailable: use final-segment recognition and continuation endpointing.
- Voice disconnects: keep durable tasks running and restore their sanitized status on reconnect.
- A material side-effect field cannot be resolved: complete safe preparatory work, ask one focused question through Trusted Execution's `clarify` path, and keep voice usable without creating an approval request.
- Recognition confidence is low or alternatives disagree on a material side-effect field: preserve the alternatives as transient classifier evidence and ask one focused clarification before issuing authority; do not execute the best hypothesis.
- No safe bounded target exists after clarification: record a concise block.
- A destructive request has no recoverable bounded path: block the destructive step and preserve completed safe work.
- Provider or tool outcome is uncertain: quarantine/reconcile through Trusted Execution rather than retrying blindly.

## Rollout

Each capability is independently disableable. Voice feature flags must not bypass canonical execution policy: action-first voice handoff remains disabled, or preserves the legacy approval behavior, until Trusted Execution PR 5 completes a repo-wide parity audit and reconciles every active safety, behavior, contributor, security, crew, prompt, and enforcement contract. The required set includes root `AGENTS.md`, `SECURITY.md`, `CONTRIBUTING.md`, `agents/TOOL_POLICY.md`, `agents/PRIME.md`, `agents/ROUTING.md`, `agents/crew/communications.md`, other affected crew contracts, and their enforcement fixtures; `SOUL.md` must return to identity/personality only with misplaced tool-approval policy removed:

1. instrument current voice latency, interruptions, failures, and task handoffs;
2. enable continuous audio for internal devices;
3. enable response chunking with native TTS;
4. enable the selected streaming TTS path;
5. after the Trusted Execution PR 5 canonical-policy parity gate passes, enable concurrent task handoff and progress conversation;
6. enable Bluetooth/wearable routes after physical-device acceptance;
7. expand rollout only after duplicate-execution, privacy, and destructive-boundary tests pass.

Disabling a new capability must return users to the current canonical voice or task path without abandoning durable work.

## Implementation plan

### PR 1 — Continuous native audio session

Create the single Android voice-session state machine, turn-scoped protected speaker/session authentication with the bounded presence lease and immediate lock/background invalidation, partial recognition plumbing, playback/capture coordination, echo-control policy, interruption detection with rejected-candidate resume behavior, built-in phone-route handling, and turn-based fallback. Do not add wearable route ownership; wearable integration is deferred to PR 6 after #259 lands.

### PR 2 — Streaming response and upgraded TTS

Connect canonical response streaming to safe phrase chunking, stable chunk IDs, separately stored normalized `spokenText`, range-progress and completion acknowledgements, acknowledged `heardAssistantText`, model-input history substitution for interrupted assistant turns, the partial spoken-delivery frontier, one high-quality streaming TTS implementation, native TTS fallback, end-to-end cancellation, and spoken-content normalization. Add the explicit speakable-stream harness mode and reconcile the existing Android post-stream quality revision so an emitted response cannot be replaced by a different final reply.

Depends on PR 1.

### PR 3 — Durable concurrent task handoff

Detach substantial tool work from the conversational turn, establish durable task identity, preserve idempotency, and separate speech/listening/task controls.

Implementation depends on the authority, idempotency, cancellation, and task-linkage foundation in #269. Its action-first feature flag must remain disabled—or continue enforcing legacy gates—until Trusted Execution PR 5 completes the repo-wide policy/contract audit and enforcement-fixture reconciliation above; no voice-specific approval bypass is permitted.

### PR 4 — Live progress and voice task controls

Project sanitized task state into voice, support status and bounded control commands, resolve active-task references, and keep unrelated conversation available.

Depends on PR 3 and the relevant Live Action foundation in #262.

### PR 5 — Multi-task and resource coordination

Add deterministic multiple-task conversation behavior, local resource prioritization, explicit resource pause/resume, and safe task amendments with stable source-action deduplication, cancellation-safe lifecycle locking, and new-authority reclassification for material side-effect or target changes.

Depends on PR 4.

### PR 6 — Reliability, privacy, and real-device acceptance

Harden process recovery, network/provider failure, Bluetooth changes, screen lock, background service behavior, destructive hard-block enforcement, accessibility, latency measurement, and end-to-end artifact delivery.

Depends on PRs 1–5 and uses PR #259 as the wearable baseline.

## Acceptance scenarios

1. A spoken research request starts once, continues after Talk Mode closes, and returns the requested file.
2. Jarvis speaks the first useful response segment before the full response is generated.
3. The user interrupts halfway through a normalized spoken phrase after canonical Markdown has advanced further; audio stops promptly, the frontier records the acknowledged `spokenCharacterOffset`, and the canonical model-input history substitutes that assistant turn with only the derived `heardAssistantText`, excluding the parallel full response, unspoken Markdown, omitted content, and Jarvis's own captured output. Saying "stop talking" additionally suppresses every later TTS chunk for that response while its displayed text continues.
4. While a task runs, the user asks for status and receives sanitized truthful progress without stopping the task.
5. A non-side-effecting preference change inside existing scope updates the intended task once even after duplicate transcript or reconnect delivery; every amendment serializes with cancellation, completion, and failure and is rejected after terminal admission closes. An amendment that adds an external step or changes any material side-effect field receives a new bounded authority linked to that task without reopening the old manifest, and the task cannot report success until all required linked amendment work succeeds. A task failure fences unstarted work across every remaining linked authority before becoming terminal; unrelated work creates a new task.
6. "Stop talking" suppresses speech for the current response without stopping text generation, "stop listening" pauses only microphone capture, and "cancel the task" atomically fences unstarted work across every linked nonterminal authority while reporting already-consumed effects and their recovery guidance, without changing either speech control.
7. After the Trusted Execution PR 5 canonical-policy parity gate passes and the voice flag is enabled, ordinary non-destructive tool work never creates a duplicate approval request; before then, voice retains legacy gates.
8. With Trusted Execution enabled after its PR 5 parity gate, messages, posts, purchases, merges, deployments, and other ordinarily remediable actions execute from a materially complete command without another question; nonrecoverable or root-wide destruction is narrowed to a permitted recoverable path or blocked, and voice confirmation cannot override that block.
9. App restart, network loss, duplicated events, and route changes do not duplicate tool effects or lose accepted work.
10. Unsupported audio configurations fall back to the existing voice loop while durable work continues.
11. Bluetooth glasses can capture the user and play Jarvis through the selected communication route.
12. Completed work appears consistently in conversation, Live Action, and artifact surfaces.
13. Echo, background noise, or another rejected interruption candidate continues acknowledging audibly rendered output until the actual duck/stop transition, then atomically snapshots and fences delivery; callbacks after that boundary do not count as heard, and rejection resumes the same response from the snapshot without skipping, losing, or duplicating queued speech.
14. A response that would trigger the existing Android post-stream quality revision either completes that revision before any speakable chunk is emitted or bypasses the revision in explicit speakable-stream mode; displayed text, spoken text, captions, interruption context, and the final harness reply identify the same canonical response.
15. A paired device receives an utterance from media playback or an unverified nearby speaker; until protected speaker verification or current OS/device reauthentication binds the command to the user, Jarvis issues no execution authority and refuses notification, memory, calendar, message, task/status, artifact, and account-data reads while allowing only public non-user-scoped conversation and verification/setup guidance in an isolated ephemeral session. That session creates no durable chat, `spokenText`, memory, learned-context, task, artifact, or profile writes and is never merged after verification. After valid verification, a later utterance following device lock, backgrounding, route transfer, lost presence, Talk Mode restart, or the 30-second lease expiry is restricted again until fresh verification succeeds; revocation synchronously stops and withholds in-flight private playback and display until reauthentication.
16. Recognition produces a low-confidence best hypothesis or competing alternatives for a material recipient, amount, repository, target, or other side-effect field; Jarvis issues no authority for that hypothesis and asks one focused clarification in the voice conversation.

## Definition of done

- All six implementation issues are complete in dependency order.
- Each implementation PR has focused regression coverage and a clean Codex review before merge.
- Physical-device acceptance passes on the Galaxy Z Fold 6 and the supported CY003 route.
- Trusted Execution PR 5 has completed the repo-wide parity audit, reconciled every affected active contract and enforcement fixture—including the required files named in Rollout—and removed tool-approval policy from `SOUL.md` before action-first voice flags enable.
- The authorization matrix proves that, after that parity gate, materially complete ordinary commands—including sends, posts, purchases, merges, and deployments—execute without follow-up questions, while nonrecoverable or root-wide destruction remains blocked unless it can be narrowed to a Trusted Execution-permitted recoverable path.
- No duplicate execution, cross-user progress leakage, hidden-reasoning exposure, or abandoned durable task is observed in the golden workflows.
