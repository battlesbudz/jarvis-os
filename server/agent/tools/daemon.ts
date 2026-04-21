import type { AgentTool, ToolContext, ToolArgs, ToolResult } from "../types";
import { sendDaemonOp, isUserPaired, isDaemonActionAllowed, type DaemonAction, type DaemonOp } from "../../daemon/bridge";

const ALLOWED_ACTIONS: readonly DaemonAction[] = ["shell", "notify", "file_read", "file_write", "file_list"] as const;

function isDaemonAction(value: string): value is DaemonAction {
  return (ALLOWED_ACTIONS as readonly string[]).includes(value);
}

export const daemonActionTool: AgentTool = {
  name: "daemon_action",
  description: "Execute a sandboxed action on the user's paired desktop daemon. Available actions: shell (run a whitelisted shell command in the workspace root), notify (send a desktop notification), file_read (read a text file under the workspace root), file_write (write a text file under the workspace root), file_list (list files in a directory under the workspace root). Returns the daemon's response or an error if not paired. Always confirm with the user before destructive shell or file_write actions.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["shell", "notify", "file_read", "file_write", "file_list"] },
      cmd: { type: "string", description: "Shell command (when action is 'shell')" },
      cwd: { type: "string", description: "Optional working directory relative to workspace root" },
      title: { type: "string", description: "Notification title (when action is 'notify')" },
      body: { type: "string", description: "Notification body (when action is 'notify')" },
      path: { type: "string", description: "File or directory path relative to workspace root" },
      content: { type: "string", description: "Text content (when action is 'file_write')" },
      timeoutMs: { type: "number", description: "Optional shell timeout in ms (default 15000)" },
    },
    required: ["action"],
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    if (!isUserPaired(ctx.userId)) {
      return { ok: false, content: JSON.stringify({ ok: false, error: "No desktop daemon paired. Ask the user to install the GamePlan daemon and pair it from Profile → Connected Channels → Desktop Daemon." }) };
    }
    const rawAction = String(args.action || "");
    if (!isDaemonAction(rawAction)) {
      return { ok: false, content: JSON.stringify({ ok: false, error: `unknown action ${rawAction}` }) };
    }
    const action: DaemonAction = rawAction;
    if (!(await isDaemonActionAllowed(ctx.userId, action))) {
      return { ok: false, content: JSON.stringify({ ok: false, error: `Action '${action}' is not permitted on this user's daemon. Ask the user to enable it in Profile → Connected Channels → Desktop Daemon → Permissions.` }) };
    }
    let op: DaemonOp;
    if (action === "shell") {
      if (!args.cmd) return { ok: false, content: JSON.stringify({ ok: false, error: "cmd required" }) };
      op = { type: "shell", cmd: String(args.cmd), cwd: args.cwd ? String(args.cwd) : undefined, timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined };
    } else if (action === "notify") {
      op = { type: "notify", title: String(args.title || "GamePlan"), body: String(args.body || "") };
    } else if (action === "file_read") {
      if (!args.path) return { ok: false, content: JSON.stringify({ ok: false, error: "path required" }) };
      op = { type: "file_read", path: String(args.path) };
    } else if (action === "file_write") {
      if (!args.path || typeof args.content !== "string") return { ok: false, content: JSON.stringify({ ok: false, error: "path and content required" }) };
      op = { type: "file_write", path: String(args.path), content: String(args.content) };
    } else if (action === "file_list") {
      if (!args.path) return { ok: false, content: JSON.stringify({ ok: false, error: "path required" }) };
      op = { type: "file_list", path: String(args.path) };
    } else {
      return { ok: false, content: JSON.stringify({ ok: false, error: `unknown action ${action}` }) };
    }
    const result = await sendDaemonOp(ctx.userId, op, action === "shell" ? 30000 : 10000);
    return { ok: !!result.ok, content: JSON.stringify(result).slice(0, 8000) };
  },
};
