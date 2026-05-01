import { getUserToken, saveUserToken, deleteUserToken } from "../userTokenStore";
import { db } from "../db";
import { eq } from "drizzle-orm";
import * as schema from "@shared/schema";

export interface GitHubPR {
  number: number;
  title: string;
  author: string;
  branch: string;
  repo: string;
  url: string;
  description: string | null;
  state: string;
  draft: boolean;
  reviewers: string[];
  ciStatus: "pass" | "fail" | "pending" | "unknown";
  ciDetails?: string;
  mergeable?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubDiffSummary {
  filesChanged: number;
  additions: number;
  deletions: number;
  files: string[];
}

export interface GitHubSettings {
  pat: string | null;
  repos: string[];
  tokenType?: "pat" | "oauth";
  username?: string | null;
}

export async function getGitHubUser(token: string): Promise<string | null> {
  try {
    const res = await githubRequest(token, "/user");
    if (!res.ok) return null;
    const data = (await res.json()) as { login?: string };
    return data.login ?? null;
  } catch {
    return null;
  }
}

export async function getGitHubSettings(userId: string): Promise<GitHubSettings> {
  const token = await getUserToken(userId, "github").catch(() => null);
  const pat = token?.accessToken || null;
  const tokenType = token?.accountEmail === "oauth" ? "oauth" : (pat ? "pat" : undefined);

  const rows = await db
    .select({ data: schema.userPreferences.data })
    .from(schema.userPreferences)
    .where(eq(schema.userPreferences.userId, userId))
    .limit(1);
  const prefs = (rows[0]?.data as Record<string, unknown>) || {};
  return {
    pat,
    repos: (prefs.github_repos as string[]) || [],
    tokenType,
    username: (prefs.github_username as string) || null,
  };
}

export async function saveGitHubSettings(
  userId: string,
  patch: Partial<GitHubSettings> & { tokenType?: "pat" | "oauth" },
): Promise<void> {
  if (patch.pat !== undefined) {
    // Always delete all existing GitHub tokens first to ensure exactly one
    // token row exists per user — prevents non-deterministic LIMIT 1 reads
    // when a user switches between PAT and OAuth (different accountEmail values).
    await deleteUserToken(userId, "github");
    if (patch.pat !== null) {
      await saveUserToken({
        userId,
        provider: "github",
        accessToken: patch.pat,
        accountEmail: patch.tokenType ?? "pat",
      });
    }
  }

  const needsPrefsUpdate = patch.repos !== undefined || patch.username !== undefined;
  if (needsPrefsUpdate) {
    const rows = await db
      .select({ data: schema.userPreferences.data })
      .from(schema.userPreferences)
      .where(eq(schema.userPreferences.userId, userId))
      .limit(1);
    const current = (rows[0]?.data as Record<string, unknown>) || {};
    const updated: Record<string, unknown> = { ...current };
    if (patch.repos !== undefined) updated.github_repos = patch.repos;
    if (patch.username !== undefined) {
      if (patch.username === null) {
        delete updated.github_username;
      } else {
        updated.github_username = patch.username;
      }
    }
    await db
      .insert(schema.userPreferences)
      .values({ userId, data: updated })
      .onConflictDoUpdate({
        target: schema.userPreferences.userId,
        set: { data: updated, updatedAt: new Date() },
      });
  }
}

async function githubRequest(
  pat: string,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `https://api.github.com${path}`;
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string> | undefined),
    },
  });
}

async function getLatestCIStatus(
  pat: string,
  owner: string,
  repo: string,
  sha: string,
): Promise<{ status: "pass" | "fail" | "pending" | "unknown"; details?: string }> {
  try {
    const res = await githubRequest(
      pat,
      `/repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=20`,
    );
    if (!res.ok) {
      const statusRes = await githubRequest(
        pat,
        `/repos/${owner}/${repo}/commits/${sha}/statuses?per_page=1`,
      );
      if (!statusRes.ok) return { status: "unknown" };
      const statuses = (await statusRes.json()) as Array<{
        state: string;
        description?: string;
      }>;
      if (statuses.length === 0) return { status: "unknown" };
      const state = statuses[0].state;
      if (state === "success") return { status: "pass" };
      if (state === "failure" || state === "error") return { status: "fail", details: statuses[0].description };
      return { status: "pending" };
    }
    const data = (await res.json()) as {
      total_count: number;
      check_runs: Array<{
        name: string;
        status: string;
        conclusion: string | null;
      }>;
    };
    if (data.total_count === 0) return { status: "unknown" };
    const runs = data.check_runs;
    if (runs.some((r) => r.status !== "completed")) return { status: "pending" };
    const failed = runs.filter(
      (r) => r.conclusion === "failure" || r.conclusion === "timed_out" || r.conclusion === "cancelled",
    );
    if (failed.length > 0) {
      return { status: "fail", details: failed.map((r) => r.name).join(", ") };
    }
    return { status: "pass" };
  } catch {
    return { status: "unknown" };
  }
}

