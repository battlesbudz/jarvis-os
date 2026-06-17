import type { Express, Request, Response } from "express";
import type OpenAI from "openai";
import { getTool } from "../agent/tools/index";
import type { ToolContext } from "../agent/types";

type PendingConfirmation = {
  userId: string;
  tool: string;
  args: any;
  expiresAt: number;
};

type CoachToolResult = {
  result: "success" | "error" | "pending";
  label: string;
  detail: string;
};

type CoachActionConfirmationDeps = {
  pendingConfirmations: Map<string, PendingConfirmation>;
  executeCoachTool: (toolName: string, args: any, userId: string) => Promise<CoachToolResult>;
  openai: OpenAI;
};

export function registerCoachActionConfirmationRoutes(
  app: Express,
  { pendingConfirmations, executeCoachTool, openai }: CoachActionConfirmationDeps,
): void {
  app.post("/api/coach/execute-confirmed", async (req: Request, res: Response) => {
    try {
      const { token } = req.body;
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!token) return res.status(400).json({ error: "token is required" });
      const pending = pendingConfirmations.get(token);
      if (!pending) return res.status(400).json({ error: "Confirmation token not found or expired" });
      if (pending.userId !== userId) return res.status(403).json({ error: "Token does not belong to this user" });
      if (pending.expiresAt < Date.now()) {
        pendingConfirmations.delete(token);
        return res.status(400).json({ error: "Confirmation token has expired" });
      }
      pendingConfirmations.delete(token);
      let execResult: CoachToolResult;
      if (pending.tool === "connected_accounts_execute") {
        const connectedAccountsTool = getTool("connected_accounts_execute");
        if (!connectedAccountsTool) {
          execResult = {
            result: "error",
            label: "Connected account action unavailable",
            detail: "The connected account action tool is not registered.",
          };
        } else {
          const toolResult = await connectedAccountsTool.execute(
            { ...pending.args, approved: true, confirmed: true },
            { userId, channel: "appchat", state: { pendingAttachments: [] } } as ToolContext,
          );
          execResult = {
            result: toolResult.ok ? "success" : "error",
            label: toolResult.label ?? "Connected account action",
            detail: toolResult.content ?? toolResult.detail ?? "",
          };
        }
      } else {
        execResult = await executeCoachTool(pending.tool, pending.args, userId);
      }
      return res.json({ result: execResult.result, label: execResult.label, detail: execResult.detail });
    } catch (error) {
      console.error("Error in execute-confirmed:", error);
      return res.status(500).json({ error: "Failed to execute confirmed action" });
    }
  });

  app.post("/api/coach/decline-action", async (req: Request, res: Response) => {
    try {
      const { token } = req.body;
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      let tool = "unknown";
      let preview: Record<string, string> = {};
      if (token) {
        const pending = pendingConfirmations.get(token);
        if (pending && pending.userId === userId) {
          tool = pending.tool;
          const a = pending.args;
          if (tool === "send_email") preview = { to: a.to || "", subject: a.subject || "" };
          else if (tool === "connected_accounts_execute") preview = { action: a.tool_slug || a.toolSlug || "", platform: a.platform || "" };
          else preview = { action: a.action || "", cmd: a.cmd || "", path: a.path || "" };
          pendingConfirmations.delete(token);
        }
      }
      const toolLabel = tool === "send_email"
        ? `sending an email to ${preview.to || "the recipient"}`
        : tool === "connected_accounts_execute"
          ? `running the Composio ${preview.platform || "connected account"} action ${preview.action || ""}`.trim()
          : `running a terminal command (${preview.cmd || preview.action || "shell"})`;
      const prompt = `The user has just declined an action you proposed. You were about to ${toolLabel} but they cancelled. Acknowledge briefly and naturally in one sentence — do not re-propose the action. Stay in your coaching persona.`;
      const resp = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: 80,
      });
      const content = resp.choices[0]?.message?.content || "Got it — I won't proceed with that action.";
      return res.json({ content });
    } catch (error) {
      console.error("Error in decline-action:", error);
      return res.json({ content: "Got it — I'll leave that for now." });
    }
  });
}
