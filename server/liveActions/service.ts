import { LiveActionDetailSchema, LiveActionSnapshotSchema, type LiveActionDetail, type LiveActionSnapshot, type LiveActionStatus } from "@shared/liveActions";
import {
  getLiveActionForUser,
  getLiveActionLineageForUser,
  listLiveActionEvents,
  listLiveActionsForUser,
  reconcileAgentJobsForUser,
} from "./repository";

export interface LiveActionReadService {
  getSnapshot(input: {
    userId: string;
    status?: LiveActionStatus;
    projectId?: string;
    limit?: number;
  }): Promise<LiveActionSnapshot>;
  getDetail(userId: string, actionId: string): Promise<LiveActionDetail | null>;
}

export const liveActionReadService: LiveActionReadService = {
  async getSnapshot(input) {
    const fullyReconciled = await reconcileAgentJobsForUser(input.userId, {
      status: input.status,
      projectId: input.projectId,
      limit: input.limit,
    });
    return LiveActionSnapshotSchema.parse({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      actions: fullyReconciled ? await listLiveActionsForUser(input) : [],
    });
  },

  async getDetail(userId, actionId) {
    const sourceLineageKey = await getLiveActionLineageForUser(userId, actionId);
    if (!sourceLineageKey) return null;
    if (!await reconcileAgentJobsForUser(userId, { sourceLineageKey })) return null;
    const action = await getLiveActionForUser(userId, actionId);
    if (!action) return null;
    return LiveActionDetailSchema.parse({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      action,
      events: await listLiveActionEvents(action.id),
    });
  },
};
