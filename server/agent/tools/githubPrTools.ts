import type { AgentTool, ToolContext, ToolArgs, ToolResult } from "../types";
import { getGitHubSettings, listOpenPRs, getPR, mergePR, getDiffSummary } from "../../integrations/github";

function ciEmoji(status: string): string {
  if (status === "pass") return "✅";
  if (status === "fail") return "❌";
  if (status === "pending") return "⏳";
  return "❓";
}

export const listGithubPrsTool: AgentTool = {
  name: "list_github_prs",
  description:
    "List open GitHub pull requests across all of the user's tracked repositories. " +
    "Returns repo name, PR number, title, author, branch, CI status (pass/fail/pending), and reviewers. " +
    "Use when the user asks 'what are my open PRs?', 'show me my pull requests', or similar.",
  parameters: {
    type: "object",
    properties: {
      repo: {
        type: "string",
        description: "Optional: filter to a specific 'owner/repo'. If omitted, fetches all tracked repos.",
      },
    },
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const { userId } = ctx;
    try {
      const settings = await getGitHubSettings(userId);
      if (!settings.pat) {
        return {
          ok: false,
          content: "No GitHub Personal Access Token configured. Ask the user to add their GitHub PAT in Settings → GitHub.",
          label: "GitHub not configured",
        };
      }
      const repos = args.repo
        ? [String(args.repo)]
        : settings.repos;
      if (repos.length === 0) {
        return {
          ok: false,
          content: "No GitHub repositories configured. Ask the user to add repos to watch in Settings → GitHub.",
          label: "No repos configured",
        };
      }
      const prs = await listOpenPRs(settings.pat, repos);
      if (prs.length === 0) {
        return {
          ok: true,
          content: `No open pull requests found across: ${repos.join(", ")}.`,
          label: "No open PRs",
        };
      }
      const lines = prs.map((pr) => {
        const ci = ciEmoji(pr.ciStatus);
        const reviewerStr = pr.reviewers.length > 0 ? ` | Reviewers: ${pr.reviewers.join(", ")}` : "";
        return `${ci} [${pr.repo}] PR #${pr.number}: "${pr.title}" by @${pr.author} (${pr.branch})${reviewerStr}`;
      });
      return {
        ok: true,
        content: `Open pull requests (${prs.length}):\n${lines.join("\n")}`,
        label: `${prs.length} open PR(s)`,
        detail: JSON.stringify(prs),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, content: `list_github_prs failed: ${msg}`, label: "GitHub fetch failed" };
    }
  },
};

export const getGithubPrTool: AgentTool = {
  name: "get_github_pr",
  description:
    "Get details for a specific GitHub pull request including description, diff summary (files changed, additions, deletions), " +
    "CI status, reviewers, and mergeability. " +
    "Use when the user asks about a specific PR number or 'what's the CI status on PR #N?'.",
  parameters: {
    type: "object",
    properties: {
      repo: {
        type: "string",
        description: "Repository in 'owner/repo' format, e.g. 'acme/backend'.",
      },
      pr_number: {
        type: "number",
        description: "The pull request number.",
      },
    },
    required: ["repo", "pr_number"],
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const { userId } = ctx;
    try {
      const settings = await getGitHubSettings(userId);
      if (!settings.pat) {
        return {
          ok: false,
          content: "No GitHub Personal Access Token configured. Ask the user to add their GitHub PAT in Settings → GitHub.",
          label: "GitHub not configured",
        };
      }
      const repo = String(args.repo || "");
      const prNumber = Number(args.pr_number);
      const [owner, repoName] = repo.split("/");
      if (!owner || !repoName) {
        return { ok: false, content: "Invalid repo format. Use 'owner/repo'.", label: "Invalid repo" };
      }
      const [pr, diff] = await Promise.all([
        getPR(settings.pat, owner, repoName, prNumber),
        getDiffSummary(settings.pat, owner, repoName, prNumber),
      ]);
      if (!pr) {
        return { ok: false, content: `PR #${prNumber} not found in ${repo}.`, label: "PR not found" };
      }
      const ci = ciEmoji(pr.ciStatus);
      const reviewerStr = pr.reviewers.length > 0 ? pr.reviewers.join(", ") : "none requested";
      const descStr = pr.description
        ? `\nDescription: ${pr.description.slice(0, 500)}${pr.description.length > 500 ? "…" : ""}`
        : "";
      const mergeStr = pr.mergeable === true ? " | Mergeable: yes" : pr.mergeable === false ? " | Mergeable: no (conflicts)" : "";
      const diffStr = diff.filesChanged > 0
        ? `\nDiff: ${diff.filesChanged} file(s) changed, +${diff.additions} −${diff.deletions}` +
          (diff.files.length > 0 ? `\nFiles: ${diff.files.slice(0, 10).join(", ")}${diff.files.length > 10 ? ` … (+${diff.files.length - 10} more)` : ""}` : "")
        : "";
      return {
        ok: true,
        content: `PR #${pr.number} in ${pr.repo}: "${pr.title}" by @${pr.author}\nBranch: ${pr.branch}\nCI: ${ci} ${pr.ciStatus}${mergeStr}\nReviewers: ${reviewerStr}${descStr}${diffStr}\nURL: ${pr.url}`,
        label: `PR #${pr.number} — ${pr.ciStatus}`,
        detail: JSON.stringify({ ...pr, diff }),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, content: `get_github_pr failed: ${msg}`, label: "GitHub fetch failed" };
    }
  },
};

