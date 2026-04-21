import type { AgentTool } from "../types";
import { db } from "../../db";
import * as schema from "@shared/schema";
import { and, eq, desc } from "drizzle-orm";

// Pattern-insights util kept inside telegramRoutes for now; we duplicate the
// minimal calls here. For analyze_patterns we lazily import the helper to
// avoid a circular dep with telegramRoutes.

async function loadPatternHelpers() {
  const mod = await import("../../telegramRoutes");
  return {
    getPlansForDateRange: (mod as any).getPlansForDateRange as (userId: string, start: string, end: string) => Promise<any[]>,
    computePatternInsights: (mod as any).computePatternInsights as (plans: any[], commitments: any[]) => string,
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

    try {
      switch (args.action) {
        case "add_plan_task": {
          if (!args.title) {
            return { ok: false, content: "Error: title is required for add_plan_task", label: "Missing title" };
          }
          const todayPlan = ctx.state?.todayPlan || null;
          const tasks = (todayPlan?.tasks as any[]) || [];
          const newTask = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            title: args.title,
            completed: false,
          };
          tasks.push(newTask);
          const planData = todayPlan ? { ...todayPlan, tasks } : { tasks };
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
            content: `Added "${args.title}" to today's plan. Today now has ${tasks.length} task(s).`,
            label: "Task added",
            detail: args.title,
          };
        }

        case "add_commitment": {
          if (!args.content) {
            return { ok: false, content: "Error: content is required for add_commitment", label: "Missing content" };
          }
          await db.insert(schema.commitments).values({
            userId,
            content: args.content,
            dueDate: args.due_date || null,
            sourceMessage: `Added via ${ctx.channel || "agent"}`,
          });
          return {
            ok: true,
            content: `Added commitment: "${args.content}"${args.due_date ? ` (due ${args.due_date})` : ""}`,
            label: "Commitment added",
            detail: args.content,
          };
        }

        case "complete_commitment": {
          if (!args.commitment_id) {
            return { ok: false, content: "Error: commitment_id is required for complete_commitment", label: "Missing id" };
          }
          const updated = await db
            .update(schema.commitments)
            .set({ status: "done", resolvedAt: new Date() })
            .where(
              and(
                eq(schema.commitments.id, args.commitment_id),
                eq(schema.commitments.userId, userId),
                eq(schema.commitments.status, "pending")
              )
            )
            .returning({ id: schema.commitments.id });
          if (updated.length === 0) {
            return {
              ok: false,
              content: `No pending commitment found with id "${args.commitment_id}".`,
              label: "Commitment not found",
            };
          }
          return {
            ok: true,
            content: `Marked commitment as done (id: ${args.commitment_id}).`,
            label: "Commitment completed",
            detail: args.commitment_id,
          };
        }

        case "list_tasks": {
          const todayPlan = ctx.state?.todayPlan || null;
          const planTasks = (todayPlan?.tasks as any[]) || [];
          const pendingCommitments = await db
            .select()
            .from(schema.commitments)
            .where(and(eq(schema.commitments.userId, userId), eq(schema.commitments.status, "pending")))
            .orderBy(desc(schema.commitments.extractedAt))
            .limit(10);

          let listing = "";
          listing += planTasks.length > 0
            ? "Today's Plan:\n" + planTasks.map((t: any) => `- ${t.completed ? "✅" : "⬜"} ${t.title}`).join("\n")
            : "Today's Plan: No tasks yet.";
          listing += "\n\n";
          listing += pendingCommitments.length > 0
            ? "Open Commitments:\n" +
              pendingCommitments.map((c: any) => `- [id:${c.id}] "${c.content}"${c.dueDate ? ` (due ${c.dueDate})` : ""}`).join("\n")
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
          const scopedCommitments = allCommitments.filter((c: any) =>
            (c.dueDate && c.dueDate >= start && c.dueDate <= end) ||
            (c.extractedAt && c.extractedAt >= new Date(start) && c.extractedAt <= new Date(end + "T23:59:59")) ||
            (c.resolvedAt && c.resolvedAt >= new Date(start) && c.resolvedAt <= new Date(end + "T23:59:59"))
          );
          const patternData = helpers.computePatternInsights(plans, scopedCommitments);
          return {
            ok: true,
            content: `Behavioral pattern data from the last 30 days. Analyze it and give the user 3-5 sharp, specific observations naming each pattern with numbers.\n\n${patternData}`,
            label: "Pattern analysis",
          };
        }

        default:
          return { ok: false, content: `Unknown action: ${args.action}`, label: "Unknown action" };
      }
    } catch (err: any) {
      return {
        ok: false,
        content: `manage_tasks failed: ${err?.message || err}`,
        label: "manage_tasks failed",
        detail: String(err?.message || err),
      };
    }
  },
};
