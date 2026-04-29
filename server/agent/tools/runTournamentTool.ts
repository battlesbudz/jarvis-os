/**
 * run_tournament tool — fans out N independent sub-agents on a task, judges
 * all outputs, and returns the best one with a short "best of N" note.
 *
 * Also supports retrieving runners-up from a previous (or most recent)
 * tournament run via the `tournament_id` parameter (the "show me the others" flow).
 */

import { z } from "zod";
import type { AgentTool } from "../types";
import { runTournament, getTournamentRunners } from "../tournamentRunner";
import type { SubAgentType } from "../subagents";
import { SUB_AGENT_TYPES } from "../subagents";

// ── Zod schema ─────────────────────────────────────────────────────────────────
// Supports both snake_case (from tool call JSON) and camelCase aliases
// to satisfy the spec contract { task, numAgents, judgeCriteria, agentType }.

const agentTypeEnum = z.enum(SUB_AGENT_TYPES as [SubAgentType, ...SubAgentType[]]);

const RunTournamentSchema = z.object({
  task: z.string().trim().optional(),
  // snake_case and camelCase aliases — both accepted
  num_agents: z.number().int().min(2).max(4).optional(),
  numAgents: z.number().int().min(2).max(4).optional(),
  judge_criteria: z.string().optional(),
  judgeCriteria: z.string().optional(),
  agent_type: agentTypeEnum.optional(),
  agentType: agentTypeEnum.optional(),
  tournament_id: z.string().optional(),
  show_runners_up: z.boolean().optional().default(false),
}).transform((data) => ({
  task: data.task,
  num_agents: data.num_agents ?? data.numAgents ?? 3,
  judge_criteria: data.judge_criteria ?? data.judgeCriteria,
  agent_type: data.agent_type ?? data.agentType ?? ("writing" as SubAgentType),
  tournament_id: data.tournament_id,
  show_runners_up: data.show_runners_up ?? false,
}));

type RunTournamentArgs = z.infer<typeof RunTournamentSchema>;

// ── Tool definition ───────────────────────────────────────────────────────────

