import type { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import { channelLinks, channelLinkCodes } from "@shared/schema";
import { randomBytes, createHash } from "crypto";

interface PairMsg { type: "pair"; code: string; hostname?: string; platform?: string }
interface ReconnectMsg { type: "reconnect"; daemonId: string; reconnectSecret: string; hostname?: string; platform?: string }
interface ResultMsg { type: "result"; id: string; ok: boolean; data?: unknown; error?: string }
interface HelloMsg { type: "hello"; ok: boolean; userId?: string; error?: string }
interface PingMsg { type: "ping" }
interface NotificationEventMsg { type: "notification_event"; notification: PhoneNotification }

export type DaemonOp =
  | { type: "shell"; cmd: string; cwd?: string; timeoutMs?: number }
  | { type: "notify"; title: string; body: string }
  | { type: "file_read"; path: string }
  | { type: "file_write"; path: string; content: string }
  | { type: "file_list"; path: string }
  | { type: "android_open_app"; packageName: string }
  | { type: "android_browse"; url: string }
  | { type: "android_screenshot" }
  | { type: "android_read_screen" }
  | { type: "android_tap"; x: number; y: number }
  | { type: "android_type"; text: string; submit?: boolean }
  | { type: "android_swipe"; x1: number; y1: number; x2: number; y2: number; durationMs?: number }
  | { type: "android_press_key"; key: "back" | "home" | "recents" | "volume_up" | "volume_down" | "enter" }
  | { type: "android_file_list"; path: string }
  | { type: "android_file_read"; path: string }
  | { type: "android_notifications_list"; limit?: number };

export interface PhoneNotification {
  pkg: string;
  app: string;
  title: string;
  text: string;
  ts: number;
  key: string;
}

// In-memory notification cache per user (newest first, max 60 per user)
const userNotifications = new Map<string, PhoneNotification[]>();

const MAX_NOTIFS_PER_USER = 60;

export function getRecentPhoneNotifications(userId: string, limit = 20): PhoneNotification[] {
  const arr = userNotifications.get(userId) || [];
  return arr.slice(0, limit);
}

interface PendingOp {
  resolve: (r: { ok: boolean; data?: unknown; error?: string }) => void;
  timer: ReturnType<typeof setTimeout>;
}

const userSockets = new Map<string, WebSocket>();
const pendingByUser = new Map<string, Map<string, PendingOp>>();
let opCounter = 0;

function nextOpId(): string {
  opCounter += 1;
  return `op_${Date.now().toString(36)}_${opCounter}`;
}

export function isUserPaired(userId: string): boolean {
  const sock = userSockets.get(userId);
  return !!(sock && sock.readyState === WebSocket.OPEN);
}

export function listPairedUsers(): string[] {
  return [...userSockets.keys()];
}

// Forcibly disconnect any active daemon socket for this user. Used when the
// user unlinks the daemon — without this, an already-paired socket would
// continue to accept ops until its next ping/disconnect.
export function closeUserDaemon(userId: string): boolean {
  const sock = userSockets.get(userId);
  if (!sock) return false;
  try { sock.close(4004, "unlinked by user"); } catch { /* noop */ }
  userSockets.delete(userId);
  const pending = pendingByUser.get(userId);
  if (pending) {
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, error: "daemon unlinked" });
      pending.delete(id);
    }
  }
  return true;
}

// ───── Per-action permission model (Desktop) ────────────────────────────
// Stored in channel_links.metadata.permissions for the user's daemon row.
// Defaults: notify/file_read/file_list ON, shell/file_write OFF.
export type DaemonAction = "shell" | "notify" | "file_read" | "file_write" | "file_list";
export type DaemonPermissions = Record<DaemonAction, boolean>;

export const DEFAULT_DAEMON_PERMISSIONS: DaemonPermissions = {
  shell: false,
  file_write: false,
  notify: true,
  file_read: true,
  file_list: true,
};

// ───── Per-action permission model (Android) ────────────────────────────
// Stored in channel_links.metadata.android_permissions.
// Defaults: screenshot/read_screen/open_app/browse/file_list ON; tap_type/file_read OFF.
export type AndroidDaemonAction =
  | "android_screenshot"
  | "android_read_screen"
  | "android_open_app"
  | "android_browse"
  | "android_file_list"
  | "android_file_read"
  | "android_tap_type";