export async function getDiffSummary(
  pat: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<GitHubDiffSummary> {
  try {
    const res = await githubRequest(pat, `/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`);
    if (!res.ok) return { filesChanged: 0, additions: 0, deletions: 0, files: [] };
    const files = (await res.json()) as Array<{
      filename: string;
      additions: number;
      deletions: number;
    }>;
    const additions = files.reduce((sum, f) => sum + (f.additions || 0), 0);
    const deletions = files.reduce((sum, f) => sum + (f.deletions || 0), 0);
    return {
      filesChanged: files.length,
      additions,
      deletions,
      files: files.slice(0, 20).map((f) => f.filename),
    };
  } catch {
    return { filesChanged: 0, additions: 0, deletions: 0, files: [] };
  }
}

export async function listOpenPRs(pat: string, repos: string[]): Promise<GitHubPR[]> {
  const results: GitHubPR[] = [];
  for (const fullRepo of repos) {
    const [owner, repo] = fullRepo.split("/");
    if (!owner || !repo) continue;
    try {
      const res = await githubRequest(pat, `/repos/${owner}/${repo}/pulls?state=open&per_page=20`);
      if (!res.ok) continue;
      const prs = (await res.json()) as Array<{
        number: number;
        title: string;
        user: { login: string };
        head: { ref: string; sha: string };
        body: string | null;
        state: string;
        draft: boolean;
        html_url: string;
        requested_reviewers: Array<{ login: string }>;
        created_at: string;
        updated_at: string;
      }>;
      for (const pr of prs) {
        const ci = await getLatestCIStatus(pat, owner, repo, pr.head.sha);
        results.push({
          number: pr.number,
          title: pr.title,
          author: pr.user.login,
          branch: pr.head.ref,
          repo: fullRepo,
          url: pr.html_url,
          description: pr.body,
          state: pr.state,
          draft: pr.draft,
          reviewers: pr.requested_reviewers.map((r) => r.login),
          ciStatus: ci.status,
          ciDetails: ci.details,
          createdAt: pr.created_at,
          updatedAt: pr.updated_at,
        });
      }
    } catch (err) {
      console.warn(`[GitHub] Failed to fetch PRs for ${fullRepo}:`, err);
    }
  }
  return results;
}

export async function getPR(
  pat: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<GitHubPR | null> {
  try {
    const res = await githubRequest(pat, `/repos/${owner}/${repo}/pulls/${prNumber}`);
    if (!res.ok) return null;
    const pr = (await res.json()) as {
      number: number;
      title: string;
      user: { login: string };
      head: { ref: string; sha: string };
      body: string | null;
      state: string;
      draft: boolean;
      html_url: string;
      requested_reviewers: Array<{ login: string }>;
      mergeable: boolean | null;
      created_at: string;
      updated_at: string;
    };
    const ci = await getLatestCIStatus(pat, owner, repo, pr.head.sha);
    return {
      number: pr.number,
      title: pr.title,
      author: pr.user.login,
      branch: pr.head.ref,
      repo: `${owner}/${repo}`,
      url: pr.html_url,
      description: pr.body,
      state: pr.state,
      draft: pr.draft,
      reviewers: pr.requested_reviewers.map((r) => r.login),
      ciStatus: ci.status,
      ciDetails: ci.details,
      mergeable: pr.mergeable ?? undefined,
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
    };
  } catch {
    return null;
  }
}

export async function mergePR(
  pat: string,
  owner: string,
  repo: string,
  prNumber: number,
  method: "merge" | "squash" | "rebase" = "merge",
): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await githubRequest(pat, `/repos/${owner}/${repo}/pulls/${prNumber}/merge`, {
      method: "PUT",
      body: JSON.stringify({ merge_method: method }),
    });
    if (res.status === 200) {
      const data = (await res.json()) as { message: string };
      return { ok: true, message: data.message || "Pull request successfully merged." };
    }
    const err = (await res.json()) as { message?: string };
    return { ok: false, message: err.message || `Merge failed (HTTP ${res.status})` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Merge request failed" };
  }
}

export async function hasGitHubPAT(userId: string): Promise<boolean> {
  const token = await getUserToken(userId, "github").catch(() => null);
  return !!(token?.accessToken);
}

export interface CreateRepoResult {
  ok: boolean;
  repoUrl?: string;
  cloneUrl?: string;
  owner?: string;
  repoName?: string;
  error?: string;
}

export async function createGitHubRepo(
  pat: string,
  name: string,
  description: string,
  isPrivate: boolean,
): Promise<CreateRepoResult> {
  try {
    const res = await githubRequest(pat, "/user/repos", {
      method: "POST",
      body: JSON.stringify({
        name,
        description,
        private: isPrivate,
        auto_init: false,
      }),
    });

    if (!res.ok) {
      const err = (await res.json()) as { message?: string };
      return { ok: false, error: err.message ?? `Failed to create repo (HTTP ${res.status})` };
    }

    const data = (await res.json()) as {
      html_url: string;
      clone_url: string;
      full_name: string;
      owner: { login: string };
      name: string;
    };

    return {
      ok: true,
      repoUrl: data.html_url,
      cloneUrl: data.clone_url,
      owner: data.owner.login,
      repoName: data.name,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Create repo failed" };
  }
}

export async function pushWorkspaceToGitHub(
  pat: string,
  owner: string,
  repoName: string,
  workspaceDir: string,
  commitMessage = "Initial commit from Jarvis",
): Promise<{ ok: boolean; error?: string }> {
  const { spawnSync } = await import("child_process");
  const pathMod = await import("path");
  const fsMod = await import("fs");
  const os = await import("os");

  // The credential URL is only used in-process for the push; it is never
  // stored permanently in .git/config (we set the clean URL after pushing).
  const credentialUrl = `https://x-access-token:${pat}@github.com/${owner}/${repoName}.git`;
  const cleanUrl = `https://github.com/${owner}/${repoName}.git`;

  // Strip the PAT from any error strings so it is never leaked in logs/responses.
  const sanitize = (s?: string | null): string =>
    (s ?? "").replace(new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "***").slice(0, 500);

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    HOME: os.homedir(),
    GIT_AUTHOR_NAME: "Jarvis",
    GIT_AUTHOR_EMAIL: "jarvis@replit.app",
    GIT_COMMITTER_NAME: "Jarvis",
    GIT_COMMITTER_EMAIL: "jarvis@replit.app",
    GIT_TERMINAL_PROMPT: "0",
  };

  const run = (args: string[]) =>
    spawnSync("git", args, {
      cwd: workspaceDir,
      env,
      encoding: "utf8",
      timeout: 120_000,
    });

  const gitDir = pathMod.join(workspaceDir, ".git");
  const hasGit = fsMod.existsSync(gitDir);

  if (!hasGit) {
    // Try -b main flag (git >= 2.28), fall back to init + rename
    const init = run(["init", "-b", "main"]);
    if (init.status !== 0) {
      const altInit = run(["init"]);
      if (altInit.status !== 0) {
        return { ok: false, error: `git init failed: ${sanitize(altInit.stderr)}` };
      }
      run(["checkout", "-b", "main"]);
    }
  }

  run(["config", "user.email", "jarvis@replit.app"]);
  run(["config", "user.name", "Jarvis"]);

  const addResult = run(["add", "--all"]);
  if (addResult.status !== 0) {
    return { ok: false, error: `git add failed: ${sanitize(addResult.stderr)}` };
  }

  const statusResult = run(["status", "--porcelain"]);
  const hasChanges = (statusResult.stdout ?? "").trim().length > 0;

  if (hasChanges) {
    const commitResult = run(["commit", "-m", commitMessage]);
    if (commitResult.status !== 0) {
      return { ok: false, error: `git commit failed: ${sanitize(commitResult.stderr)}` };
    }
  }

  // Set the remote with embedded credentials only for the push call.
  const remoteList = run(["remote"]);
  const hasOrigin = (remoteList.stdout ?? "").includes("origin");
  if (hasOrigin) {
    run(["remote", "set-url", "origin", credentialUrl]);
  } else {
    run(["remote", "add", "origin", credentialUrl]);
  }

  const pushResult = run(["push", "-u", "origin", "main"]);

  // Immediately replace the credential URL with the clean public URL so the
  // PAT is never persisted in .git/config.
  run(["remote", "set-url", "origin", cleanUrl]);

  if (pushResult.status !== 0) {
    return { ok: false, error: `git push failed: ${sanitize(pushResult.stderr)}` };
  }

  return { ok: true };
}
