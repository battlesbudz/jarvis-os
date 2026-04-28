/**
 * Learning Synthesiser — Periodic review of CORRECTIONS.md & ERRORS.md
 *
 * Reads the two learnings files, passes them to an LLM, and distils recurring
 * patterns into bullet-point entries suitable for appending to MEMORY.md.
 *
 * The synthesis can be triggered:
 *   1. Manually — POST /api/workspace/synthesise (Settings screen button)
 *   2. Automatically — Sunday 04:30 via the scheduler
 *
 * Results are appended to MEMORY.md and logged to the console audit trail.
 * Each run is persisted to the `learning_synthesis_log` DB table so users
 * can review their synthesis history in the app.
 */

import OpenAI from "openai";
import { readWorkspaceFile, writeWorkspaceFile, STUBS } from "../workspace/loader";
import { db } from "../db";
import { learningSynthesisLog } from "@shared/schema";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export interface SynthesisResult {
  bullets: string[];
  appendedToMemory: boolean;
  archived: boolean;
  correctionLines: number;
  errorLines: number;
  skipped: boolean;
  skipReason?: string;
}

/**
 * Synthesise learnings from CORRECTIONS.md and ERRORS.md.
 *
 * @param applyToMemory  If true, appends distilled bullets to MEMORY.md.
 *                       If false, returns them without writing (dry-run / preview).
 * @param archiveAfter   If true (and applyToMemory is true), resets CORRECTIONS.md and
 *                       ERRORS.md to their stub headers after a successful synthesis.
 *                       Post-synthesis entries written after this call are preserved
 *                       because only pre-existing content is removed.
 * @param triggeredBy    'manual' (default) or 'scheduler'
 */
export async function synthesiseLearnings(
  applyToMemory = true,
  archiveAfter = false,
  triggeredBy: "manual" | "scheduler" = "manual",
): Promise<SynthesisResult> {
  const [corrections, errors] = await Promise.all([
    readWorkspaceFile("corrections"),
    readWorkspaceFile("errors"),
  ]);

  const correctionLines = corrections.split("\n").filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith("<!--")).length;
  const errorLines = errors.split("\n").filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith("<!--")).length;

  if (correctionLines === 0 && errorLines === 0) {
    console.log("[LearningSynthesiser] No learnings content to synthesise — skipping");
    const result: SynthesisResult = {
      bullets: [],
      appendedToMemory: false,
      archived: false,
      correctionLines: 0,
      errorLines: 0,
      skipped: true,
      skipReason: "CORRECTIONS.md and ERRORS.md are empty — nothing to synthesise yet.",
    };
    await logSynthesisRun(result, triggeredBy);
    return result;
  }

  const prompt = `You are an AI assistant helping the Jarvis personal AI to improve itself over time.

Below are the accumulated correction and error logs from recent Jarvis sessions.
Your job is to identify the most important recurring patterns and distil them into clear, actionable memory bullets that Jarvis should remember permanently.

CORRECTIONS.md (user corrections to Jarvis behaviour):
---
${corrections.slice(0, 6000)}
---

ERRORS.md (Jarvis errors and failures):
---
${errors.slice(0, 3000)}
---

Instructions:
1. Identify the 3–7 most significant recurring themes or patterns across both files.
2. For each theme, write one concise bullet point that Jarvis should remember.
3. Each bullet MUST start with "- " and be specific, actionable, and written in the second person imperative (e.g. "- Always confirm the date before scheduling calendar events.").
4. Do NOT include bullets that are already obvious, trivial, or about one-off issues.
5. Focus on patterns that repeat, not isolated incidents.
6. Output ONLY the bullet points — no headers, no commentary, no JSON.`;

  let rawOutput = "";
  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_completion_tokens: 600,
    });
    rawOutput = resp.choices[0]?.message?.content?.trim() ?? "";
  } catch (err) {
    console.error("[LearningSynthesiser] LLM call failed:", err);
    throw new Error("LLM call failed — could not synthesise learnings");
  }

  const bullets = rawOutput
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- ") && l.length > 4);

  if (bullets.length === 0) {
    console.warn("[LearningSynthesiser] LLM returned no usable bullets");
    const result: SynthesisResult = {
      bullets: [],
      appendedToMemory: false,
      archived: false,
      correctionLines,
      errorLines,
      skipped: true,
      skipReason: "LLM did not return any usable bullet points.",
    };
    await logSynthesisRun(result, triggeredBy);
    return result;
  }

  let appendedToMemory = false;
  let archived = false;

  if (applyToMemory) {
    const ts = new Date().toISOString().slice(0, 10);
    const block = `\n## Synthesised learnings — ${ts}\n${bullets.join("\n")}`;
    await writeWorkspaceFile("memory", block, "append");
    appendedToMemory = true;
    console.log(
      `[LearningSynthesiser] Appended ${bullets.length} bullet(s) to MEMORY.md`,
    );

    if (archiveAfter) {
      await Promise.all([
        writeWorkspaceFile("corrections", STUBS.corrections, "overwrite"),
        writeWorkspaceFile("errors", STUBS.errors, "overwrite"),
      ]);
      archived = true;
      console.log(
        `[LearningSynthesiser] Archived — CORRECTIONS.md and ERRORS.md reset to stub headers`,
      );
    }
  }

  console.log(
    `[LearningSynthesiser] Synthesis complete — ${bullets.length} bullets, correctionLines=${correctionLines}, errorLines=${errorLines}, applied=${appendedToMemory}, archived=${archived}`,
  );

  const result: SynthesisResult = { bullets, appendedToMemory, archived, correctionLines, errorLines, skipped: false };
  await logSynthesisRun(result, triggeredBy);
  return result;
}

async function logSynthesisRun(
  result: SynthesisResult,
  triggeredBy: "manual" | "scheduler",
): Promise<void> {
  try {
    await db.insert(learningSynthesisLog).values({
      bulletCount: result.bullets.length,
      bullets: result.bullets as unknown as typeof learningSynthesisLog.$inferInsert["bullets"],
      triggeredBy,
      skipped: result.skipped,
      skipReason: result.skipReason ?? null,
    });
  } catch (err) {
    console.error("[LearningSynthesiser] Failed to write synthesis log to DB:", err);
  }
}
