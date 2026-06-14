import type { Express, Request, Response } from "express";

type Middleware = (req: Request, res: Response, next: (err?: unknown) => void) => unknown;

const paramValue = (value: string | string[]): string => Array.isArray(value) ? (value[0] ?? "") : value;
const envVarNamePattern = /^[A-Z_][A-Z0-9_]{0,127}$/;

export function registerMcpRoutes(app: Express, authMiddleware: Middleware): void {
  app.get("/api/mcp-servers/prompts", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { mcpServerRegistry } = await import("../agent/mcp/mcpServerRegistry");
      const prompts = await mcpServerRegistry.listPromptsForUser(userId);
      res.json({
        prompts: prompts.map((entry) => ({
          serverName: entry.serverName,
          serverId: entry.serverId,
          name: entry.prompt.name,
          description: entry.prompt.description,
          arguments: entry.prompt.arguments ?? [],
        })),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  app.post("/api/mcp-servers/prompts/resolve", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const { serverId, name, args } = req.body as { serverId: string; name: string; args?: Record<string, string> };
    if (!serverId || !name) return res.status(400).json({ error: "serverId and name are required" });
    try {
      const { mcpServerRegistry } = await import("../agent/mcp/mcpServerRegistry");
      const client = mcpServerRegistry.getClientForUser(userId, serverId);
      if (!client) return res.status(404).json({ error: "MCP server not found or not accessible" });
      const result = await client.getPrompt(name, args);
      const resolvedText = result.messages
        .map((message) => (typeof message.content === "object" && "text" in message.content ? message.content.text ?? "" : ""))
        .filter(Boolean)
        .join("\n\n");
      res.json({ resolvedText: resolvedText || name, description: result.description });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  app.get("/api/settings/env-var-check", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const key = typeof req.query.key === "string" ? req.query.key.trim() : "";
    if (!key) return res.status(400).json({ error: "key query param is required" });
    if (!envVarNamePattern.test(key)) {
      return res.status(400).json({ error: "key must be a valid env var name (uppercase letters, digits, underscores; max 128 chars)" });
    }
    const { envVarPresent } = await import("../lib/credentialResolver");
    res.json({ present: envVarPresent(key) });
  });

  app.get("/api/mcp-servers", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { mcpServerRegistry } = await import("../agent/mcp/mcpServerRegistry");
      const statuses = mcpServerRegistry.getStatusForUser(userId);
      res.json({
        servers: statuses.map((s) => ({
          id: s.server.id,
          name: s.server.name,
          transport: s.server.transport,
          command: s.server.command,
          url: s.server.url,
          enabled: s.server.enabled,
          isBuiltIn: s.server.isBuiltIn,
          connected: s.connected,
          toolCount: s.toolCount,
          error: s.error,
          isSystem: s.server.userId === null,
          credentialMode: s.server.credentialMode ?? "direct",
          envKey: s.server.envKey ?? null,
        })),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  app.post("/api/mcp-servers", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const { name, transport, command, url, authToken, credentialMode, envKey } = req.body as {
      name?: string;
      transport?: string;
      command?: string;
      url?: string;
      authToken?: string;
      credentialMode?: string;
      envKey?: string;
    };
    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "name is required" });
    }
    const transport2 = transport === "http" ? "http" : "stdio";
    if (transport2 === "stdio" && !command) {
      return res.status(400).json({ error: "command is required for stdio transport" });
    }
    if (transport2 === "http" && !url) {
      return res.status(400).json({ error: "url is required for http transport" });
    }
    const mode = credentialMode === "env-ref" ? "env-ref" : "direct";
    if (transport2 === "http" && mode === "env-ref") {
      const key = envKey?.trim() ?? "";
      if (!key) {
        return res.status(400).json({ error: "envKey is required when credentialMode is env-ref" });
      }
      if (!envVarNamePattern.test(key)) {
        return res.status(400).json({ error: "envKey must be a valid env var name (uppercase letters, digits, underscores; max 128 chars)" });
      }
    }
    try {
      const { mcpServerRegistry } = await import("../agent/mcp/mcpServerRegistry");
      const row = await mcpServerRegistry.addServer({
        userId,
        name: name.trim().slice(0, 80),
        transport: transport2,
        command: command ?? null,
        url: url ?? null,
        authToken: mode === "direct" ? (authToken ?? null) : null,
        credentialMode: mode,
        envKey: mode === "env-ref" ? (envKey?.trim() ?? null) : null,
        enabled: true,
        isBuiltIn: false,
      });
      res.status(201).json({ ok: true, id: row.id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[MCP API] addServer failed:", msg);
      res.status(500).json({ error: msg });
    }
  });

  app.delete("/api/mcp-servers/:id", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const id = paramValue(req.params.id);
    try {
      const { mcpServerRegistry } = await import("../agent/mcp/mcpServerRegistry");
      const deleted = await mcpServerRegistry.deleteServer(id, userId);
      if (!deleted) return res.status(404).json({ error: "Server not found or not owned by you" });
      res.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  app.patch("/api/mcp-servers/:id/enabled", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const id = paramValue(req.params.id);
    const { enabled } = req.body as { enabled?: boolean };
    if (typeof enabled !== "boolean") {
      return res.status(400).json({ error: "enabled must be a boolean" });
    }
    try {
      const { mcpServerRegistry } = await import("../agent/mcp/mcpServerRegistry");
      await mcpServerRegistry.setEnabled(id, enabled);
      res.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  app.get("/api/mcp-key", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId as string;
    try {
      const { getMcpKeyInfo } = await import("../agent/mcp/mcpApiKeys");
      const info = await getMcpKeyInfo(userId);
      if (!info) return res.json({ hasKey: false });
      res.json({ hasKey: true, prefix: info.prefix, createdAt: info.createdAt, lastUsedAt: info.lastUsedAt });
    } catch (err) {
      res.status(500).json({ error: "Failed to get key info" });
    }
  });

  app.post("/api/mcp-key/generate", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId as string;
    try {
      const { generateMcpApiKey } = await import("../agent/mcp/mcpApiKeys");
      const { rawKey, prefix } = await generateMcpApiKey(userId);
      res.json({ rawKey, prefix });
    } catch (err) {
      res.status(500).json({ error: "Failed to generate key" });
    }
  });

  app.delete("/api/mcp-key", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId as string;
    try {
      const { revokeMcpApiKeys } = await import("../agent/mcp/mcpApiKeys");
      await revokeMcpApiKeys(userId);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to revoke keys" });
    }
  });

  app.post("/api/mcp", async (req: Request, res: Response) => {
    const { handleMcpRequest } = await import("../agent/mcp/mcpServerHandler");
    await handleMcpRequest(req, res);
  });
}
