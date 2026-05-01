/**
 * cloudDeploy — deploy completed app projects to Vercel or Railway.
 *
 * Vercel:  Next.js / React-Vite → Vercel REST API (file upload + deployment)
 * Railway: Node.js/Express      → Railway GraphQL API (project create) + CLI deploy
 *
 * Both providers are optional — if the relevant API token is missing, deployment
 * is silently skipped and the zip download link remains the only delivery method.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { spawnSync } from "child_process";
import * as os from "os";

// ── Shared helpers ────────────────────────────────────────────────────────────

function slugify(title: string, maxLen = 50): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, maxLen) || "jarvis-app"
  );
}

// ── File collection ───────────────────────────────────────────────────────────

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB per file
const MAX_TOTAL_FILES = 5_000;

const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".nuxt",
  "dist",
  "build",
  ".turbo",
  ".cache",
  "__pycache__",
  ".expo",
  "coverage",
]);

const EXCLUDE_EXTENSIONS = new Set([".log", ".DS_Store"]);

const EXCLUDE_FILENAMES = new Set([".env", ".env.local", ".env.production"]);

function shouldExclude(relPath: string): boolean {
  const parts = relPath.split("/");
  for (const part of parts) {
    if (EXCLUDE_DIRS.has(part)) return true;
    if (EXCLUDE_FILENAMES.has(part)) return true;
    if (EXCLUDE_EXTENSIONS.has(path.extname(part))) return true;
  }
  return false;
}

interface FileEntry {
  file: string;   // forward-slash relative path
  data: Buffer;
  sha: string;    // hex SHA-1
  size: number;
}

function collectFiles(
  dir: string,
  baseDir: string,
  results: FileEntry[],
  counter: { n: number },
): void {
  if (counter.n >= MAX_TOTAL_FILES) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (counter.n >= MAX_TOTAL_FILES) break;
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath).split(path.sep).join("/");
    if (shouldExclude(relPath)) continue;
    if (entry.isDirectory()) {
      collectFiles(fullPath, baseDir, results, counter);
    } else if (entry.isFile()) {
      try {
        const stat = fs.statSync(fullPath);
        if (stat.size === 0 || stat.size > MAX_FILE_SIZE_BYTES) continue;
        const data = fs.readFileSync(fullPath);
        const sha = crypto.createHash("sha1").update(data).digest("hex");
        results.push({ file: relPath, data, sha, size: stat.size });
        counter.n++;
      } catch {
        // skip unreadable files
      }
    }
  }
}

// ── Vercel deployment ─────────────────────────────────────────────────────────

const VERCEL_API = "https://api.vercel.com";

const VERCEL_FRAMEWORK_MAP: Record<string, string | null> = {
  nextjs: "nextjs",
  "react-vite": "vite",
  "node-express": null,
  custom: null,
};

/**
 * Upload a single file to Vercel's content-addressed file store.
 * Returns true if the file is accepted (200 / 201) or already present (400 / 409).
 */
async function uploadVercelFile(token: string, entry: FileEntry): Promise<boolean> {
  try {
    const resp = await fetch(`${VERCEL_API}/v2/files`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "x-vercel-size": String(entry.size),
        "x-vercel-digest": `sha1:${entry.sha}`,
      },
      body: entry.data,
    });
    // 200 / 201 = success, 400 / 409 = file already stored (de-dup) — all OK
    return resp.ok || resp.status === 400 || resp.status === 409;
  } catch {
    return false;
  }
}

async function pollVercelDeployment(
  token: string,
  deploymentId: string,
  fallbackUrl: string,
  timeoutMs = 10 * 60 * 1000,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, 6_000));
    try {
      const resp = await fetch(`${VERCEL_API}/v13/deployments/${deploymentId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) continue;
      const data = (await resp.json()) as { readyState: string; url: string };
      console.log(`[CloudDeploy] Vercel state=${data.readyState}`);
      if (data.readyState === "READY") return `https://${data.url}`;
      if (data.readyState === "ERROR" || data.readyState === "CANCELED") {
        console.warn(`[CloudDeploy] Vercel deployment ended with state=${data.readyState}`);
        return null;
      }
    } catch {
      // transient error — keep polling
    }
  }
  // Timed out: return the URL optimistically (build may still succeed)
  console.warn("[CloudDeploy] Vercel polling timed out — returning URL optimistically");
  return fallbackUrl;
}

