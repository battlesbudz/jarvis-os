/**
 * Goal decomposition engine — turns a single user goal into a
 * project tree of phases → milestones → tasks.
 *
 * Runs as an agent_jobs job (agentType = "goal_decompose"). Uses the
 * PLANNING sub-agent prompt structure to brainstorm, then a strict
 * JSON-schema pass to convert the plan into a typed GoalTreeData
 * payload that we persist into goal_trees.
 */
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import * as schema from "@shared/schema";
import { createRoutedOpenAIChatShim } from "./routedChatCompletion";
import type {
  GoalTreeData,
  GoalTreePhase,
  GoalTreeMilestone,
  GoalTreeTask,
} from "@shared/schema";
import { buildUntrustedSoulContext, BUDGET_PRESETS } from "../memory/contextBuilder";

const openai = createRoutedOpenAIChatShim("[GoalDecomposer]", "balanced");

interface UserGoal {
  id: string;
  title: string;
  category?: string;
  description?: string;
  unit?: string;
  target?: number;
  current?: number;
  deadline?: string;
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function clampStr(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  return s.trim().slice(0, max);
}

function clampNum(n: unknown, min: number, max: number, dflt: number): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return dflt;
  return Math.max(min, Math.min(max, v));
}

function normaliseTree(raw: unknown, fallbackTitle: string): GoalTreeData {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const phasesRaw = Array.isArray(obj.phases) ? obj.phases : [];
  const phases: GoalTreePhase[] = phasesRaw.slice(0, 6).map((p, pi) => {
    const pp = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
    const milestonesRaw = Array.isArray(pp.milestones) ? pp.milestones : [];
    const milestones: GoalTreeMilestone[] = milestonesRaw.slice(0, 6).map((m, mi) => {
      const mm = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
      const tasksRaw = Array.isArray(mm.tasks) ? mm.tasks : [];
      const tasks: GoalTreeTask[] = tasksRaw.slice(0, 8).map((t, ti) => {
        const tt = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
        return {
          id: newId(`t${pi}${mi}${ti}`),
          title: clampStr(tt.title, 200) || `Task ${ti + 1}`,
          description: clampStr(tt.description, 500) || undefined,
          estimateHours: clampNum(tt.estimateHours, 0.25, 40, 1),
          status: pi === 0 && mi === 0 && ti === 0 ? "ready" : pi === 0 && mi === 0 ? "ready" : "blocked",
        };
      });
      return {
        id: newId(`m${pi}${mi}`),
        title: clampStr(mm.title, 200) || `Milestone ${mi + 1}`,
        description: clampStr(mm.description, 500) || undefined,
        status: pi === 0 && mi === 0 ? "ready" : "ready",
        tasks,
      };
    });
    return {
      id: newId(`p${pi}`),
      title: clampStr(pp.title, 200) || `Phase ${pi + 1}`,
      description: clampStr(pp.description, 500) || undefined,
      status: pi === 0 ? "ready" : "ready",
      milestones,
    };
  });
  return {
    phases,
    rationale: clampStr(obj.rationale, 1000) || `Decomposition of "${fallbackTitle}"`,
    generatedAt: new Date().toISOString(),
  };
}

async function loadGoal(userId: string, goalId: string): Promise<UserGoal | null> {
  const [row] = await db
    .select({ data: schema.goals.data })
    .from(schema.goals)
    .where(eq(schema.goals.userId, userId))
    .limit(1);
  const list = (row?.data as UserGoal[] | undefined) || [];
  return list.find((g) => g.id === goalId) || null;
}

