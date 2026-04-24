/**
 * Discord Approval Feedback Learning — Phase 3 Extension
 *
 * Records approval/rejection signals as user_memories (category: "preferences")
 * so the memory system can surface patterns over time:
 * e.g. "User consistently approves scripts under 600 words."
 */

import { db } from "../db";
import { userMemories } from "@shared/schema";

export interface ApprovalSignal {
  userId: string;
  approved: boolean;
  contentType: string;       // "script" | "task" | "plan" | "custom"
  content: string;           // the actual text that was approved/rejected
  channelId: string;
  messageId: string;
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function approximateTone(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("bullet") || /^[-•*]/m.test(text)) return "bullet-point";
  if (lower.includes("\n\n") && text.split("\n\n").length > 3) return "multi-section";
  if (wordCount(text) < 200) return "short";
  if (wordCount(text) > 600) return "long";
  return "medium-length";
}

/**
 * Record an approval or rejection as a preference memory.
 * Called from buildReactionHandler after the status is updated.
 */
export async function recordApprovalSignal(signal: ApprovalSignal): Promise<void> {
  try {
    const wc = wordCount(signal.content);
    const tone = approximateTone(signal.content);
    const verdict = signal.approved ? "approved" : "rejected";
    const typeLabel = signal.contentType || "content";

    const memoryContent =
      `User ${verdict} a Discord ${typeLabel} that was ${wc} words and ${tone} in format. ` +
      `Content preview: "${signal.content.slice(0, 120).replace(/\n/g, " ")}${signal.content.length > 120 ? "…" : ""}"`;

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    await db.insert(userMemories).values({
      id,
      userId: signal.userId,
      content: memoryContent,
      category: "preferences",
      relevanceScore: signal.approved ? 60 : 55,
      confidence: 65,
      sourceType: "discord_approval",
      sourceRef: signal.messageId,
    });

    console.log(
      `[ApprovalLearning] Stored ${verdict} signal for user ${signal.userId}: ` +
      `${wc} words, ${tone}, type=${typeLabel}`,
    );
  } catch (err) {
    // Non-fatal — learning failure must not block the approval action
    console.error("[ApprovalLearning] Failed to record signal:", err);
  }
}
