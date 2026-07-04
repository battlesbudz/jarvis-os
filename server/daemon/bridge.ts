import type { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import { channelLinks, channelLinkCodes, userPreferences } from "@shared/schema";
import { randomBytes, createHash } from "crypto";
import { getSession as _getCoachSession, setSession as _setCoachSession } from "../channels/sessionStore";

type DaemonClientKind = "unified_android_app" | "standalone_android_daemon" | "desktop_daemon";
type AndroidDaemonClientKind = "unified_android_app" | "standalone_android_daemon";
interface DaemonClientMetadata { clientKind?: DaemonClientKind; appPackage?: string; appVersion?: string }
interface AndroidDaemonClientMetadata { clientKind?: AndroidDaemonClientKind; appPackage?: string; appVersion?: string }
interface PairMsg extends DaemonClientMetadata { type: "pair"; code: string; hostname?: string; platform?: string }
interface AndroidAppBootstrapMsg extends DaemonClientMetadata { type: "android_app_bootstrap"; bootstrapToken: string; hostname?: string; platform?: string }
interface ReconnectMsg extends DaemonClientMetadata { type: "reconnect"; daemonId: string; reconnectSecret: string; hostname?: string; platform?: string }
interface ResultMsg { type: "result"; id: string; ok: boolean; data?: unknown; error?: string; [key: string]: unknown }
interface HelloMsg { type: "hello"; ok: boolean; userId?: string; error?: string }
interface PingMsg { type: "ping" }
interface NotificationEventMsg { type: "notification_event"; notification: PhoneNotification }

export type DaemonOp =
  | { type: "ping" }
  | { type: "shell"; cmd: string; cwd?: string; timeoutMs?: number; allowOutsideRoot?: boolean }
  | { type: "codex_oauth_prompt"; prompt: string; command?: string; timeoutMs?: number }
  | { type: "codex_oauth_app_server_prompt"; prompt: string; command?: string; timeoutMs?: number }
  | { type: "codex_oauth_cancel" }
  | { type: "notify"; title: string; body: string }
  | { type: "android_notify"; title: string; body: string }
  | { type: "file_read"; path: string }
  | { type: "file_write"; path: string; content: string }
  | { type: "file_list"; path: string }
  | { type: "android_open_app"; packageName: string }
  | { type: "android_list_apps" }
  | { type: "android_browse"; url: string }
  | { type: "android_screenshot" }
  | { type: "android_read_screen" }
  | { type: "android_screen_context" }
  | { type: "android_operator_action"; action: Record<string, unknown> }
  | { type: "android_local_model_status"; model?: string }
  | { type: "android_local_model_import"; model?: string; sourcePath?: string; fileName?: string }
  | { type: "android_local_model_validate"; model?: string; backend?: string; contextTokens?: number; keepEngineWarm?: boolean; allowCpuFallback?: boolean; speculativeDecoding?: boolean; profileId?: string; profileLabel?: string }
  | { type: "android_local_model_smoke_test"; model?: string }
  | { type: "android_local_model_generate"; requestId?: string; model: string; prompt: string; contextTokens?: number; maxTokens?: number; backend?: string; allowCpuFallback?: boolean; speculativeDecoding?: boolean; temperature?: number }
  | { type: "android_local_model_cancel"; requestId?: string }
  | { type: "android_tap"; x: number; y: number }
  | { type: "android_type"; text: string; submit?: boolean }
  | { type: "android_swipe"; x1: number; y1: number; x2: number; y2: number; durationMs?: number }
  | { type: "android_pinch"; pointer1: { x1: number; y1: number; x2: number; y2: number }; pointer2: { x1: number; y1: number; x2: number; y2: number }; durationMs?: number }
  | { type: "android_press_key"; key: "back" | "home" | "recents" | "volume_up" | "volume_down" | "enter" | "select_all" | "delete" }

  | { type: "android_file_list"; path: string }
  | { type: "android_file_read"; path: string }
  | { type: "android_notifications_list"; limit?: number }
  | { type: "android_return_to_jarvis" }
  | { type: "android_file_search"; query: string; root?: string; fileType?: string; maxDepth?: number }
  | { type: "android_open_file"; path: string }
  | { type: "android_copy_to_clipboard"; path: string }
  | { type: "android_copy_text_to_clipboard"; text: string; label?: string }
  | { type: "desktop_screenshot" }
  | { type: "desktop_read_screen" }
  | { type: "android_notification_reply"; notificationKey: string; replyText: string }
  | { type: "browser_mcp"; tool: string; args: Record<string, unknown> }
  | { type: "voice_set_wake_words"; enabled: boolean; words?: string[]; talkMode?: boolean; allowSoftwareWakeWordFallback?: boolean }
  | { type: "voice_set_talk_mode"; enabled: boolean }
  | { type: "voice_tts_finished" }
  | { type: "voice_speak_audio"; audioBase64: string; format?: string }
  | { type: "android_camera_snap"; facing?: "front" | "back" | "both" }
  | { type: "android_camera_clip"; facing?: "front" | "back"; durationMs?: number; audio?: boolean }
  | { type: "android_location_get"; accuracy?: "coarse" | "precise"; maxAgeMs?: number }
  | { type: "android_sms_send"; to: string; message: string }
  | { type: "android_screen_record"; durationMs?: number; fps?: number; audio?: boolean }
  | { type: "android_view_hierarchy" }
  | { type: "android_paste_text"; text: string; fieldDescription?: string }
  | { type: "android_get_focused_field" }
  | { type: "android_clear_field" }
  | { type: "android_start_training"; label: string; timeoutMs?: number }
  | { type: "android_get_display_size" };

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
  socket: WebSocket;
  timer: ReturnType<typeof setTimeout>;
}

