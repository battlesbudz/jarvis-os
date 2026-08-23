import { LiveActionDetailSchema, LiveActionSnapshotSchema, type LiveActionDetail, type LiveActionSnapshot, type LiveActionStatus } from "@shared/liveActions";
import {
  getLiveActionForUser,
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
    await reconcileAgentJobsForUser(input.userId);
    return LiveActionSnapshotSchema.parse({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      actions: await listLiveActionsForUser(input),
    });
  },

  async getDetail(userId, actionId) {
    await reconcileAgentJobsForUser(userId);
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
