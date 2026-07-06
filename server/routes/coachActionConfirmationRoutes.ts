import type { Express, Request, Response } from "express";
import type OpenAI from "openai";
import { ackDaemonVoiceApproval } from "../daemon/bridge";
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

type ExecutePendingCoachActionInput = {
  pendingConfirmations: Map<string, PendingConfirmation>;
  executeCoachTool: (toolName: string, args: any, userId: string) => Promise<CoachToolResult>;
  userId: string;
  token: string;
};

function confirmationError(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function isAndroidAgentToolConfirmation(pending: PendingConfirmation): boolean {
  const action = String(pending.args?.action || "");
  return pending.tool.startsWith("android_") || (pending.tool === "daemon_action" && action.startsWith("android_"));
}

async function executeAgentTool(
  toolName: string,
  args: any,
  userId: string,
  fallbackLabel: string,
): Promise<CoachToolResult> {
  const agentTool = getTool(toolName);
  if (!agentTool) {
    return {
      result: "error",
      label: `${fallbackLabel} unavailable`,
      detail: `The ${fallbackLabel.toLowerCase()} tool '${toolName}' is not registered.`,
    };
  }
  const toolResult = await agentTool.execute(
    { ...args, approved: true, confirmed: true },
    { userId, channel: "appchat", state: { pendingAttachments: [] } } as ToolContext,
  );
  return {
    result: toolResult.ok ? "success" : "error",
    label: toolResult.label ?? fallbackLabel,
    detail: toolResult.content ?? toolResult.detail ?? "",
  };
}

export async function executePendingCoachAction({
  pendingConfirmations,
  executeCoachTool,
  userId,
  token,
}: ExecutePendingCoachActionInput): Promise<CoachToolResult> {
  if (!token) throw confirmationError("token is required", 400);
  const pending = pendingConfirmations.get(token);
  if (!pending) throw confirmationError("Confirmation token not found or expired", 400);
  if (pending.userId !== userId) throw confirmationError("Token does not belong to this user", 403);
  if (pending.expiresAt < Date.now()) {
    pendingConfirmations.delete(token);
    throw confirmationError("Confirmation token has expired", 400);
  }
  pendingConfirmations.delete(token);
  if (pending.tool === "connected_accounts_execute") {
    return executeAgentTool("connected_accounts_execute", pending.args, userId, "Connected account action");
  }
  if (isAndroidAgentToolConfirmation(pending)) {
    return executeAgentTool(pending.tool, pending.args, userId, "Android action");
  }
  return executeCoachTool(pending.tool, pending.args, userId);
}

export function registerCoachActionConfirmationRoutes(
  app: Express,
  { pendingConfirmations, executeCoachTool, openai }: CoachActionConfirmationDeps,
): void {
  app.post("/api/coach/ack-voice-approval", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    if (!token) return res.status(400).json({ error: "token is required" });
    ackDaemonVoiceApproval(userId, token);
    return res.json({ ok: true });
  });

  app.post("/api/coach/execute-confirmed", async (req: Request, res: Response) => {
    try {
      const { token } = req.body;
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      if (!token) return res.status(400).json({ error: "token is required" });
      const execResult = await executePendingCoachAction({
        pendingConfirmations,
        executeCoachTool,
        userId,
        token,
      });
      return res.json({ result: execResult.result, label: execResult.label, detail: execResult.detail });
    } catch (error) {
      console.error("Error in execute-confirmed:", error);
      const status = typeof (error as { status?: unknown })?.status === "number"
        ? (error as { status: number }).status
        : 500;
      if (status !== 500) {
        return res.status(status).json({ error: (error as Error).message });
      }
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
      const prompt = `The user has just declined an action you proposed. You were about to ${toolLabel} but they cancelled. Acknowledge briefly and naturally in one sentence — do not re-propose the action. Stay in Jarvis's normal voice.`;
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
