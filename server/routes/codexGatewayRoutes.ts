import type { Express, Request, Response } from "express";

import {
  normalizeCodexDelegationSandbox,
  normalizeCodexDelegationTimeoutMs,
  resolveCodexDelegationCwd,
  runLocalCodexDelegation,
} from "../agent/codexDelegation";
import { runCodexOAuthPrompt } from "../agent/providers/codexOAuth";
import { getCodexOAuthCommand } from "../agent/providers/env";

function getBearerToken(req: Request): string {
  const authHeader = req.headers.authorization;
  return authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
}

function requireCodexGatewayToken(req: Request, res: Response): boolean {
  const expectedToken = process.env.JARVIS_CODEX_GATEWAY_TOKEN?.trim();
  const token = getBearerToken(req);
  if (!expectedToken || token !== expectedToken) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

export function registerCodexGatewayRoutes(app: Express): void {
  app.post("/api/codex/delegate", async (req: Request, res: Response) => {
    try {
      if (!requireCodexGatewayToken(req, res)) return;

      const task = String(req.body?.task ?? "").trim();
      if (!task) return res.status(400).json({ error: "task is required" });

      let cwd: string;
      try {
        cwd = resolveCodexDelegationCwd(req.body?.working_directory);
      } catch (err) {
        return res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      }

      const result = await runLocalCodexDelegation({
        task,
        context: typeof req.body?.context === "string" ? req.body.context : undefined,
        allowExternalSideEffects: req.body?.allow_external_side_effects === true,
        cwd,
        sandbox: normalizeCodexDelegationSandbox(req.body?.sandbox),
        timeoutMs: normalizeCodexDelegationTimeoutMs(req.body?.timeout_seconds),
      });

      return res.json(result);
    } catch (error) {
      console.error("[CodexGateway] delegation failed:", error);
      return res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/api/codex/gateway-health", async (req: Request, res: Response) => {
    if (!requireCodexGatewayToken(req, res)) return;

    res.json({
      ok: true,
      role: "jarvis-codex-oauth-gateway",
      checkedAt: new Date().toISOString(),
      codexCommandConfigured: !!(process.env.JARVIS_CODEX_COMMAND || process.env.CODEX_COMMAND),
      codexCommand: getCodexOAuthCommand(),
      nodeEnv: process.env.NODE_ENV || null,
      host: process.env.HOST || null,
      port: process.env.PORT || "5000",
    });
  });

  app.post("/api/codex/provider-turn", async (req: Request, res: Response) => {
    try {
      if (!requireCodexGatewayToken(req, res)) return;

      const prompt = String(req.body?.prompt ?? "").trim();
      if (!prompt) return res.status(400).json({ error: "prompt is required" });

      const content = await runCodexOAuthPrompt(getCodexOAuthCommand(), prompt);
      return res.json({ content });
    } catch (error) {
      console.error("[CodexGateway] provider turn failed:", error);
      return res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
