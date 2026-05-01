import type { Express, Request, Response } from "express";
import { db } from "./db";
import { eq, and } from "drizzle-orm";
import * as schema from "@shared/schema";
import {
  startProject,
  pauseProject,
  resumeProject,
  answerProjectQuestion,
  getProjectStatus,
  getUserProjects,
  setAutonomousMode,
} from "./agent/projectRunner";
import { authMiddleware } from "./auth";
import { getGitHubSettings, createGitHubRepo, pushWorkspaceToGitHub } from "./integrations/github";
import * as fs from "fs";

const _p = (v: string | string[]): string => Array.isArray(v) ? (v[0] ?? "") : v;

export function registerProjectRoutes(app: Express): void {
  // GET /api/projects — list user's projects
  app.get("/api/projects", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const projects = await getUserProjects(userId);
      res.json(projects);
    } catch (err) {
      console.error("[ProjectRoutes] GET /api/projects failed:", err);
      res.status(500).json({ error: "Failed to load projects" });
    }
  });

  // POST /api/projects — create a new project
  app.post("/api/projects", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const { title, description, goal, autonomousMode, originChannel } = req.body as {
        title?: string;
        description?: string;
        goal?: string;
        autonomousMode?: boolean;
        originChannel?: string;
      };

      if (!title || !goal) {
        return res.status(400).json({ error: "title and goal are required" });
      }

      const projectId = await startProject(userId, title, description ?? "", goal, originChannel ?? "app");

      if (autonomousMode) {
        await setAutonomousMode(projectId, true);
      }

      res.json({ projectId, status: "planning" });
    } catch (err) {
      console.error("[ProjectRoutes] POST /api/projects failed:", err);
      res.status(500).json({ error: "Failed to create project" });
    }
  });

  // GET /api/projects/:id — project detail + plan + sessions
  app.get("/api/projects/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const id = _p(req.params.id);

      const status = await getProjectStatus(id);
      if (!status) return res.status(404).json({ error: "Project not found" });
      if (status.project.userId !== userId) return res.status(403).json({ error: "Forbidden" });

      res.json(status);
    } catch (err) {
      console.error("[ProjectRoutes] GET /api/projects/:id failed:", err);
      res.status(500).json({ error: "Failed to load project" });
    }
  });

  // PATCH /api/projects/:id — update project (pause/resume/answer/auto mode)
  app.patch("/api/projects/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const id = _p(req.params.id);
      const { action, answer, autonomousMode } = req.body as {
        action?: "pause" | "resume";
        answer?: string;
        autonomousMode?: boolean;
      };

      const [project] = await db
        .select()
        .from(schema.jarvisProjects)
        .where(and(eq(schema.jarvisProjects.id, id), eq(schema.jarvisProjects.userId, userId)))
        .limit(1);

      if (!project) return res.status(404).json({ error: "Project not found" });

      if (action === "pause") {
        await pauseProject(id);
        return res.json({ status: "paused" });
      }

      if (action === "resume") {
        await resumeProject(id);
        return res.json({ status: "building" });
      }

      if (answer !== undefined) {
        await answerProjectQuestion(id, answer);
        return res.json({ status: "building" });
      }

      if (autonomousMode !== undefined) {
        await setAutonomousMode(id, autonomousMode);
        return res.json({ autonomousMode });
      }

      res.status(400).json({ error: "No valid action provided" });
    } catch (err) {
      console.error("[ProjectRoutes] PATCH /api/projects/:id failed:", err);
      res.status(500).json({ error: "Failed to update project" });
    }
  });

  // DELETE /api/projects/:id — delete a project
  app.delete("/api/projects/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const id = _p(req.params.id);

      const [project] = await db
        .select()
        .from(schema.jarvisProjects)
        .where(and(eq(schema.jarvisProjects.id, id), eq(schema.jarvisProjects.userId, userId)))
        .limit(1);

      if (!project) return res.status(404).json({ error: "Project not found" });

      await db.delete(schema.jarvisProjects).where(eq(schema.jarvisProjects.id, id));
      res.json({ deleted: true });
    } catch (err) {
      console.error("[ProjectRoutes] DELETE /api/projects/:id failed:", err);
      res.status(500).json({ error: "Failed to delete project" });
    }
  });

  // POST /api/projects/:id/push-to-github — push the project workspace to a new GitHub repo
  app.post("/api/projects/:id/push-to-github", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const id = _p(req.params.id);
      const { repoName, isPrivate, description } = req.body as {
        repoName?: string;
        isPrivate?: boolean;
        description?: string;
      };

      if (!repoName) {
        return res.status(400).json({ error: "repoName is required" });
      }

      const [project] = await db
        .select()
        .from(schema.jarvisProjects)
        .where(and(eq(schema.jarvisProjects.id, id), eq(schema.jarvisProjects.userId, userId)))
        .limit(1);

      if (!project) return res.status(404).json({ error: "Project not found" });

      if (project.status !== "complete") {
        return res.status(400).json({ error: "Project must be complete before pushing to GitHub" });
      }

      if (!project.workspaceDir || !fs.existsSync(project.workspaceDir)) {
        return res.status(400).json({ error: "Project workspace directory not found" });
      }

      const settings = await getGitHubSettings(userId);
      if (!settings.pat) {
        return res.status(400).json({ error: "No GitHub token configured. Add your GitHub PAT in Settings → GitHub." });
      }

      const safeRepoName = repoName.trim().replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^[._-]+|[._-]+$/g, "").slice(0, 100);
      if (!safeRepoName) {
        return res.status(400).json({ error: "Repository name contains only invalid characters. Use letters, numbers, hyphens, or underscores." });
      }

      const createResult = await createGitHubRepo(
        settings.pat,
        safeRepoName,
        description ?? project.description ?? project.goal ?? `Built by Jarvis: ${project.title}`,
        isPrivate ?? false,
      );

      if (!createResult.ok || !createResult.owner || !createResult.repoName || !createResult.repoUrl) {
        return res.status(500).json({ error: createResult.error ?? "Failed to create GitHub repository" });
      }

      const pushResult = await pushWorkspaceToGitHub(
        settings.pat,
        createResult.owner,
        createResult.repoName,
        project.workspaceDir,
        `Initial commit: ${project.title ?? "Jarvis project"}`,
      );

      if (!pushResult.ok) {
        // Attempt to delete the newly-created repo so the user doesn't end up
        // with an empty orphaned repo they didn't ask for.
        try {
          await fetch(`https://api.github.com/repos/${createResult.owner}/${createResult.repoName}`, {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${settings.pat}`,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
            },
          });
          console.log(`[ProjectRoutes] cleaned up orphaned repo ${createResult.owner}/${createResult.repoName} after push failure`);
        } catch (cleanupErr) {
          console.warn(`[ProjectRoutes] could not clean up orphaned repo:`, cleanupErr);
        }
        return res.status(500).json({ error: pushResult.error ?? "Failed to push code to GitHub" });
      }

      await db
        .update(schema.jarvisProjects)
        .set({ githubRepoUrl: createResult.repoUrl, updatedAt: new Date() })
        .where(eq(schema.jarvisProjects.id, id));

      console.log(`[ProjectRoutes] pushed project ${id} to GitHub: ${createResult.repoUrl}`);
      res.json({ repoUrl: createResult.repoUrl });
    } catch (err) {
      console.error("[ProjectRoutes] POST /api/projects/:id/push-to-github failed:", err);
      res.status(500).json({ error: "Failed to push to GitHub" });
    }
  });
}
