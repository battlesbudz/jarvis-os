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
      label: "GitHub (OAuth or Personal Access Token)",
      toolNames: ["list_github_prs", "get_github_pr", "merge_github_pr"],
    },
  ],
  async healthCheck(context) {
    if (!context?.userId) return { healthy: true };
    const { hasGitHubPAT } = await import("../integrations/github");
    const hasToken = await hasGitHubPAT(context.userId).catch(() => false);
    if (!hasToken) {
      return { healthy: false, reason: "GitHub not connected — use 'Connect with GitHub' or add a Personal Access Token in Settings → GitHub" };
    }
    return { healthy: true };
  },
};