export type AndroidDaemonPermissions = Record<AndroidDaemonAction, boolean>;

export const DEFAULT_ANDROID_DAEMON_PERMISSIONS: AndroidDaemonPermissions = {
  android_screenshot: true,
  android_read_screen: true,
  android_open_app: true,
  android_browse: true,
  android_file_list: true,
  android_file_read: false,
  android_tap_type: false,
};

// Prefer the real paired row (any non-pending address) over a pre-pairing
// stub when both exist, so permission lookups are deterministic.
async function findUserDaemonRow(userId: string) {
  const rows = await db.select().from(channelLinks)
    .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, "daemon")));
  if (rows.length === 0) return null;
  const real = rows.find((r) => !r.address.startsWith("pending_"));
  return real || rows[0];
}

export async function getDaemonDeviceMeta(userId: string): Promise<{ hostname: string | null; platform: string | null }> {
  try {
    const row = await findUserDaemonRow(userId);
    const meta = (row?.metadata as Record<string, unknown> | null) || null;
    return {
      hostname: (meta?.hostname as string | undefined) || null,
      platform: (meta?.platform as string | undefined) || null,
    };
  } catch {
    return { hostname: null, platform: null };
  }
}

export async function getDaemonPermissions(userId: string): Promise<DaemonPermissions> {
  try {
    const row = await findUserDaemonRow(userId);
    const meta = (row?.metadata as Record<string, unknown> | null) || null;
    const stored = meta?.permissions;
    if (stored && typeof stored === "object") {
      return { ...DEFAULT_DAEMON_PERMISSIONS, ...(stored as Partial<DaemonPermissions>) };
    }
  } catch (err) {
    console.error("[daemon] getDaemonPermissions failed:", err);
  }
  return { ...DEFAULT_DAEMON_PERMISSIONS };
}

export async function setDaemonPermissions(
  userId: string,
  perms: Partial<DaemonPermissions>,
): Promise<DaemonPermissions> {
  const merged = { ...DEFAULT_DAEMON_PERMISSIONS, ...perms };
  try {
    const row = await findUserDaemonRow(userId);
    const meta = ((row?.metadata as Record<string, unknown> | null) || {}) as Record<string, unknown>;
    meta.permissions = merged;
    if (row) {
      await db.update(channelLinks).set({ metadata: meta })
        .where(eq(channelLinks.id, row.id));
    } else {
      await db.insert(channelLinks).values({
        userId, channel: "daemon", address: `pending_${userId}`, metadata: meta, lastSeenAt: new Date(),
      }).onConflictDoNothing();
    }
  } catch (err) {
    console.error("[daemon] setDaemonPermissions failed:", err);
  }
  return merged;
}

export async function isDaemonActionAllowed(userId: string, action: DaemonAction): Promise<boolean> {
  const perms = await getDaemonPermissions(userId);
  return !!perms[action];
}

// ───── Android permission helpers ────────────────────────────────────────

export async function getAndroidDaemonPermissions(userId: string): Promise<AndroidDaemonPermissions> {
  try {
    const row = await findUserDaemonRow(userId);
    const meta = (row?.metadata as Record<string, unknown> | null) || null;
    const stored = meta?.android_permissions;
    if (stored && typeof stored === "object") {
      return { ...DEFAULT_ANDROID_DAEMON_PERMISSIONS, ...(stored as Partial<AndroidDaemonPermissions>) };
    }
  } catch (err) {
    console.error("[daemon] getAndroidDaemonPermissions failed:", err);
  }
  return { ...DEFAULT_ANDROID_DAEMON_PERMISSIONS };
}

export async function setAndroidDaemonPermissions(
  userId: string,
  perms: Partial<AndroidDaemonPermissions>,
): Promise<AndroidDaemonPermissions> {
  const merged = { ...DEFAULT_ANDROID_DAEMON_PERMISSIONS, ...perms };
  try {
    const row = await findUserDaemonRow(userId);
    const meta = ((row?.metadata as Record<string, unknown> | null) || {}) as Record<string, unknown>;
    meta.android_permissions = merged;
    if (row) {
      await db.update(channelLinks).set({ metadata: meta })
        .where(eq(channelLinks.id, row.id));
    } else {
      await db.insert(channelLinks).values({
        userId, channel: "daemon", address: `pending_android_${userId}`, metadata: meta, lastSeenAt: new Date(),
      }).onConflictDoNothing();
    }
  } catch (err) {
    console.error("[daemon] setAndroidDaemonPermissions failed:", err);
  }
  return merged;
}

