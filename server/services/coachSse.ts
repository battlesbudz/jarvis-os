import type { Response } from "express";

type CoachStreamResponse = Pick<
  Response,
  | "destroyed"
  | "end"
  | "flushHeaders"
  | "headersSent"
  | "setHeader"
  | "writableEnded"
  | "write"
>;

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message.slice(0, 500)
    : "Stream interrupted";
}

export function openCoachSse(res: CoachStreamResponse): boolean {
  if (res.writableEnded || res.destroyed) return false;
  if (res.headersSent) return true;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();
  return true;
}

export function writeCoachStreamError(res: CoachStreamResponse, error: unknown): boolean {
  if (!openCoachSse(res)) return false;
  try {
    res.write(`data: ${JSON.stringify({ type: "error", message: errorMessage(error) })}\n\n`);
    res.end();
    return true;
  } catch {
    return false;
  }
}
