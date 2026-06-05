import { getCoachAppAgentId } from "../agent/coreAgentIds";

export function getCoachAgentSessionAgentId(userId: string): string {
  return getCoachAppAgentId(userId);
}
