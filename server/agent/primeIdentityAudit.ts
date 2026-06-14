/**
 * PRIME.md Identity Audit
 *
 * Monthly audit that compares Jarvis's actual outbound messages against the
 * rules defined in agents/PRIME.md and surfaces meaningful drift as inbox
 * proposals — never auto-applies changes to the soul document.
 *
 * Runs once per calendar month (idempotency via proactiveScheduleLog).
 * Called on the first Sunday of each month at 01:00 AM by scheduler.ts.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { db } from "../db";
import { eq, and, desc, inArray, gte } from "drizzle-orm";
import * as schema from "@shared/schema";
import { notifyUser } from "../channels/registry";
import { routeModelTurn } from "./modelRouter";

const PRIME_MD_PATH = path.resolve("agents/PRIME.md");

interface DriftEntry {
  section: string;
  observation: string;
  primeQuote: string;
  exampleMessage: string;
  proposedEdit: string;
  editType: "tighten_rule" | "add_example" | "clarify_boundary" | "remove_outdated";
}

interface AuditResult {
  overallAlignment: "high" | "medium" | "low";
  summary: string;
  drifts: DriftEntry[];
}

/**
 * Returns the current ISO month string, e.g. "2026-04".
 */
function currentMonthKey(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Check whether this audit has already run for the given user and month.
 * Returns true if a log row exists (already done), false if not yet run.
 */
async function auditAlreadyRan(userId: string, monthKey: string): Promise<boolean> {
  try {
    const rows = await db
      .select({ id: schema.proactiveScheduleLog.id })
      .from(schema.proactiveScheduleLog)
      .where(
        and(
          eq(schema.proactiveScheduleLog.userId, userId),
          eq(schema.proactiveScheduleLog.messageType, "prime_identity_audit"),
          eq(schema.proactiveScheduleLog.sentDate, monthKey),
        ),
      )
      .limit(1);
    return rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Mark the audit as completed for this user and month.
 * Called only after the audit has fully and successfully run.
 */
async function markAuditComplete(userId: string, monthKey: string): Promise<void> {
  await db
    .insert(schema.proactiveScheduleLog)
    .values({ userId, messageType: "prime_identity_audit", sentDate: monthKey })
    .onConflictDoNothing()
    .catch(() => {});
}

/**
 * Run the PRIME.md identity audit for a single user.
 * Returns early (silently) if already run this calendar month.
 * The idempotency log is written only after a successful audit run so that
 * transient failures (LLM timeout, PRIME.md read error) do not permanently
 * consume the monthly slot.
 */
export async function runPrimeIdentityAudit(
  userId: string,
): Promise<{ driftsFound: number; proposalsQueued: number }> {
  const monthKey = currentMonthKey();

  // ── Step 1: Idempotency guard (pre-check, log after success) ─────────────
  if (await auditAlreadyRan(userId, monthKey)) {
    console.log(`[PrimeAudit] Already ran for user ${userId} in ${monthKey} — skipping`);
    return { driftsFound: 0, proposalsQueued: 0 };
  }

  try {
    // ── Step 2: Sample real conversations ──────────────────────────────────
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const rows = await db
      .select({
        content: schema.interactionLog.content,
        channel: schema.interactionLog.channel,
        label: schema.interactionLog.label,
        createdAt: schema.interactionLog.createdAt,
      })
      .from(schema.interactionLog)
      .where(
        and(
          eq(schema.interactionLog.userId, userId),
          eq(schema.interactionLog.direction, "outbound"),
          inArray(schema.interactionLog.channel, ["telegram", "app_chat"]),
          gte(schema.interactionLog.createdAt, cutoff),
        ),
      )
      .orderBy(desc(schema.interactionLog.createdAt))
      .limit(40);

    // If no outbound messages exist this month, send an explicit low-data message
    // and mark the month as complete rather than silently skipping.
    if (rows.length === 0) {
      console.log(`[PrimeAudit] No conversation sample for user ${userId} — sending low-data message`);
      try {
        await notifyUser(
          userId,
          "morning_briefing",
          `🔍 Monthly identity audit: no outbound conversation data in the last 30 days — audit will run next month when there is sample data to analyse.`,
        );
      } catch (err) {
        console.error(`[PrimeAudit] Failed to notify user ${userId}:`, err);
      }
      await markAuditComplete(userId, monthKey);
      return { driftsFound: 0, proposalsQueued: 0 };
    }

    const sampleText = rows
      .map((r, i) => {
        const snippet = r.content.slice(0, 300).replace(/\n+/g, " ");
        const ch = r.channel ?? "unknown";
        const lbl = r.label ? ` [${r.label}]` : "";
        return `${i + 1}. [${ch}${lbl}] ${snippet}`;
      })
      .join("\n");

    // ── Step 3: Load PRIME.md ───────────────────────────────────────────────
    let primeContent: string;
    try {
      primeContent = await fs.readFile(PRIME_MD_PATH, "utf-8");
    } catch (err) {
      console.error("[PrimeAudit] Could not read PRIME.md:", err);
      return { driftsFound: 0, proposalsQueued: 0 };
    }

    // ── Step 4: Alignment LLM call ──────────────────────────────────────────
    const systemPrompt = `You are the identity auditor for Jarvis. You will receive:
1. The PRIME.md document — Jarvis's soul: who it is supposed to be
2. A sample of Jarvis's actual recent outbound messages

Your task: identify where the actual behavior diverges from the stated identity.
Be specific and evidence-based. Point to exact quotes from both the PRIME.md
rules and the sample messages. Do not invent drift that isn't demonstrated.

Focus on the most meaningful divergences — not stylistic noise. A divergence
is meaningful if it would change how a user experiences Jarvis over many
interactions.

Output JSON only.`;

    const userPrompt = [
      `# PRIME.md\n\n${primeContent}`,
      `---`,
      `# Jarvis's Recent Outbound Messages (sample of ${rows.length})\n\n${sampleText}`,
      `---`,
      `Analyse the messages against PRIME.md. Output JSON with this exact schema:`,
      `{`,
      `  "overallAlignment": "high | medium | low",`,
      `  "summary": "2-sentence characterisation of Jarvis's current behavioral state",`,
      `  "drifts": [`,
      `    {`,
      `      "section": "## How you coach",`,
      `      "observation": "description of the drift with evidence",`,
      `      "primeQuote": "exact quote from PRIME.md that is being violated",`,
      `      "exampleMessage": "truncated example from the sample that illustrates the drift",`,
      `      "proposedEdit": "Specific change to the PRIME.md section",`,
      `      "editType": "tighten_rule | add_example | clarify_boundary | remove_outdated"`,
      `    }`,
      `  ]`,
      `}`,
      ``,
      `Cap at 4 drifts. If fewer than 2 drifts have genuine evidence, return overallAlignment: "high" and an empty drifts array — do not manufacture issues.`,
    ].join("\n");

    let auditResult: AuditResult;
    try {
      const response = await routeModelTurn({
        tier: "smart",
        maxCompletionTokens: 2048,
        stream: false,
        toolChoice: "none",
        userId,
        logPrefix: "[PrimeAudit]",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

      const raw = (response.textContent ?? "").trim();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON object found in LLM response");
      }

      auditResult = JSON.parse(jsonMatch[0]) as AuditResult;

      if (!Array.isArray(auditResult.drifts)) {
        auditResult.drifts = [];
      }
      // Cap at 4 per spec
      auditResult.drifts = auditResult.drifts.slice(0, 4);

      // Enforce anti-false-positive rule: fewer than 2 genuine drifts → high alignment
      if (auditResult.drifts.length < 2) {
        auditResult.overallAlignment = "high";
        auditResult.drifts = [];
      }
    } catch (err) {
      console.error(`[PrimeAudit] LLM call failed for user ${userId}:`, err);
      return { driftsFound: 0, proposalsQueued: 0 };
    }

    // ── Step 5: Queue drifts as Inbox proposals ─────────────────────────────
    let proposalsQueued = 0;
    for (const drift of auditResult.drifts) {
      const sectionName = drift.section.replace(/^#+\s*/, "").trim();
      const title = `Identity drift: ${sectionName}`;

      const body = [
        `## Observation`,
        drift.observation,
        ``,
        `## PRIME.md Quote`,
        `> ${drift.primeQuote}`,
        ``,
        `## Example Message (demonstrates drift)`,
        `> ${drift.exampleMessage}`,
        ``,
        `## Proposed PRIME.md Change`,
        `**Type:** ${drift.editType.replace(/_/g, " ")}`,
        ``,
        "```diff",
        `- [existing content in ${drift.section}]`,
        `+ ${drift.proposedEdit}`,
        "```",
      ].join("\n");

      try {
        await db.insert(schema.deliverables).values({
          userId,
          agentType: "prime_identity_audit",
          type: "plan",
          title,
          summary: drift.observation.slice(0, 200),
          body,
          meta: {
            auditMonth: monthKey,
            section: drift.section,
            editType: drift.editType,
            primeQuote: drift.primeQuote,
            proposedEdit: drift.proposedEdit,
          },
          status: "pending_approval",
          triageStatus: "needs_attention",
        });
        proposalsQueued++;
      } catch (err) {
        console.error(`[PrimeAudit] Failed to insert deliverable for user ${userId}:`, err);
      }
    }

    // ── Send Telegram summary ───────────────────────────────────────────────
    let telegramMsg: string;
    if (auditResult.drifts.length === 0) {
      telegramMsg =
        `🔍 Monthly identity audit complete. No significant drift detected — Jarvis is ` +
        `behaving consistently with PRIME.md.`;
    } else {
      telegramMsg = [
        `🔍 Monthly identity audit complete.`,
        `Overall alignment: ${auditResult.overallAlignment}`,
        auditResult.summary,
        `Drift proposals queued: ${proposalsQueued} — review in Inbox to approve or dismiss.`,
      ].join("\n");
    }

    try {
      await notifyUser(userId, "morning_briefing", telegramMsg);
    } catch (err) {
      console.error(`[PrimeAudit] Failed to notify user ${userId}:`, err);
    }

    // ── Step 6: Log the audit (only on success) ─────────────────────────────
    await markAuditComplete(userId, monthKey);

    console.log(
      `[PrimeAudit] Audit complete for user ${userId} — alignment=${auditResult.overallAlignment} drifts=${auditResult.drifts.length} proposals=${proposalsQueued}`,
    );

    return { driftsFound: auditResult.drifts.length, proposalsQueued };
  } catch (err) {
    console.error(`[PrimeAudit] Unexpected error for user ${userId}:`, err);
    return { driftsFound: 0, proposalsQueued: 0 };
  }
}
