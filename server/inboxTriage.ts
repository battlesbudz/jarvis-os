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
import { eq, and } from "drizzle-orm";
import * as schema from "@shared/schema";
import { markSoulStale } from "./memory/soul";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

type TriageVerdict = "auto_handle" | "escalate" | "promote_memory";

/**
 * Tools where Jarvis-initiated deliverables can be auto-handled by triage
 * without asking the user (mirrors the non-strictly-irreversible set).
 */
const AUTO_APPROVABLE_GATE_TOOLS = new Set([
  "browser_navigate",
  "browser_click",
  "browser_type",
  "browser_select",
  "browser_clear_session",
  "create_document",
  "drive_create_file",
  "setup_named_agent",
  "gmail_draft",
  "clear_memory",
  "agent_memory_clear",
  "connect_channel",
]);

async function classifyDeliverable(
  d: typeof schema.deliverables.$inferSelect
): Promise<{ verdict: TriageVerdict; note: string }> {
  const meta = (d.meta as Record<string, unknown>) || {};

  if (d.type === "email_draft") {
    return { verdict: "escalate", note: "Email drafts require your review before sending" };
  }

  if (d.type === "approval_gate") {
    const initiatedBy = meta.initiatedBy as string | undefined;
    const toolName = meta.toolName as string | undefined;
    if (initiatedBy === "jarvis" && toolName && AUTO_APPROVABLE_GATE_TOOLS.has(toolName)) {
      return { verdict: "auto_handle", note: `Auto-approved — Jarvis-initiated ${toolName}` };
    }
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
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_completion_tokens: 120,
    });
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
        if (d.type === "approval_gate") {
          const meta = (d.meta as { gateId?: string }) || {};
          if (meta.gateId) {
            const { approveGate } = await import("./agent/agentApproval");
            await approveGate(meta.gateId, userId).catch(() => {});
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
        if (note) {
          await db
            .update(schema.deliverables)
            .set({ triageNote: note })
            .where(eq(schema.deliverables.id, d.id));
        }
        console.log(`[InboxTriage] escalated to user: ${d.id} (${d.title.slice(0, 60)})`);
      }
    } catch (err) {
      console.error(`[InboxTriage] error triaging deliverable ${d.id}:`, err);
    }
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
        .from(schema.users)
        .limit(100);
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
