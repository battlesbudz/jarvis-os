export const CORE_PLACEHOLDER_NAMES = ["Jarvis Telegram Bot", "Jarvis Discord Bot", "Discord Channel Agent"];

interface RosterSectionAgent {
  name: string;
  isCoreAgent: boolean;
  isActive: number;
  status: string;
}

interface RosterSectionTask {
  status: string;
}

export function buildRosterSections<TAgent extends RosterSectionAgent, TTask extends RosterSectionTask>(
  agents: TAgent[],
  activeTasks: TTask[],
) {
  const coreAgents = agents.filter((agent) => agent.isCoreAgent);
  const customAgents = agents.filter((agent) => !agent.isCoreAgent);
  const runningJobs = activeTasks.filter((task) => ["queued", "running"].includes(task.status));
  const recentJobs = activeTasks.filter((task) => !["queued", "running"].includes(task.status)).slice(0, 10);
  const onlineCount = agents.filter((agent) => agent.status === "online").length;
  const activeCount = agents.filter((agent) => agent.isActive === 1).length;
  const missingCoreNames = CORE_PLACEHOLDER_NAMES.filter(
    (name) => !coreAgents.some((agent) => agent.name === name),
  );

  return {
    coreAgents,
    customAgents,
    runningJobs,
    recentJobs,
    onlineCount,
    activeCount,
    missingCoreNames,
  };
}
