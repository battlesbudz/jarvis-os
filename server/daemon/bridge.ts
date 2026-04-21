import type { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import { channelLinks, channelLinkCodes } from "@shared/schema";

interface PairMsg { type: "pair"; code: string; daemonId?: string; hostname?: string; platform?: string }
interface ResultMsg { type: "result"; id: string; ok: boolean; data?: unknown; error?: string }
interface HelloMsg { type: "hello"; ok: boolean; userId?: string; error?: string }
interface PingMsg { type: "ping" }

export type DaemonOp =
  | { type: "shell"; cmd: string; cwd?: string; timeoutMs?: number }
  | { type: "notify"; title: string; body: string }
  | { type: "file_read"; path: string }
  | { type: "file_write"; path: string; content: string }
  | { type: "file_list"; path: string };

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

export async function sendDaemonOp(
  userId: string,
  op: DaemonOp,
  timeoutMs = 15000,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const sock = userSockets.get(userId);
  if (!sock || sock.readyState !== WebSocket.OPEN) {
    return { ok: false, error: "daemon not connected" };
  }
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
    await db.insert(channelLinks).values({
      userId,
      channel: "daemon",
      address: daemonId,
      metadata: meta,
      lastSeenAt: new Date(),
    }).onConflictDoUpdate({
      target: [channelLinks.channel, channelLinks.address],
      set: { userId, metadata: meta, lastSeenAt: new Date() },
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
      const m = msg as PairMsg | ResultMsg | PingMsg;

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
        const daemonId = m.daemonId || `daemon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        await recordDaemonLink(userId, daemonId, {
          hostname: m.hostname || "unknown",
          platform: m.platform || "unknown",
        });
        // Replace any prior socket for this user
        const prior = userSockets.get(userId);
        if (prior && prior !== ws) { try { prior.close(4003, "replaced by new daemon"); } catch { /* noop */ } }
        userSockets.set(userId, ws);
        const hello: HelloMsg = { type: "hello", ok: true, userId };
        try { ws.send(JSON.stringify(hello)); } catch { /* noop */ }
        console.log(`[daemon] paired userId=${userId} hostname=${m.hostname || "unknown"}`);
        return;
      }

      if (m.type === "ping") {
        try { ws.send(JSON.stringify({ type: "pong" })); } catch { /* noop */ }
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

    ws.on("close", () => {
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
