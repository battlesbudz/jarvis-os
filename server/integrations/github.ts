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
}

export async function getGitHubSettings(userId: string): Promise<GitHubSettings> {
  const token = await getUserToken(userId, "github").catch(() => null);
  const pat = token?.accessToken || null;

  const rows = await db
    .select({ data: schema.userPreferences.data })
    .from(schema.userPreferences)
    .where(eq(schema.userPreferences.userId, userId))
    .limit(1);
  const prefs = (rows[0]?.data as Record<string, unknown>) || {};
  return {
    pat,
    repos: (prefs.github_repos as string[]) || [],
  };
}

export async function saveGitHubSettings(
  userId: string,
  patch: Partial<GitHubSettings>,
): Promise<void> {
  if (patch.pat !== undefined) {
    if (patch.pat === null) {
      await deleteUserToken(userId, "github");
    } else {
      await saveUserToken({
        userId,
        provider: "github",
        accessToken: patch.pat,
        accountEmail: "pat",
      });
    }
  }

  if (patch.repos !== undefined) {
    const rows = await db
      .select({ data: schema.userPreferences.data })
      .from(schema.userPreferences)
      .where(eq(schema.userPreferences.userId, userId))
      .limit(1);
    const current = (rows[0]?.data as Record<string, unknown>) || {};
    const updated: Record<string, unknown> = { ...current, github_repos: patch.repos };
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
