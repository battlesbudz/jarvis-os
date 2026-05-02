import fs from "fs";
import path from "path";
import type { Express, Request } from "express";
import type { IncomingMessage, Server as HttpServer } from "http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import { getUserIdFromRequest } from "../auth";
import { listChannels } from "../channels/registry";
import {
  getDaemonDeviceMeta,
  getDaemonLastSeen,
  getOpAuditLog,
  isAndroidDaemonActive,
  isDesktopDaemonActive,
  listPairedUsers,
} from "../daemon/bridge";
import {
  approveGatewayPairingRequest,
  authenticateGatewayDeviceToken,
  createGatewayPairingRequest,
  hasGatewayScope,
  JWT_GATEWAY_SCOPES,
  listGatewayDevices,
  listGatewayPairingRequests,
  rejectGatewayPairingRequest,
  requireGatewayScope,
  revokeGatewayDevice,
  type GatewayPrincipal,
} from "./devicePairing";
import * as schema from "@shared/schema";

type RpcId = string | number | null;
type RpcParams = Record<string, unknown>;

interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: RpcId;
  method?: string;
  params?: RpcParams;
}

type RpcContext = GatewayPrincipal;

const GATEWAY_WS_PATH = "/api/gateway/ws";
const GATEWAY_CHAT_CHANNEL = "Gateway";
const STARTED_AT = new Date();

interface GatewayCapability {
  area: string;
  status: "foundation" | "mapped" | "partial";
  jarvisSurface: string[];
  openClawSurface: string[];
}

const OPENCLAW_PARITY_CAPABILITIES: GatewayCapability[] = [
  { area: "gateway", status: "foundation", jarvisSurface: ["gateway.health", "gateway.status", "gateway.capabilities"], openClawSurface: ["Gateway health", "Control UI connection", "runtime status"] },
  { area: "chat", status: "foundation", jarvisSurface: ["chat.send", "Gateway coach session"], openClawSurface: ["chat", "talk", "session message"] },
  { area: "sessions", status: "mapped", jarvisSurface: ["sessions.list", "coach_channel_sessions", "agent_chat_sessions"], openClawSurface: ["agents", "sessions", "chat/talk state"] },
  { area: "channels", status: "mapped", jarvisSurface: ["channels.list", "telegram", "whatsapp", "slack", "discord", "in_app", "webchat"], openClawSurface: ["channels", "instances", "linked apps"] },
  { area: "daemon", status: "mapped", jarvisSurface: ["daemon.status", "desktop daemon", "android daemon", "operation audit"], openClawSurface: ["nodes", "device status", "exec approvals"] },
  { area: "devices", status: "foundation", jarvisSurface: ["devices.pairing.request", "devices.pairing.approve", "devices.list", "devices.revoke"], openClawSurface: ["device pairing", "scoped operator tokens", "browser/node trust"] },
  { area: "automation", status: "mapped", jarvisSurface: ["cron.list", "jarvis_scheduled_tasks", "agent_workflows", "agent_jobs"], openClawSurface: ["cron", "dreams", "background jobs"] },
  { area: "approvals", status: "mapped", jarvisSurface: ["approvals.list", "agent_approval_gates", "agent_approval_policies"], openClawSurface: ["approval gates", "exec/tool approvals"] },
  { area: "skills", status: "partial", jarvisSurface: ["skills.list", "skill_packs", "user_skills", "mcp_servers"], openClawSurface: ["skills", "plugins", "MCP"] },
  { area: "config", status: "foundation", jarvisSurface: ["config.get"], openClawSurface: ["runtime config", "secret refs", "model/provider config"] },
  { area: "logs", status: "mapped", jarvisSurface: ["logs.tail", "diagnostic_events", "self_heal_audit_log"], openClawSurface: ["debug", "logs", "health traces"] },
];

function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function limitFrom(params: RpcParams = {}, fallback = 25, max = 100): number {
  const n = Number(params.limit);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : fallback;
}

