export interface BrainMaintenanceResult {
  users: number;
  processed: number;
  skipped: number;
  failed: number;
  peopleProjected: number;
  memoriesProjected: number;
  chunksEmbedded: number;
}

interface BrainMaintenanceDeps {
  listUserIds(): Promise<string[]>;
  claimRun(userId: string, messageType: string, sentDate: string): Promise<boolean>;
  projectPeople(userId: string): Promise<{ projected: number }>;
  projectMemories(userId: string): Promise<{ projected: number }>;
  refreshUserIndex(userId: string): Promise<{ embedded: number }>;
  log(message: string): void;
  error(message: string, error: unknown): void;
}

function dateKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

const defaultDeps: BrainMaintenanceDeps = {
  async listUserIds() {
    const [{ db }, schema] = await Promise.all([import("../db"), import("@shared/schema")]);
    const users = await db.select({ id: schema.users.id }).from(schema.users).catch(() => []);
    return users.map((user) => user.id);
  },
  async claimRun(userId, messageType, sentDate) {
    const [{ db }, schema] = await Promise.all([import("../db"), import("@shared/schema")]);
    const claimed = await db
      .insert(schema.proactiveScheduleLog)
      .values({ userId, messageType, sentDate })
      .onConflictDoNothing()
      .returning({ id: schema.proactiveScheduleLog.id });
    return claimed.length > 0;
  },
  async projectPeople(userId) {
    const { projectPeopleIntoBrain } = await import("./adapter");
    return projectPeopleIntoBrain(userId);
  },
  async projectMemories(userId) {
    const { projectApprovedMemories } = await import("./adapter");
    return projectApprovedMemories(userId);
  },
  async refreshUserIndex(userId) {
    const { refreshIndex } = await import("./adapter");
    return refreshIndex({ userId, staleOnly: true, limit: 50, actorId: "brain-maintenance" });
  },
  log(message) {
    console.log(message);
  },
  error(message, error) {
    console.error(message, error);
  },
};

export async function runBrainMaintenanceForAllUsers(
  now = new Date(),
  deps: BrainMaintenanceDeps = defaultDeps,
): Promise<BrainMaintenanceResult> {
  const sentDate = dateKey(now);
  const messageType = `gbrain:refresh_index:${sentDate}`;
  const userIds = await deps.listUserIds();
  const result: BrainMaintenanceResult = {
    users: userIds.length,
    processed: 0,
    skipped: 0,
    failed: 0,
    peopleProjected: 0,
    memoriesProjected: 0,
    chunksEmbedded: 0,
  };

  for (const userId of userIds) {
    try {
      if (!(await deps.claimRun(userId, messageType, sentDate))) {
        result.skipped += 1;
        continue;
      }

      const people = await deps.projectPeople(userId);
      const memories = await deps.projectMemories(userId);
      const refreshed = await deps.refreshUserIndex(userId);

      result.processed += 1;
      result.peopleProjected += people.projected;
      result.memoriesProjected += memories.projected;
      result.chunksEmbedded += refreshed.embedded;
    } catch (err) {
      result.failed += 1;
      deps.error(`[GBrainMaintenance] Failed for user ${userId}:`, err);
    }
  }

  deps.log(
    `[GBrainMaintenance] Complete - users=${result.users} processed=${result.processed} ` +
      `skipped=${result.skipped} failed=${result.failed} peopleProjected=${result.peopleProjected} ` +
      `memoriesProjected=${result.memoriesProjected} chunksEmbedded=${result.chunksEmbedded}`,
  );

  return result;
}
