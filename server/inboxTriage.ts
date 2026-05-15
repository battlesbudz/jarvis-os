/**
 * Inbox Triage Runner
 *
 * Background worker (3-minute interval) that autonomously classifies
 * pending deliverables and either:
 *   - auto_handle:     marks as approved + triageStatus='auto_handled'
 *   - promote_memory:  saves a memory row + marks as approved + triageStatus='promoted_memory'
 *   - escalate:        leaves as pending_approval + triageStatus='needs_attention'
 *
 * Reduces inbox noise for low-risk or informational items while surfacing
 * items that genuinely need the user's attention.
 */

import { db } from "./db";
import { eq, and, sql as drizzleSql } from "drizzle-orm";
import * as schema from "@shared/schema";
import { markSoulStale } from "./memory/soul";
import { STRICTLY_IRREVERSIBLE_TOOLS, approveGate } from "./agent/agentApproval";
import { createRoutedChatCompletion } from "./agent/routedChatCompletion";

type TriageVerdict = "auto_handle" | "escalate" | "promote_memory";

async function classifyDeliverable(
  d: typeof schema.deliverables.$inferSelect
): Promise<{ verdict: TriageVerdict; note: string }> {
  if (d.type === "email_draft") {
    return { verdict: "escalate", note: "Email drafts require your review before sending" };
  }

  // Approval-gate deliverables only exist for user-initiated or strictly-irreversible
  // requests (Jarvis-initiated safe gates are auto-approved at creation with no deliverable).
  // Always escalate so the user sees them.
  if (d.type === "approval_gate") {
    return { verdict: "escalate", note: "Requires your approval before proceeding" };
  }

  const bodySnippet = (d.body || "").slice(0, 600);
  const prompt = `You are an AI inbox triage assistant for a personal assistant app called Jarvis.

Classify this deliverable into EXACTLY one of these verdicts:
- "escalate" — requires the user to make a decision, review a draft before sending, or take a specific action
- "auto_handle" — purely informational / background completed work that requires no user decision  
- "promote_memory" — contains an important insight, key decision made, goal milestone, or notable outcome worth saving to long-term memory

Return JSON only — {"verdict": "...", "note": "one clear sentence explaining why"}

Type: ${d.type}
Title: ${d.title}
Summary: ${d.summary || "(none)"}
Content preview: ${bodySnippet}`;

  try {
    const resp = await createRoutedChatCompletion({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_completion_tokens: 120,
    }, { tier: "cheap", logPrefix: "[InboxTriage/deliverable]" });
    const raw = resp.choices[0]?.message?.content || "{}";
    const result = JSON.parse(raw) as { verdict?: string; note?: string };
    const valid: TriageVerdict[] = ["auto_handle", "escalate", "promote_memory"];
    const verdict = valid.includes(result.verdict as TriageVerdict)
      ? (result.verdict as TriageVerdict)
      : "escalate";
    return { verdict, note: result.note || "" };
  } catch {
    return { verdict: "escalate", note: "" };
  }
}

async function promoteToMemory(
  userId: string,
  d: typeof schema.deliverables.$inferSelect
): Promise<void> {
  const content = d.summary || d.title;
  await db.insert(schema.userMemories).values({
    userId,
    content: `[Inbox triage] ${content}`,
    category: "fact",
    confidence: 70,
    relevanceScore: 65,
    sourceType: "inbox_triage",
    sourceRef: d.id,
  });
  markSoulStale(userId).catch(() => {});
}

