import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { listChannels } from "../channels/registry";
import {
  getAndroidDaemonPermissions,
  getDaemonDeviceMeta,
  getDaemonLastSeen,
  getDaemonPermissions,
  isAndroidDaemonActive,
  isDesktopDaemonActive,
} from "../daemon/bridge";
import * as schema from "@shared/schema";

export type GatewayNodeKind =
  | "server"
  | "gateway_device"
  | "desktop_daemon"
  | "android_daemon"
  | "job_worker"
  | "scheduler"
  | "channel"
  | "job";

export type GatewayNodeStatus = "online" | "offline" | "degraded" | "idle" | "running" | "queued";

export interface GatewayNode {
  nodeId: string;
  kind: GatewayNodeKind;
  label: string;
  status: GatewayNodeStatus;
  capabilities: string[];
  scopes: string[];
  lastSeenAt: string | null;
  actions: string[];
  metadata: Record<string, unknown>;
}

export interface CapabilityRoute {
  capability: string;
  routed: boolean;
  node: GatewayNode | null;
  reason: string;
}

const SERVER_CAPABILITIES = [
  "gateway.health",
  "gateway.status",
  "actions.invoke",
  "code.change.request",
  "repo.branch.push",
  "repo.pr.create",
  "repo.pr.status",
  "repo.pr.verify",
  "orchestration.plan.create",
  "events.list",
  "chat.send",
  "sessions.list",
  "approvals.list",
  "approvals.approve",
  "approvals.reject",
  "jobs.create",
  "jobs.cancel",
  "cron.create",
  "cron.list",
];

const CHANNEL_CAPABILITIES = ["message.receive", "message.send", "agent.tools"];

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function permissionsToCapabilities(prefix: string, permissions: Record<string, boolean>): string[] {
  return Object.entries(permissions)
    .filter(([, enabled]) => enabled)
    .map(([name]) => `${prefix}.${name}`);
}

