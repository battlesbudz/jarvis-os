/**
 * buildIntentRouter.ts
 *
 * Extracted, dependency-injectable build-intent routing logic.
 * Separating this from coachAgent.ts makes the routing behaviour fully
 * unit-testable without a database or HTTP stack.
 *
 * The default exports wire up the real implementations; tests substitute stubs.
 */

import { BUILD_ACK_MARKER } from "./queryClassifier";
import { submitAgentJob } from "./jobClient";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BuildRouteInput {
  userId: string;
  userText: string;
  channelName: string;
  chatMessages: Array<{ role: string; content: string }>;
  discordChannelId?: string;
}

export interface BuildRouteResult {
  /** `true` if the request was handled as a build job; `false` means fall-through. */
  handled: boolean;
  /** Present when `handled === true`. The ack reply to return to the user. */
  reply?: string;
  /** Present when `handled === true` and a *new* job was created. */
  jobId?: string;
  /** Present when `handled === true` but the job was a duplicate. */
  duplicateJobId?: string;
}

export interface BuildRouteDeps {
  submit: typeof submitAgentJob;
}

// ── Core routing function ─────────────────────────────────────────────────────

/**
 * Attempt to route `input` as a build-feature background job.
 *
 * Deduplication is handled inside `submitAgentJob` — if a queued or running
 * build_feature job with a similar title already exists for the user (within
 * the last 10 minutes) it returns `isDuplicate: true` without inserting a
 * second row.  `routeBuildIntent` uses that flag to pick the right ack message.
 *
 * @param input   Routing context (caller-supplied).
 * @param deps    Injectable dependencies (real or stubbed).
 * @returns       `{ handled: false }` when the caller should fall through to
 *                the normal orchestrator path.
 */
export async function routeBuildIntent(
  input: BuildRouteInput,
  deps: BuildRouteDeps = { submit: submitAgentJob },
): Promise<BuildRouteResult> {
  const { userId, userText, channelName, chatMessages, discordChannelId } = input;
  const { submit } = deps;

  const buildTitle = `Build: ${userText.slice(0, 80)}${userText.length > 80 ? "…" : ""}`;

  // ── Enqueue (or detect duplicate) ────────────────────────────────────────
  const buildPrompt = userText;
  const buildInput: Record<string, unknown> = { originChannel: channelName };
  if (discordChannelId) buildInput.originDiscordChannelId = discordChannelId;

  const recentForBuild = chatMessages
    .slice(0, 6)
    .reverse()
    .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`)
    .join("\n");
  if (recentForBuild) buildInput.conversationContext = recentForBuild;

  const { id: jobId, isDuplicate } = await submit({
    userId,
    agentType: "build_feature",
    title: buildTitle,
    prompt: buildPrompt,
    input: buildInput,
  });

  if (isDuplicate) {
    const ackReply = `Got it — I've already ${BUILD_ACK_MARKER} for something very similar (job ${jobId}). I'll let you know as soon as it's done.`;
    console.log(
      `[${channelName}] build intent is a duplicate of job=${jobId} — skipping enqueue user=${userId}`,
    );
    return { handled: true, reply: ackReply, duplicateJobId: jobId };
  }

  // BUILD_ACK_MARKER is embedded verbatim so classifyBuildFollowUp can
  // recognise this turn as a completed build ack — keeping the two in sync.
  const ackReply = `Got it — I've ${BUILD_ACK_MARKER}. I'll notify you when the new tool is ready (usually takes a minute or two).`;

  console.log(
    `[${channelName}] build intent detected — queued build_feature job=${jobId} user=${userId}`,
  );

  return { handled: true, reply: ackReply, jobId };
}
