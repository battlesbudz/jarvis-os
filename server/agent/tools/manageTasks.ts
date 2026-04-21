import type { AgentTool, AgentPlan } from "../types";
import { db } from "../../db";
import * as schema from "@shared/schema";
import { and, eq, desc } from "drizzle-orm";

// Pattern-insights util kept inside telegramRoutes for now; we lazily import
// the helpers to avoid a circular dep with telegramRoutes.

interface PatternHelpers {
  getPlansForDateRange: (userId: string, start: string, end: string) => Promise<Array<{ date: string; tasks: unknown[] }>>;
  computePatternInsights: (plans: Array<{ date: string; tasks: unknown[] }>, commitments?: unknown[]) => string;
}

async function loadPatternHelpers(): Promise<PatternHelpers> {
  const mod: PatternHelpers = await import("../../telegramRoutes");
  return {
    getPlansForDateRange: mod.getPlansForDateRange,
    computePatternInsights: mod.computePatternInsights,
  };
}

export const manageTasksTool: AgentTool = {
  name: "manage_tasks",
  description:
    "Manage today's plan and the user's commitments. Use this to add tasks to today's plan, add commitments, complete commitments, list current items, or analyze 30-day behavioral patterns.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "add_plan_task",
          "add_commitment",
          "complete_commitment",
          "list_tasks",
          "analyze_patterns",
        ],
      },
      title: { type: "string", description: "Task title (add_plan_task)" },
      content: { type: "string", description: "Commitment content (add_commitment)" },
      due_date: { type: "string", description: "YYYY-MM-DD (add_commitment, optional)" },
      commitment_id: { type: "string", description: "ID from [id:...] (complete_commitment)" },
    },
    required: ["action"],
  },
  async execute(args, ctx) {
    const userId = ctx.userId;
    const dateKey: string = ctx.state?.dateKey || new Date().toISOString().slice(0, 10);

    interface ManageTasksArgs {
      action: string;
      title?: string;
      content?: string;
      due_date?: string;
      commitment_id?: string;
    }
    const a = args as ManageTasksArgs;

    try {
      switch (a.action) {
        case "add_plan_task": {
          if (!a.title) {
            return { ok: false, content: "Error: title is required for add_plan_task", label: "Missing title" };
          }
          const todayPlan: AgentPlan | null = ctx.state?.todayPlan ?? null;
          const tasks: AgentPlan["tasks"] = todayPlan?.tasks ? [...todayPlan.tasks] : [];
          const newTask = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            title: a.title,
            completed: false,
          };
          tasks.push(newTask);
          const planData: AgentPlan = todayPlan ? { ...todayPlan, tasks } : { tasks };
          await db
            .insert(schema.plans)
            .values({ userId, date: dateKey, data: planData })
            .onConflictDoUpdate({
              target: [schema.plans.userId, schema.plans.date],
              set: { data: planData, updatedAt: new Date() },
            });
          if (ctx.state) ctx.state.todayPlan = planData;
          return {
            ok: true,
            content: `Added "${a.title}" to today's plan. Today now has ${tasks.length} task(s).`,
            label: "Task added",
            detail: a.title,
          };
        }

        case "add_commitment": {
          if (!a.content) {
            return { ok: false, content: "Error: content is required for add_commitment", label: "Missing content" };
          }
          await db.insert(schema.commitments).values({
            userId,
            content: a.content,
            dueDate: a.due_date || null,
            sourceMessage: `Added via ${ctx.channel || "agent"}`,
          });
          return {
            ok: true,
            content: `Added commitment: "${a.content}"${a.due_date ? ` (due ${a.due_date})` : ""}`,
            label: "Commitment added",
            detail: a.content,
          };
        }

        case "complete_commitment": {
          if (!a.commitment_id) {
            return { ok: false, content: "Error: commitment_id is required for complete_commitment", label: "Missing id" };
          }
          const updated = await db
            .update(schema.commitments)
            .set({ status: "done", resolvedAt: new Date() })
            .where(
              and(
                eq(schema.commitments.id, a.commitment_id),
                eq(schema.commitments.userId, userId),
                eq(schema.commitments.status, "pending")
              )
            )
            .returning({ id: schema.commitments.id });
          if (updated.length === 0) {
            return {
              ok: false,
              content: `No pending commitment found with id "${a.commitment_id}".`,
              label: "Commitment not found",
            };
          }
          return {
            ok: true,
            content: `Marked commitment as done (id: ${a.commitment_id}).`,
            label: "Commitment completed",
            detail: a.commitment_id,
          };
        }

        case "list_tasks": {
          const todayPlan: AgentPlan | null = ctx.state?.todayPlan ?? null;
          const planTasks: AgentPlan["tasks"] = todayPlan?.tasks ?? [];
          const pendingCommitments = await db
            .select()
            .from(schema.commitments)
            .where(and(eq(schema.commitments.userId, userId), eq(schema.commitments.status, "pending")))
            .orderBy(desc(schema.commitments.extractedAt))
            .limit(10);

          let listing = "";
          listing += planTasks.length > 0
            ? "Today's Plan:\n" + planTasks.map((t) => `- ${t.completed ? "✅" : "⬜"} ${t.title}`).join("\n")
            : "Today's Plan: No tasks yet.";
          listing += "\n\n";
          listing += pendingCommitments.length > 0
            ? "Open Commitments:\n" +
              pendingCommitments.map((c) => `- [id:${c.id}] "${c.content}"${c.dueDate ? ` (due ${c.dueDate})` : ""}`).join("\n")
            : "Open Commitments: None.";
          return { ok: true, content: listing, label: "Listed tasks" };
        }

        case "analyze_patterns": {
          const helpers = await loadPatternHelpers().catch(() => null);
          if (!helpers || !helpers.getPlansForDateRange || !helpers.computePatternInsights) {
            return { ok: false, content: "Pattern analysis temporarily unavailable.", label: "Pattern analysis unavailable" };
          }
          const today = new Date();
          const startDate = new Date(today);
          startDate.setDate(startDate.getDate() - 30);
          const start = startDate.toISOString().slice(0, 10);
          const end = today.toISOString().slice(0, 10);

          const plans = await helpers.getPlansForDateRange(userId, start, end);
          if (plans.length < 3) {
            return { ok: true, content: "Not enough data yet for pattern analysis (need at least a few days).", label: "Not enough data" };
          }
          const allCommitments = await db.select().from(schema.commitments).where(eq(schema.commitments.userId, userId)).limit(200);
          const startDt = new Date(start);
          const endDt = new Date(end + "T23:59:59");
          const scopedCommitments = allCommitments.filter((c) =>
            (c.dueDate && c.dueDate >= start && c.dueDate <= end) ||
            (c.extractedAt && c.extractedAt >= startDt && c.extractedAt <= endDt) ||
            (c.resolvedAt && c.resolvedAt >= startDt && c.resolvedAt <= endDt)
          );
          const patternData = helpers.computePatternInsights(plans, scopedCommitments);
          return {
            ok: true,
            content: `Behavioral pattern data from the last 30 days. Analyze it and give the user 3-5 sharp, specific observations naming each pattern with numbers.\n\n${patternData}`,
            label: "Pattern analysis",
          };
        }

        default:
          return { ok: false, content: `Unknown action: ${a.action}`, label: "Unknown action" };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        content: `manage_tasks failed: ${msg}`,
        label: "manage_tasks failed",
        detail: msg,
      };
    }
  },
};