export async function deployToVercel(
  workspaceDir: string,
  projectTitle: string,
  framework: string,
): Promise<string | null> {
  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    console.log("[CloudDeploy] VERCEL_TOKEN not set — skipping Vercel deployment");
    return null;
  }

  console.log(`[CloudDeploy] Collecting files for Vercel: ${workspaceDir}`);
  const files: FileEntry[] = [];
  collectFiles(workspaceDir, workspaceDir, files, { n: 0 });

  if (files.length === 0) {
    console.warn("[CloudDeploy] No files found — skipping Vercel deployment");
    return null;
  }

  // Upload all files and count failures
  console.log(`[CloudDeploy] Uploading ${files.length} files to Vercel`);
  const uploadResults = await Promise.all(files.map((f) => uploadVercelFile(token, f)));
  const failedCount = uploadResults.filter((ok) => !ok).length;

  // Bail if more than 10 % of files failed to upload
  const failureRate = failedCount / files.length;
  if (failureRate > 0.1) {
    console.warn(
      `[CloudDeploy] Vercel upload failure rate too high (${failedCount}/${files.length}) — aborting deployment`,
    );
    return null;
  }

  if (failedCount > 0) {
    console.warn(`[CloudDeploy] ${failedCount} file(s) failed to upload; continuing with the rest`);
  }

  // Only include files that were successfully uploaded
  const successfulFiles = files.filter((_, i) => uploadResults[i]);

  const name = slugify(projectTitle);
  const vercelFramework = VERCEL_FRAMEWORK_MAP[framework] ?? null;

  const body: Record<string, unknown> = {
    name,
    files: successfulFiles.map((f) => ({ file: f.file, sha: f.sha, size: f.size })),
    target: "production",
  };
  if (vercelFramework) {
    body.projectSettings = { framework: vercelFramework };
  }

  console.log(
    `[CloudDeploy] Creating Vercel deployment: name=${name} framework=${vercelFramework ?? "auto"} files=${successfulFiles.length}`,
  );

  let deployResp: Response;
  try {
    deployResp = await fetch(`${VERCEL_API}/v13/deployments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.warn("[CloudDeploy] Vercel API request failed:", err);
    return null;
  }

  if (!deployResp.ok) {
    const errText = await deployResp.text().catch(() => "");
    console.warn(
      `[CloudDeploy] Vercel deployment API error ${deployResp.status}: ${errText.slice(0, 500)}`,
    );
    return null;
  }

  const deployData = (await deployResp.json()) as { id: string; url: string; readyState: string };
  const deploymentId = deployData.id;
  const fallbackUrl = `https://${deployData.url}`;
  console.log(
    `[CloudDeploy] Vercel deployment created: id=${deploymentId} url=${fallbackUrl} state=${deployData.readyState}`,
  );

  if (deployData.readyState === "READY") return fallbackUrl;

  return pollVercelDeployment(token, deploymentId, fallbackUrl);
}

// ── Railway deployment ────────────────────────────────────────────────────────
//
// Strategy:
//  1. Create a new Railway project via the public Railway GraphQL API → get a
//     deterministic project ID.
//  2. Deploy the workspace to THAT project using the official Railway CLI client
//     (`npx @railway/cli up --project <id>`).  The CLI is Railway's official
//     deployment client and is the only supported way to send local source files
//     to Railway's build pipeline — their public GraphQL API does not expose a
//     file-upload or tarball deployment mutation.
//  3. Poll ONLY that project ID for its service domain via GraphQL.
//
// All URL resolution is scoped to the specific project created in step 1.
// We never query "recent projects" or return an unrelated domain.

const RAILWAY_GRAPHQL = "https://backboard.railway.app/graphql/v2";

async function railwayGraphQL<T = unknown>(
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T | null> {
  try {
    const resp = await fetch(RAILWAY_GRAPHQL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!resp.ok) {
      console.warn(`[CloudDeploy] Railway API HTTP ${resp.status}`);
      return null;
    }
    const json = (await resp.json()) as { data?: T; errors?: unknown[] };
    if (json.errors?.length) {
      console.warn("[CloudDeploy] Railway API errors:", JSON.stringify(json.errors).slice(0, 400));
    }
    return json.data ?? null;
  } catch (err) {
    console.warn("[CloudDeploy] Railway API fetch error:", err);
    return null;
  }
}

/** Create a new Railway project and return its project ID, or null on failure. */
async function createRailwayProject(token: string, name: string): Promise<string | null> {
  const data = await railwayGraphQL<{ projectCreate: { id: string; name: string } }>(
    token,
    `mutation CreateProject($input: ProjectCreateInput!) {
      projectCreate(input: $input) {
        id
        name
      }
    }`,
    { input: { name: slugify(name, 50), description: "Deployed by Jarvis" } },
  );
  const id = data?.projectCreate?.id ?? null;
  if (id) {
    console.log(`[CloudDeploy] Railway project created: id=${id} name=${data?.projectCreate?.name}`);
  } else {
    console.warn("[CloudDeploy] Railway projectCreate returned no id");
  }
  return id;
}

/** Query the service domain for a specific Railway project ID. Returns null if not yet provisioned. */
async function getRailwayProjectDomain(token: string, projectId: string): Promise<string | null> {
  const data = await railwayGraphQL<{
    project: {
      services: {
        edges: Array<{
          node: {
            serviceInstances: {
              edges: Array<{
                node: {
                  domains?: {
                    serviceDomains?: Array<{ domain: string }>;
                  };
                };
              }>;
            };
          };
        }>;
      };
    };
  }>(
    token,
    `query GetProjectDomain($id: String!) {
      project(id: $id) {
        services {
          edges {
            node {
              serviceInstances {
                edges {
                  node {
                    domains {
                      serviceDomains {
                        domain
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }`,
    { id: projectId },
  );

  const services = data?.project?.services?.edges ?? [];
  for (const { node: svc } of services) {
    for (const { node: inst } of svc.serviceInstances?.edges ?? []) {
      const domain = inst.domains?.serviceDomains?.[0]?.domain;
      if (domain) return `https://${domain}`;
    }
  }
  return null;
}

/** Poll a specific Railway project for its service domain, up to timeoutMs. */
async function waitForRailwayDomain(
  token: string,
  projectId: string,
  timeoutMs = 5 * 60 * 1000,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, 8_000));
    const domain = await getRailwayProjectDomain(token, projectId);
    if (domain) {
      console.log(`[CloudDeploy] Railway domain ready: ${domain}`);
      return domain;
    }
  }
  console.warn(`[CloudDeploy] Railway domain polling timed out for project=${projectId}`);
  return null;
}

