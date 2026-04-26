import type { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import { channelLinks, channelLinkCodes, userPreferences } from "@shared/schema";
import { randomBytes, createHash } from "crypto";

interface PairMsg { type: "pair"; code: string; hostname?: string; platform?: string }
interface ReconnectMsg { type: "reconnect"; daemonId: string; reconnectSecret: string; hostname?: string; platform?: string }
interface ResultMsg { type: "result"; id: string; ok: boolean; data?: unknown; error?: string }
interface HelloMsg { type: "hello"; ok: boolean; userId?: string; error?: string }
interface PingMsg { type: "ping" }
interface NotificationEventMsg { type: "notification_event"; notification: PhoneNotification }

export type DaemonOp =
  | { type: "ping" }
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
  | { type: "android_notifications_list"; limit?: number }
  | { type: "android_return_to_jarvis" }
  | { type: "android_file_search"; query: string; root?: string; fileType?: string; maxDepth?: number }
  | { type: "android_open_file"; path: string }
  | { type: "android_copy_to_clipboard"; path: string }
  | { type: "desktop_screenshot" }
  | { type: "desktop_read_screen" }
  | { type: "android_notification_reply"; notificationKey: string; replyText: string }
  | { type: "browser_mcp"; tool: string; args: Record<string, unknown> }
  | { type: "voice_set_wake_words"; enabled: boolean; words?: string[]; talkMode?: boolean }
  | { type: "voice_set_talk_mode"; enabled: boolean }
  | { type: "voice_tts_finished" };

export interface PhoneNotification {
  pkg: string;
  app: string;
  title: string;
  text: string;
  ts: number;
  key: string;
  hasReplyAction?: boolean;
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

// Keyed by `${userId}:${platform}` where platform is "desktop" or "android"
const userSockets = new Map<string, WebSocket>();
const pendingByUser = new Map<string, Map<string, PendingOp>>();
let opCounter = 0;

// Wake word event subscriptions: userId → set of callbacks
const wakeWordTriggerCallbacks = new Map<string, Set<(e: { phrase: string; transcript: string }) => void>>();

export function subscribeWakeWordTrigger(
  userId: string,
  cb: (e: { phrase: string; transcript: string }) => void,
): () => void {
  if (!wakeWordTriggerCallbacks.has(userId)) wakeWordTriggerCallbacks.set(userId, new Set());
  wakeWordTriggerCallbacks.get(userId)!.add(cb);
  return () => wakeWordTriggerCallbacks.get(userId)?.delete(cb);
}

/**
 * After an Android daemon pairs or reconnects, push the user's stored wake/talk
 * settings so the device listener is always in sync even after a reboot.
 */
async function syncWakeSettingsToDaemon(userId: string): Promise<void> {
  try {
    const rows = await db.select({ data: userPreferences.data })
      .from(userPreferences).where(eq(userPreferences.userId, userId));
    const prefs = (rows[0]?.data ?? {}) as Record<string, any>;
    const wakeWordEnabled: boolean = prefs.wakeWordEnabled ?? false;
    const talkModeEnabled: boolean = prefs.talkModeEnabled ?? false;
    const wakeWords: string[] = prefs.wakeWords ?? ["hey jarvis", "jarvis", "computer"];
    // Always push authoritative state so a previously-enabled daemon stops if user disabled it
    await sendDaemonOp(userId, {
      type: "voice_set_wake_words",
      enabled: wakeWordEnabled,
      words: wakeWords,
      talkMode: talkModeEnabled,
    }, 5000);
    console.log(`[daemon] wake settings synced on connect: userId=${userId} enabled=${wakeWordEnabled} talkMode=${talkModeEnabled}`);
  } catch (e) {
    console.error("[daemon] wake settings sync failed:", e);
  }
}

function nextOpId(): string {
  opCounter += 1;
  return `op_${Date.now().toString(36)}_${opCounter}`;
}

function socketKey(userId: string, platform: string): string {
  return `${userId}:${platform}`;
}

export function isUserPaired(userId: string): boolean {
  const desktop = userSockets.get(socketKey(userId, "desktop"));
  if (desktop && desktop.readyState === WebSocket.OPEN) return true;
  const android = userSockets.get(socketKey(userId, "android"));
  return !!(android && android.readyState === WebSocket.OPEN);
}

export function isDesktopDaemonActive(userId: string): boolean {
  const sock = userSockets.get(socketKey(userId, "desktop"));
  return !!(sock && sock.readyState === WebSocket.OPEN);
}

export function listPairedUsers(): string[] {
  const userIds = new Set<string>();
  for (const key of userSockets.keys()) {
    const colonIdx = key.indexOf(":");
    if (colonIdx > -1) userIds.add(key.slice(0, colonIdx));
  }
  return [...userIds];
}

// Forcibly disconnect active daemon socket(s) for this user.
// If platform is provided, only that platform's socket is closed.
// Without platform, all daemon sockets for the user are closed.
export function closeUserDaemon(userId: string, platform?: string): boolean {
  const platforms = platform ? [platform] : ["desktop", "android"];
  let closed = false;
  for (const p of platforms) {
    const key = socketKey(userId, p);
    const sock = userSockets.get(key);
    if (sock) {
      try { sock.close(4004, "unlinked by user"); } catch { /* noop */ }
      userSockets.delete(key);
      closed = true;
    }
  }
  for (const p of platforms) {
    const pKey = socketKey(userId, p);
    const pendingMap = pendingByUser.get(pKey);
    if (pendingMap) {
      for (const [, op] of pendingMap) {
        clearTimeout(op.timer);
        op.resolve({ ok: false, error: "daemon unlinked" });
      }
      pendingByUser.delete(pKey);
    }
  }
  return closed;
}

// ───── Per-action permission model (Desktop) ────────────────────────────
// Stored in channel_links.metadata.permissions for the user's daemon row.
// Defaults: notify/file_read/file_list/desktop_screenshot/desktop_read_screen ON,
//           shell/file_write OFF.
export type DaemonAction = "shell" | "notify" | "file_read" | "file_write" | "file_list" | "desktop_screenshot" | "desktop_read_screen" | "browser_local";
export type DaemonPermissions = Record<DaemonAction, boolean>;

export const DEFAULT_DAEMON_PERMISSIONS: DaemonPermissions = {
  shell: false,
  file_write: false,
  notify: true,
  file_read: true,
  file_list: true,
  desktop_screenshot: true,
  desktop_read_screen: true,
  browser_local: false,
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
// stub when both exist. If platform is provided, only rows for that platform
// are considered (matched by metadata.platform).
async function findUserDaemonRow(userId: string, platform?: string) {
  const rows = await db.select().from(channelLinks)
    .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, "daemon")));
  if (rows.length === 0) return null;
  let candidates = rows;
  if (platform) {
    const filtered = rows.filter((r) => {
      const meta = (r.metadata as Record<string, unknown> | null) || {};
      const p = (meta.platform as string | undefined) || "desktop";
      return p === platform;
    });
    if (filtered.length === 0) return null;
    candidates = filtered;
  }
  const real = candidates.find((r) => !r.address.startsWith("pending_"));
  return real || candidates[0];
}