export const mergeGithubPrTool: AgentTool = {
  name: "merge_github_pr",
  description:
    "Merge a GitHub pull request. SAFETY RULES:\n" +
    "1. Always call get_github_pr first to verify CI status is 'pass'.\n" +
    "2. Never merge when CI is failing or pending.\n" +
    "3. Always get explicit user confirmation before merging:\n" +
    "   - On Discord: post a message describing the merge, then call register_approval " +
    "     with onApprove.type='run_prompt' and a prompt that re-triggers the merge. " +
    "     Do NOT set confirmed=true — let the approval flow handle execution.\n" +
    "   - On Telegram/in-app: ask the user to confirm in chat, then call this tool again " +
    "     with confirmed=true once the user says yes.\n" +
    "4. confirmed=true is required for the merge to execute; omitting it or setting " +
    "   confirmed=false will return a confirmation prompt without merging.",
  parameters: {
    type: "object",
    properties: {
      repo: {
        type: "string",
        description: "Repository in 'owner/repo' format.",
      },
      pr_number: {
        type: "number",
        description: "The pull request number to merge.",
      },
      method: {
        type: "string",
        enum: ["merge", "squash", "rebase"],
        description: "Merge method: 'merge' (default), 'squash', or 'rebase'.",
      },
      confirmed: {
        type: "boolean",
        description:
          "Set to true only after the user has explicitly confirmed the merge in this conversation " +
          "(or via register_approval on Discord). Omit or set false to get a confirmation prompt.",
      },
    },
    required: ["repo", "pr_number"],
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const { userId } = ctx;
    try {
      if (!args.confirmed) {
        const repo = String(args.repo || "");
        const prNumber = Number(args.pr_number);
        return {
          ok: false,
          content:
            `Merge confirmation required for PR #${prNumber} in ${repo}.\n` +
            "On Discord: post a confirmation message and call register_approval so the user can react with ✅.\n" +
            "On Telegram/in-app: ask the user to confirm, then call merge_github_pr again with confirmed=true.",
          label: "Awaiting confirmation",
        };
      }
      const settings = await getGitHubSettings(userId);
      if (!settings.pat) {
        return {
          ok: false,
          content: "No GitHub Personal Access Token configured.",
          label: "GitHub not configured",
        };
      }
      const repo = String(args.repo || "");
      const prNumber = Number(args.pr_number);
      const method = (args.method as "merge" | "squash" | "rebase") || "merge";
      const [owner, repoName] = repo.split("/");
      if (!owner || !repoName) {
        return { ok: false, content: "Invalid repo format. Use 'owner/repo'.", label: "Invalid repo" };
      }
      const pr = await getPR(settings.pat, owner, repoName, prNumber);
      if (!pr) {
        return { ok: false, content: `PR #${prNumber} not found in ${repo}.`, label: "PR not found" };
      }
      if (pr.ciStatus === "fail") {
        return {
          ok: false,
          content: `❌ Cannot merge PR #${prNumber} — CI is failing. Fix the failing checks first.`,
          label: "CI failing — merge blocked",
        };
      }
      if (pr.ciStatus === "pending") {
        return {
          ok: false,
          content: `⏳ Cannot merge PR #${prNumber} — CI checks are still running. Wait for them to complete.`,
          label: "CI pending — merge blocked",
        };
      }
      const result = await mergePR(settings.pat, owner, repoName, prNumber, method);
      return {
        ok: result.ok,
        content: result.ok
          ? `✅ PR #${prNumber} merged successfully in ${repo}. ${result.message}`
          : `❌ Failed to merge PR #${prNumber}: ${result.message}`,
        label: result.ok ? `PR #${prNumber} merged` : `PR #${prNumber} merge failed`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, content: `merge_github_pr failed: ${msg}`, label: "Merge failed" };
    }
  },
};