async function generateTreeWithLLM(goal: UserGoal, userId: string): Promise<GoalTreeData> {
  let soulBlock = "";
  try {
    const { getSoulPromptBlock } = await import("../memory/soul");
    soulBlock = buildUntrustedSoulContext(
      await getSoulPromptBlock(userId),
      "User context from JARVIS Soul",
      BUDGET_PRESETS.planning.soul,
    );
  } catch (err) {
    console.error(`[goalDecomposer] SOUL load failed for ${userId}:`, err);
  }
  const system = `You are Jarvis's goal-decomposition planner. Break a single user goal into a concrete, sequenced project tree.

${soulBlock ? `${soulBlock}\n\n` : ""}

Hard rules:
- 2 to 4 PHASES (chronological, each represents a meaningful chunk of progress)
- Each phase has 1 to 3 MILESTONES (verifiable outcomes)
- Each milestone has 2 to 5 TASKS (each ≤ 4 hours of focused work)
- Tasks are concrete actions, not aspirations. "Email 3 prospective vendors with our spec" not "Find vendors".
- The very first task of phase 1 must be the smallest possible first step (≤30 minutes).
- Do NOT invent facts about the user — work from what they wrote.

Return ONLY this JSON shape, nothing else:
{
  "rationale": "<2-3 sentences on the overall approach>",
  "phases": [
    {
      "title": "<phase name>",
      "description": "<one line>",
      "milestones": [
        {
          "title": "<milestone name>",
          "description": "<one line outcome>",
          "tasks": [
            { "title": "<task>", "description": "<one line>", "estimateHours": 1 }
          ]
        }
      ]
    }
  ]
}`;

  const targetText = goal.target && goal.unit ? `${goal.current ?? 0}/${goal.target} ${goal.unit}` : "";
  const userMsg = `Goal: ${goal.title}
${goal.category ? `Category: ${goal.category}` : ""}
${targetText ? `Progress: ${targetText}` : ""}
${goal.deadline ? `Deadline: ${goal.deadline}` : ""}
${goal.description ? `Notes: ${goal.description}` : ""}

Decompose it now.`;

  const { getModel } = await import("../lib/modelPrefs");
  const model = await getModel(userId, "research");

  const resp = await openai.chat.completions.create({
    model,
    user: userId,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userMsg },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 2500,
  });
  const content = resp.choices[0]?.message?.content || "{}";
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = {};
  }
  return normaliseTree(parsed, goal.title);
}

export interface DecomposeResult {
  goalTreeId: string;
  phaseCount: number;
  turns: number;
  toolCallsCount: number;
}

/**
 * Run from the job queue. Reads agentJobs.input.goalId, regenerates
 * (or refreshes) the tree, and upserts goal_trees.
 */
export async function runGoalDecomposition(
  job: typeof schema.agentJobs.$inferSelect,
): Promise<DecomposeResult> {
  const inputObj = (job.input && typeof job.input === "object" ? job.input : {}) as { goalId?: string };
  const goalId = inputObj.goalId;
  if (!goalId) throw new Error("goal_decompose job missing input.goalId");

  const goal = await loadGoal(job.userId, goalId);
  if (!goal) throw new Error(`Goal ${goalId} not found for user ${job.userId}`);

  const tree = await generateTreeWithLLM(goal, job.userId);
  if (tree.phases.length === 0) {
    throw new Error("Decomposition returned no phases");
  }

  // Upsert goal_trees row keyed on (userId, goalId)
  const existing = await db
    .select({ id: schema.goalTrees.id })
    .from(schema.goalTrees)
    .where(and(eq(schema.goalTrees.userId, job.userId), eq(schema.goalTrees.goalId, goalId)))
    .limit(1);

  let goalTreeId: string;
  if (existing.length > 0) {
    goalTreeId = existing[0].id;
    await db
      .update(schema.goalTrees)
      .set({ tree, title: goal.title, status: "active", updatedAt: new Date() })
      .where(eq(schema.goalTrees.id, goalTreeId));
  } else {
    const inserted = await db
      .insert(schema.goalTrees)
      .values({
        userId: job.userId,
        goalId,
        title: goal.title,
        tree,
        status: "active",
      })
      .returning({ id: schema.goalTrees.id });
    goalTreeId = inserted[0]?.id || "";
  }

  return {
    goalTreeId,
    phaseCount: tree.phases.length,
    turns: 1,
    toolCallsCount: 0,
  };
}

/**
 * Convenience: enqueue a decomposition job for a goal. The worker
 * loads the full goal payload at run time, so callers only need the
 * id + title (used for the human-readable job title).
 */
export async function enqueueGoalDecomposition(
  userId: string,
  goal: { id: string; title: string },
): Promise<string> {
  const { submitAgentJob } = await import("./jobQueue");
  const { id } = await submitAgentJob({
    userId,
    agentType: "goal_decompose",
    title: `Decompose: ${goal.title}`,
    prompt: `Break the goal "${goal.title}" into a phased plan.`,
    input: { goalId: goal.id },
  });
  return id;
}