export async function deployToRailway(
  workspaceDir: string,
  projectTitle: string,
): Promise<string | null> {
  const token = process.env.RAILWAY_TOKEN;
  if (!token) {
    console.log("[CloudDeploy] RAILWAY_TOKEN not set — skipping Railway deployment");
    return null;
  }

  // Step 1: Create a dedicated Railway project via the public API
  const projectId = await createRailwayProject(token, projectTitle);
  if (!projectId) {
    console.warn("[CloudDeploy] Could not create Railway project — aborting");
    return null;
  }

  // Step 2: Deploy files to that specific project using the Railway CLI
  console.log(`[CloudDeploy] Running railway up --project ${projectId}`);
  const result = spawnSync(
    "npx",
    ["--yes", "@railway/cli@3", "up", "--detach", "--project", projectId],
    {
      cwd: workspaceDir,
      env: { ...process.env, RAILWAY_TOKEN: token, HOME: os.homedir(), CI: "true" },
      encoding: "utf8",
      timeout: 600_000,
      stdio: "pipe",
    },
  );

  const stdout = (result.stdout ?? "").trim();
  const stderr = (result.stderr ?? "").trim();
  console.log(`[CloudDeploy] Railway CLI exit=${result.status}`);
  if (stdout) console.log(`[CloudDeploy] Railway stdout: ${stdout.slice(0, 600)}`);
  if (stderr) console.log(`[CloudDeploy] Railway stderr: ${stderr.slice(0, 600)}`);

  if (result.status !== 0 && result.status !== null) {
    // Non-zero exit — still try to get the domain (build may be in progress)
    console.warn("[CloudDeploy] Railway CLI returned non-zero — checking domain anyway");
  }

  // Step 3: Poll the specific project we created for its service domain.
  // This is scoped to our projectId only — no cross-project leakage possible.
  const domain = await waitForRailwayDomain(token, projectId);
  return domain;
}

