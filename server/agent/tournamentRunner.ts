/**
 * Tournament Runner — multi-agent competitive answer selection.
 *
 * Fans out N independent sub-agent calls on the same task (with prompt-level
 * diversity to produce varied outputs), collects all results, then asks a
 * Claude judge to score each output and name a winner.
 *
 * The complete run (outputs, scores, winner) is persisted to `tournament_runs`
 * so the user can retrieve runners-up on request.
 */

import { runSubAgent } from "./subagents";
import type { SubAgentType } from "./subagents";
import type { ToolContext } from "./types";
import { anthropic, ORCHESTRATOR_MODEL } from "../lib/anthropicClient";
import { db } from "../db";
import { tournamentRuns } from "@shared/schema";
import type { TournamentOutput, TournamentScore } from "@shared/schema";

// ── High-stakes signal detection ──────────────────────────────────────────────

const EMAIL_SIGNALS = [
  /\bemail\b/i, /\bdraft\b/i, /\bwrite.*to\b/i, /\bsend.*to\b/i, /\breply.*to\b/i,
];

const HIGH_STAKES_SIGNALS = [
  /\binvestment\b/i, /\blegal\b/i, /\bfinancial\b/i, /\bstrategy\b/i, /\bstrategic\b/i,
  /\bcontract\b/i, /\bproposal\b/i, /\bpitch\b/i, /\bdeal\b/i, /\bnegotiat/i,
  /\bcritical\b/i, /\bimportant.*email\b/i, /\bsenior\b/i, /\bexecutive\b/i,
  /\bboard\b/i, /\binvestor\b/i, /\bventure\b/i, /\bpartner\b/i, /\bclient\b/i,
  /\banalysis\b/i, /\breport\b/i, /\bpresent.*to\b/i, /\bcompetitive\b/i,
];

// Signals that indicate the user is already requesting tournament mode — prevents re-offering.
const TOURNAMENT_REQUEST_SIGNALS = [
  /\btournament\b/i, /\bbest of\b/i, /\bmulti.?agent\b/i, /\brun.*multiple\b/i,
  /\bcompare.*agent\b/i, /\bparallel.*agent\b/i,
];

/**
 * Returns true if the text contains signals that warrant offering tournament mode.
 * Checks for: VIP contact emails, strategy docs, investment/legal analysis.
 * Returns false if the request already asks for tournament mode (no redundant offer).
 */
export function detectTournamentSignals(text: string): boolean {
  // Don't offer tournament mode if the request is already about tournaments.
  if (TOURNAMENT_REQUEST_SIGNALS.some((r) => r.test(text))) return false;

  const hasEmail = EMAIL_SIGNALS.some((r) => r.test(text));
  const hasHighStakes = HIGH_STAKES_SIGNALS.some((r) => r.test(text));
  return hasEmail || hasHighStakes;
}

// ── Approach diversity — varied prompts per agent slot ────────────────────────

const APPROACH_STYLES = [
  {
    label: "structured-analytical",
    prefix: "Use a structured, analytical approach: be thorough, precise, and evidence-driven. Prioritise accuracy and completeness over brevity.",
  },
  {
    label: "creative-expansive",
    prefix: "Use a creative, expansive approach: explore angles others might miss, bring fresh perspectives, and prioritise insight over convention.",
  },
  {
    label: "concise-direct",
    prefix: "Use a concise, direct approach: distil the essence, cut to what matters most, and prioritise clarity and actionability.",
  },
  {
    label: "stakeholder-focused",
    prefix: "Use a stakeholder-focused approach: consider the audience's goals and concerns, tailor the tone, and make it immediately usable by the recipient.",
  },
];

// ── Tournament options & result types ─────────────────────────────────────────

export interface TournamentOptions {
  task: string;
  numAgents?: number;
  judgeCriteria?: string;
  agentType: SubAgentType;
  context: ToolContext;
}

