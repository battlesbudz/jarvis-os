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

type CoachActionResult = {
  tool: string;
  [key: string]: unknown;
};

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

export function writeCoachActionResults(
  res: Pick<CoachStreamResponse, "write">,
  actionResults: CoachActionResult[],
  attachments: unknown[],
): boolean {
  const nonSearchActions = actionResults.filter((action) => (
    action.tool !== "web_search" && action.tool !== "search_web"
  ));

  if (nonSearchActions.length === 0 && attachments.length === 0) return false;

  const actionsPayload: Record<string, unknown> = {
    type: "actions",
    actions: nonSearchActions,
  };
  if (attachments.length > 0) actionsPayload.attachments = attachments;

  res.write(`data: ${JSON.stringify(actionsPayload)}\n\n`);
  return true;
}
