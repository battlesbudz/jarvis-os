import "./agent/openaiChatRouterPatch";

export const activeCoachRuns = new Map<string, {
  controller: AbortController;
  userId: string;
  channel?: "appchat";
  done?: Promise<void>;
}>();

export function registerActiveCoachRun(runId: string, controller: AbortController, userId: string): void {
  activeCoachRuns.set(runId, { controller, userId });
}

export function clearActiveCoachRun(runId: string): void {
  activeCoachRuns.delete(runId);
}

export function getActiveRunForUser(userId: string): { runId: string; controller: AbortController } | null {
  for (const [runId, entry] of activeCoachRuns.entries()) {
    if (entry.userId === userId) {
      return { runId, controller: entry.controller };
    }
  }
  return null;
}

export function abortActiveCoachRun(runId: string, callerId: string): { status: "aborted" | "not_found" | "forbidden"; userId?: string } {
  const run = activeCoachRuns.get(runId);
  if (!run) return { status: "not_found" };
  if (run.userId !== callerId) return { status: "forbidden" };
  run.controller.abort();
  if (!run.done) activeCoachRuns.delete(runId);
  return { status: "aborted", userId: run.userId };
}

export async function abortActiveCoachRunsForUser(userId: string): Promise<void> {
  const pending: Promise<void>[] = [];
  for (const [runId, entry] of activeCoachRuns) {
    if (entry.userId !== userId || entry.channel !== "appchat") continue;
    entry.controller.abort();
    if (entry.done) pending.push(entry.done);
    else activeCoachRuns.delete(runId);
  }
  await Promise.all(pending);
}