// Keyed by `${userId}:${platform}` where platform is "desktop" or "android"
const userSockets = new Map<string, WebSocket>();
const pendingByUser = new Map<string, Map<string, PendingOp>>();
const daemonSocketReplacementLocks = new Set<string>();
const ANDROID_DAEMON_BOOTSTRAP_TOKEN_PREFIX = "android_bootstrap_";
let opCounter = 0;

// Wake word event subscriptions: userId → set of callbacks
const wakeWordTriggerCallbacks = new Map<string, Set<(e: { phrase: string; transcript: string; daemonHandling: boolean }) => void>>();

// ── Training tap subscriptions ───────────────────────────────────────────────
// One pending waiter per user at a time.  android_train_button tool sets this;
// the training_tap event handler resolves it.
export interface TrainingTapEvent {
  x: number;
  y: number;
  appPackage: string;
  screenContext: string;
  elementLabel: string;
  screenshotBase64?: string;
}

interface TrainingWaiter {
  label: string;
  resolve: (event: TrainingTapEvent) => void;
  reject: (reason: string) => void;
  timer: ReturnType<typeof setTimeout>;
}

const trainingWaiters = new Map<string, TrainingWaiter>();

/**
 * Register a one-shot listener for the next training_tap event from the
 * Android daemon for this user.  Times out after timeoutMs (default 60 s).
 * The returned Promise resolves with the event payload, or rejects on timeout.
 */
export function waitForTrainingTap(
  userId: string,
  label: string,
  timeoutMs = 60_000,
): Promise<TrainingTapEvent> {
  return new Promise<TrainingTapEvent>((resolve, reject) => {
    // Cancel any previous waiter for this user
    const prior = trainingWaiters.get(userId);
    if (prior) {
      clearTimeout(prior.timer);
      prior.reject("superseded by new training session");
    }
    const timer = setTimeout(() => {
      trainingWaiters.delete(userId);
      reject("Training timed out — no tap received within the allowed time.");
    }, timeoutMs);
    trainingWaiters.set(userId, { label, resolve, reject, timer });
  });
}

export function subscribeWakeWordTrigger(
  userId: string,
  cb: (e: { phrase: string; transcript: string; daemonHandling: boolean }) => void,
): () => void {
  if (!wakeWordTriggerCallbacks.has(userId)) wakeWordTriggerCallbacks.set(userId, new Set());
  wakeWordTriggerCallbacks.get(userId)!.add(cb);
  return () => wakeWordTriggerCallbacks.get(userId)?.delete(cb);
}

// ── Per-user session ID store for daemon (Voice) coach conversations ────────
// Backed by the shared persistent sessionStore so sessions survive server
// restarts. The store keeps an in-process Map as a fast path with the DB as
// the durable backing layer.

/**
 * Handles a voice utterance captured by the Android daemon in Talk Mode.
 * Routes through the full Jarvis coach pipeline (runCoachAgent) so the response
 * has access to the user's goals, memory, calendar, and tools — exactly like a
 * Telegram or in-app message would.
 * After getting the reply text, converts to speech and sends voice_speak_audio
 * back to the daemon so the phone plays it immediately (hands-free loop).
 */
