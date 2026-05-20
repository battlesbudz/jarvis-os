import type { Express, Request, Response } from "express";

const paramValue = (value: string | string[]): string => Array.isArray(value) ? (value[0] ?? "") : value;

export function registerLocalWorkerRoutes(app: Express): void {
  app.get("/api/local-worker/token", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const { getOrCreateWorkerToken } = await import("../lib/localWorkerQueue");
    const token = getOrCreateWorkerToken(userId);
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    res.json({
      token,
      instructions: {
        poll: `GET  ${baseUrl}/api/local-worker/jobs/next?token=${token}`,
        complete: `POST ${baseUrl}/api/local-worker/jobs/:id/complete?token=${token}`,
        fail: `POST ${baseUrl}/api/local-worker/jobs/:id/fail?token=${token}`,
        heartbeat: `POST ${baseUrl}/api/local-worker/heartbeat?token=${token}`,
        capabilities: ["url-transcript", "audio-transcription"],
      },
    });
  });

  app.post("/api/local-worker/heartbeat", async (req: Request, res: Response) => {
    const token = String(req.query.token || req.body?.token || "");
    if (!token) return res.status(400).json({ error: "token required" });
    const { heartbeat } = await import("../lib/localWorkerQueue");
    if (!heartbeat(token, req.body?.capabilities)) return res.status(401).json({ error: "invalid token" });
    res.json({ ok: true });
  });

  app.get("/api/local-worker/jobs/next", async (req: Request, res: Response) => {
    const token = String(req.query.token || "");
    if (!token) return res.status(400).json({ error: "token required" });
    const { claimNextJob } = await import("../lib/localWorkerQueue");
    const job = claimNextJob(token);
    if (!job) return res.status(204).end();
    res.json(job);
  });

  app.post("/api/local-worker/jobs/:id/complete", async (req: Request, res: Response) => {
    const token = String(req.query.token || req.body?.token || "");
    const jobId = paramValue(req.params.id);
    if (!token || !jobId) return res.status(400).json({ error: "token and id required" });
    const segments = req.body?.segments;
    if (!Array.isArray(segments)) return res.status(400).json({ error: "segments array required" });
    const { completeJob } = await import("../lib/localWorkerQueue");
    if (!completeJob(jobId, token, segments)) {
      return res.status(404).json({ error: "job not found or token mismatch" });
    }
    res.json({ ok: true });
  });

  app.post("/api/local-worker/jobs/:id/fail", async (req: Request, res: Response) => {
    const token = String(req.query.token || req.body?.token || "");
    const jobId = paramValue(req.params.id);
    if (!token || !jobId) return res.status(400).json({ error: "token and id required" });
    const error = String(req.body?.error || "unknown error");
    const { failJob } = await import("../lib/localWorkerQueue");
    if (!failJob(jobId, token, error)) {
      return res.status(404).json({ error: "job not found or token mismatch" });
    }
    res.json({ ok: true });
  });

  app.post("/api/local-worker/transcribe-audio", async (req: Request, res: Response) => {
    const token = String(req.query.token || req.body?.token || "");
    if (!token) return res.status(400).json({ error: "token required" });

    const { getUserIdByToken } = await import("../lib/localWorkerQueue");
    const userId = getUserIdByToken(token);
    if (!userId) return res.status(401).json({ error: "invalid token" });

    const audioB64 = req.body?.audio as string | undefined;
    const format = (req.body?.format as string | undefined) || "mp3";
    if (!audioB64) return res.status(400).json({ error: "audio (base64) required" });

    if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
      return res.status(503).json({ error: "OpenAI API not configured" });
    }

    try {
      const audioBuffer = Buffer.from(audioB64, "base64");
      if (audioBuffer.length > 25 * 1024 * 1024) {
        return res.status(413).json({ error: "Audio chunk exceeds 25 MB Whisper limit - split into smaller chunks" });
      }

      const { openai } = await import("../replit_integrations/audio/client");
      const { toFile } = await import("openai");
      const safeFormat = ["mp3", "wav", "m4a", "webm", "mp4", "ogg"].includes(format) ? format : "mp3";
      const file = await toFile(audioBuffer, `audio.${safeFormat}`, { type: `audio/${safeFormat}` });
      const response = await openai.audio.transcriptions.create({
        file,
        model: "whisper-1",
        language: "en",
        response_format: "text",
      });
      const transcript = typeof response === "string" ? response : ((response as { text?: string }).text ?? "");
      res.json({ ok: true, transcript });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[local-worker/transcribe-audio] error for user ${userId}: ${msg}`);
      res.status(500).json({ error: msg });
    }
  });
}
