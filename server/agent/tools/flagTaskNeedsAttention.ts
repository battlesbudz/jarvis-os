import type { AgentTool, ToolContext, ToolArgs, ToolResult } from "../types";
import { db } from "../../db";
import * as schema from "@shared/schema";
import { and, eq } from "drizzle-orm";

/**
 * Build a `flag_task_needs_attention` tool scoped to a specific scheduled task.
 *
 * The taskId is bound at construction time (by the scheduler) so the model
 * only needs to supply the question — it cannot accidentally target the wrong
 * task row.
 */
export function buildFlagTaskNeedsAttentionTool(taskId: string): AgentTool {
  return {
    name: "flag_task_needs_attention",
    description:
      "Use this tool when you hit a blocker or need guidance from the user to complete the current scheduled task. " +
      "It pauses the task, marks it as 'Needs You' in Mission Control, and sends a Telegram message to the user with your question. " +
      "Call it with a clear, specific question so the user knows exactly what decision or information is required.",
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description:
            "The question or clarification you need from the user before you can proceed. Be specific and actionable.",
        },
      },
      required: ["question"],
    },
    async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
      const question = String(args.question || "").trim();
      if (!question) {
        return { ok: false, content: "question is required.", label: "Missing question" };
      }

      try {
        const [task] = await db
          .select()
          .from(schema.jarvisScheduledTasks)
          .where(
            and(
              eq(schema.jarvisScheduledTasks.id, taskId),
              eq(schema.jarvisScheduledTasks.userId, ctx.userId),
            ),
          )
          .limit(1);

        if (!task) {
          return { ok: false, content: `Scheduled task id=${taskId} not found.`, label: "Task not found" };
        }

        await db
          .update(schema.jarvisScheduledTasks)
          .set({ needsAttention: true, attentionQuestion: question })
          .where(
            and(
              eq(schema.jarvisScheduledTasks.id, taskId),
              eq(schema.jarvisScheduledTasks.userId, ctx.userId),
            ),
          );

        try {
          const [link] = await db
            .select()
            .from(schema.telegramLinks)
            .where(eq(schema.telegramLinks.userId, ctx.userId));

          if (link?.chatId) {
            const { sendLongMessage } = await import("../../integrations/telegram");
            await sendLongMessage(
              link.chatId,
              `⚠️ Your task *"${task.title}"* needs your guidance:\n\n${question}\n\nReply directly to this message with your answer and I'll take it from there.\n\n[task:${taskId}]`,
            );
          }
        } catch (err) {
          console.error("[flag_task_needs_attention] Telegram notify failed (non-fatal):", err);
        }

        return {
          ok: true,
          content: `Task marked as 'Needs You'. The user has been notified via Telegram and Mission Control. Stop here — do not attempt further actions until the user responds.`,
          label: "Needs You",
          detail: `taskId=${taskId}, question=${question}`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[flag_task_needs_attention] failed:", msg);
        return { ok: false, content: `Failed to flag task: ${msg}`, label: "Flag failed", detail: msg };
      }
    },
  };
}
