/**
 * Workspace Loader — File-backed "brain" for Jarvis
 *
 * Manages ~/.jarvis/workspace/ which contains:
 *   SOUL.md       — persona / standing character instructions
 *   AGENTS.md     — operating principles / agent behaviour rules
 *   MEMORY.md     — HOT memory, capped at 100 lines, always loaded
 *   .learnings/ERRORS.md
 *   .learnings/CORRECTIONS.md
 *   .learnings/FEATURE_REQUESTS.md
 *
 * All files are read into an in-memory cache on startup and re-read whenever
 * a file changes on disk (via fs.watch).  getWorkspaceContext() returns a
 * single string block ready to be prepended to any agent system prompt.
 */

import fs from "fs/promises";
import { watch } from "fs";
import path from "path";
import os from "os";

// ── Paths ─────────────────────────────────────────────────────────────────────

export const WORKSPACE_DIR = path.join(os.homedir(), ".jarvis", "workspace");
export const LEARNINGS_DIR = path.join(WORKSPACE_DIR, ".learnings");

export const WORKSPACE_FILES = {
  soul:             path.join(WORKSPACE_DIR, "SOUL.md"),
  agents:           path.join(WORKSPACE_DIR, "AGENTS.md"),
  memory:           path.join(WORKSPACE_DIR, "MEMORY.md"),
  errors:           path.join(LEARNINGS_DIR, "ERRORS.md"),
  corrections:      path.join(LEARNINGS_DIR, "CORRECTIONS.md"),
  feature_requests: path.join(LEARNINGS_DIR, "FEATURE_REQUESTS.md"),
} as const;

export type WorkspaceFileKey = keyof typeof WORKSPACE_FILES;

// ── Stub content written on first initialisation ──────────────────────────────

export const STUBS: Record<WorkspaceFileKey, string> = {
  soul: `# Jarvis Workspace — SOUL.md
<!-- Edit this file to give Jarvis a custom persona or standing character instructions. -->
<!-- These instructions are injected into EVERY agent session alongside the generated Soul. -->

## Persona & Character
You are Jarvis — a highly capable, proactive AI chief-of-staff. You are direct, thoughtful, and action-oriented. You adapt your communication style to match the user's energy and context.

## Standing Instructions
- Always prioritise the user's time. Summarise before elaborating.
- When uncertain, ask one clarifying question rather than guessing.
- Prefer concrete, actionable responses over vague advice.
`,

  agents: `# Jarvis Workspace — AGENTS.md
<!-- Edit this file to define operating principles that apply across all agent sessions. -->

## Operating Principles
1. Complete tasks fully — never return a half-finished result without flagging it.
2. Use tools purposefully — do not call tools when a direct answer suffices.
3. Be transparent about uncertainty and tool limitations.
4. Respect user autonomy — offer options, do not decide without asking when stakes are high.
`,

  memory: `# Jarvis Workspace — MEMORY.md
<!-- This file is the HOT memory layer — always loaded, capped at 100 lines. -->
<!-- Jarvis can update this file mid-session using the workspace_update tool. -->
<!-- Lines are auto-trimmed from the top when the file exceeds 100 lines. -->
`,

  errors: `# Learnings — ERRORS.md
<!-- Auto-populated by Jarvis when it encounters repeated errors. Capped at 50 entries. -->
`,

  corrections: `# Learnings — CORRECTIONS.md
<!-- Auto-populated when users correct Jarvis's behaviour. Capped at 50 entries. -->
`,

  feature_requests: `# Learnings — FEATURE_REQUESTS.md
<!-- Auto-populated when users request new capabilities. Capped at 50 entries. -->
`,
};

// ── In-memory cache ───────────────────────────────────────────────────────────

interface WorkspaceCache {
  soul: string;
  agents: string;
  memory: string;
  loadedAt: number;
}

let cache: WorkspaceCache | null = null;

function invalidateCache(): void {
  cache = null;
}

// ── Initialisation ────────────────────────────────────────────────────────────

/**
 * Ensure the workspace directory and all stub files exist.
 * Called once at server startup. Safe to call multiple times.
 */
export async function initWorkspace(): Promise<void> {
  try {
    await fs.mkdir(WORKSPACE_DIR, { recursive: true });
    await fs.mkdir(LEARNINGS_DIR, { recursive: true });

    for (const [key, filePath] of Object.entries(WORKSPACE_FILES)) {
      try {
        await fs.access(filePath);
      } catch {
        // File does not exist — write stub content.
        await fs.writeFile(filePath, STUBS[key as WorkspaceFileKey], "utf-8");
        console.log(`[Workspace] created ${path.basename(filePath)}`);
      }
    }

    console.log("[Workspace] initialised at", WORKSPACE_DIR);
  } catch (err) {
    console.error("[Workspace] initWorkspace failed:", err);
  }
}

// ── File reading helpers ──────────────────────────────────────────────────────