export interface TournamentResult {
  tournamentId: string;
  winnerIndex: number;
  winnerOutput: string;
  winnerApproach: string;
  winnerScore: number;
  winnerReasoning: string;
  numAgents: number;
  allOutputs: TournamentOutput[];
  allScores: TournamentScore[];
}

// ── Judge call ────────────────────────────────────────────────────────────────

async function judgeOutputs(opts: {
  task: string;
  outputs: TournamentOutput[];
  criteria: string;
}): Promise<{ scores: TournamentScore[]; winnerIndex: number }> {
  // Build output block preserving original agentIndex values.
  const outputBlock = opts.outputs
    .map(
      (o) =>
        `### Agent ${o.agentIndex + 1} (${o.approach})\n${o.body.slice(0, 3000)}${o.body.length > 3000 ? "\n[truncated]" : ""}`,
    )
    .join("\n\n");

  const agentIndices = opts.outputs.map((o) => o.agentIndex);

  const response = await anthropic.messages.create({
    model: ORCHESTRATOR_MODEL,
    max_tokens: 1024,
    system: `You are an expert quality judge evaluating multiple outputs from independent AI agents on the same task. Score each output against the provided criteria and pick the best one. Respond with valid JSON only — no markdown, no commentary outside JSON.

Agent indices available: ${agentIndices.join(", ")}

Response format:
{
  "scores": [
    { "agentIndex": 0, "score": 85, "reasoning": "brief explanation" },
    { "agentIndex": 1, "score": 72, "reasoning": "brief explanation" }
  ],
  "winnerIndex": 0
}

Rules:
- Use the exact agentIndex values from the agents shown above.
- Score 0-100 against the criteria (accuracy, completeness, appropriateness, quality).
- Failed agents (showing an error message) should receive score ≤ 10.
- winnerIndex must be one of the listed agent indices, pointing to the highest-scoring agent.
- Keep each reasoning to 1-2 sentences.`,
    messages: [
      {
        role: "user",
        content: `Task: ${opts.task}\n\nJudge criteria: ${opts.criteria}\n\n${outputBlock}`,
      },
    ],
  });

  const content = response.content[0];
  const text = content.type === "text" ? content.text : "";

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in judge response");
    const parsed = JSON.parse(jsonMatch[0]) as {
      scores: Array<{ agentIndex: number; score: number; reasoning: string }>;
      winnerIndex: number;
    };
    // Validate winnerIndex is one of the actual agent indices.
    const validWinnerIndex = agentIndices.includes(parsed.winnerIndex)
      ? parsed.winnerIndex
      : agentIndices[0];
    return {
      scores: parsed.scores.map((s) => ({
        agentIndex: Number(s.agentIndex),
        score: Number(s.score) || 0,
        reasoning: String(s.reasoning || ""),
      })),
      winnerIndex: validWinnerIndex,
    };
  } catch {
    // Fallback: first agent wins.
    return {
      scores: opts.outputs.map((o) => ({
        agentIndex: o.agentIndex,
        score: o.agentIndex === 0 ? 75 : 65,
        reasoning: "Judge parse failed; first agent selected by default",
      })),
      winnerIndex: 0,
    };
  }
}

// ── Main runner ────────────────────────────────────────────────────────────────

