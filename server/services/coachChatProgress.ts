import type { Response } from "express";
import {
  TELEGRAM_VISIBLE_PROGRESS_INTERVAL_MS,
  buildTurnProgressEvent,
  buildVisibleTurnProgressMessage,
  shouldEmitVisibleProgressUpdate,
} from "../agent/turnProgress";

type MeaningfulProgressInput = {
  source: string;
  stage: string;
  message: string;
  detail?: string;
};

export function createCoachChatProgressStream(input: {
  res: Response;
  startedAtMs: number;
  userId?: string | null;
}) {
  const { res, startedAtMs, userId } = input;
  let lastVisibleUpdateAtMs = startedAtMs;
  let visibleProgressUpdateCount = 0;
  let latestVisibleProgressPhase = "";
  let visibleProgressInterval: ReturnType<typeof setInterval> | null = null;

  const ensureCoachSseOpen = () => {
    if (res.headersSent) return;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders();
  };

  const emitVisibleProgress = (phase?: string) => {
    if (phase) latestVisibleProgressPhase = phase;
    if (res.writableEnded || res.destroyed) return;
    const nowMs = Date.now();
    ensureCoachSseOpen();
    const message = buildVisibleTurnProgressMessage({
      startedAtMs,
      nowMs,
      updateCount: visibleProgressUpdateCount,
      latestPhase: latestVisibleProgressPhase,
    });
    const event = buildTurnProgressEvent({
      startedAtMs,
      nowMs,
      updateCount: visibleProgressUpdateCount,
      source: "server",
      stage: "idle_visible_update",
      message,
      detail: latestVisibleProgressPhase || undefined,
      meaningful: false,
    });
    visibleProgressUpdateCount += 1;
    lastVisibleUpdateAtMs = nowMs;
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      console.log(`[Coach/SSE] visible progress elapsedMs=${nowMs - startedAtMs} userId=${userId ?? "unknown"} phase=${latestVisibleProgressPhase || "auto"}`);
    } catch {}
  };

  const emitMeaningfulProgress = (progress: MeaningfulProgressInput) => {
    if (res.writableEnded || res.destroyed) return;
    const nowMs = Date.now();
    ensureCoachSseOpen();
    const event = buildTurnProgressEvent({
      startedAtMs,
      nowMs,
      updateCount: visibleProgressUpdateCount,
      source: progress.source,
      stage: progress.stage,
      message: progress.message,
      detail: progress.detail,
      meaningful: true,
    });
    visibleProgressUpdateCount += 1;
    latestVisibleProgressPhase = progress.message;
    lastVisibleUpdateAtMs = nowMs;
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      console.log(`[Coach/SSE] meaningful progress source=${progress.source} stage=${progress.stage} elapsedMs=${nowMs - startedAtMs} userId=${userId ?? "unknown"}`);
    } catch {}
  };

  const touchVisibleProgress = (phase?: string) => {
    if (phase) latestVisibleProgressPhase = phase;
    lastVisibleUpdateAtMs = Date.now();
  };

  const startVisibleProgress = () => {
    if (visibleProgressInterval) return;
    visibleProgressInterval = setInterval(() => {
      if (res.writableEnded || res.destroyed) return;
      const nowMs = Date.now();
      if (!shouldEmitVisibleProgressUpdate({ nowMs, lastVisibleUpdateAtMs })) return;
      emitVisibleProgress();
    }, TELEGRAM_VISIBLE_PROGRESS_INTERVAL_MS);
  };

  const stopVisibleProgress = () => {
    if (visibleProgressInterval) {
      clearInterval(visibleProgressInterval);
      visibleProgressInterval = null;
    }
  };

  return {
    ensureCoachSseOpen,
    emitMeaningfulProgress,
    startVisibleProgress,
    stopVisibleProgress,
    touchVisibleProgress,
  };
}