async function readFileSafe(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

// ── Cache loading ─────────────────────────────────────────────────────────────

async function loadCache(): Promise<WorkspaceCache> {
  const [soul, agents, memory] = await Promise.all([
    readFileSafe(WORKSPACE_FILES.soul),
    readFileSafe(WORKSPACE_FILES.agents),
    readFileSafe(WORKSPACE_FILES.memory),
  ]);
  const loaded: WorkspaceCache = { soul, agents, memory, loadedAt: Date.now() };
  cache = loaded;
  return loaded;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns a single workspace context block for injection into system prompts.
 * Reads from cache; reloads from disk if the cache has been invalidated.
 */
export async function getWorkspaceContext(): Promise<string> {
  const c = cache ?? (await loadCache());

  const parts: string[] = [];

  const soulContent = c.soul.trim();
  if (soulContent && !isStubOnly(soulContent)) {
    parts.push(`### SOUL.md\n${soulContent}`);
  }

  const agentsContent = c.agents.trim();
  if (agentsContent && !isStubOnly(agentsContent)) {
    parts.push(`### AGENTS.md\n${agentsContent}`);
  }

  const memoryContent = c.memory.trim();
  if (memoryContent && !isStubOnly(memoryContent)) {
    parts.push(`### MEMORY.md (HOT memory)\n${memoryContent}`);
  }

  if (parts.length === 0) return "";

  return `\n\n---\n## Workspace Instructions\n_These standing instructions are loaded from the owner's workspace files and MUST be followed:_\n\n${parts.join("\n\n")}`;
}

/** Return true when content is just comment lines (the stub template). */
function isStubOnly(content: string): boolean {
  const meaningful = content
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("<!--") && !l.trim().startsWith("#"))
    .join("");
  return meaningful.length === 0;
}

/**
 * Read a single workspace file by key.
 */
export async function readWorkspaceFile(key: WorkspaceFileKey): Promise<string> {
  return readFileSafe(WORKSPACE_FILES[key]);
}

/**
 * Write a workspace file. Enforces line caps for MEMORY.md and learnings files.
 * Invalidates the in-memory cache after writing.
 */
export async function writeWorkspaceFile(
  key: WorkspaceFileKey,
  content: string,
  mode: "overwrite" | "append" = "overwrite",
): Promise<void> {
  const filePath = WORKSPACE_FILES[key];
  let final = content;

  if (mode === "append") {
    const existing = await readFileSafe(filePath);
    final = existing ? existing.trimEnd() + "\n" + content : content;
  }

  // Enforce size caps.
  if (key === "memory") {
    final = trimToLastN(final, 100);
  } else if (key === "corrections" || key === "errors" || key === "feature_requests") {
    final = trimToLastNEntries(final, 50);
  }

  await fs.writeFile(filePath, final, "utf-8");
  invalidateCache();
}

/**
 * Trim content to the last N lines, preserving header lines that start with `#`.
 */
function trimToLastN(content: string, maxLines: number): string {
  const lines = content.split("\n");
  if (lines.length <= maxLines) return content;

  // Always preserve header comment lines at the top.
  const headerLines: string[] = [];
  let i = 0;
  while (i < lines.length && (lines[i].startsWith("#") || lines[i].startsWith("<!--") || lines[i].trim() === "")) {
    headerLines.push(lines[i]);
    i++;
  }

  const body = lines.slice(i);
  const trimmed = body.slice(Math.max(0, body.length - (maxLines - headerLines.length)));
  return [...headerLines, ...trimmed].join("\n");
}

/**
 * Trim a learnings file to the last N entries.
 * Entries are delimited by lines that are exactly `---`.
 * Header lines (starting with `#` or `<!--`) are always preserved at the top.
 */
function trimToLastNEntries(content: string, maxEntries: number): string {
  const lines = content.split("\n");

  // Collect header lines (comments + title block at the very top).
  const headerLines: string[] = [];
  let i = 0;
  while (i < lines.length && (lines[i].startsWith("#") || lines[i].startsWith("<!--") || lines[i].trim() === "")) {
    headerLines.push(lines[i]);
    i++;
  }

  const body = lines.slice(i);

  // Split body into entries by `---` delimiter lines.
  const entries: string[][] = [];
  let current: string[] = [];
  for (const line of body) {
    if (line.trim() === "---") {
      if (current.length > 0 || entries.length > 0) {
        entries.push(current);
        current = [];
      }
      // The `---` separator starts a new entry block; keep it as the entry start.
      current = ["---"];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) entries.push(current);

  // Keep only the last maxEntries entries.
  const kept = entries.slice(Math.max(0, entries.length - maxEntries));
  const keptLines = kept.flat();

  return [...headerLines, ...keptLines].join("\n");
}

// ── File watcher ──────────────────────────────────────────────────────────────

const WATCHED_NAMES = new Set(Object.values(WORKSPACE_FILES).map((p) => path.basename(p)));
let watcherStarted = false;

/**
 * Start watching workspace files for changes. Call once at server startup.
 */
export function startWorkspaceWatcher(): void {
  if (watcherStarted) return;
  watcherStarted = true;

  // Watch the workspace root
  watchDir(WORKSPACE_DIR);
  // Watch .learnings/
  watchDir(LEARNINGS_DIR);
}

function watchDir(dir: string): void {
  try {
    watch(dir, (_event, filename) => {
      if (!filename) return;
      if (WATCHED_NAMES.has(filename)) {
        invalidateCache();
        console.log(`[Workspace] cache invalidated — ${filename} changed`);
      }
    });
  } catch {
    // Non-fatal — cache will reload on next access anyway.
  }
}
