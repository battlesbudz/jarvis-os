/**
 * Local Worker Queue
 *
 * Allows a user to register a local agent running on their own PC.
 * When all server-side transcript strategies fail, the job is forwarded
 * to the local worker which can run yt-dlp (or any other tool) without
 * the cloud host's IP ever touching YouTube.
 *
 * Architecture (no DB required — fully in-process):
 *   1. User calls GET /api/local-worker/token (requires auth) → gets a stable token
 *   2. Local worker runs on PC, polls GET /api/local-worker/jobs/next?token=XXX
 *   3. Server queues a job, waits up to 30 s for the worker to claim + return it
 *   4. Worker POSTs result to /api/local-worker/jobs/:id/complete?token=XXX
 *
 * Tokens survive until the server restarts. Re-call the setup endpoint to refresh.
 */

import crypto from "crypto";

export interface LocalJobSegment {
  text: string;
  offset: number;
  duration: number;
}

export type LocalWorkerCapability = "url-transcript" | "audio-transcription";
export type LocalWorkerClaimedJob =
  | { id: string; type: "url-transcript"; url: string }
  | { id: string; type: "audio-transcription"; audio: string; format: string; source: "telegram" };

interface WorkerRegistration {
  userId: string;
  token: string;
  lastSeen: number;
  capabilities: Set<LocalWorkerCapability>;
}

export interface LocalWorkerStatus {
  registered: boolean;
  online: boolean;
  audioOnline: boolean;
  lastSeen: number | null;
  capabilities: LocalWorkerCapability[];
}

interface LocalJob {
  id: string;
  userId: string;
  type: LocalWorkerCapability;
  url?: string;
  audio?: string;
  format?: string;
  source?: "telegram";
  status: "pending" | "claimed" | "done" | "failed";
  createdAt: number;
  resolve: (segs: LocalJobSegment[]) => void;
  reject: (err: Error) => void;
}

const tokenRegistry = new Map<string, WorkerRegistration>();
const userTokenMap = new Map<string, string>();
const jobStore = new Map<string, LocalJob>();

const WORKER_ONLINE_WINDOW_MS = 2 * 60 * 1000;
const JOB_TTL_MS = 5 * 60 * 1000;

export function getOrCreateWorkerToken(userId: string): string {
  const existing = userTokenMap.get(userId);
  if (existing && tokenRegistry.has(existing)) return existing;
  const token = `lw_${userId.slice(0, 8)}_${crypto.randomBytes(16).toString("hex")}`;
  tokenRegistry.set(token, { userId, token, lastSeen: 0, capabilities: new Set(["url-transcript"]) });
  userTokenMap.set(userId, token);
  return token;
}

export function getUserIdByToken(token: string): string | null {
  return tokenRegistry.get(token)?.userId ?? null;
}

function normalizeCapabilities(value: unknown): LocalWorkerCapability[] | null {
  if (!Array.isArray(value)) return null;
  const allowed = new Set<LocalWorkerCapability>(["url-transcript", "audio-transcription"]);
  return value.filter((item): item is LocalWorkerCapability => allowed.has(item));
}

export function heartbeat(token: string, capabilities?: unknown): boolean {
  const reg = tokenRegistry.get(token);
  if (!reg) return false;
  reg.lastSeen = Date.now();
  const normalized = normalizeCapabilities(capabilities);
  if (normalized) reg.capabilities = new Set(normalized.length > 0 ? normalized : ["url-transcript"]);
  return true;
}

export function isWorkerOnline(userId: string, capability: LocalWorkerCapability = "url-transcript"): boolean {
  const token = userTokenMap.get(userId);
  if (!token) return false;
  const reg = tokenRegistry.get(token);
  if (!reg) return false;
  if (!reg.capabilities.has(capability)) return false;
  return Date.now() - reg.lastSeen < WORKER_ONLINE_WINDOW_MS;
}