function ok(id: RpcId | undefined, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function err(id: RpcId | undefined, code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function publicConfigSnapshot() {
  return {
    app: "Jarvis",
    version: readPackageVersion(),
    environment: process.env.NODE_ENV ?? "development",
    startedAt: STARTED_AT.toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    providers: {
      openai: Boolean(process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY),
      anthropic: Boolean(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY),
      google: Boolean(process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_WEB_CLIENT_ID),
      microsoft: Boolean(process.env.MICROSOFT_CLIENT_ID),
      supadata: Boolean(process.env.SUPADATA_API_KEY),
    },
    gateway: {
      wsPath: GATEWAY_WS_PATH,
      auth: "Bearer Jarvis JWT, DASHBOARD_SECRET, or paired gateway device token",
    },
  };
}

function resolveUserId(ctx: RpcContext, params: RpcParams): string | null {
  if (ctx.userId) return ctx.userId;
  if (process.env.JARVIS_TRUST_LOCAL_GATEWAY_RPC !== "true") return null;
  const requested = params.userId;
  return typeof requested === "string" && requested.trim() ? requested.trim() : null;
}

async function gatewayStatus(userId: string | null) {
  const recentDiagnostics = await db
    .select({
      id: schema.diagnosticEvents.id,
      subsystem: schema.diagnosticEvents.subsystem,
      severity: schema.diagnosticEvents.severity,
      message: schema.diagnosticEvents.message,
      createdAt: schema.diagnosticEvents.createdAt,
    })
    .from(schema.diagnosticEvents)
    .orderBy(desc(schema.diagnosticEvents.createdAt))
    .limit(10)
    .catch(() => []);

  return {
    ok: true,
    service: "jarvis-gateway",
    authenticated: Boolean(userId),
    activeDaemonUsers: userId ? listPairedUsers() : [],
    recentDiagnostics,
    capabilities: OPENCLAW_PARITY_CAPABILITIES.map((c) => ({ area: c.area, status: c.status })),
    ...publicConfigSnapshot(),
  };
}

async function channelState(userId: string | null, limit: number) {
  const registered = listChannels().map((channel) => ({
    name: channel.name,
    configured: channel.isConfigured(),
    toolGroups: channel.toolGroups,
  }));
  const linked = userId
    ? await db.select().from(schema.channelLinks).where(eq(schema.channelLinks.userId, userId)).limit(limit).catch(() => [])
    : [];
  return { registered, linked };
}

async function sessionState(userId: string, limit: number) {
  const [coachSessions, agentSessions] = await Promise.all([
    db.select().from(schema.coachChannelSessions).where(eq(schema.coachChannelSessions.userId, userId)).limit(limit).catch(() => []),
    db
      .select({
        sdkSessionId: schema.agentChatSessions.sdkSessionId,
        agentId: schema.agentChatSessions.agentId,
        createdAt: schema.agentChatSessions.createdAt,
        updatedAt: schema.agentChatSessions.updatedAt,
        expiresAt: schema.agentChatSessions.expiresAt,
      })
      .from(schema.agentChatSessions)
      .where(eq(schema.agentChatSessions.userId, userId))
      .orderBy(desc(schema.agentChatSessions.updatedAt))
      .limit(limit)
      .catch(() => []),
  ]);
  return { coachSessions, agentSessions };
}

async function daemonState(userId: string) {
  const [desktopMeta, androidMeta, desktopLastSeenAt, androidLastSeenAt] = await Promise.all([
    getDaemonDeviceMeta(userId, "desktop"),
    getDaemonDeviceMeta(userId, "android"),
    getDaemonLastSeen(userId, "desktop"),
    getDaemonLastSeen(userId, "android"),
  ]);
  return {
    desktop: { connected: isDesktopDaemonActive(userId), lastSeenAt: desktopLastSeenAt, ...desktopMeta },
    android: { connected: isAndroidDaemonActive(userId), lastSeenAt: androidLastSeenAt, ...androidMeta },
    recentOps: getOpAuditLog(userId),
  };
}

async function agentState(userId: string, limit: number) {
  const [discordAgents, customAgents] = await Promise.all([
    db.select().from(schema.discordAgents).where(eq(schema.discordAgents.userId, userId)).limit(limit).catch(() => []),
    db.select().from(schema.customAgents).where(eq(schema.customAgents.userId, userId)).limit(limit).catch(() => []),
  ]);
  return { discordAgents, customAgents };
}

async function cronState(userId: string, limit: number) {
  const [scheduledTasks, workflows, jobs] = await Promise.all([
    db.select().from(schema.jarvisScheduledTasks).where(eq(schema.jarvisScheduledTasks.userId, userId)).orderBy(desc(schema.jarvisScheduledTasks.createdAt)).limit(limit).catch(() => []),
    db.select().from(schema.agentWorkflows).where(eq(schema.agentWorkflows.userId, userId)).orderBy(desc(schema.agentWorkflows.updatedAt)).limit(limit).catch(() => []),
    db.select().from(schema.agentJobs).where(eq(schema.agentJobs.userId, userId)).orderBy(desc(schema.agentJobs.createdAt)).limit(limit).catch(() => []),
  ]);
  return { scheduledTasks, workflows, jobs };
}

async function approvalState(userId: string, limit: number) {
  const [gates, policies] = await Promise.all([
    db.select().from(schema.agentApprovalGates).where(eq(schema.agentApprovalGates.userId, userId)).orderBy(desc(schema.agentApprovalGates.createdAt)).limit(limit).catch(() => []),
    db.select().from(schema.agentApprovalPolicies).where(eq(schema.agentApprovalPolicies.userId, userId)).limit(limit).catch(() => []),
  ]);
  return { gates, policies };
}

async function skillState(userId: string | null, limit: number) {
  const [skillPacks, mcpServers, userSkills] = await Promise.all([
    db.select().from(schema.skillPacks).limit(limit).catch(() => []),
    userId ? db.select().from(schema.mcpServers).where(eq(schema.mcpServers.userId, userId)).limit(limit).catch(() => []) : Promise.resolve([]),
    userId ? db.select().from(schema.userSkills).where(eq(schema.userSkills.userId, userId)).limit(limit).catch(() => []) : Promise.resolve([]),
  ]);
  return { skillPacks, mcpServers, userSkills };
}

async function logState(userId: string | null, limit: number) {
  const [diagnostics, selfHeal] = await Promise.all([
    db.select().from(schema.diagnosticEvents).orderBy(desc(schema.diagnosticEvents.createdAt)).limit(limit).catch(() => []),
    db.select().from(schema.selfHealAuditLog).orderBy(desc(schema.selfHealAuditLog.id)).limit(Math.min(limit, 25)).catch(() => []),
  ]);
  return { userScoped: Boolean(userId), diagnostics, selfHeal };
}

async function chatSend(userId: string, params: RpcParams) {
  const text = typeof params.text === "string" ? params.text.trim() : "";
  if (!text) throw new Error("text is required");

  const requestedSessionId = typeof params.sdkSessionId === "string" && params.sdkSessionId.trim()
    ? params.sdkSessionId.trim()
    : undefined;
  const resetSession = params.resetSession === true;
  const [{ runCoachAgent }, sessionStore] = await Promise.all([
    import("../channels/coachAgent"),
    import("../channels/sessionStore"),
  ]);
  const sdkSessionId = resetSession
    ? undefined
    : requestedSessionId ?? (await sessionStore.getSession(userId, GATEWAY_CHAT_CHANNEL));
  const started = Date.now();
  const result = await runCoachAgent({
    userId,
    userText: text,
    channelName: GATEWAY_CHAT_CHANNEL,
    sdkSessionId,
  });

  if (result.sdkSessionId) {
    sessionStore.setSession(userId, GATEWAY_CHAT_CHANNEL, result.sdkSessionId);
  }

  return {
    channel: GATEWAY_CHAT_CHANNEL,
    reply: result.reply,
    rawReply: result.rawReply,
    attachments: result.attachments,
    sdkSessionId: result.sdkSessionId,
    elapsedMs: Date.now() - started,
  };
}

async function handleRpc(req: JsonRpcRequest, ctx: RpcContext) {
  if (!req || typeof req !== "object") return err(null, -32600, "Invalid JSON-RPC request");
  if (!req.method || typeof req.method !== "string") return err(req.id, -32600, "JSON-RPC method is required");

  const params = req.params ?? {};
  const limit = limitFrom(params);
  const userId = resolveUserId(ctx, params);
  const requireUser = () => {
    if (!userId) throw new Error("A Jarvis bearer token or params.userId is required for this method");
    return userId;
  };

  try {
    switch (req.method) {
      case "gateway.health": return ok(req.id, { ok: true, ...publicConfigSnapshot() });
      case "gateway.status": return ok(req.id, await gatewayStatus(userId));
      case "gateway.capabilities": return ok(req.id, { capabilities: OPENCLAW_PARITY_CAPABILITIES });
      case "config.get": return ok(req.id, publicConfigSnapshot());
      case "chat.send":
        requireGatewayScope(ctx, "operator.write");
        return ok(req.id, await chatSend(requireUser(), params));
      case "channels.list":
        if (userId) requireGatewayScope(ctx, "operator.read");
        return ok(req.id, await channelState(userId, limit));
      case "sessions.list":
        requireGatewayScope(ctx, "operator.read");
        return ok(req.id, await sessionState(requireUser(), limit));
      case "daemon.status":
        requireGatewayScope(ctx, "operator.read");
        return ok(req.id, await daemonState(requireUser()));
      case "agents.list":
        requireGatewayScope(ctx, "operator.read");
        return ok(req.id, await agentState(requireUser(), limit));
      case "cron.list":
        requireGatewayScope(ctx, "operator.read");
        return ok(req.id, await cronState(requireUser(), limit));
      case "approvals.list":
        requireGatewayScope(ctx, "operator.approvals");
        return ok(req.id, await approvalState(requireUser(), limit));
      case "skills.list":
        if (userId) requireGatewayScope(ctx, "operator.read");
        return ok(req.id, await skillState(userId, limit));
      case "logs.tail":
        requireGatewayScope(ctx, "operator.read");
        return ok(req.id, await logState(userId, limit));
      case "devices.whoami":
        return ok(req.id, { userId: ctx.userId, deviceId: ctx.deviceId, scopes: ctx.scopes, authKind: ctx.authKind });
      case "devices.list":
        requireGatewayScope(ctx, "operator.read");
        return ok(req.id, {
          devices: await listGatewayDevices(requireUser(), Boolean(params.includeRevoked), limit),
          pairingRequests: hasGatewayScope(ctx, "operator.pairing")
            ? await listGatewayPairingRequests(requireUser(), limit)
            : [],
        });
      case "devices.pairing.request":
        if (ctx.userId) requireGatewayScope(ctx, "operator.pairing");
        return ok(req.id, await createGatewayPairingRequest({
          userId: requireUser(),
          label: typeof params.label === "string" ? params.label : undefined,
          kind: typeof params.kind === "string" ? params.kind : undefined,
          origin: typeof params.origin === "string" ? params.origin : undefined,
          requestedScopes: params.scopes,
          metadata: typeof params.metadata === "object" && params.metadata ? params.metadata as Record<string, unknown> : {},
        }));
      case "devices.pairing.approve":
        requireGatewayScope(ctx, "operator.pairing");
        return ok(req.id, await approveGatewayPairingRequest({
          userId: requireUser(),
          requestId: typeof params.requestId === "string" ? params.requestId : undefined,
          code: typeof params.code === "string" ? params.code : undefined,
          scopes: params.scopes,
        }));
      case "devices.pairing.reject":
        requireGatewayScope(ctx, "operator.pairing");
        if (typeof params.requestId !== "string") throw new Error("requestId is required");
        return ok(req.id, await rejectGatewayPairingRequest(requireUser(), params.requestId));
      case "devices.revoke":
        requireGatewayScope(ctx, "operator.pairing");
        if (typeof params.deviceId !== "string") throw new Error("deviceId is required");
        return ok(req.id, await revokeGatewayDevice(requireUser(), params.deviceId));
      default: return err(req.id, -32601, `Unknown gateway method: ${req.method}`);
    }
  } catch (error) {
    return err(req.id, -32000, error instanceof Error ? error.message : String(error));
  }
}

function tokenFrom(req: IncomingMessage): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  try {
    return new URL(req.url || "", "http://localhost").searchParams.get("token");
  } catch {
    return null;
  }
}

async function principalFromRequest(req: IncomingMessage): Promise<GatewayPrincipal> {
  const token = tokenFrom(req);
  if (token && process.env.DASHBOARD_SECRET && token === process.env.DASHBOARD_SECRET) {
    const rows = await db.select({ id: schema.users.id }).from(schema.users).limit(1).catch(() => []);
    return { userId: rows[0]?.id ?? null, scopes: JWT_GATEWAY_SCOPES, authKind: "jwt" };
  }
  const jwtUserId = await getUserIdFromRequest(req as unknown as Request);
  if (jwtUserId) return { userId: jwtUserId, scopes: JWT_GATEWAY_SCOPES, authKind: "jwt" };
  const devicePrincipal = await authenticateGatewayDeviceToken(token);
  return devicePrincipal ?? { userId: null, scopes: [], authKind: "anonymous" };
}

function send(ws: WebSocket, payload: unknown) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

async function onMessage(ws: WebSocket, raw: RawData, ctx: RpcContext) {
  let parsed: JsonRpcRequest | JsonRpcRequest[];
  try {
    parsed = JSON.parse(raw.toString()) as JsonRpcRequest | JsonRpcRequest[];
  } catch {
    send(ws, err(null, -32700, "Invalid JSON"));
    return;
  }
  const response = Array.isArray(parsed)
    ? await Promise.all(parsed.map((item) => handleRpc(item, ctx)))
    : await handleRpc(parsed, ctx);
  send(ws, response);
}

export function registerGatewayControlPlane(app: Express, server: HttpServer): void {
  app.get("/api/gateway/health", (_req, res) => res.json({ ok: true, ...publicConfigSnapshot() }));
  app.get("/api/gateway/capabilities", (_req, res) => res.json({ capabilities: OPENCLAW_PARITY_CAPABILITIES }));
  app.post("/api/gateway/rpc", async (req, res) => {
    const ctx = await principalFromRequest(req);
    const payload = req.body as JsonRpcRequest | JsonRpcRequest[];
    res.json(Array.isArray(payload) ? await Promise.all(payload.map((item) => handleRpc(item, ctx))) : await handleRpc(payload, ctx));
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    if ((req.url || "").split("?")[0] !== GATEWAY_WS_PATH) return;
    wss.handleUpgrade(req, socket, head, async (ws) => {
      const ctx = await principalFromRequest(req);
      send(ws, {
        type: "hello",
        service: "jarvis-gateway",
        protocol: "json-rpc-2.0",
        authenticated: Boolean(ctx.userId),
        authKind: ctx.authKind,
        deviceId: ctx.deviceId,
        scopes: ctx.scopes,
        methods: OPENCLAW_PARITY_CAPABILITIES.flatMap((c) => c.jarvisSurface),
      });
      ws.on("message", (raw) => onMessage(ws, raw, ctx).catch((error) => {
        send(ws, err(null, -32000, error instanceof Error ? error.message : String(error)));
      }));
      ws.on("error", () => {});
    });
  });

  console.log(`[Gateway] Control plane registered at ${GATEWAY_WS_PATH}`);
}