export async function runTournament(opts: TournamentOptions): Promise<TournamentResult> {
  const numAgents = Math.min(4, Math.max(2, opts.numAgents ?? 3));
  const criteria =
    opts.judgeCriteria ||
    "Quality, accuracy, completeness, clarity, and fitness for purpose given the task.";

  const approaches = APPROACH_STYLES.slice(0, numAgents);

  console.log(
    `[tournament] starting: agentType=${opts.agentType} numAgents=${numAgents} userId=${opts.context.userId}`,
  );

  // Fan out N concurrent sub-agent calls.
  // Each output preserves its original agentIndex (not re-indexed after filtering).
  const agentPromises = approaches.map(async (approach, i): Promise<TournamentOutput> => {
    const augmentedPrompt = `${approach.prefix}\n\n${opts.task}`;
    try {
      const result = await runSubAgent({
        agentType: opts.agentType,
        prompt: augmentedPrompt,
        defaultTitle: `Tournament agent ${i + 1}`,
        context: opts.context,
      });
      return { agentIndex: i, approach: approach.label, body: result.body };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[tournament] agent ${i + 1} failed:`, msg);
      return {
        agentIndex: i,
        approach: approach.label,
        body: `(Agent ${i + 1} failed: ${msg})`,
      };
    }
  });

  const outputs = await Promise.all(agentPromises);

  // Always pass ALL outputs to the judge (including failed ones, which get low scores).
  // This ensures winnerIndex correctly maps into the `outputs` array.
  let scores: TournamentScore[] = [];
  let winnerIndex = 0;

  try {
    const judgment = await judgeOutputs({ task: opts.task, outputs, criteria });
    scores = judgment.scores;
    winnerIndex = judgment.winnerIndex;
  } catch (err) {
    console.error("[tournament] judge call failed:", err);
    // Fallback: first agent, equal scores.
    scores = outputs.map((o) => ({
      agentIndex: o.agentIndex,
      score: o.agentIndex === 0 ? 75 : 65,
      reasoning: "Judge unavailable; first agent selected by default",
    }));
    winnerIndex = 0;
  }

  // Winner is looked up by the original agentIndex, not array position.
  const winner = outputs.find((o) => o.agentIndex === winnerIndex) ?? outputs[0];
  const winnerScore = scores.find((s) => s.agentIndex === winnerIndex);

  // winnerId stored as the approach label (text), matching the schema contract.
  const winnerIdText = winner?.approach ?? `agent-${winnerIndex}`;

  // Persist to DB.
  let tournamentId = `tournament-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const rows = await db
      .insert(tournamentRuns)
      .values({
        userId: opts.context.userId,
        task: opts.task,
        agentType: opts.agentType,
        numAgents,
        outputs,
        scores,
        winnerId: winnerIdText,
        judgeCriteria: criteria,
      })
      .returning({ id: tournamentRuns.id });
    if (rows[0]?.id) tournamentId = rows[0].id;
    console.log(`[tournament] persisted run id=${tournamentId}`);
  } catch (err) {
    console.error("[tournament] DB persist failed (non-fatal):", err);
  }

  return {
    tournamentId,
    winnerIndex,
    winnerOutput: winner?.body ?? "(no output)",
    winnerApproach: winner?.approach ?? "unknown",
    winnerScore: winnerScore?.score ?? 0,
    winnerReasoning: winnerScore?.reasoning ?? "",
    numAgents,
    allOutputs: outputs,
    allScores: scores,
  };
}

/**
 * Retrieve all outputs from a previous tournament run for "show runners-up" recall.
 * If tournamentId is omitted, returns the user's most recent tournament run.
 */
export async function getTournamentRunners(
  userId: string,
  tournamentId?: string,
): Promise<{ found: boolean; run?: typeof tournamentRuns.$inferSelect }> {
  try {
    const { eq, and, desc } = await import("drizzle-orm");

    let rows: Array<typeof tournamentRuns.$inferSelect>;
    if (tournamentId) {
      rows = await db
        .select()
        .from(tournamentRuns)
        .where(and(eq(tournamentRuns.id, tournamentId), eq(tournamentRuns.userId, userId)))
        .limit(1);
    } else {
      // No ID provided — return the most recent run for the user.
      rows = await db
        .select()
        .from(tournamentRuns)
        .where(eq(tournamentRuns.userId, userId))
        .orderBy(desc(tournamentRuns.createdAt))
        .limit(1);
    }

    if (!rows[0]) return { found: false };
    return { found: true, run: rows[0] };
  } catch {
    return { found: false };
  }
}
