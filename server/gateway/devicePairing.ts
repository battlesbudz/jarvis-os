import { createHash, randomBytes } from "crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import * as schema from "@shared/schema";
import type { GatewayDeviceScope } from "@shared/schema";

export interface GatewayPrincipal {
  userId: string | null;
  deviceId?: string;
  scopes: GatewayDeviceScope[];
  authKind: "anonymous" | "jwt" | "device";
}

export const JWT_GATEWAY_SCOPES: GatewayDeviceScope[] = [
  "operator.admin",
  "operator.read",
  "operator.write",
  "operator.approvals",
  "operator.pairing",
];

const DEFAULT_DEVICE_SCOPES: GatewayDeviceScope[] = ["operator.read"];
const APPROVED_DEVICE_SCOPES: GatewayDeviceScope[] = ["operator.read", "operator.write", "operator.approvals"];

function normalizeScopes(scopes: unknown, fallback: GatewayDeviceScope[]): GatewayDeviceScope[] {
  if (!Array.isArray(scopes)) return fallback;
  const allowed = new Set<string>(schema.GATEWAY_DEVICE_SCOPES);
  const normalized = scopes.filter((scope): scope is GatewayDeviceScope => typeof scope === "string" && allowed.has(scope));
  return normalized.length > 0 ? [...new Set(normalized)] : fallback;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newPairingCode(): string {
  return `J-${randomBytes(3).toString("hex").toUpperCase()}`;
}

function newDeviceToken(): string {
  return `jgwd_${randomBytes(32).toString("base64url")}`;
}

export function hasGatewayScope(principal: GatewayPrincipal, scope: GatewayDeviceScope): boolean {
  return principal.scopes.includes("operator.admin") || principal.scopes.includes(scope);
}

export function requireGatewayScope(principal: GatewayPrincipal, scope: GatewayDeviceScope): void {
  if (!principal.userId || !hasGatewayScope(principal, scope)) {
    throw new Error(`Gateway scope required: ${scope}`);
  }
}

export async function authenticateGatewayDeviceToken(token: string | null): Promise<GatewayPrincipal | null> {
  if (!token?.startsWith("jgwd_")) return null;
  const hash = tokenHash(token);
  const rows = await db
    .select()
    .from(schema.gatewayDevices)
    .where(and(eq(schema.gatewayDevices.tokenHash, hash), isNull(schema.gatewayDevices.revokedAt)))
    .limit(1)
    .catch(() => []);
  const device = rows[0];
  if (!device) return null;

  db.update(schema.gatewayDevices)
    .set({ lastSeenAt: new Date() })
    .where(eq(schema.gatewayDevices.id, device.id))
    .catch(() => {});

  return {
    userId: device.userId,
    deviceId: device.id,
    scopes: normalizeScopes(device.scopes, DEFAULT_DEVICE_SCOPES),
    authKind: "device",
  };
}

export async function createGatewayPairingRequest({
  userId,
  label,
  kind,
  origin,
  requestedScopes,
  metadata,
}: {
  userId: string;
  label?: string;
  kind?: string;
  origin?: string | null;
  requestedScopes?: unknown;
  metadata?: Record<string, unknown>;
}) {
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  const scopes = normalizeScopes(requestedScopes, DEFAULT_DEVICE_SCOPES);
  const values = {
    code: newPairingCode(),
    userId,
    label: (label || "Gateway device").slice(0, 120),
    kind: (kind || "browser").slice(0, 40),
    origin: origin || null,
    requestedScopes: scopes,
    metadata: metadata ?? {},
    expiresAt,
  };

  const [row] = await db.insert(schema.gatewayDevicePairingRequests).values(values).returning();
  return row;
}

export async function listGatewayPairingRequests(userId: string, limit = 25) {
  return db
    .select()
    .from(schema.gatewayDevicePairingRequests)
    .where(eq(schema.gatewayDevicePairingRequests.userId, userId))
    .orderBy(desc(schema.gatewayDevicePairingRequests.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));
}

export async function approveGatewayPairingRequest({
  userId,
  requestId,
  code,
  scopes,
}: {
  userId: string;
  requestId?: string;
  code?: string;
  scopes?: unknown;
}) {
  const rows = requestId
    ? await db.select().from(schema.gatewayDevicePairingRequests).where(eq(schema.gatewayDevicePairingRequests.id, requestId)).limit(1)
    : await db.select().from(schema.gatewayDevicePairingRequests).where(eq(schema.gatewayDevicePairingRequests.code, code || "")).limit(1);
  const request = rows[0];
  if (!request || request.userId !== userId) throw new Error("Pairing request not found");
  if (request.status !== "pending") throw new Error(`Pairing request is ${request.status}`);
  if (new Date(request.expiresAt).getTime() < Date.now()) {
    await db.update(schema.gatewayDevicePairingRequests)
      .set({ status: "expired", resolvedAt: new Date() })
      .where(eq(schema.gatewayDevicePairingRequests.id, request.id))
      .catch(() => {});
    throw new Error("Pairing request expired");
  }

  const rawToken = newDeviceToken();
  const approvedScopes = normalizeScopes(scopes, APPROVED_DEVICE_SCOPES);
  const [device] = await db.insert(schema.gatewayDevices).values({
    userId,
    label: request.label,
    kind: request.kind,
    tokenHash: tokenHash(rawToken),
    scopes: approvedScopes,
    metadata: {
      ...(request.metadata as Record<string, unknown>),
      origin: request.origin,
      pairedFromRequestId: request.id,
    },
  }).returning();

  await db.update(schema.gatewayDevicePairingRequests)
    .set({ status: "approved", deviceId: device.id, resolvedAt: new Date() })
    .where(eq(schema.gatewayDevicePairingRequests.id, request.id));

  return {
    device: { ...device, tokenHash: undefined },
    token: rawToken,
  };
}

export async function rejectGatewayPairingRequest(userId: string, requestId: string) {
  const [request] = await db
    .select()
    .from(schema.gatewayDevicePairingRequests)
    .where(eq(schema.gatewayDevicePairingRequests.id, requestId))
    .limit(1);
  if (!request || request.userId !== userId) throw new Error("Pairing request not found");
  await db.update(schema.gatewayDevicePairingRequests)
    .set({ status: "rejected", resolvedAt: new Date() })
    .where(eq(schema.gatewayDevicePairingRequests.id, request.id));
  return { ok: true };
}

export async function listGatewayDevices(userId: string, includeRevoked = false, limit = 50) {
  const rows = await db
    .select()
    .from(schema.gatewayDevices)
    .where(eq(schema.gatewayDevices.userId, userId))
    .orderBy(desc(schema.gatewayDevices.pairedAt))
    .limit(Math.min(Math.max(limit, 1), 100));
  return rows
    .filter((device) => includeRevoked || !device.revokedAt)
    .map((device) => ({ ...device, tokenHash: undefined }));
}

export async function revokeGatewayDevice(userId: string, deviceId: string) {
  const [device] = await db
    .select()
    .from(schema.gatewayDevices)
    .where(eq(schema.gatewayDevices.id, deviceId))
    .limit(1);
  if (!device || device.userId !== userId) throw new Error("Gateway device not found");
  await db.update(schema.gatewayDevices)
    .set({ revokedAt: new Date() })
    .where(eq(schema.gatewayDevices.id, deviceId));
  return { ok: true };
}

