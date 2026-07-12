import type { AgentTool, AgentPlan } from "../types";
import { db } from "../../db";
import * as schema from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  createOrMergeCommitmentInDb,
  listPendingPersonalCommitments,
  personalCommitmentCondition,
  updateCommitmentInDb,
} from "../../commitments/dbCommitmentRepository";
import {
  parseCommitmentKind,
  parseCommitmentSignalLevel,
} from "../../commitments/commitmentStore";

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
      commitment_kind: {
        type: "string",
        enum: ["user_commitment", "user_task", "operational_incident", "notification"],
        description:
          "Required for add_commitment. Use user_commitment/user_task for the user's own work, operational_incident for service or configuration problems, and notification for alerts or messages.",
      },
      signal_level: {
        type: "string",
        enum: ["normal", "low"],
        description:
          "Required for add_commitment. Use low for non-actionable notification noise.",
      },
      dedupe_key: {
        type: "string",
        description:
          "Stable topic key for an added commitment. Reuse it for repeated reports of the same issue; omit dates, counts, and changing status text.",
      },
      commitment_id: { type: "string", description: "ID from [id:...] (complete_commitment)" },
    },
    required: ["action"],
  },
  async execute(args, ctx) {
    const userId = ctx.userId;
    const dateKey: string = ctx.state?.dateKey || new Date().toISOString().slice(0, 10);



    try {
      switch (String(args.action ?? "")) {
        case "add_plan_task": {
          if (!args.title) {
            return { ok: false, content: "Error: title is required for add_plan_task", label: "Missing title" };
          }
          const todayPlan: AgentPlan | null = ctx.state?.todayPlan ?? null;
          const tasks: AgentPlan["tasks"] = todayPlan?.tasks ? [...todayPlan.tasks] : [];
          const newTask = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            title: String(args.title ?? ""),
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
            content: `Added "${String(args.title ?? "")}" to today's plan. Today now has ${tasks.length} task(s).`,
            label: "Task added",
            detail: String(args.title ?? ""),
          };
        }

        case "add_commitment": {
          if (!args.content) {
            return { ok: false, content: "Error: content is required for add_commitment", label: "Missing content" };
          }
          const commitmentKind = parseCommitmentKind(args.commitment_kind);
          const signalLevel = parseCommitmentSignalLevel(args.signal_level);
          if (!commitmentKind || !signalLevel) {
            return {
              ok: false,
              content: "Error: commitment_kind and signal_level are required for add_commitment.",
              label: "Missing commitment classification",
            };
          }
          const result = await createOrMergeCommitmentInDb({
            userId,
            content: String(args.content ?? ""),
            dueDate: typeof args.due_date === "string" ? args.due_date : null,
            commitmentKind,
            signalLevel,
            dedupeKey: typeof args.dedupe_key === "string" ? args.dedupe_key : null,
            sourceType: ctx.channel || "agent",
            sourceMessage: `Added via ${ctx.channel || "agent"}`,
          });
          const verb = result.action === "merged" ? "Deduplicated" : "Added";
          return {
            ok: true,
            content: `${verb} commitment: "${result.commitment.content}"${result.commitment.dueDate ? ` (due ${result.commitment.dueDate})` : ""}`,
            label: result.action === "merged" ? "Commitment deduplicated" : "Commitment added",
            detail: result.commitment.content,
          };
        }

        case "complete_commitment": {
          if (!args.commitment_id) {
            return { ok: false, content: "Error: commitment_id is required for complete_commitment", label: "Missing id" };
          }
          const updated = await updateCommitmentInDb({
            userId,
            id: String(args.commitment_id ?? ""),
            status: "done",
            requirePending: true,
          });
          if (!updated || updated.status !== "done") {
            return {
              ok: false,
              content: `No pending commitment found with id "${String(args.commitment_id ?? "")}".`,
              label: "Commitment not found",
            };
          }
          return {
            ok: true,
            content: `Marked commitment as done (id: ${String(args.commitment_id ?? "")}).`,
            label: "Commitment completed",
            detail: String(args.commitment_id ?? ""),
          };
        }

        case "list_tasks": {
          const todayPlan: AgentPlan | null = ctx.state?.todayPlan ?? null;
          const planTasks: AgentPlan["tasks"] = todayPlan?.tasks ?? [];
          const pendingCommitments = await listPendingPersonalCommitments(userId, 10);

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
          const allCommitments = await db
            .select()
            .from(schema.commitments)
            .where(personalCommitmentCondition(userId))
            .limit(200);
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
          return { ok: false, content: `Unknown action: ${String(args.action ?? "")}`, label: "Unknown action" };
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