// ── Master function ───────────────────────────────────────────────────────────

export interface CloudDeployResult {
  provider: "vercel" | "railway" | null;
  url: string | null;
  attempted: boolean;
}

export type DeployProvider = "vercel" | "railway" | "auto";

/**
 * Attempt cloud deployment.
 *
 * @param forceProvider - When set to "vercel" or "railway", only that provider
 *   is attempted regardless of framework. "auto" selects based on framework.
 */
export async function attemptCloudDeploy(
  workspaceDir: string,
  projectTitle: string,
  framework: string,
  forceProvider: DeployProvider = "auto",
): Promise<CloudDeployResult> {
  const hasVercel = !!process.env.VERCEL_TOKEN;
  const hasRailway = !!process.env.RAILWAY_TOKEN;

  // Determine which provider to use.
  // In "auto" mode the framework strictly dictates the provider — there is NO
  // cross-provider fallback (e.g. a Next.js app will never be deployed to Railway
  // and a Node/Express app will never be deployed to Vercel).  If the required
  // token is absent the function returns attempted=false so callers can surface
  // a clear "add VERCEL_TOKEN / RAILWAY_TOKEN" message instead of silently
  // routing to the wrong platform.
  let useVercel = false;
  let useRailway = false;

  if (forceProvider === "vercel") {
    if (!hasVercel) return { provider: null, url: null, attempted: false };
    useVercel = true;
  } else if (forceProvider === "railway") {
    if (!hasRailway) return { provider: null, url: null, attempted: false };
    useRailway = true;
  } else {
    // auto: strict framework → provider mapping, no cross-provider fallback
    if (framework === "nextjs" || framework === "react-vite") {
      if (!hasVercel) return { provider: null, url: null, attempted: false };
      useVercel = true;
    } else if (framework === "node-express") {
      if (!hasRailway) return { provider: null, url: null, attempted: false };
      useRailway = true;
    } else {
      // custom / unknown: Vercel if token present, else Railway — no fallback
      // between them (first available token wins, consistent with user intent)
      if (hasVercel) useVercel = true;
      else if (hasRailway) useRailway = true;
    }
  }

  if (!useVercel && !useRailway) {
    return { provider: null, url: null, attempted: false };
  }

  if (useVercel) {
    try {
      const url = await deployToVercel(workspaceDir, projectTitle, framework);
      if (url) return { provider: "vercel", url, attempted: true };
    } catch (err) {
      console.warn("[CloudDeploy] Vercel error:", err);
    }
    return { provider: null, url: null, attempted: true };
  }

  if (useRailway) {
    try {
      const url = await deployToRailway(workspaceDir, projectTitle);
      if (url) return { provider: "railway", url, attempted: true };
    } catch (err) {
      console.warn("[CloudDeploy] Railway error:", err);
    }
    return { provider: null, url: null, attempted: true };
  }

  return { provider: null, url: null, attempted: false };
}