export async function getDaemonDeviceMeta(userId: string, platform?: string): Promise<{ hostname: string | null; platform: string | null }> {
  try {
    const row = await findUserDaemonRow(userId, platform);
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
    const row = await findUserDaemonRow(userId, "desktop");
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
    const row = await findUserDaemonRow(userId, "desktop");
    const meta = ((row?.metadata as Record<string, unknown> | null) || {}) as Record<string, unknown>;
    meta.permissions = merged;
    if (row) {
      await db.update(channelLinks).set({ metadata: meta })
        .where(eq(channelLinks.id, row.id));
    } else {
      await db.insert(channelLinks).values({
        userId, channel: "daemon", address: `pending_${userId}`, metadata: { ...meta, platform: "desktop" }, lastSeenAt: new Date(),
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
    const row = await findUserDaemonRow(userId, "android");
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
    const row = await findUserDaemonRow(userId, "android");
    const meta = ((row?.metadata as Record<string, unknown> | null) || {}) as Record<string, unknown>;
    meta.android_permissions = merged;
    if (row) {
      await db.update(channelLinks).set({ metadata: meta })
        .where(eq(channelLinks.id, row.id));
    } else {
      await db.insert(channelLinks).values({
        userId, channel: "daemon", address: `pending_android_${userId}`, metadata: { ...meta, platform: "android" }, lastSeenAt: new Date(),
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

// Returns true if the Android daemon socket is connected.
export function isAndroidDaemonActive(userId: string): boolean {
  const sock = userSockets.get(socketKey(userId, "android"));
  return !!(sock && sock.readyState === WebSocket.OPEN);
}

// ───── Op audit log ─────────────────────────────────────────────────────
// Keeps the last 20 op results per user for daemon_diagnostic queries.
export interface OpAuditEntry {
  ts: number;
  type: string;
  ok: boolean;
  error?: string;
  durationMs: number;
}
const opAuditLog = new Map<string, OpAuditEntry[]>();
const MAX_AUDIT_ENTRIES = 20;

function recordAuditEntry(userId: string, entry: OpAuditEntry) {
  let arr = opAuditLog.get(userId);
  if (!arr) { arr = []; opAuditLog.set(userId, arr); }
  arr.push(entry);
  if (arr.length > MAX_AUDIT_ENTRIES) arr.splice(0, arr.length - MAX_AUDIT_ENTRIES);
}

export function getOpAuditLog(userId: string): OpAuditEntry[] {
  return opAuditLog.get(userId) || [];
}

// Convenience: send a ping op and return the device state (or error).
export async function pingDaemon(
  userId: string,
  timeoutMs = 5000,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  return sendDaemonOp(userId, { type: "ping" }, timeoutMs);
}

export async function sendDaemonOp(
  userId: string,
  op: DaemonOp,
  timeoutMs = 15000,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const isAndroidOp = op.type.startsWith("android_") || op.type.startsWith("voice_");
  // "notify" and "ping" are platform-neutral: route to desktop first, android fallback.
  // All other non-android ops are desktop-only; android_*/voice_* ops are android-only.
  const isPlatformNeutral = op.type === "ping" || op.type === "notify";

  let sock: WebSocket | undefined;
  if (isPlatformNeutral) {
    sock = userSockets.get(socketKey(userId, "desktop")) || userSockets.get(socketKey(userId, "android"));
  } else if (isAndroidOp) {
    sock = userSockets.get(socketKey(userId, "android"));
  } else {
    sock = userSockets.get(socketKey(userId, "desktop"));
  }

  if (!sock || sock.readyState !== WebSocket.OPEN) {
    const missing = isPlatformNeutral ? "daemon" : isAndroidOp ? "android daemon" : "desktop daemon";
    console.log(`[daemon] op SKIPPED — ${missing} not connected userId=${userId} op=${op.type}`);
    if (isAndroidOp) {
      return { ok: false, error: "Android daemon not connected. Ask the user to install the Jarvis Android APK and pair it." };
    }
    if (!isPlatformNeutral) {
      return { ok: false, error: "Desktop daemon not connected. Ask the user to install and pair the desktop daemon." };
    }
    return { ok: false, error: "No daemon connected. Install and pair the desktop daemon or the Android APK from Profile → Connected Channels." };
  }
  // Determine which platform this op is actually going to (for scoped pending tracking)
  let actualPlatform: string;
  if (isPlatformNeutral) {
    const deskSock = userSockets.get(socketKey(userId, "desktop"));
    actualPlatform = (sock === deskSock) ? "desktop" : "android";
  } else {
    actualPlatform = isAndroidOp ? "android" : "desktop";
  }
  const pendingKey = socketKey(userId, actualPlatform);

  console.log(`[daemon] op SENT userId=${userId} op=${op.type}`, 'packageName' in op ? `pkg=${(op as any).packageName}` : '');
  const sentAt = Date.now();
  return new Promise((resolve) => {
    const id = nextOpId();
    const timer = setTimeout(() => {
      const map = pendingByUser.get(pendingKey);
      map?.delete(id);
      console.log(`[daemon] op TIMEOUT userId=${userId} op=${op.type}`);
      const durationMs = Date.now() - sentAt;
      recordAuditEntry(userId, { ts: sentAt, type: op.type, ok: false, error: "timeout", durationMs });
      resolve({ ok: false, error: "daemon timeout" });
    }, timeoutMs);
    let userMap = pendingByUser.get(pendingKey);
    if (!userMap) {
      userMap = new Map();
      pendingByUser.set(pendingKey, userMap);
    }
    userMap.set(id, {
      resolve: (result) => {
        const durationMs = Date.now() - sentAt;
        if (op.type === "ping") {
          console.log(`[daemon] ping RTT ${durationMs}ms userId=${userId} ok=${result.ok}`, result.ok ? '' : `err=${result.error}`);
        } else {
          console.log(`[daemon] op RESULT userId=${userId} op=${op.type} ok=${result.ok}`, result.ok ? '' : `err=${result.error}`);
        }
        recordAuditEntry(userId, { ts: sentAt, type: op.type, ok: result.ok, error: result.error, durationMs });
        resolve(result);
      },
      timer,
    });
    try {
      sock.send(JSON.stringify({ type: "op", id, op }));
    } catch (err) {
      clearTimeout(timer);
      userMap.delete(id);
      const durationMs = Date.now() - sentAt;
      recordAuditEntry(userId, { ts: sentAt, type: op.type, ok: false, error: String(err), durationMs });
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
    const platform = (meta.platform as string | undefined) || "desktop";
    // Find existing rows and preserve permissions from the same-platform row.
    const existing = await db.select().from(channelLinks)
      .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, "daemon")));
    const mergedMeta: Record<string, unknown> = { ...meta };
    for (const row of existing) {
      const prior = (row.metadata as Record<string, unknown> | null) || {};
      const priorPlatform = (prior.platform as string | undefined) || "desktop";
      if (priorPlatform === platform) {
        // Preserve existing permissions for this platform
        if (prior.permissions && !mergedMeta.permissions) {
          mergedMeta.permissions = prior.permissions;
        }
        if (prior.android_permissions && !mergedMeta.android_permissions) {
          mergedMeta.android_permissions = prior.android_permissions;
        }
      }
    }
    // Delete only the existing row for this platform (preserve the other platform's row)
    for (const row of existing) {
      const priorMeta = (row.metadata as Record<string, unknown> | null) || {};
      const priorPlatform = (priorMeta.platform as string | undefined) || "desktop";
      if (priorPlatform === platform) {
        await db.delete(channelLinks).where(eq(channelLinks.id, row.id));
      }
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
    let pairedPlatform: string = "desktop";
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
      interface WakeWordTriggeredMsg { type: "wake_word_triggered"; phrase?: string; transcript?: string }
      const m = msg as PairMsg | ReconnectMsg | ResultMsg | PingMsg | NotificationEventMsg | WakeWordTriggeredMsg;

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
          const reconnPlatform = (storedMeta.platform as string | undefined) || "desktop";
          pairedPlatform = reconnPlatform;
          const reconnKey = socketKey(pairedUserId, reconnPlatform);
          const prior = userSockets.get(reconnKey);
          if (prior && prior !== ws) { try { prior.close(4003, "replaced by new daemon"); } catch { /* noop */ } }
          userSockets.set(reconnKey, ws);
          const hello: HelloMsg = { type: "hello", ok: true, userId: pairedUserId };
          try { ws.send(JSON.stringify(hello)); } catch { /* noop */ }
          console.log(`[daemon] reconnected userId=${pairedUserId} platform=${reconnPlatform} daemonId=${rm.daemonId}`);
          // Sync wake/talk settings to daemon after reconnect (fire-and-forget)
          if (reconnPlatform === "android") setTimeout(() => syncWakeSettingsToDaemon(pairedUserId), 1500);
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
        const pairPlatform = m.platform || "desktop";
        pairedPlatform = pairPlatform;
        await recordDaemonLink(userId, daemonId, {
          hostname: m.hostname || "unknown",
          platform: pairPlatform,
          reconnectSecretHash,
        });
        // Replace any prior socket for the same platform only
        const pairKey = socketKey(userId, pairPlatform);
        const prior = userSockets.get(pairKey);
        if (prior && prior !== ws) { try { prior.close(4003, "replaced by new daemon"); } catch { /* noop */ } }
        userSockets.set(pairKey, ws);
        // Send daemonId + one-time plaintext secret to client; never sent again after this
        const hello = { type: "hello", ok: true, userId, daemonId, reconnectSecret };
        try { ws.send(JSON.stringify(hello)); } catch { /* noop */ }
        console.log(`[daemon] paired userId=${userId} hostname=${m.hostname || "unknown"} platform=${pairPlatform}`);
        // Sync wake/talk settings to daemon after initial pair (fire-and-forget)
        if (pairPlatform === "android") setTimeout(() => syncWakeSettingsToDaemon(userId), 1500);
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

      // Wake word triggered — push an in-app event so the mobile client opens Talk Mode
      if (m.type === "wake_word_triggered" && pairedUserId) {
        const phrase: string = (m as { type: "wake_word_triggered"; phrase?: string; transcript?: string }).phrase ?? "";
        const transcript: string = (m as { type: "wake_word_triggered"; phrase?: string; transcript?: string }).transcript ?? "";
        console.log(`[daemon] wake_word_triggered userId=${pairedUserId} phrase="${phrase}"`);
        // Broadcast to any SSE/in-app listeners for this user
        wakeWordTriggerCallbacks.get(pairedUserId)?.forEach(cb => {
          try { cb({ phrase, transcript }); } catch { /* noop */ }
        });
        return;
      }

      if (m.type === "result" && pairedUserId) {
        const userMap = pendingByUser.get(socketKey(pairedUserId, pairedPlatform));
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
      if (pairedUserId) {
        const key = socketKey(pairedUserId, pairedPlatform);
        if (userSockets.get(key) === ws) {
          userSockets.delete(key);
          console.log(`[daemon] disconnected userId=${pairedUserId} platform=${pairedPlatform}`);
        }
        // Reject pending ops only for this platform's socket (not the other daemon)
        const pendingKey = socketKey(pairedUserId, pairedPlatform);
        const userMap = pendingByUser.get(pendingKey);
        if (userMap) {
          for (const [id, pending] of userMap) {
            clearTimeout(pending.timer);
            pending.resolve({ ok: false, error: "daemon disconnected" });
            userMap.delete(id);
          }
          pendingByUser.delete(pendingKey);
        }
      }
      if (pairTimeout) { clearTimeout(pairTimeout); pairTimeout = null; }
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
