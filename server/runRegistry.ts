export const activeCoachRuns = new Map<string, { controller: AbortController; userId: string }>();

export function getActiveRunForUser(userId: string): { runId: string; controller: AbortController } | null {
  for (const [runId, entry] of activeCoachRuns.entries()) {
    if (entry.userId === userId) {
      return { runId, controller: entry.controller };
    }
  }
  return null;
}