export function getWorkerStatus(userId: string): LocalWorkerStatus {
  const token = userTokenMap.get(userId);
  const reg = token ? tokenRegistry.get(token) : null;
  if (!reg) {
    return {
      registered: false,
      online: false,
      audioOnline: false,
      lastSeen: null,
      capabilities: [],
    };
  }

  const online = Date.now() - reg.lastSeen < WORKER_ONLINE_WINDOW_MS;
  return {
    registered: true,
    online,
    audioOnline: online && reg.capabilities.has("audio-transcription"),
    lastSeen: reg.lastSeen || null,
    capabilities: Array.from(reg.capabilities),
  };
}

export function queueTranscriptJob(
  userId: string,
  url: string,
  timeoutMs = 30_000
): Promise<LocalJobSegment[]> {
  return new Promise((resolve, reject) => {
    const id = `lwj_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const job: LocalJob = { id, userId, type: "url-transcript", url, status: "pending", createdAt: Date.now(), resolve, reject };
    jobStore.set(id, job);

    const timeout = setTimeout(() => {
      if (jobStore.has(id)) {
        jobStore.delete(id);
        reject(new Error("LOCAL_WORKER_TIMEOUT: Local worker did not respond within 30 seconds."));
      }
    }, timeoutMs);
    (timeout as { unref?: () => void }).unref?.();
  });
}

export function queueAudioTranscriptionJob(
  userId: string,
  audio: string,
  format: string,
  timeoutMs = 90_000,
): Promise<LocalJobSegment[]> {
  return new Promise((resolve, reject) => {
    const id = `lwa_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const job: LocalJob = {
      id,
      userId,
      type: "audio-transcription",
      audio,
      format,
      source: "telegram",
      status: "pending",
      createdAt: Date.now(),
      resolve,
      reject,
    };
    jobStore.set(id, job);

    const timeout = setTimeout(() => {
      if (jobStore.has(id)) {
        jobStore.delete(id);
        reject(new Error("LOCAL_WORKER_TIMEOUT: Local worker did not transcribe the audio in time."));
      }
    }, timeoutMs);
    (timeout as { unref?: () => void }).unref?.();
  });
}

export function claimNextJob(token: string): LocalWorkerClaimedJob | null {
  const reg = tokenRegistry.get(token);
  if (!reg) return null;
  reg.lastSeen = Date.now();
  for (const [id, job] of jobStore) {
    if (job.userId === reg.userId && job.status === "pending" && reg.capabilities.has(job.type)) {
      job.status = "claimed";
      if (job.type === "url-transcript" && job.url) return { id, type: job.type, url: job.url };
      if (job.type === "audio-transcription" && job.audio && job.format) {
        return { id, type: job.type, audio: job.audio, format: job.format, source: job.source ?? "telegram" };
      }
    }
  }
  return null;
}

export function completeJob(jobId: string, token: string, segments: LocalJobSegment[]): boolean {
  const job = jobStore.get(jobId);
  if (!job) return false;
  const reg = tokenRegistry.get(token);
  if (!reg || reg.userId !== job.userId) return false;
  job.status = "done";
  jobStore.delete(jobId);
  job.resolve(segments);
  return true;
}

export function failJob(jobId: string, token: string, error: string): boolean {
  const job = jobStore.get(jobId);
  if (!job) return false;
  const reg = tokenRegistry.get(token);
  if (!reg || reg.userId !== job.userId) return false;
  job.status = "failed";
  jobStore.delete(jobId);
  job.reject(new Error(`LOCAL_WORKER_ERROR: ${error}`));
  return true;
}

const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobStore) {
    if (now - job.createdAt > JOB_TTL_MS) {
      jobStore.delete(id);
      try { job.reject(new Error("LOCAL_WORKER_TIMEOUT: Job expired.")); } catch {}
    }
  }
}, 2 * 60 * 1000);
(cleanupInterval as { unref?: () => void }).unref?.();

export function _resetForTests(): void {
  tokenRegistry.clear();
  userTokenMap.clear();
  jobStore.clear();
}
