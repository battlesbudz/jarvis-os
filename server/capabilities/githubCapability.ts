import type { Capability } from "./types";
import { listGithubPrsTool, getGithubPrTool, mergeGithubPrTool } from "../agent/tools/githubPrTools";

export const githubCapability: Capability = {
  id: "github",
  label: "GitHub",
  toolGroups: ["github"],
  tools: [listGithubPrsTool, getGithubPrTool, mergeGithubPrTool],
  configRequirements: [],
  integrationDependencies: [
    {
      integrationId: "github",
      label: "GitHub (Personal Access Token)",
      toolNames: ["list_github_prs", "get_github_pr", "merge_github_pr"],
    },
  ],
  async healthCheck(context) {
    if (!context?.userId) return { healthy: true };
    const { hasGitHubPAT } = await import("../integrations/github");
    const hasPat = await hasGitHubPAT(context.userId).catch(() => false);
    if (!hasPat) {
      return { healthy: false, reason: "GitHub PAT not configured — add a Personal Access Token in Settings → GitHub" };
    }
    return { healthy: true };
  },
};
