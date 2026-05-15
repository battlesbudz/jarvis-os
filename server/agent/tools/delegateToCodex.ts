import type { AgentTool, ToolArgs, ToolContext, ToolResult } from "../types";
import {
  normalizeCodexDelegationSandbox,
  normalizeCodexDelegationTimeoutMs,
  resolveCodexDelegationCwd,
  runCodexDelegation,
} from "../codexDelegation";
import { isIntegrationOwner } from "../../integrationOwner";

export const delegateToCodexTool: AgentTool = {
  name: "delegate_to_codex",
  description:
    "Delegate a scoped task to the local Codex CLI so it can use the host's Codex OAuth login, configured MCP servers, " +
    "and local CLI context. Owner-only. Default is read-only. Use this when Jarvis needs Codex-side tools or plugins " +
    "instead of direct Jarvis tools. Do not use for sending, posting, deleting, deploying, committing, purchasing, " +
    "or other external side effects unless the user explicitly approved that exact action.",
  parameters: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "The exact scoped task for Codex to perform.",
      },
      context: {
        type: "string",
        description: "Extra context Jarvis already knows that Codex should use.",
      },
      sandbox: {
        type: "string",
        enum: ["read-only", "workspace-write"],
        description: "Codex sandbox mode. Use read-only unless the user asked for local file edits.",
      },
      working_directory: {
        type: "string",
        description: "Optional subdirectory under the Jarvis workspace for Codex to use as cwd.",
      },
      timeout_seconds: {
        type: "number",
        description: "Timeout in seconds, clamped to 5-600. Default 300.",
      },
      allow_external_side_effects: {
        type: "boolean",
        description: "Only true after explicit user approval for the exact external action.",
      },
    },
    required: ["task"],
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    if (!await isIntegrationOwner(ctx.userId)) {
      return {
        ok: false,
        content: "Access denied: only the account owner may delegate tasks to the local Codex OAuth bridge.",
        label: "delegate_to_codex: forbidden",
      };
    }

    const task = String(args.task ?? "").trim();
    if (!task) {
      return {
        ok: false,
        content: "task is required.",
        label: "delegate_to_codex: missing task",
      };
    }

    let cwd: string;
    try {
      cwd = resolveCodexDelegationCwd(args.working_directory);
    } catch (err) {
      return {
        ok: false,
        content: err instanceof Error ? err.message : String(err),
        label: "delegate_to_codex: bad cwd",
      };
    }

    const sandbox = normalizeCodexDelegationSandbox(args.sandbox);
    const timeoutMs = normalizeCodexDelegationTimeoutMs(args.timeout_seconds);
    const allowExternalSideEffects = args.allow_external_side_effects === true;

    try {
      const result = await runCodexDelegation({
        task,
        context: typeof args.context === "string" ? args.context : undefined,
        cwd,
        sandbox,
        timeoutMs,
        allowExternalSideEffects,
        signal: ctx.signal,
      });

      return {
        ok: true,
        content: result.content || "(Codex completed without a final message.)",
        label: "Delegated to Codex",
        detail: `cwd: ${result.cwd}; sandbox: ${result.sandbox}; durationMs: ${result.durationMs}`,
        metadata: {
          cwd: result.cwd,
          sandbox: result.sandbox,
          durationMs: result.durationMs,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        content: `Codex delegation failed: ${message}`,
        label: "delegate_to_codex: failed",
        detail: message,
      };
    }
  },
};