/**
 * Classify a single inbox_items row and decide whether it should be
 * auto-dismissed (hidden without user interaction) or kept for the user.
 *
 * EXPECTED INPUT TYPES (keep this comment in sync with heartbeat.ts write-path audit):
 *   • google_calendar / outlook_calendar / calendar
 *       Calendar surface-rule hits from curiosityScanner.ts.
 *       The user created a rule to be notified about these events so they can
 *       prep or act. Bias strongly toward KEEP — only auto-dismiss if the item
 *       is clearly a past event or an obvious duplicate already handled.
 *
 *   • nervous_system
 *       News/web watch hits from nervous-system/scanner.ts.
 *       The user configured a watch topic so these signals match their stated
 *       interests. Bias toward KEEP — only auto-dismiss if the hit is clearly
 *       off-topic, a false positive, or has no genuine relevance to the watch.
 *
 *   • other / heartbeat_telegram / task_guidance
 *       General Jarvis notifications (in-app channel, agent self-edit
 *       confirmations, plan completions, etc.). Use general judgment:
 *       auto-dismiss routine background status updates with no follow-up needed;
 *       keep anything that involves a pending decision or next step.
 *
 * NOTE: Email items (sourceType "email" / "gmail" / "outlook_email") no longer
 * flow through inbox_items — email triage was migrated to Telegram delivery.
 * If an email-sourced item appears here it is legacy/manual and should default
 * to KEEP (escalate = safe fallback).
 *
 * CLASSIFICATION EXAMPLES (expected outcomes; update if prompt changes):
 *
 *   CALENDAR — should be KEPT (autoDismiss: false):
 *     subject="Q2 Planning", snippet="2:00 PM at HQ — agenda TBD",
 *       jarvisReason="Matched your surface rule"
 *     → KEEP: User created a prep rule; action/prep may be needed.
 *
 *     subject="Client Demo", snippet="10:00 AM — slides needed",
 *       jarvisReason="Matched your surface rule"
 *     → KEEP: Upcoming event with clear prep implications.
 *
 *   CALENDAR — auto-dismiss acceptable:
 *     subject="Team Standup (yesterday)", snippet="9:00 AM — already ended",
 *       jarvisReason="Matched your surface rule"
 *     → DISMISS: Event is in the past; prep is no longer useful.
 *
 *   NERVOUS SYSTEM — should be KEPT (autoDismiss: false):
 *     subject="Senate passes AI regulation bill",
 *       sender="Nervous System — AI Policy", snippet="...regulatory framework..."
 *     → KEEP: Directly relevant to the user's configured watch topic.
 *
 *   NERVOUS SYSTEM — auto-dismiss acceptable:
 *     subject="10 tips to sleep better",
 *       sender="Nervous System — Productivity", snippet="generic wellness listicle"
 *     → DISMISS: Off-topic false positive; no genuine relevance to the watch.
 *
 *   GENERAL (other) — auto-dismiss acceptable:
 *     subject="Code change applied", snippet="3 lines updated in utils.ts",
 *       jarvisReason="Agent self-edit completed"
 *     → DISMISS: Routine background status; no follow-up needed.
 *
 *   GENERAL (other) — should be KEPT:
 *     subject="Your weekly plan is ready", snippet="Review and approve to activate",
 *       jarvisReason="Plan awaiting approval"
 *     → KEEP: Pending user decision.
 */
async function classifyInboxItem(
  item: typeof schema.inboxItems.$inferSelect
): Promise<{ autoDismiss: boolean; reason: string }> {
  const prompt = `You are an inbox triage assistant for Jarvis, a personal AI assistant.

Email triage has moved to Telegram, so the in-app inbox now only contains these item types:

1. CALENDAR surface hits (sourceType: google_calendar / outlook_calendar / calendar)
   The user created a surface rule to be notified about these events — they want to prep or take action.
   Default: KEEP. Auto-dismiss ONLY if the event is clearly a past event already handled, an obvious
   irrelevant duplicate, or so far in the future with zero prep implications that no attention is needed now.

2. NERVOUS-SYSTEM signals (sourceType: nervous_system)
   News/web watch hits on topics the user told Jarvis to monitor.
   Default: KEEP. Auto-dismiss ONLY if the hit is clearly a false positive — the snippet is off-topic,
   generic clickbait, or has no genuine relevance to the watch topic despite a keyword match.

3. GENERAL notifications (sourceType: other / heartbeat_telegram / task_guidance / etc.)
   In-app channel messages, agent-action confirmations, plan completions.
   Auto-dismiss only if it is a routine background status update with no pending decision or follow-up.
   Keep if the user may want to confirm, review, or take any next step.

When in doubt, KEEP — it is always better to show an item the user can dismiss themselves than to
silently auto-dismiss something they wanted to see.

Return JSON only: {"autoDismiss": true/false, "reason": "one sentence"}

Source type: ${item.sourceType}
Subject: ${item.subject || "(none)"}
Sender: ${item.sender || "(none)"}
Snippet: ${(item.snippet || "").slice(0, 400)}
Jarvis reason: ${item.jarvisReason || "(none)"}`;

  try {
    const resp = await createRoutedChatCompletion({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_completion_tokens: 80,
    }, { tier: "cheap", logPrefix: "[InboxTriage/item]" });
    const raw = resp.choices[0]?.message?.content || "{}";
    const result = JSON.parse(raw) as { autoDismiss?: boolean; reason?: string };
    return { autoDismiss: result.autoDismiss === true, reason: result.reason || "" };
  } catch {
    return { autoDismiss: false, reason: "" };
  }
}

async function triageInboxItemsForUser(userId: string): Promise<void> {
  const pendingItems = await db
    .select()
    .from(schema.inboxItems)
    .where(
      and(
        eq(schema.inboxItems.userId, userId),
        eq(schema.inboxItems.status, "pending")
      )
    )
    .limit(15);

  for (const item of pendingItems) {
    try {
      const { autoDismiss, reason } = await classifyInboxItem(item);
      if (autoDismiss) {
        await db
          .update(schema.inboxItems)
          .set({
            status: "dismissed",
            actedAt: new Date(),
            jarvisReason: reason || "Auto-dismissed — not actionable",
          })
          .where(eq(schema.inboxItems.id, item.id));
        console.log(`[InboxTriage] auto-dismissed inbox item: ${item.id} (${(item.subject || "").slice(0, 60)}) — ${reason}`);
      }
    } catch (err) {
      console.error(`[InboxTriage] error triaging inbox item ${item.id}:`, err);
    }
  }
}

