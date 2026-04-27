/**
 * Local Worker Queue
 *
 * Allows a user to register a local agent running on their own PC.
 * When all server-side transcript strategies fail, the job is forwarded
 * to the local worker which can run yt-dlp (or any other tool) without
 * Replit's IP ever touching YouTube.
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

interface WorkerRegistration {
  userId: string;
  token: string;
  lastSeen: number;
}

interface LocalJob {
  id: string;
  userId: string;
  url: string;
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
  tokenRegistry.set(token, { userId, token, lastSeen: 0 });
  userTokenMap.set(userId, token);
  return token;
}

export function getUserIdByToken(token: string): string | null {
  return tokenRegistry.get(token)?.userId ?? null;
}

export function heartbeat(token: string): boolean {
  const reg = tokenRegistry.get(token);
  if (!reg) return false;
  reg.lastSeen = Date.now();
  return true;
}

export function isWorkerOnline(userId: string): boolean {
  const token = userTokenMap.get(userId);
  if (!token) return false;
  const reg = tokenRegistry.get(token);
  if (!reg) return false;
  return Date.now() - reg.lastSeen < WORKER_ONLINE_WINDOW_MS;
}

export function queueTranscriptJob(
  userId: string,
  url: string,
  timeoutMs = 30_000
): Promise<LocalJobSegment[]> {
  return new Promise((resolve, reject) => {
    const id = `lwj_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const job: LocalJob = { id, userId, url, status: "pending", createdAt: Date.now(), resolve, reject };
    jobStore.set(id, job);

    setTimeout(() => {
      if (jobStore.has(id)) {
        jobStore.delete(id);
        reject(new Error("LOCAL_WORKER_TIMEOUT: Local worker did not respond within 30 seconds."));
      }
    }, timeoutMs);
  });
}

export function claimNextJob(token: string): { id: string; url: string } | null {
  const reg = tokenRegistry.get(token);
  if (!reg) return null;
  reg.lastSeen = Date.now();
  for (const [id, job] of jobStore) {
    if (job.userId === reg.userId && job.status === "pending") {
      job.status = "claimed";
      return { id, url: job.url };
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

setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobStore) {
    if (now - job.createdAt > JOB_TTL_MS) {
      jobStore.delete(id);
      try { job.reject(new Error("LOCAL_WORKER_TIMEOUT: Job expired.")); } catch {}
    }
  }
}, 2 * 60 * 1000);