export async function listGatewayNodes(userId: string | null, limit = 50): Promise<GatewayNode[]> {
  const now = new Date().toISOString();
  const nodes: GatewayNode[] = [
    {
      nodeId: "jarvis:server",
      kind: "server",
      label: "Jarvis Server",
      status: "online",
      capabilities: SERVER_CAPABILITIES,
      scopes: ["operator.read", "operator.write", "operator.approvals", "operator.pairing"],
      lastSeenAt: now,
      actions: ["gateway.status", "events.list", "actions.invoke", "code.change.request", "repo.branch.push", "repo.pr.create", "repo.pr.status", "repo.pr.verify", "orchestration.plan.create", "chat.send", "jobs.create", "cron.create"],
      metadata: { processUptimeSeconds: Math.floor(process.uptime()) },
    },
    {
      nodeId: "jarvis:scheduler",
      kind: "scheduler",
      label: "Jarvis Scheduler",
      status: "online",
      capabilities: ["cron.poll", "dreams.run", "agent.loops", "discord.schedules", "scheduled_tasks.run"],
      scopes: ["system"],
      lastSeenAt: now,
      actions: ["cron.list", "cron.create"],
      metadata: { tick: "1 minute" },
    },
    {
      nodeId: "jarvis:job-worker",
      kind: "job_worker",
      label: "Background Job Worker",
      status: "online",
      capabilities: ["jobs.run", "research", "planning", "writing", "deep_research", "build_feature"],
      scopes: ["system"],
      lastSeenAt: now,
      actions: ["jobs.create", "jobs.cancel"],
      metadata: { polling: true },
    },
  ];

  for (const channel of listChannels()) {
    nodes.push({
      nodeId: `channel:${channel.name}`,
      kind: "channel",
      label: channel.name,
      status: channel.isConfigured() ? "online" : "offline",
      capabilities: CHANNEL_CAPABILITIES,
      scopes: channel.toolGroups,
      lastSeenAt: null,
      actions: ["channels.list"],
      metadata: { toolGroups: channel.toolGroups },
    });
  }

  if (!userId) return nodes;

  const [gatewayDevices, activeJobs] = await Promise.all([
    db.select()
      .from(schema.gatewayDevices)
      .where(eq(schema.gatewayDevices.userId, userId))
      .orderBy(desc(schema.gatewayDevices.pairedAt))
      .limit(Math.min(limit, 100))
      .catch(() => []),
    db.select()
      .from(schema.agentJobs)
      .where(and(eq(schema.agentJobs.userId, userId), inArray(schema.agentJobs.status, ["queued", "running"])))
      .orderBy(desc(schema.agentJobs.createdAt))
      .limit(Math.min(limit, 100))
      .catch(() => []),
  ]);

  for (const device of gatewayDevices) {
    const scopes = (device.scopes as string[]) || [];
    nodes.push({
      nodeId: `gateway-device:${device.id}`,
      kind: "gateway_device",
      label: device.label,
      status: device.revokedAt ? "offline" : "online",
      capabilities: ["control.ui", "gateway.rpc", "gateway.ws", "events.subscribe"],
      scopes,
      lastSeenAt: iso(device.lastSeenAt ?? device.pairedAt),
      actions: device.revokedAt ? [] : ["devices.revoke"],
      metadata: { kind: device.kind, revoked: Boolean(device.revokedAt) },
    });
  }

  const [desktopMeta, androidMeta, desktopLastSeenAt, androidLastSeenAt, desktopPerms, androidPerms] = await Promise.all([
    getDaemonDeviceMeta(userId, "desktop"),
    getDaemonDeviceMeta(userId, "android"),
    getDaemonLastSeen(userId, "desktop"),
    getDaemonLastSeen(userId, "android"),
    getDaemonPermissions(userId),
    getAndroidDaemonPermissions(userId),
  ]);
  const desktopCapabilities = ["daemon.ping", "daemon.notify", ...permissionsToCapabilities("desktop", desktopPerms)];
  nodes.push({
    nodeId: "daemon:desktop",
    kind: "desktop_daemon",
    label: desktopMeta.hostname ? `Desktop Daemon: ${desktopMeta.hostname}` : "Desktop Daemon",
    status: isDesktopDaemonActive(userId) ? "online" : "offline",
    capabilities: desktopCapabilities,
    scopes: Object.entries(desktopPerms).filter(([, enabled]) => enabled).map(([name]) => name),
    lastSeenAt: desktopLastSeenAt,
    actions: ["daemon.ping", "daemon.notify", "daemon.test"],
    metadata: desktopMeta,
  });

  const androidCapabilities = ["daemon.ping", "daemon.notify", ...permissionsToCapabilities("android", androidPerms)];
  nodes.push({
    nodeId: "daemon:android",
    kind: "android_daemon",
    label: androidMeta.hostname ? `Android Daemon: ${androidMeta.hostname}` : "Android Daemon",
    status: isAndroidDaemonActive(userId) ? "online" : "offline",
    capabilities: androidCapabilities,
    scopes: Object.entries(androidPerms).filter(([, enabled]) => enabled).map(([name]) => name),
    lastSeenAt: androidLastSeenAt,
    actions: ["daemon.ping", "daemon.test"],
    metadata: androidMeta,
  });

  for (const job of activeJobs) {
    nodes.push({
      nodeId: `job:${job.id}`,
      kind: "job",
      label: job.title,
      status: job.status === "running" ? "running" : "queued",
      capabilities: [`job.${job.agentType}`, "job.cancel"],
      scopes: ["system"],
      lastSeenAt: iso(job.startedAt ?? job.createdAt),
      actions: ["jobs.cancel"],
      metadata: { agentType: job.agentType, turns: job.turns, toolCallsCount: job.toolCallsCount },
    });
  }

  return nodes;
}

export function routeCapability(capability: string, nodes: GatewayNode[]): CapabilityRoute {
  const online = nodes.filter((node) => ["online", "running", "queued"].includes(node.status));
  const exact = online.find((node) => node.capabilities.includes(capability));
  if (exact) return { capability, routed: true, node: exact, reason: "exact capability match" };

  const prefix = online.find((node) => node.capabilities.some((candidate) => capability.startsWith(candidate) || candidate.startsWith(capability)));
  if (prefix) return { capability, routed: true, node: prefix, reason: "prefix capability match" };

  const offline = nodes.find((node) => node.capabilities.includes(capability));
  if (offline) return { capability, routed: false, node: offline, reason: `node is ${offline.status}` };

  return { capability, routed: false, node: null, reason: "no node advertises this capability" };
}
