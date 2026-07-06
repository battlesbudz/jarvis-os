import fs from "fs";
import path from "path";
import type { Express, Request } from "express";
import type { IncomingMessage, Server as HttpServer } from "http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { and, desc, eq } from "drizzle-orm";
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
import { listGatewayEvents, onGatewayEvent, recordGatewayEvent } from "./eventBus";
import { listGatewayNodes, routeCapability } from "./nodeRegistry";
import * as schema from "@shared/schema";
import { cancellationStatusForAgentJobStatus } from "../agent/voiceRuntimeResourceCore";

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

interface RpcEvents {
  emit?: (method: string, params: Record<string, unknown>) => void;
}

interface GatewayCapability {
  area: string;
  status: "foundation" | "mapped" | "partial";
  jarvisSurface: string[];
  runtimeSurface: string[];
}

const JARVIS_RUNTIME_CAPABILITIES: GatewayCapability[] = [
  { area: "gateway", status: "foundation", jarvisSurface: ["gateway.health", "gateway.status", "gateway.capabilities"], runtimeSurface: ["Gateway health", "Control UI connection", "runtime status"] },
  { area: "actions", status: "foundation", jarvisSurface: ["actions.invoke", "capability router dispatch"], runtimeSurface: ["actions.invoke", "node action execution", "routed tool calls"] },
  { area: "events", status: "foundation", jarvisSurface: ["events.list", "gateway.event"], runtimeSurface: ["event bus", "activity timeline", "live control stream"] },
  { area: "nodes", status: "foundation", jarvisSurface: ["nodes.list", "capabilities.route"], runtimeSurface: ["nodes", "capability registry", "capability router"] },
  { area: "chat", status: "foundation", jarvisSurface: ["chat.send", "Gateway coach session"], runtimeSurface: ["chat", "talk", "session message"] },
  { area: "sessions", status: "mapped", jarvisSurface: ["sessions.list", "coach_channel_sessions", "agent_chat_sessions"], runtimeSurface: ["agents", "sessions", "chat/talk state"] },
  { area: "channels", status: "mapped", jarvisSurface: ["channels.list", "telegram", "whatsapp", "slack", "discord", "in_app", "webchat"], runtimeSurface: ["channels", "instances", "linked apps"] },
  { area: "daemon", status: "mapped", jarvisSurface: ["daemon.status", "desktop daemon", "android daemon", "operation audit"], runtimeSurface: ["nodes", "device status", "exec approvals"] },
  { area: "devices", status: "foundation", jarvisSurface: ["devices.pairing.request", "devices.pairing.approve", "devices.list", "devices.revoke", "daemon.ping", "daemon.notify", "daemon.test"], runtimeSurface: ["device pairing", "scoped operator tokens", "browser/node trust"] },
  { area: "automation", status: "mapped", jarvisSurface: ["cron.list", "cron.create", "jobs.create", "jobs.cancel", "jarvis_scheduled_tasks", "agent_workflows", "agent_jobs"], runtimeSurface: ["cron", "background work", "scheduled jobs"] },
  { area: "approvals", status: "mapped", jarvisSurface: ["approvals.list", "approvals.approve", "approvals.reject", "agent_approval_gates", "agent_approval_policies"], runtimeSurface: ["approval gates", "exec/tool approvals"] },
  { area: "skills", status: "partial", jarvisSurface: ["skills.list", "skill_packs", "user_skills", "mcp_servers"], runtimeSurface: ["skills", "plugins", "MCP"] },
  { area: "config", status: "foundation", jarvisSurface: ["config.get"], runtimeSurface: ["runtime config", "secret refs", "model/provider config"] },
  { area: "logs", status: "mapped", jarvisSurface: ["logs.tail", "diagnostic_events", "self_heal_audit_log"], runtimeSurface: ["debug", "logs", "health traces"] },
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
      codexOAuth: process.env.JARVIS_CODEX_OAUTH_ENABLED !== "false" && process.env.JARVIS_CODEX_OAUTH_ENABLED !== "0",
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
    capabilities: JARVIS_RUNTIME_CAPABILITIES.map((c) => ({ area: c.area, status: c.status })),
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

async function cronCreate(userId: string, params: RpcParams) {
  const title = typeof params.title === "string" ? params.title.trim() : "";
  const whenExpr = typeof params.when === "string" ? params.when.trim() : "";
  if (!title) throw new Error("title is required");
  if (!whenExpr) throw new Error("when is required");

  const [{ parseNaturalTime, parseRecurringExpr }] = await Promise.all([
    import("../agent/tools/cronTools"),
  ]);
  const recurring = parseRecurringExpr(whenExpr);
  const scheduledAt = recurring?.scheduledAt ?? parseNaturalTime(whenExpr);
  if (!scheduledAt) throw new Error(`Could not parse time expression: ${whenExpr}`);

  const recurrence = typeof params.recurrence === "string" && params.recurrence.trim()
    ? params.recurrence.trim()
    : recurring?.recurrence ?? null;
  const description = typeof params.description === "string" && params.description.trim()
    ? params.description.trim()
    : null;
  const shellCommand = typeof params.shellCommand === "string" && params.shellCommand.trim()
    ? params.shellCommand.trim()
    : null;

  const [task] = await db.insert(schema.jarvisScheduledTasks).values({
    userId,
    title,
    description,
    scheduledAt,
    recurrence,
    shellCommand,
    taskKind: "jarvis_action",
  }).returning();
  recordGatewayEvent({
    userId,
    type: "cron.created",
    area: "automation",
    title: `Scheduled ${title}`,
    message: scheduledAt.toISOString(),
    subjectType: "scheduled_task",
    subjectId: task?.id ?? null,
    metadata: { recurrence, shellCommand: Boolean(shellCommand) },
  }).catch(() => {});
  return { ok: true, task };
}

async function jobCreate(userId: string, params: RpcParams) {
  const title = typeof params.title === "string" ? params.title.trim() : "";
  const prompt = typeof params.prompt === "string" ? params.prompt.trim() : "";
  const agentType = typeof params.agentType === "string" && params.agentType.trim()
    ? params.agentType.trim()
    : "general";
  if (!title) throw new Error("title is required");
  if (!prompt) throw new Error("prompt is required");

  const { submitAgentJob } = await import("../agent/jobClient");
  const input = typeof params.input === "object" && params.input
    ? params.input as Record<string, unknown>
    : {};
  const result = await submitAgentJob({
    userId,
    agentType: agentType as any,
    title,
    prompt,
    input: { ...input, source: "gateway" },
  });
  recordGatewayEvent({
    userId,
    type: result.isDuplicate ? "job.duplicate" : "job.queued",
    area: "automation",
    title: result.isDuplicate ? `Existing job reused: ${title}` : `Queued job: ${title}`,
    subjectType: "job",
    subjectId: result.id,
    metadata: { agentType },
  }).catch(() => {});
  return { ok: true, ...result };
}

async function jobCancel(userId: string, params: RpcParams) {
  const jobId = typeof params.jobId === "string" ? params.jobId.trim() : "";
  if (!jobId) throw new Error("jobId is required");
  const [row] = await db.select({ status: schema.agentJobs.status })
    .from(schema.agentJobs)
    .where(and(eq(schema.agentJobs.id, jobId), eq(schema.agentJobs.userId, userId)))
    .limit(1);
  if (!row) throw new Error("Job not found");
  const nextStatus = cancellationStatusForAgentJobStatus(row.status);
  if (!nextStatus) throw new Error(`Job is already ${row.status}`);
  const [updated] = await db.update(schema.agentJobs)
    .set({ status: nextStatus, ...(nextStatus === "cancelled" ? { completedAt: new Date() } : {}) })
    .where(and(eq(schema.agentJobs.id, jobId), eq(schema.agentJobs.userId, userId)))
    .returning({ id: schema.agentJobs.id, status: schema.agentJobs.status });
  recordGatewayEvent({
    userId,
    type: "job.cancelled",
    area: "automation",
    title: `Job ${nextStatus}`,
    subjectType: "job",
    subjectId: jobId,
    metadata: { status: nextStatus },
  }).catch(() => {});
  return { ok: Boolean(updated), job: updated };
}

async function daemonPing(userId: string, params: RpcParams) {
  const timeoutMs = Number.isFinite(Number(params.timeoutMs)) ? Number(params.timeoutMs) : 5000;
  const { pingDaemon } = await import("../daemon/bridge");
  const result = await pingDaemon(userId, timeoutMs);
  recordGatewayEvent({
    userId,
    type: result.ok ? "daemon.ping.ok" : "daemon.ping.failed",
    area: "daemon",
    severity: result.ok ? "info" : "warning",
    title: result.ok ? "Daemon ping succeeded" : "Daemon ping failed",
    message: result.error ?? null,
    metadata: { timeoutMs },
  }).catch(() => {});
  return result;
}

async function daemonNotify(userId: string, params: RpcParams) {
  const title = typeof params.title === "string" && params.title.trim() ? params.title.trim() : "Jarvis";
  const body = typeof params.body === "string" && params.body.trim() ? params.body.trim() : "Gateway test notification";
  const { sendDaemonOp } = await import("../daemon/bridge");
  const result = await sendDaemonOp(userId, { type: "notify", title, body }, 7000);
  recordGatewayEvent({
    userId,
    type: result.ok ? "daemon.notify.sent" : "daemon.notify.failed",
    area: "daemon",
    severity: result.ok ? "info" : "warning",
    title: result.ok ? "Daemon notification sent" : "Daemon notification failed",
    message: result.error ?? body,
  }).catch(() => {});
  return result;
}

async function daemonTest(userId: string, params: RpcParams) {
  const action = typeof params.action === "string" ? params.action.trim() : "ping";
  const { sendDaemonOp } = await import("../daemon/bridge");
  if (action === "notify") return daemonNotify(userId, params);
  if (action === "ping") return daemonPing(userId, params);

  let result: { ok: boolean; data?: unknown; error?: string };
  if (action === "desktop_screenshot") result = await sendDaemonOp(userId, { type: "desktop_screenshot" }, 10000);
  else if (action === "desktop_read_screen") result = await sendDaemonOp(userId, { type: "desktop_read_screen" }, 10000);
  else if (action === "android_read_screen") result = await sendDaemonOp(userId, { type: "android_read_screen" }, 10000);
  else if (action === "android_screenshot") result = await sendDaemonOp(userId, { type: "android_screenshot" }, 10000);
  else result = await daemonPing(userId, params);

  recordGatewayEvent({
    userId,
    type: result.ok ? "daemon.test.ok" : "daemon.test.failed",
    area: "daemon",
    severity: result.ok ? "info" : "warning",
    title: result.ok ? `Daemon test succeeded: ${action}` : `Daemon test failed: ${action}`,
    message: result.error ?? null,
    metadata: { action },
  }).catch(() => {});
  return result;
}

async function approvalState(userId: string, limit: number) {
  const [gates, policies] = await Promise.all([
    db.select().from(schema.agentApprovalGates).where(eq(schema.agentApprovalGates.userId, userId)).orderBy(desc(schema.agentApprovalGates.createdAt)).limit(limit).catch(() => []),
    db.select().from(schema.agentApprovalPolicies).where(eq(schema.agentApprovalPolicies.userId, userId)).limit(limit).catch(() => []),
  ]);
  return { gates, policies };
}

async function resolveApprovalGate(userId: string, params: RpcParams, decision: "approve" | "reject") {
  const gateId = typeof params.gateId === "string" ? params.gateId.trim() : "";
  if (!gateId) throw new Error("gateId is required");

  const { approveGate, getGate, rejectGate } = await import("../agent/agentApproval");
  const gate = await getGate(gateId);
  if (!gate) throw new Error("Gate not found");
  if (gate.userId !== userId) throw new Error("Forbidden: this approval gate belongs to another user");
  if (gate.status !== "pending") throw new Error("Gate already resolved");

  const ok = decision === "approve"
    ? await approveGate(gateId, userId)
    : await rejectGate(gateId, userId);
  if (!ok) throw new Error(`Failed to ${decision} gate`);
  recordGatewayEvent({
    userId,
    type: decision === "approve" ? "approval.approved" : "approval.rejected",
    area: "approvals",
    title: decision === "approve" ? "Approval gate approved" : "Approval gate rejected",
    subjectType: "approval_gate",
    subjectId: gateId,
    metadata: { toolName: gate.toolName },
  }).catch(() => {});
  return { ok: true, gateId, status: decision === "approve" ? "approved" : "rejected" };
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

async function eventState(userId: string | null, limit: number) {
  return { events: await listGatewayEvents(userId, limit) };
}

async function nodeState(userId: string | null, limit: number) {
  return { nodes: await listGatewayNodes(userId, limit) };
}

async function capabilityRouteState(userId: string | null, params: RpcParams, limit: number) {
  const capability = typeof params.capability === "string" ? params.capability.trim() : "";
  if (!capability) throw new Error("capability is required");
  const nodes = await listGatewayNodes(userId, limit);
  const route = routeCapability(capability, nodes);
  recordGatewayEvent({
    userId,
    type: route.routed ? "capability.routed" : "capability.unrouted",
    area: "nodes",
    severity: route.routed ? "info" : "warning",
    title: route.routed ? `Capability routed: ${capability}` : `No route for capability: ${capability}`,
    message: route.reason,
    subjectType: route.node?.kind ?? "capability",
    subjectId: route.node?.nodeId ?? capability,
    metadata: { capability, nodeId: route.node?.nodeId ?? null },
  }).catch(() => {});
  return route;
}

function inputFrom(params: RpcParams): RpcParams {
  return typeof params.input === "object" && params.input && !Array.isArray(params.input)
    ? params.input as RpcParams
    : {};
}

function daemonActionForCapability(capability: string): string | null {
  const direct = capability.startsWith("desktop.")
    ? capability.slice("desktop.".length)
    : capability.startsWith("android.")
      ? capability.slice("android.".length)
      : capability;
  const aliases: Record<string, string> = {
    "desktop.notify": "notify",
    "android.notify": "notify",
    "desktop.desktop_screenshot": "desktop_screenshot",
    "desktop.desktop_read_screen": "desktop_read_screen",
    "desktop.file_read": "file_read",
    "desktop.file_list": "file_list",
    "android.android_screenshot": "android_screenshot",
    "android.android_read_screen": "android_read_screen",
    "android.android_file_read": "android_file_read",
    "android.android_file_list": "android_file_list",
    "daemon.notify": "notify",
    "daemon.ping": "ping",
  };
  return aliases[capability] ?? aliases[direct] ?? direct;
}

async function daemonCapabilityInvoke(userId: string, capability: string, input: RpcParams) {
  const action = daemonActionForCapability(capability);
  if (!action) throw new Error(`No daemon action registered for ${capability}`);
  if (action === "notify") return daemonNotify(userId, input);
  if (action === "ping") return daemonPing(userId, input);
  const { sendDaemonOp } = await import("../daemon/bridge");

  if (action === "file_read" || action === "file_list" || action === "android_file_read" || action === "android_file_list") {
    const path = typeof input.path === "string" ? input.path.trim() : "";
    if (!path) throw new Error("path is required");
    return sendDaemonOp(userId, { type: action, path } as any, action.endsWith("read") ? 10000 : 8000);
  }
  if (action === "desktop_screenshot") return sendDaemonOp(userId, { type: "desktop_screenshot" }, 20000);
  if (action === "desktop_read_screen") return sendDaemonOp(userId, { type: "desktop_read_screen" }, 40000);
  if (action === "android_screenshot") return sendDaemonOp(userId, { type: "android_screenshot" }, 20000);
  if (action === "android_read_screen") return sendDaemonOp(userId, { type: "android_read_screen" }, 20000);

  return daemonTest(userId, { ...input, action });
}

async function actionInvoke(userId: string, params: RpcParams, events: RpcEvents, limit: number) {
  const capability = typeof params.capability === "string" ? params.capability.trim() : "";
  if (!capability) throw new Error("capability is required");
  const input = inputFrom(params);
  await recordGatewayEvent({
    userId,
    type: "action.requested",
    area: "actions",
    title: `Action requested: ${capability}`,
    subjectType: "capability",
    subjectId: capability,
    metadata: { capability },
  }).catch(() => {});

  const nodes = await listGatewayNodes(userId, limit);
  const route = routeCapability(capability, nodes);
  if (!route.routed) {
    await recordGatewayEvent({
      userId,
      type: "action.failed",
      area: "actions",
      severity: "warning",
      title: `Action not routed: ${capability}`,
      message: route.reason,
      subjectType: route.node?.kind ?? "capability",
      subjectId: route.node?.nodeId ?? capability,
      metadata: { capability, nodeId: route.node?.nodeId ?? null },
    }).catch(() => {});
    return { ok: false, capability, route, error: route.reason };
  }

  try {
    let result: unknown;
    switch (capability) {
      case "chat.send":
        result = await chatSend(userId, input, events);
        break;
      case "daemon.ping":
        result = await daemonPing(userId, input);
        break;
      case "daemon.notify":
        result = await daemonNotify(userId, input);
        break;
      case "daemon.test":
        result = await daemonTest(userId, input);
        break;
      case "jobs.create":
        result = await jobCreate(userId, input);
        break;
      case "jobs.cancel":
        result = await jobCancel(userId, input);
        break;
      case "cron.create":
        result = await cronCreate(userId, input);
        break;
      case "approvals.approve":
        result = await resolveApprovalGate(userId, input, "approve");
        break;
      case "approvals.reject":
        result = await resolveApprovalGate(userId, input, "reject");
        break;
      default:
        if (capability.startsWith("desktop.") || capability.startsWith("android.")) {
          result = await daemonCapabilityInvoke(userId, capability, input);
        } else {
          throw new Error(`No invoker registered for ${capability}`);
        }
    }

    await recordGatewayEvent({
      userId,
      type: "action.completed",
      area: "actions",
      title: `Action completed: ${capability}`,
      subjectType: route.node?.kind ?? "capability",
      subjectId: route.node?.nodeId ?? capability,
      metadata: { capability, nodeId: route.node?.nodeId ?? null },
    }).catch(() => {});
    return { ok: true, capability, route, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordGatewayEvent({
      userId,
      type: "action.failed",
      area: "actions",
      severity: "warning",
      title: `Action failed: ${capability}`,
      message,
      subjectType: route.node?.kind ?? "capability",
      subjectId: route.node?.nodeId ?? capability,
      metadata: { capability, nodeId: route.node?.nodeId ?? null },
    }).catch(() => {});
    return { ok: false, capability, route, error: message };
  }
}

async function chatSend(userId: string, params: RpcParams, events: RpcEvents = {}) {
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
  const streamCallbacks = events.emit
    ? {
        onToken: (chunk: string) => events.emit?.("chat.token", { content: chunk }),
        onProgressMessage: (message: string) => events.emit?.("chat.progress", { message }),
      }
    : {};
  const result = await runCoachAgent({
    userId,
    userText: text,
    channelName: GATEWAY_CHAT_CHANNEL,
    sdkSessionId,
    ...streamCallbacks,
  });

  if (result.sdkSessionId) {
    sessionStore.setSession(userId, GATEWAY_CHAT_CHANNEL, result.sdkSessionId);
  }

  recordGatewayEvent({
    userId,
    type: "chat.completed",
    area: "chat",
    title: "Gateway chat reply completed",
    subjectType: "session",
    subjectId: result.sdkSessionId ?? null,
    metadata: { elapsedMs: Date.now() - started, hasAttachments: result.attachments.length > 0 },
  }).catch(() => {});

  return {
    channel: GATEWAY_CHAT_CHANNEL,
    reply: result.reply,
    rawReply: result.rawReply,
    attachments: result.attachments,
    sdkSessionId: result.sdkSessionId,
    elapsedMs: Date.now() - started,
  };
}

async function handleRpc(req: JsonRpcRequest, ctx: RpcContext, events: RpcEvents = {}) {
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
      case "gateway.capabilities": return ok(req.id, { capabilities: JARVIS_RUNTIME_CAPABILITIES });
      case "config.get": return ok(req.id, publicConfigSnapshot());
      case "events.list":
        if (userId) requireGatewayScope(ctx, "operator.read");
        return ok(req.id, await eventState(userId, limit));
      case "nodes.list":
        if (userId) requireGatewayScope(ctx, "operator.read");
        return ok(req.id, await nodeState(userId, limit));
      case "capabilities.route":
        if (userId) requireGatewayScope(ctx, "operator.read");
        return ok(req.id, await capabilityRouteState(userId, params, limit));
      case "actions.invoke":
        requireGatewayScope(ctx, "operator.write");
        return ok(req.id, await actionInvoke(requireUser(), params, events, limit));
      case "chat.send":
        requireGatewayScope(ctx, "operator.write");
        return ok(req.id, await chatSend(requireUser(), params, events));
      case "channels.list":
        if (userId) requireGatewayScope(ctx, "operator.read");
        return ok(req.id, await channelState(userId, limit));
      case "sessions.list":
        requireGatewayScope(ctx, "operator.read");
        return ok(req.id, await sessionState(requireUser(), limit));
      case "daemon.status":
        requireGatewayScope(ctx, "operator.read");
        return ok(req.id, await daemonState(requireUser()));
      case "daemon.ping":
        requireGatewayScope(ctx, "operator.write");
        return ok(req.id, await daemonPing(requireUser(), params));
      case "daemon.notify":
        requireGatewayScope(ctx, "operator.write");
        return ok(req.id, await daemonNotify(requireUser(), params));
      case "daemon.test":
        requireGatewayScope(ctx, "operator.write");
        return ok(req.id, await daemonTest(requireUser(), params));
      case "agents.list":
        requireGatewayScope(ctx, "operator.read");
        return ok(req.id, await agentState(requireUser(), limit));
      case "cron.list":
        requireGatewayScope(ctx, "operator.read");
        return ok(req.id, await cronState(requireUser(), limit));
      case "cron.create":
        requireGatewayScope(ctx, "operator.write");
        return ok(req.id, await cronCreate(requireUser(), params));
      case "jobs.create":
        requireGatewayScope(ctx, "operator.write");
        return ok(req.id, await jobCreate(requireUser(), params));
      case "jobs.cancel":
        requireGatewayScope(ctx, "operator.write");
        return ok(req.id, await jobCancel(requireUser(), params));
      case "approvals.list":
        requireGatewayScope(ctx, "operator.approvals");
        return ok(req.id, await approvalState(requireUser(), limit));
      case "approvals.approve":
        requireGatewayScope(ctx, "operator.approvals");
        return ok(req.id, await resolveApprovalGate(requireUser(), params, "approve"));
      case "approvals.reject":
        requireGatewayScope(ctx, "operator.approvals");
        return ok(req.id, await resolveApprovalGate(requireUser(), params, "reject"));
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
        {
          const result = await createGatewayPairingRequest({
            userId: requireUser(),
            label: typeof params.label === "string" ? params.label : undefined,
            kind: typeof params.kind === "string" ? params.kind : undefined,
            origin: typeof params.origin === "string" ? params.origin : undefined,
            requestedScopes: params.scopes,
            metadata: typeof params.metadata === "object" && params.metadata ? params.metadata as Record<string, unknown> : {},
          });
          recordGatewayEvent({
            userId: requireUser(),
            type: "device.pairing.requested",
            area: "devices",
            title: `Pairing requested: ${result.label}`,
            subjectType: "gateway_pairing_request",
            subjectId: result.id,
            metadata: { kind: result.kind, code: result.code },
          }).catch(() => {});
          return ok(req.id, result);
        }
      case "devices.pairing.approve":
        requireGatewayScope(ctx, "operator.pairing");
        {
          const result = await approveGatewayPairingRequest({
            userId: requireUser(),
            requestId: typeof params.requestId === "string" ? params.requestId : undefined,
            code: typeof params.code === "string" ? params.code : undefined,
            scopes: params.scopes,
          });
          recordGatewayEvent({
            userId: requireUser(),
            type: "device.paired",
            area: "devices",
            title: `Gateway device paired: ${result.device.label}`,
            subjectType: "gateway_device",
            subjectId: result.device.id,
            metadata: { scopes: result.device.scopes },
          }).catch(() => {});
          return ok(req.id, result);
        }
      case "devices.pairing.reject":
        requireGatewayScope(ctx, "operator.pairing");
        if (typeof params.requestId !== "string") throw new Error("requestId is required");
        {
          const result = await rejectGatewayPairingRequest(requireUser(), params.requestId);
          recordGatewayEvent({
            userId: requireUser(),
            type: "device.pairing.rejected",
            area: "devices",
            title: "Gateway pairing rejected",
            subjectType: "gateway_pairing_request",
            subjectId: params.requestId,
          }).catch(() => {});
          return ok(req.id, result);
        }
      case "devices.revoke":
        requireGatewayScope(ctx, "operator.pairing");
        if (typeof params.deviceId !== "string") throw new Error("deviceId is required");
        {
          const result = await revokeGatewayDevice(requireUser(), params.deviceId);
          recordGatewayEvent({
            userId: requireUser(),
            type: "device.revoked",
            area: "devices",
            title: "Gateway device revoked",
            subjectType: "gateway_device",
            subjectId: params.deviceId,
          }).catch(() => {});
          return ok(req.id, result);
        }
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
  const eventsFor = (id: RpcId | undefined): RpcEvents => ({
    emit: (method, params) => send(ws, { jsonrpc: "2.0", method, params: { requestId: id ?? null, ...params } }),
  });
  const response = Array.isArray(parsed)
    ? await Promise.all(parsed.map((item) => handleRpc(item, ctx)))
    : await handleRpc(parsed, ctx, eventsFor(parsed.id));
  send(ws, response);
}

export function registerGatewayControlPlane(app: Express, server: HttpServer): void {
  app.get("/api/gateway/health", (_req, res) => res.json({ ok: true, ...publicConfigSnapshot() }));
  app.get("/api/gateway/capabilities", (_req, res) => res.json({ capabilities: JARVIS_RUNTIME_CAPABILITIES }));
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
      const unsubscribe = onGatewayEvent((event) => {
        if (event.userId && ctx.userId && event.userId !== ctx.userId) return;
        if (event.userId && !ctx.userId) return;
        send(ws, { jsonrpc: "2.0", method: "gateway.event", params: { event } });
      });
      send(ws, {
        type: "hello",
        service: "jarvis-gateway",
        protocol: "json-rpc-2.0",
        authenticated: Boolean(ctx.userId),
        authKind: ctx.authKind,
        deviceId: ctx.deviceId,
        scopes: ctx.scopes,
        methods: JARVIS_RUNTIME_CAPABILITIES.flatMap((c) => c.jarvisSurface),
      });
      ws.on("message", (raw) => onMessage(ws, raw, ctx).catch((error) => {
        send(ws, err(null, -32000, error instanceof Error ? error.message : String(error)));
      }));
      ws.on("close", unsubscribe);
      ws.on("error", () => {});
    });
  });

  console.log(`[Gateway] Control plane registered at ${GATEWAY_WS_PATH}`);
}