export const runTournamentTool: AgentTool = {
  name: "run_tournament",
  description: `Run the same task across multiple independent Jarvis sub-agents simultaneously, then have a judge pick the best output. Use this for high-stakes tasks where quality variance matters — important email drafts, strategy documents, investment or legal analysis, competitive research.

When to start a new tournament (provide "task"):
- User is drafting an important email to an executive, investor, or key client
- User needs a strategy document, pitch, or proposal
- User explicitly asks for "tournament mode", "best version", or "try multiple approaches"
- Task involves legal, financial, or investment analysis

When to retrieve runners-up (set show_runners_up=true or provide tournament_id):
- User says "show me the others", "show the runners-up", "compare the versions", "see the other answers"
- Use tournament_id from a prior run_tournament result if available; otherwise the most recent tournament is returned automatically`,
  parameters: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description:
          "The complete task description — include all context the agents need (recipient name, purpose, constraints, tone). Required when running a new tournament.",
      },
      num_agents: {
        type: "number",
        description: "How many agents to run in parallel. Must be 2–4. Default: 3.",
      },
      judge_criteria: {
        type: "string",
        description:
          "Explicit criteria for the judge to evaluate outputs against. If omitted, general quality metrics apply.",
      },
      agent_type: {
        type: "string",
        enum: SUB_AGENT_TYPES,
        description:
          "Sub-agent type for all slots. Default: writing. Use 'research' for research tasks, 'email' for email drafts, 'planning' for plans.",
      },
      tournament_id: {
        type: "string",
        description:
          "ID from a prior run_tournament result. When set (or when show_runners_up=true), runners-up are retrieved instead of starting a new tournament. Omit when starting a new run.",
      },
      show_runners_up: {
        type: "boolean",
        description:
          "Set to true when the user asks to see the other versions, runners-up, or compare outputs. Retrieves runners-up from the most recent (or specified) tournament.",
      },
    },
    required: [],
  },

  async execute(rawArgs, ctx) {
    // ── Validate args with Zod ──────────────────────────────────────────────
    const parseResult = RunTournamentSchema.safeParse(rawArgs);
    if (!parseResult.success) {
      const issues = parseResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      return { ok: false, content: `Invalid arguments: ${issues}`, label: "Validation error" };
    }
    const args: RunTournamentArgs = parseResult.data;

    // ── Show runners-up flow ───────────────────────────────────────────────
    // Triggered when: show_runners_up=true OR tournament_id is provided without a task.
    const isRunnersUpRequest =
      args.show_runners_up === true ||
      (args.tournament_id && !args.task);

    if (isRunnersUpRequest) {
      const { found, run } = await getTournamentRunners(ctx.userId, args.tournament_id);

      if (!found || !run) {
        return {
          ok: false,
          content: args.tournament_id
            ? `Tournament run "${args.tournament_id}" not found or belongs to a different user.`
            : "No previous tournament run found for your account. Start one first by calling run_tournament with a task.",
          label: "Tournament not found",
        };
      }

      const outputs = (run.outputs as TournamentOutput[]) || [];
      const scores = (run.scores as TournamentScore[]) || [];
      const winnerId = run.winnerId;

      const runnersUp = outputs
        .filter((o) => o.approach !== winnerId)
        .map((o, idx) => {
          const score = scores.find((s) => s.agentIndex === o.agentIndex);
          return [
            `## Runner-up ${idx + 1} — ${o.approach} (score: ${score?.score ?? "n/a"}/100)`,
            score ? `> ${score.reasoning}` : "",
            "",
            o.body,
          ]
            .filter((l) => l !== "")
            .join("\n");
        });

      if (runnersUp.length === 0) {
        return {
          ok: true,
          content: "There are no runners-up stored for this tournament (only one agent ran).",
          label: "No runners-up",
        };
      }

      return {
        ok: true,
        content: `Here are the runners-up from the ${run.agentType} tournament (task: "${run.task.slice(0, 80)}${run.task.length > 80 ? "…" : ""}"):\n\n${runnersUp.join("\n\n---\n\n")}`,
        label: `Runners-up from ${run.agentType} tournament`,
      };
    }

    // ── New tournament run ─────────────────────────────────────────────────
    const task = (args.task ?? "").trim();
    if (!task) {
      return {
        ok: false,
        content: 'task is required to start a tournament. To retrieve runners-up from a previous tournament, set show_runners_up=true or provide tournament_id.',
        label: "Missing task",
      };
    }

    const agentType: SubAgentType = args.agent_type ?? "writing";
    const numAgents = args.num_agents ?? 3;

    try {
      console.log(
        `[run_tournament] starting: agentType=${agentType} numAgents=${numAgents} userId=${ctx.userId}`,
      );

      const result = await runTournament({
        task,
        numAgents,
        judgeCriteria: args.judge_criteria,
        agentType,
        context: ctx,
      });

      const header =
        `**(Best of ${result.numAgents} — winner: ${result.winnerApproach}, score ${result.winnerScore}/100)**\n` +
        `*${result.winnerReasoning}*\n\n` +
        `Tournament ID: \`${result.tournamentId}\` — say "show me the others" or "compare" to see runners-up.\n\n` +
        `---\n\n`;

      return {
        ok: true,
        content: header + result.winnerOutput,
        label: `Tournament winner (${agentType}, ${result.numAgents} agents, score ${result.winnerScore})`,
        detail: result.tournamentId,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[run_tournament] failed:", err);
      return {
        ok: false,
        content: `Tournament run failed: ${msg}`,
        label: "Tournament failed",
        detail: msg,
      };
    }
  },
};

// ── Local type helpers (re-exported from schema for internal use) ─────────────
interface TournamentOutput {
  agentIndex: number;
  approach: string;
  body: string;
}

interface TournamentScore {
  agentIndex: number;
  score: number;
  reasoning: string;
}
