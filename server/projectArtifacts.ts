import * as fs from "fs";
import * as path from "path";
import { and, eq, notInArray } from "drizzle-orm";
import { db } from "./db";
import * as schema from "@shared/schema";

const SNAPSHOT_BLOCKED_DIRS = new Set([
  ".git",
  ".next",
  ".expo",
  "build",
  "dist",
  "node_modules",
  "coverage",
]);

const SNAPSHOT_BLOCKED_FILES = new Set([
  ".jarvis-dev-server.json",
]);

const MAX_FILE_BYTES = 1_000_000;
const MAX_TOTAL_BYTES = 25_000_000;

function toProjectPath(root: string, fullPath: string): string {
  return path.relative(root, fullPath).replace(/\\/g, "/");
}

function ensureInside(root: string, fullPath: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(fullPath);
  return resolvedPath === resolvedRoot || resolvedPath.startsWith(resolvedRoot + path.sep);
}

function isWorkspaceEmpty(workspaceDir: string): boolean {
  if (!fs.existsSync(workspaceDir)) return true;
  const entries = fs.readdirSync(workspaceDir).filter((entry) => entry !== ".jarvis-dev-server.json");
  return entries.length === 0;
}

function listSnapshotFiles(workspaceDir: string): { filePath: string; fullPath: string; sizeBytes: number }[] {
  const root = path.resolve(workspaceDir);
  const files: { filePath: string; fullPath: string; sizeBytes: number }[] = [];
  let totalBytes = 0;

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && SNAPSHOT_BLOCKED_DIRS.has(entry.name)) continue;
      if (entry.isFile() && SNAPSHOT_BLOCKED_FILES.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);
      if (!ensureInside(root, fullPath)) continue;

      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;
      const stat = fs.statSync(fullPath);
      if (stat.size > MAX_FILE_BYTES) continue;
      if (totalBytes + stat.size > MAX_TOTAL_BYTES) continue;
      totalBytes += stat.size;
      files.push({ filePath: toProjectPath(root, fullPath), fullPath, sizeBytes: stat.size });
    }
  };

  if (fs.existsSync(root)) walk(root);
  return files;
}

export async function snapshotProjectWorkspace(projectId: string, workspaceDir: string): Promise<void> {
  if (!fs.existsSync(workspaceDir)) return;
  const files = listSnapshotFiles(workspaceDir);
  const seenPaths = files.map((file) => file.filePath);

  for (const file of files) {
    const contentBase64 = fs.readFileSync(file.fullPath).toString("base64");
    await db
      .insert(schema.jarvisProjectFiles)
      .values({
        projectId,
        filePath: file.filePath,
        contentBase64,
        sizeBytes: file.sizeBytes,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.jarvisProjectFiles.projectId, schema.jarvisProjectFiles.filePath],
        set: {
          contentBase64,
          sizeBytes: file.sizeBytes,
          updatedAt: new Date(),
        },
      });
  }

  if (seenPaths.length === 0) {
    console.warn(`[ProjectArtifacts] skipped empty snapshot for project ${projectId}; preserving stored files`);
    return;
  }

  await db
    .delete(schema.jarvisProjectFiles)
    .where(and(
      eq(schema.jarvisProjectFiles.projectId, projectId),
      notInArray(schema.jarvisProjectFiles.filePath, seenPaths),
    ));
}

export async function hydrateProjectWorkspace(projectId: string, workspaceDir: string): Promise<boolean> {
  if (!isWorkspaceEmpty(workspaceDir)) return false;

  const rows = await db
    .select()
    .from(schema.jarvisProjectFiles)
    .where(eq(schema.jarvisProjectFiles.projectId, projectId));

  if (rows.length === 0) return false;

  const root = path.resolve(workspaceDir);
  fs.mkdirSync(root, { recursive: true });

  for (const row of rows) {
    const fullPath = path.resolve(root, row.filePath);
    if (!ensureInside(root, fullPath)) continue;
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, Buffer.from(row.contentBase64, "base64"));
  }

  console.log(`[ProjectArtifacts] hydrated ${rows.length} file(s) for project ${projectId}`);
  return true;
}

export async function listProjectSnapshot(projectId: string): Promise<{
  path: string;
  name: string;
  type: "file";
  size: number;
  updatedAt: string;
}[]> {
  const rows = await db
    .select()
    .from(schema.jarvisProjectFiles)
    .where(eq(schema.jarvisProjectFiles.projectId, projectId));

  return rows.map((row) => ({
    path: row.filePath,
    name: path.basename(row.filePath),
    type: "file" as const,
    size: row.sizeBytes,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function readProjectSnapshotFile(projectId: string, filePath: string): Promise<{
  path: string;
  content: string;
  size: number;
  updatedAt: string;
} | null> {
  const [row] = await db
    .select()
    .from(schema.jarvisProjectFiles)
    .where(and(eq(schema.jarvisProjectFiles.projectId, projectId), eq(schema.jarvisProjectFiles.filePath, filePath)))
    .limit(1);

  if (!row) return null;
  const buffer = Buffer.from(row.contentBase64, "base64");
  return {
    path: filePath,
    content: buffer.toString("utf8"),
    size: row.sizeBytes,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function saveProjectArchive(projectId: string, zipPath: string): Promise<void> {
  const zip = fs.readFileSync(zipPath);
  await db
    .insert(schema.jarvisProjectArchives)
    .values({
      projectId,
      zipBase64: zip.toString("base64"),
      sizeBytes: zip.length,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.jarvisProjectArchives.projectId,
      set: {
        zipBase64: zip.toString("base64"),
        sizeBytes: zip.length,
        updatedAt: new Date(),
      },
    });
}

export async function readProjectArchive(projectId: string): Promise<{ data: Buffer; sizeBytes: number } | null> {
  const [archive] = await db
    .select()
    .from(schema.jarvisProjectArchives)
    .where(eq(schema.jarvisProjectArchives.projectId, projectId))
    .limit(1);

  if (!archive) return null;
  return { data: Buffer.from(archive.zipBase64, "base64"), sizeBytes: archive.sizeBytes };
}