export async function runTriagePassForUser(userId: string): Promise<void> {
  const pending = await db
    .select()
    .from(schema.deliverables)
    .where(
      and(
        eq(schema.deliverables.userId, userId),
        eq(schema.deliverables.status, "pending_approval"),
        eq(schema.deliverables.triageStatus, "needs_attention")
      )
    )
    .limit(20);

  for (const d of pending) {
    try {
      const { verdict, note } = await classifyDeliverable(d);

      if (verdict === "auto_handle") {
        // For approval_gate deliverables, only approve if the underlying gate succeeds.
        // For other deliverable types there's no gate to approve.
        if (d.type === "approval_gate") {
          const meta = (d.meta as { gateId?: string }) || {};
          if (meta.gateId) {
            const gateOk = await approveGate(meta.gateId, userId).catch(() => false);
            if (!gateOk) {
              await db
                .update(schema.deliverables)
                .set({ triageNote: "Auto-approve attempted but gate not found / already resolved" })
                .where(eq(schema.deliverables.id, d.id));
              console.warn(`[InboxTriage] approveGate failed for ${d.id} — gate may already be resolved`);
              continue;
            }
          }
        }
        await db
          .update(schema.deliverables)
          .set({
            status: "approved",
            triageStatus: "auto_handled",
            triageNote: note || "Auto-handled by Jarvis",
            actedAt: new Date(),
          })
          .where(eq(schema.deliverables.id, d.id));
        console.log(`[InboxTriage] auto-handled: ${d.id} (${d.title.slice(0, 60)})`);
      } else if (verdict === "promote_memory") {
        await promoteToMemory(userId, d);
        await db
          .update(schema.deliverables)
          .set({
            status: "approved",
            triageStatus: "promoted_memory",
            triageNote: note || "Saved to long-term memory by Jarvis",
            actedAt: new Date(),
          })
          .where(eq(schema.deliverables.id, d.id));
        console.log(`[InboxTriage] promoted to memory: ${d.id} (${d.title.slice(0, 60)})`);
      } else {
        // Mark as 'escalated' so this deliverable is NOT re-evaluated on the next pass
        await db
          .update(schema.deliverables)
          .set({ triageStatus: "escalated", triageNote: note || undefined })
          .where(eq(schema.deliverables.id, d.id));
        console.log(`[InboxTriage] escalated to user: ${d.id} (${d.title.slice(0, 60)})`);
      }
    } catch (err) {
      console.error(`[InboxTriage] error triaging deliverable ${d.id}:`, err);
    }
  }

  // Also triage raw inbox notifications
  await triageInboxItemsForUser(userId);

  // Fallback: auto-approve pending Jarvis-initiated gates that have no linked deliverable
  // (handles the edge case where the deliverable creation failed at gate creation time)
  try {
    const orphanedGates = await db
      .select()
      .from(schema.agentApprovalGates)
      .where(
        and(
          eq(schema.agentApprovalGates.userId, userId),
          eq(schema.agentApprovalGates.status, "pending"),
          eq(schema.agentApprovalGates.initiatedBy, "jarvis"),
          drizzleSql`${schema.agentApprovalGates.expiresAt} > NOW()`
        )
      )
      .limit(10);

    for (const gate of orphanedGates) {
      if (!STRICTLY_IRREVERSIBLE_TOOLS.has(gate.toolName)) {
        const ok = await approveGate(gate.id, userId).catch(() => false);
        if (ok) {
          console.log(`[InboxTriage] fallback auto-approved orphaned gate: ${gate.id} (${gate.toolName})`);
        }
      }
    }
  } catch (err) {
    console.error(`[InboxTriage] fallback gate check error for user ${userId}:`, err);
  }
}

export async function runStartupTriagePass(): Promise<void> {
  const users = await db.select({ id: schema.users.id }).from(schema.users);
  for (const user of users) {
    await runTriagePassForUser(user.id).catch((err) => {
      console.error(`[InboxTriage] startup pass failed for user ${user.id}:`, err);
    });
  }
}

let triageRunning = false;

export function startTriageRunner(): void {
  if (triageRunning) return;
  triageRunning = true;

  const INTERVAL_MS = 3 * 60 * 1000;

  const timer = setInterval(async () => {
    try {
      const users = await db
        .select({ id: schema.users.id })
        .from(schema.users);
      for (const user of users) {
        await runTriagePassForUser(user.id).catch((err) => {
          console.error(`[InboxTriage] pass failed for user ${user.id}:`, err);
        });
      }
    } catch (err) {
      console.error("[InboxTriage] runner error:", err);
    }
  }, INTERVAL_MS);
  if (typeof (timer as unknown as { unref?: () => void }).unref === "function") {
    (timer as unknown as { unref: () => void }).unref();
  }

  console.log("[InboxTriage] Triage runner started — 3-minute pass interval");
}