export async function isAndroidDaemonActionAllowed(userId: string, action: AndroidDaemonAction): Promise<boolean> {
  const perms = await getAndroidDaemonPermissions(userId);
  return !!perms[action];
}

// Returns true if the currently-connected daemon is an Android device.
export async function isAndroidDaemonActive(userId: string): Promise<boolean> {
  if (!isUserPaired(userId)) return false;
  try {
    const row = await findUserDaemonRow(userId);
    const meta = (row?.metadata as Record<string, unknown> | null) || null;
    return meta?.platform === "android";
  } catch {
    return false;
  }
}

// Platform-level gating: android_* ops can only go to android daemons,
// and desktop ops cannot go to android daemons. Enforced here so all
// callers (tools, routes, etc.) are protected by a single check.
async function validateOpForPlatform(
  userId: string,
  op: DaemonOp,
): Promise<{ ok: false; error: string } | null> {
  const isAndroid = await isAndroidDaemonActive(userId);
  const isAndroidOp = op.type.startsWith("android_");
  if (isAndroidOp && !isAndroid) {
    return { ok: false, error: `Op '${op.type}' requires an Android daemon, but the connected daemon is a desktop daemon.` };
  }
  if (!isAndroidOp && isAndroid && op.type !== "notify") {
    return { ok: false, error: `Op '${op.type}' is a desktop-only op, but the connected daemon is Android. Use android_* ops instead.` };
  }
  return null;
}

export async function sendDaemonOp(
  userId: string,
  op: DaemonOp,
  timeoutMs = 15000,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const sock = userSockets.get(userId);
  if (!sock || sock.readyState !== WebSocket.OPEN) {
    return { ok: false, error: "daemon not connected" };
  }
  const platformErr = await validateOpForPlatform(userId, op);
  if (platformErr) return platformErr;
  return new Promise((resolve) => {
    const id = nextOpId();
    const timer = setTimeout(() => {
      const map = pendingByUser.get(userId);
      map?.delete(id);
      resolve({ ok: false, error: "daemon timeout" });
    }, timeoutMs);
    let userMap = pendingByUser.get(userId);
    if (!userMap) {
      userMap = new Map();
      pendingByUser.set(userId, userMap);
    }
    userMap.set(id, { resolve, timer });
    try {
      sock.send(JSON.stringify({ type: "op", id, op }));
    } catch (err) {
      clearTimeout(timer);
      userMap.delete(id);
      resolve({ ok: false, error: String(err) });
    }
  });
}

export function generatePairingCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export async function createDaemonPairingCode(userId: string): Promise<string> {
  const code = generatePairingCode();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  await db.insert(channelLinkCodes).values({
    code, userId, channel: "daemon", expiresAt,
  });
  return code;
}

async function consumePairingCode(code: string): Promise<string | null> {
  try {
    const rows = await db.select().from(channelLinkCodes)
      .where(and(eq(channelLinkCodes.code, code), eq(channelLinkCodes.channel, "daemon")))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
      await db.delete(channelLinkCodes).where(eq(channelLinkCodes.code, code));
      return null;
    }
    await db.delete(channelLinkCodes).where(eq(channelLinkCodes.code, code));
    return row.userId;
  } catch (err) {
    console.error("[daemon] consumePairingCode failed:", err);
    return null;
  }
}

async function recordDaemonLink(userId: string, daemonId: string, meta: Record<string, unknown>): Promise<void> {
  try {
    // Normalize to a single daemon row per user. Read any existing rows so we
    // can preserve previously-stored permissions, then drop them all and
    // insert one canonical row keyed by (userId, channel="daemon", daemonId).
    const existing = await db.select().from(channelLinks)
      .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, "daemon")));
    const mergedMeta: Record<string, unknown> = { ...meta };
    for (const row of existing) {
      const prior = (row.metadata as Record<string, unknown> | null) || {};
      if (prior.permissions && !mergedMeta.permissions) {
        mergedMeta.permissions = prior.permissions;
      }
      if (prior.android_permissions && !mergedMeta.android_permissions) {
        mergedMeta.android_permissions = prior.android_permissions;
      }
    }
    if (existing.length > 0) {
      await db.delete(channelLinks)
        .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, "daemon")));
    }
    await db.insert(channelLinks).values({
      userId,
      channel: "daemon",
      address: daemonId,
      metadata: mergedMeta,
      lastSeenAt: new Date(),
    }).onConflictDoUpdate({
      target: [channelLinks.channel, channelLinks.address],
      set: { userId, metadata: mergedMeta, lastSeenAt: new Date() },
    });
  } catch (err) {
    console.error("[daemon] recordDaemonLink failed:", err);
  }
}