async function processDaemonUtterance(userId: string, utterance: string): Promise<void> {
  try {
    console.log(`[daemon] talk: processing utterance for userId=${userId}: "${utterance.slice(0, 60)}"`);
    const { runCoachAgent } = await import("../channels/coachAgent");
    const { textToSpeech } = await import("../integrations/audioClient");

    const storedSessionId = await _getCoachSession(userId, "Voice");
    const result = await runCoachAgent({
      userId,
      userText: utterance,
      channelName: "Voice",
      sdkSessionId: storedSessionId,
    });
    if (result.sdkSessionId) {
      _setCoachSession(userId, "Voice", result.sdkSessionId);
    }

    const responseText = result.reply.trim() || "I'm not sure how to help with that.";
    console.log(`[daemon] talk: Jarvis reply: "${responseText.slice(0, 80)}"`);

    const audioBuffer = await textToSpeech(responseText, "alloy", "mp3");
    const audioBase64 = audioBuffer.toString("base64");

    // Send audio to daemon — it plays it and then re-arms for the next wake word
    await sendDaemonOp(userId, { type: "voice_speak_audio", audioBase64, format: "mp3" }, 15_000);
  } catch (err) {
    console.error("[daemon] processDaemonUtterance failed:", err);
    // Notify the user so they know something went wrong
    sendDaemonOp(userId, { type: "notify", title: "Jarvis", body: "Could not process your request — please try again." }, 5_000).catch(() => {});
  }
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
    const softwareWakeWordFallbackEnabled: boolean = prefs.softwareWakeWordFallbackEnabled === true;
    // Always push authoritative state. System-assistant mode keeps the old foreground mic listener off.
    await sendDaemonOp(userId, {
      type: "voice_set_wake_words",
      enabled: wakeWordEnabled && softwareWakeWordFallbackEnabled,
      words: wakeWords,
      talkMode: talkModeEnabled,
      allowSoftwareWakeWordFallback: softwareWakeWordFallbackEnabled,
    }, 5000);
    console.log(`[daemon] wake settings synced on connect: userId=${userId} enabled=${wakeWordEnabled} talkMode=${talkModeEnabled} softwareFallback=${softwareWakeWordFallbackEnabled}`);
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

function normalizeDaemonPlatform(platform: unknown): "desktop" | "android" {
  return String(platform || "").toLowerCase() === "android" ? "android" : "desktop";
}

function normalizeDaemonClientKind(value: unknown): DaemonClientKind | undefined {
  if (
    value === "unified_android_app" ||
    value === "standalone_android_daemon" ||
    value === "desktop_daemon"
  ) {
    return value;
  }
  return undefined;
}

function normalizeAndroidDaemonClientKind(value: unknown): AndroidDaemonClientKind | undefined {
  if (value === "unified_android_app" || value === "standalone_android_daemon") {
    return value;
  }
  return undefined;
}

function buildAndroidDaemonClientMetadata(platform: "desktop" | "android", msg: {
  clientKind?: unknown;
  appPackage?: unknown;
  appVersion?: unknown;
}): AndroidDaemonClientMetadata | null {
  if (platform !== "android") return null;
  const android_client: AndroidDaemonClientMetadata = {};
  const clientKind = normalizeAndroidDaemonClientKind(msg.clientKind);
  if (clientKind) android_client.clientKind = clientKind;
  if (typeof msg.appPackage === "string" && msg.appPackage.trim()) {
    android_client.appPackage = msg.appPackage.trim();
  }
  if (typeof msg.appVersion === "string" && msg.appVersion.trim()) {
    android_client.appVersion = msg.appVersion.trim();
  }
  return Object.keys(android_client).length > 0 ? android_client : null;
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

export function shouldProtectPendingDaemonSocket(prior: { readyState: number } | undefined, pendingCount: number): boolean {
  return !!(prior && prior.readyState === WebSocket.OPEN && pendingCount > 0);
}

function pendingOpCount(key: string): number {
  return pendingByUser.get(key)?.size ?? 0;
}

function isDaemonSocketReplacementLocked(key: string): boolean {
  return daemonSocketReplacementLocks.has(key);
}

function rejectDuplicateDaemonSocket(
  ws: WebSocket,
  userId: string,
  platform: string,
  pendingCount: number,
): void {
  const message = "Existing Desktop Daemon operation is still running; keeping the active socket.";
  try { ws.send(JSON.stringify({ type: "hello", ok: false, error: message })); } catch { /* noop */ }
  try { ws.close(4004, "daemon busy"); } catch { /* noop */ }
  console.log(`[daemon] duplicate connection rejected userId=${userId} platform=${platform} pending=${pendingCount}`);
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
export type DaemonAction = "shell" | "notify" | "file_read" | "file_write" | "file_list" | "desktop_screenshot" | "desktop_read_screen" | "browser_local" | "allow_outside_root";
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
  allow_outside_root: false,
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
  | "android_tap_type"
  | "android_camera"
  | "android_location"
  | "android_sms"
  | "android_screen_record"
  | "android_local_model";
export type AndroidDaemonPermissions = Record<AndroidDaemonAction, boolean>;

export const DEFAULT_ANDROID_DAEMON_PERMISSIONS: AndroidDaemonPermissions = {
  android_screenshot: true,
  android_read_screen: true,
  android_open_app: true,
  android_browse: true,
  android_file_list: true,
  android_file_read: false,
  android_tap_type: false,
  android_camera: true,
  android_location: true,
  android_sms: false,
  android_screen_record: true,
  android_local_model: true,
};

function operatorActionPermKey(operatorAction: Record<string, unknown>): AndroidDaemonAction | null {
  switch (operatorAction.type) {
    case "open_app":
      return "android_open_app";
    case "tap_element":
    case "tap_coordinates":
    case "type_text":
    case "swipe":
    case "press_key":
      return "android_tap_type";
    case "wait":
    case "done":
      return null;
    default:
      return "android_tap_type";
  }
}

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

/**
 * Return the ISO string of the last time the daemon for this userId+platform
 * was seen (from channel_links.lastSeenAt), or null if no row exists.
 */
export async function getDaemonLastSeen(userId: string, platform: string): Promise<string | null> {
  try {
    const row = await findUserDaemonRow(userId, platform);
    if (!row?.lastSeenAt) return null;
    return new Date(row.lastSeenAt).toISOString();
  } catch {
    return null;
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

export async function pingAndroidDaemon(
  userId: string,
  timeoutMs = 5000,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  return sendDaemonOp(userId, { type: "ping" }, timeoutMs, "android");
}

export async function sendDaemonOp(
  userId: string,
  op: DaemonOp,
  timeoutMs = 15000,
  platformOverride?: "desktop" | "android",
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const isAndroidOp = op.type.startsWith("android_") || op.type.startsWith("voice_");
  // "notify" and "ping" are platform-neutral: route to desktop first, android fallback.
  // All other non-android ops are desktop-only; android_*/voice_* ops are android-only.
  const isPlatformNeutral = op.type === "ping" || op.type === "notify";

  let sock: WebSocket | undefined;
  if (platformOverride) {
    sock = userSockets.get(socketKey(userId, platformOverride));
  } else if (isPlatformNeutral) {
    sock = userSockets.get(socketKey(userId, "desktop")) || userSockets.get(socketKey(userId, "android"));
  } else if (isAndroidOp) {
    sock = userSockets.get(socketKey(userId, "android"));
  } else {
    sock = userSockets.get(socketKey(userId, "desktop"));
  }

  if (!sock || sock.readyState !== WebSocket.OPEN) {
    const missing = platformOverride
      ? `${platformOverride} daemon`
      : isPlatformNeutral ? "daemon" : isAndroidOp ? "android daemon" : "desktop daemon";
    console.log(`[daemon] op SKIPPED — ${missing} not connected userId=${userId} op=${op.type}`);
    if (platformOverride === "android" || isAndroidOp) {
      return { ok: false, error: "Jarvis Android app device control is not connected. Open the Jarvis Android app and enable Device Control." };
    }
    if (platformOverride === "desktop" || !isPlatformNeutral) {
      return { ok: false, error: "Desktop daemon not connected. Ask the user to install and pair the desktop daemon." };
    }
    return { ok: false, error: "No daemon connected. Install and pair the desktop daemon or the Android APK from Profile → Connected Channels." };
  }
  // Determine which platform this op is actually going to (for scoped pending tracking)
  let actualPlatform: string;
  if (platformOverride) {
    actualPlatform = platformOverride;
  } else if (isPlatformNeutral) {
    const deskSock = userSockets.get(socketKey(userId, "desktop"));
    actualPlatform = (sock === deskSock) ? "desktop" : "android";
  } else {
    actualPlatform = isAndroidOp ? "android" : "desktop";
  }
  const pendingKey = socketKey(userId, actualPlatform);
  if (isDaemonSocketReplacementLocked(pendingKey)) {
    console.log(`[daemon] op SKIPPED - daemon socket replacement in progress userId=${userId} platform=${actualPlatform} op=${op.type}`);
    return { ok: false, error: "Desktop daemon connection is being refreshed. Retry shortly." };
  }

  // ── Bridge-level Android permission gate ──────────────────────────────────
  // Enforce permission checks at the bridge layer so no code path can bypass
  // the user's permission settings, even if the tool layer check is skipped.
  const isCodexOAuthOp = op.type === "codex_oauth_prompt" || op.type === "codex_oauth_app_server_prompt";
  if (!isAndroidOp && !isPlatformNeutral && isCodexOAuthOp) {
    const allowed = await isDaemonActionAllowed(userId, "shell");
    if (!allowed) {
      const msg = "Desktop daemon Shell Execution is disabled. Enable it in Profile -> Connected Channels -> Desktop Daemon before using Codex OAuth through the daemon.";
      console.log(`[daemon] op BLOCKED (bridge-level permission) userId=${userId} op=${op.type} perm=shell`);
      return { ok: false, error: msg };
    }
  }

  if (isAndroidOp) {
    const OP_PERM_MAP: Partial<Record<string, AndroidDaemonAction>> = {
      android_camera_snap:    "android_camera",
      android_camera_clip:    "android_camera",
      android_location_get:   "android_location",
      android_sms_send:       "android_sms",
      android_screen_record:  "android_screen_record",
      android_screen_context: "android_read_screen",
      android_view_hierarchy: "android_read_screen",
      android_copy_to_clipboard: "android_tap_type",
      android_copy_text_to_clipboard: "android_tap_type",
      android_pinch:          "android_tap_type",
      android_local_model_status:   "android_local_model",
      android_local_model_import:   "android_local_model",
      android_local_model_validate: "android_local_model",
      android_local_model_smoke_test: "android_local_model",
      android_local_model_generate: "android_local_model",
      android_local_model_cancel:   "android_local_model",
    };
    const requiredPerm = op.type === "android_operator_action"
      ? operatorActionPermKey(op.action)
      : OP_PERM_MAP[op.type];
    if (requiredPerm) {
      const allowed = await isAndroidDaemonActionAllowed(userId, requiredPerm);
      if (!allowed) {
        const msg = `Android permission '${requiredPerm}' is disabled. Enable it in Profile → Connected Channels → Android Daemon before using this feature.`;
        console.log(`[daemon] op BLOCKED (bridge-level permission) userId=${userId} op=${op.type} perm=${requiredPerm}`);
        return { ok: false, error: msg };
      }
    }
  }
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`[daemon] op SENT userId=${userId} op=${op.type}`, 'packageName' in op ? `pkg=${(op as any).packageName}` : '');
  const sentAt = Date.now();
  return new Promise((resolve) => {
    const id = nextOpId();
    const timer = setTimeout(() => {
      const map = pendingByUser.get(pendingKey);
      map?.delete(id);
      console.log(`[daemon] op TIMEOUT userId=${userId} op=${op.type}`);
      if (isCodexOAuthOp) {
        try {
          sock.send(JSON.stringify({ type: "op", id: nextOpId(), op: { type: "codex_oauth_cancel" } }));
        } catch {
          // Best-effort cleanup only; the caller is already receiving a timeout.
        }
      }
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
      socket: sock,
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

export async function createAndroidDaemonBootstrapToken(userId: string): Promise<string> {
  const bootstrapToken = `${ANDROID_DAEMON_BOOTSTRAP_TOKEN_PREFIX}${randomBytes(32).toString("hex")}`;
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  await db.insert(channelLinkCodes).values({
    code: bootstrapToken, userId, channel: "daemon", expiresAt,
  });
  return bootstrapToken;
}

async function lookupPairingCodeUserId(code: string): Promise<string | null> {
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
    return row.userId;
  } catch (err) {
    console.error("[daemon] lookupPairingCodeUserId failed:", err);
    return null;
  }
}

async function lookupAndroidDaemonBootstrapTokenUserId(bootstrapToken: string): Promise<string | null> {
  if (!bootstrapToken.startsWith(ANDROID_DAEMON_BOOTSTRAP_TOKEN_PREFIX)) return null;
  try {
    const rows = await db.select().from(channelLinkCodes)
      .where(and(eq(channelLinkCodes.code, bootstrapToken), eq(channelLinkCodes.channel, "daemon")))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
      await db.delete(channelLinkCodes).where(eq(channelLinkCodes.code, bootstrapToken));
      return null;
    }
    return row.userId;
  } catch (err) {
    console.error("[daemon] lookupAndroidDaemonBootstrapTokenUserId failed:", err);
    return null;
  }
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

async function consumeAndroidDaemonBootstrapToken(bootstrapToken: string): Promise<string | null> {
  if (!bootstrapToken.startsWith(ANDROID_DAEMON_BOOTSTRAP_TOKEN_PREFIX)) return null;
  try {
    const rows = await db.select().from(channelLinkCodes)
      .where(and(eq(channelLinkCodes.code, bootstrapToken), eq(channelLinkCodes.channel, "daemon")))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
      await db.delete(channelLinkCodes).where(eq(channelLinkCodes.code, bootstrapToken));
      return null;
    }
    await db.delete(channelLinkCodes).where(eq(channelLinkCodes.code, bootstrapToken));
    return row.userId;
  } catch (err) {
    console.error("[daemon] consumeAndroidDaemonBootstrapToken failed:", err);
    return null;
  }
}

async function recordDaemonLink(userId: string, daemonId: string, meta: Record<string, unknown>): Promise<void> {
  try {
    const rawPlatform = meta.platform as string | undefined;
    const platform = normalizeDaemonPlatform(rawPlatform);
    // Find existing rows and preserve permissions from the same-platform row.
    const existing = await db.select().from(channelLinks)
      .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, "daemon")));
    const mergedMeta: Record<string, unknown> = { ...meta, platform };
    if (rawPlatform && rawPlatform !== platform && !mergedMeta.osPlatform) {
      mergedMeta.osPlatform = rawPlatform;
    }
    for (const row of existing) {
      const prior = (row.metadata as Record<string, unknown> | null) || {};
      const priorPlatform = normalizeDaemonPlatform(prior.platform);
      if (priorPlatform === platform) {
        // Preserve existing permissions for this platform
        if (prior.permissions && !mergedMeta.permissions) {
          mergedMeta.permissions = prior.permissions;
        }
        if (prior.android_permissions && !mergedMeta.android_permissions) {
          mergedMeta.android_permissions = prior.android_permissions;
        }
        if (platform === "android" && prior.android_client && !mergedMeta.android_client) {
          mergedMeta.android_client = prior.android_client;
        }
      }
    }
    // Delete only the existing row for this platform (preserve the other platform's row)
    for (const row of existing) {
      const priorMeta = (row.metadata as Record<string, unknown> | null) || {};
      const priorPlatform = normalizeDaemonPlatform(priorMeta.platform);
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
      // Not our path — leave the socket alone so other upgrade handlers can claim it
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
      const m = msg as PairMsg | AndroidAppBootstrapMsg | ReconnectMsg | ResultMsg | PingMsg | NotificationEventMsg | WakeWordTriggeredMsg;

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
          if (pairTimeout) { clearTimeout(pairTimeout); pairTimeout = null; }
          // Update metadata with fresh hostname/platform if provided
          if (rm.hostname) storedMeta.hostname = rm.hostname;
          if (rm.platform) {
            const rawPlatform = rm.platform;
            const normalizedPlatform = normalizeDaemonPlatform(rawPlatform);
            storedMeta.platform = normalizedPlatform;
            if (rawPlatform !== normalizedPlatform && !storedMeta.osPlatform) storedMeta.osPlatform = rawPlatform;
          }
          const reconnPlatform = normalizeDaemonPlatform(storedMeta.platform);
          const android_client = buildAndroidDaemonClientMetadata(reconnPlatform, rm);
          if (android_client) {
            const priorClient = storedMeta.android_client && typeof storedMeta.android_client === "object"
              ? storedMeta.android_client as Record<string, unknown>
              : {};
            storedMeta.android_client = { ...priorClient, ...android_client };
          } else if (reconnPlatform !== "android") {
            delete storedMeta.android_client;
          }
          storedMeta.platform = reconnPlatform;
          const reconnectUserId = row.userId;
          const reconnKey = socketKey(reconnectUserId, reconnPlatform);
          const prior = userSockets.get(reconnKey);
          const pendingCount = pendingOpCount(reconnKey);
          if (prior && prior !== ws && shouldProtectPendingDaemonSocket(prior, pendingCount)) {
            rejectDuplicateDaemonSocket(ws, reconnectUserId, reconnPlatform, pendingCount);
            return;
          }
          daemonSocketReplacementLocks.add(reconnKey);
          try {
            await db.update(channelLinks)
              .set({ metadata: storedMeta, lastSeenAt: new Date() })
              .where(eq(channelLinks.id, row.id));
            const currentPrior = userSockets.get(reconnKey);
            const currentPendingCount = pendingOpCount(reconnKey);
            if (currentPrior && currentPrior !== ws && shouldProtectPendingDaemonSocket(currentPrior, currentPendingCount)) {
              rejectDuplicateDaemonSocket(ws, reconnectUserId, reconnPlatform, currentPendingCount);
              return;
            }
            pairedUserId = reconnectUserId;
            pairedPlatform = reconnPlatform;
            if (currentPrior && currentPrior !== ws) { try { currentPrior.close(4003, "replaced by new daemon"); } catch { /* noop */ } }
            userSockets.set(reconnKey, ws);
            const hello: HelloMsg = { type: "hello", ok: true, userId: pairedUserId };
            try { ws.send(JSON.stringify(hello)); } catch { /* noop */ }
            console.log(`[daemon] reconnected userId=${pairedUserId} platform=${reconnPlatform} daemonId=${rm.daemonId}`);
            // Sync wake/talk settings to daemon after reconnect (fire-and-forget)
            if (reconnPlatform === "android") setTimeout(() => syncWakeSettingsToDaemon(pairedUserId ?? ""), 1500);
          } finally {
            daemonSocketReplacementLocks.delete(reconnKey);
          }
        } catch (err) {
          console.error("[daemon] reconnect lookup failed:", err);
          try { ws.send(JSON.stringify({ type: "hello", ok: false, error: "reconnect failed" })); } catch { /* noop */ }
        }
        return;
      }

      if (m.type === "android_app_bootstrap") {
        const bm = m as AndroidAppBootstrapMsg;
        const pairPlatform = "android";
        const candidateUserId = await lookupAndroidDaemonBootstrapTokenUserId(bm.bootstrapToken);
        if (!candidateUserId) {
          const reply: HelloMsg = { type: "hello", ok: false, error: "invalid or expired bootstrap token" };
          try { ws.send(JSON.stringify(reply)); } catch { /* noop */ }
          ws.close(4002, "invalid bootstrap token");
          return;
        }
        const pairKey = socketKey(candidateUserId, pairPlatform);
        const prior = userSockets.get(pairKey);
        const pendingCount = pendingOpCount(pairKey);
        if (prior && prior !== ws && shouldProtectPendingDaemonSocket(prior, pendingCount)) {
          rejectDuplicateDaemonSocket(ws, candidateUserId, pairPlatform, pendingCount);
          return;
        }
        daemonSocketReplacementLocks.add(pairKey);
        try {
          const userId = await consumeAndroidDaemonBootstrapToken(bm.bootstrapToken);
          if (!userId || userId !== candidateUserId) {
            const reply: HelloMsg = { type: "hello", ok: false, error: "invalid or expired bootstrap token" };
            try { ws.send(JSON.stringify(reply)); } catch { /* noop */ }
            ws.close(4002, "invalid bootstrap token");
            return;
          }
          if (pairTimeout) { clearTimeout(pairTimeout); pairTimeout = null; }
          const daemonId = randomBytes(16).toString("hex");
          const reconnectSecret = randomBytes(32).toString("hex");
          const reconnectSecretHash = createHash("sha256").update(reconnectSecret).digest("hex");
          const bootstrapMsg = { ...bm, clientKind: "unified_android_app" as const };
          const android_client = buildAndroidDaemonClientMetadata(pairPlatform, bootstrapMsg);
          await recordDaemonLink(userId, daemonId, {
            hostname: bm.hostname || "unknown",
            platform: pairPlatform,
            ...(android_client ? { android_client } : {}),
            reconnectSecretHash,
          });
          pairedUserId = userId;
          pairedPlatform = pairPlatform;
          const currentPrior = userSockets.get(pairKey);
          const currentPendingCount = pendingOpCount(pairKey);
          if (currentPrior && currentPrior !== ws && shouldProtectPendingDaemonSocket(currentPrior, currentPendingCount)) {
            rejectDuplicateDaemonSocket(ws, userId, pairPlatform, currentPendingCount);
            return;
          }
          if (currentPrior && currentPrior !== ws) { try { currentPrior.close(4003, "replaced by new daemon"); } catch { /* noop */ } }
          userSockets.set(pairKey, ws);
          const hello = { type: "hello", ok: true, userId, daemonId, reconnectSecret };
          try { ws.send(JSON.stringify(hello)); } catch { /* noop */ }
          console.log(`[daemon] Android app bootstrapped userId=${userId} hostname=${bm.hostname || "unknown"}`);
          setTimeout(() => syncWakeSettingsToDaemon(userId), 1500);
        } finally {
          daemonSocketReplacementLocks.delete(pairKey);
        }
        return;
      }

      if (m.type === "pair") {
        const rawPairPlatform = m.platform || "desktop";
        const pairPlatform = normalizeDaemonPlatform(rawPairPlatform);
        const candidateUserId = await lookupPairingCodeUserId(m.code);
        if (!candidateUserId) {
          const reply: HelloMsg = { type: "hello", ok: false, error: "invalid or expired code" };
          try { ws.send(JSON.stringify(reply)); } catch { /* noop */ }
          ws.close(4002, "invalid code");
          return;
        }
        const pairKey = socketKey(candidateUserId, pairPlatform);
        const prior = userSockets.get(pairKey);
        const pendingCount = pendingOpCount(pairKey);
        if (prior && prior !== ws && shouldProtectPendingDaemonSocket(prior, pendingCount)) {
          rejectDuplicateDaemonSocket(ws, candidateUserId, pairPlatform, pendingCount);
          return;
        }
        daemonSocketReplacementLocks.add(pairKey);
        try {
          const userId = await consumePairingCode(m.code);
        if (!userId) {
          const reply: HelloMsg = { type: "hello", ok: false, error: "invalid or expired code" };
          try { ws.send(JSON.stringify(reply)); } catch { /* noop */ }
          ws.close(4002, "invalid code");
          return;
        }
        if (userId !== candidateUserId) {
          const reply: HelloMsg = { type: "hello", ok: false, error: "invalid or expired code" };
          try { ws.send(JSON.stringify(reply)); } catch { /* noop */ }
          ws.close(4002, "invalid code");
          return;
        }
        if (pairTimeout) { clearTimeout(pairTimeout); pairTimeout = null; }
        // Generate cryptographically random daemonId and reconnectSecret server-side.
        // Never trust a client-supplied daemonId — reject any the client sends.
        const daemonId = randomBytes(16).toString("hex");
        const reconnectSecret = randomBytes(32).toString("hex");
        const reconnectSecretHash = createHash("sha256").update(reconnectSecret).digest("hex");
        const android_client = buildAndroidDaemonClientMetadata(pairPlatform, m);
        await recordDaemonLink(userId, daemonId, {
          hostname: m.hostname || "unknown",
          platform: pairPlatform,
          ...(rawPairPlatform !== pairPlatform ? { osPlatform: rawPairPlatform } : {}),
          ...(android_client ? { android_client } : {}),
          reconnectSecretHash,
        });
        pairedUserId = userId;
        pairedPlatform = pairPlatform;
        // Replace any prior socket for the same platform only
        const currentPrior = userSockets.get(pairKey);
        const currentPendingCount = pendingOpCount(pairKey);
        if (currentPrior && currentPrior !== ws && shouldProtectPendingDaemonSocket(currentPrior, currentPendingCount)) {
          rejectDuplicateDaemonSocket(ws, userId, pairPlatform, currentPendingCount);
          return;
        }
        if (currentPrior && currentPrior !== ws) { try { currentPrior.close(4003, "replaced by new daemon"); } catch { /* noop */ } }
        userSockets.set(pairKey, ws);
        // Send daemonId + one-time plaintext secret to client; never sent again after this
        const hello = { type: "hello", ok: true, userId, daemonId, reconnectSecret };
        try { ws.send(JSON.stringify(hello)); } catch { /* noop */ }
        console.log(`[daemon] paired userId=${userId} hostname=${m.hostname || "unknown"} platform=${pairPlatform}`);
        // Sync wake/talk settings to daemon after initial pair (fire-and-forget)
        if (pairPlatform === "android") setTimeout(() => syncWakeSettingsToDaemon(userId), 1500);
        } finally {
          daemonSocketReplacementLocks.delete(pairKey);
        }
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

      // Training tap — user physically tapped the screen while training mode was active
      if ((m.type as string) === "training_tap" && pairedUserId) {
        const tm = m as { type: string; x?: number; y?: number; appPackage?: string; screenContext?: string; elementLabel?: string; screenshot?: string };
        const waiter = trainingWaiters.get(pairedUserId);
        if (waiter) {
          clearTimeout(waiter.timer);
          trainingWaiters.delete(pairedUserId);
          waiter.resolve({
            x: tm.x ?? 0,
            y: tm.y ?? 0,
            appPackage: tm.appPackage ?? "",
            screenContext: tm.screenContext ?? "",
            elementLabel: tm.elementLabel ?? waiter.label,
            screenshotBase64: tm.screenshot,
          });
        }
        return;
      }

      // Voice utterance from daemon Talk Mode — run through AI and respond via TTS
      if ((m.type as string) === "voice_user_utterance" && pairedUserId) {
        const text = (m as { type: string; text?: string }).text ?? "";
        if (text) {
          processDaemonUtterance(pairedUserId, text).catch(err =>
            console.error(`[daemon] voice_user_utterance processing failed: ${err}`)
          );
        }
        return;
      }

      // Wake word triggered — push an in-app event so the mobile client opens Talk Mode
      if (m.type === "wake_word_triggered" && pairedUserId) {
        const wm = m as { type: "wake_word_triggered"; phrase?: string; transcript?: string; daemonHandling?: boolean };
        const phrase: string = wm.phrase ?? "";
        const transcript: string = wm.transcript ?? "";
        const daemonHandling: boolean = !!wm.daemonHandling;
        console.log(`[daemon] wake_word_triggered userId=${pairedUserId} phrase="${phrase}" daemonHandling=${daemonHandling}`);
        // Broadcast to any SSE/in-app listeners for this user
        wakeWordTriggerCallbacks.get(pairedUserId)?.forEach(cb => {
          try { cb({ phrase, transcript, daemonHandling }); } catch { /* noop */ }
        });
        return;
      }

      if (m.type === "result" && pairedUserId) {
        const userMap = pendingByUser.get(socketKey(pairedUserId, pairedPlatform));
        const pending = userMap?.get(m.id);
        if (pending) {
          clearTimeout(pending.timer);
          userMap!.delete(m.id);
          // Daemon spreads result fields at the top level (stdout, stderr, content, etc.).
          // If `data` is absent, collect those extra fields so callers can access them.
          const { type: _t, id: _i, ok, data, error, ...rest } = m as ResultMsg;
          const resolvedData = data !== undefined ? data : (Object.keys(rest).length > 0 ? rest : undefined);
          pending.resolve({ ok, data: resolvedData, error });
        }
        // Update last_seen
        db.update(channelLinks)
          .set({ lastSeenAt: new Date() })
          .where(and(eq(channelLinks.userId, pairedUserId), eq(channelLinks.channel, "daemon")))
          .catch((err) => console.error("[daemon] last_seen update failed:", err));
      }
    });

    // Server-side keepalive - ping the daemon every 20 s so hosting proxies
    // do not drop the WebSocket due to idle timeout.
    const keepalive = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.ping(); } catch { /* noop */ }
      }
    }, 20000);

    ws.on("close", () => {
      clearInterval(keepalive);
      if (pairedUserId) {
        const key = socketKey(pairedUserId, pairedPlatform);
        const wasRegisteredSocket = userSockets.get(key) === ws;
        if (wasRegisteredSocket) {
          userSockets.delete(key);
          console.log(`[daemon] disconnected userId=${pairedUserId} platform=${pairedPlatform}`);
        }
        // Reject pending ops only for this platform's socket (not the other daemon)
        const pendingKey = socketKey(pairedUserId, pairedPlatform);
        const userMap = pendingByUser.get(pendingKey);
        if (userMap) {
          for (const [id, pending] of userMap) {
            if (pending.socket !== ws) continue;
            clearTimeout(pending.timer);
            pending.resolve({ ok: false, error: "daemon disconnected" });
            userMap.delete(id);
          }
          if (userMap.size === 0) pendingByUser.delete(pendingKey);
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
