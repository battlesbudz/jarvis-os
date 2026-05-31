import type * as schema from "@shared/schema";
import type { EphemeralAgentKind } from "./ephemeralAgents";
import type { NamedAgentResult } from "./runNamedAgent";

type AgentJobRow = Pick<
  typeof schema.agentJobs.$inferSelect,
  "id" | "userId" | "agentType" | "title" | "prompt" | "input"
>;

export function buildEphemeralWorkerResultDeliverable(
  job: AgentJobRow,
  result: NamedAgentResult & { ephemeral: true },
  kind: EphemeralAgentKind,
): typeof schema.deliverables.$inferInsert {
  const input = (job.input as Record<string, unknown>) ?? {};
  const ephemeralAgent = input.ephemeralAgent && typeof input.ephemeralAgent === "object"
    ? input.ephemeralAgent as Record<string, unknown>
    : {};
  const cleanupMode = ephemeralAgent.cleanupMode === "delete" ? "delete" : "disable";
  const workerType = typeof input.workerType === "string" ? input.workerType : "goal_task";
  const toolCallsCount = result.toolCalls?.length ?? 0;

  return {
    userId: job.userId,
    jobId: job.id,
    agentType: "ephemeral_agent_task",
    type: "worker_result",
    title: job.title,
    summary: `${result.agentName || "Temporary Worker"} completed ${job.title}. Review the worker result before using it.`,
    body: result.reply || "Temporary worker completed with no text output.",
    status: "pending_approval",
    meta: {
      workerType,
      ephemeralAgentKind: kind,
      ephemeralAgentId: result.agentId,
      cleanupMode,
      turns: result.turns,
      toolCallsCount,
      attachments: result.attachments ?? [],
    },
  };
}