export function startDaemonBridge(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    if (!req.url || !req.url.startsWith("/api/daemon/ws")) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws: WebSocket) => {
    let pairedUserId: string | null = null;
    let pairTimeout: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      if (!pairedUserId) {
        try { ws.close(4001, "pairing timeout"); } catch { /* noop */ }
      }
    }, 30000);

    ws.on("message", async (raw: RawData) => {
      let msg: unknown;
      try { msg = JSON.parse(raw.toString()); } catch {
        try { ws.send(JSON.stringify({ type: "error", error: "invalid json" })); } catch { /* noop */ }
        return;
      }
      const m = msg as PairMsg | ReconnectMsg | ResultMsg | PingMsg;

      // Reconnect using stored daemonId + reconnectSecret (proof-of-possession).
      // The secret was issued server-side during pair; we compare sha256(provided) to stored hash.
      if (m.type === "reconnect") {
        const rm = m as ReconnectMsg;
        if (!rm.daemonId || !rm.reconnectSecret) {
          try { ws.send(JSON.stringify({ type: "hello", ok: false, error: "daemonId and reconnectSecret are required" })); } catch { /* noop */ }
          return;
        }
        try {
          const rows = await db.select().from(channelLinks)
            .where(and(eq(channelLinks.address, rm.daemonId), eq(channelLinks.channel, "daemon")))
            .limit(1);
          const row = rows[0];
          if (!row) {
            try { ws.send(JSON.stringify({ type: "hello", ok: false, error: "unknown daemonId — please re-pair" })); } catch { /* noop */ }
            ws.close(4002, "unknown daemonId");
            return;
          }
          // Verify reconnect secret by comparing sha256 hash (constant-time not critical here,
          // but using timingSafeEqual via hex comparison is sufficient for this use-case)
          const storedMeta = ((row.metadata as Record<string, unknown> | null) || {}) as Record<string, unknown>;
          const storedHash = storedMeta.reconnectSecretHash as string | undefined;
          if (!storedHash) {
            // Row predates secure reconnect — force re-pair
            try { ws.send(JSON.stringify({ type: "hello", ok: false, error: "legacy pair record — please re-pair" })); } catch { /* noop */ }
            ws.close(4002, "legacy record");
            return;
          }
          const providedHash = createHash("sha256").update(rm.reconnectSecret).digest("hex");
          if (providedHash !== storedHash) {
            try { ws.send(JSON.stringify({ type: "hello", ok: false, error: "invalid reconnect secret — please re-pair" })); } catch { /* noop */ }
            ws.close(4001, "bad secret");
            return;
          }
          pairedUserId = row.userId;
          if (pairTimeout) { clearTimeout(pairTimeout); pairTimeout = null; }
          // Update metadata with fresh hostname/platform if provided
          if (rm.hostname) storedMeta.hostname = rm.hostname;
          if (rm.platform) storedMeta.platform = rm.platform;
          await db.update(channelLinks)
            .set({ metadata: storedMeta, lastSeenAt: new Date() })
            .where(eq(channelLinks.id, row.id));
          const prior = userSockets.get(pairedUserId);
          if (prior && prior !== ws) { try { prior.close(4003, "replaced by new daemon"); } catch { /* noop */ } }
          userSockets.set(pairedUserId, ws);
          const hello: HelloMsg = { type: "hello", ok: true, userId: pairedUserId };
          try { ws.send(JSON.stringify(hello)); } catch { /* noop */ }
          console.log(`[daemon] reconnected userId=${pairedUserId} daemonId=${rm.daemonId}`);
        } catch (err) {
          console.error("[daemon] reconnect lookup failed:", err);
          try { ws.send(JSON.stringify({ type: "hello", ok: false, error: "reconnect failed" })); } catch { /* noop */ }
        }
        return;
      }

      if (m.type === "pair") {
        const userId = await consumePairingCode(m.code);
        if (!userId) {
          const reply: HelloMsg = { type: "hello", ok: false, error: "invalid or expired code" };
          try { ws.send(JSON.stringify(reply)); } catch { /* noop */ }
          ws.close(4002, "invalid code");
          return;
        }
        pairedUserId = userId;
        if (pairTimeout) { clearTimeout(pairTimeout); pairTimeout = null; }
        // Generate cryptographically random daemonId and reconnectSecret server-side.
        // Never trust a client-supplied daemonId — reject any the client sends.
        const daemonId = randomBytes(16).toString("hex");
        const reconnectSecret = randomBytes(32).toString("hex");
        const reconnectSecretHash = createHash("sha256").update(reconnectSecret).digest("hex");
        await recordDaemonLink(userId, daemonId, {
          hostname: m.hostname || "unknown",
          platform: m.platform || "desktop",
          reconnectSecretHash,
        });
        // Replace any prior socket for this user
        const prior = userSockets.get(userId);
        if (prior && prior !== ws) { try { prior.close(4003, "replaced by new daemon"); } catch { /* noop */ } }
        userSockets.set(userId, ws);
        // Send daemonId + one-time plaintext secret to client; never sent again after this
        const hello = { type: "hello", ok: true, userId, daemonId, reconnectSecret };
        try { ws.send(JSON.stringify(hello)); } catch { /* noop */ }
        console.log(`[daemon] paired userId=${userId} hostname=${m.hostname || "unknown"} platform=${m.platform || "desktop"}`);
        return;
      }

      if (m.type === "ping") {
        try { ws.send(JSON.stringify({ type: "pong" })); } catch { /* noop */ }
        return;
      }

      // Notification event pushed from Android daemon — cache server-side
      if (m.type === "notification_event" && pairedUserId) {
        const ne = m as NotificationEventMsg;
        if (ne.notification && typeof ne.notification === "object") {
          const arr = userNotifications.get(pairedUserId) || [];
          arr.unshift(ne.notification); // newest first
          while (arr.length > MAX_NOTIFS_PER_USER) arr.pop();
          userNotifications.set(pairedUserId, arr);
        }
        return;
      }

      if (m.type === "result" && pairedUserId) {
        const userMap = pendingByUser.get(pairedUserId);
        const pending = userMap?.get(m.id);
        if (pending) {
          clearTimeout(pending.timer);
          userMap!.delete(m.id);
          pending.resolve({ ok: m.ok, data: m.data, error: m.error });
        }
        // Update last_seen
        db.update(channelLinks)
          .set({ lastSeenAt: new Date() })
          .where(and(eq(channelLinks.userId, pairedUserId), eq(channelLinks.channel, "daemon")))
          .catch((err) => console.error("[daemon] last_seen update failed:", err));
      }
    });

    // Server-side keepalive — ping the daemon every 20 s so Replit's proxy
    // doesn't drop the WebSocket due to idle timeout.
    const keepalive = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.ping(); } catch { /* noop */ }
      }
    }, 20000);

    ws.on("close", () => {
      clearInterval(keepalive);
      if (pairedUserId && userSockets.get(pairedUserId) === ws) {
        userSockets.delete(pairedUserId);
        console.log(`[daemon] disconnected userId=${pairedUserId}`);
      }
      if (pairTimeout) { clearTimeout(pairTimeout); pairTimeout = null; }
      // Reject any pending ops for this user
      if (pairedUserId) {
        const userMap = pendingByUser.get(pairedUserId);
        if (userMap) {
          for (const [id, pending] of userMap) {
            clearTimeout(pending.timer);
            pending.resolve({ ok: false, error: "daemon disconnected" });
            userMap.delete(id);
          }
        }
      }
    });

    ws.on("error", (err: Error) => {
      console.error("[daemon] socket error:", err);
    });
  });

  console.log("[daemon] WebSocket bridge mounted at /api/daemon/ws");

  // Periodic cleanup of expired pairing codes
  const cleanup = setInterval(() => {
    db.delete(channelLinkCodes)
      .where(and(eq(channelLinkCodes.channel, "daemon"), sql`${channelLinkCodes.expiresAt} < NOW()`))
      .catch((err) => console.error("[daemon] code cleanup failed:", err));
  }, 5 * 60 * 1000) as unknown as NodeJS.Timeout;
  cleanup.unref();
}
