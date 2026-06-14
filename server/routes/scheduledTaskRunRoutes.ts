import type { Express, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { db } from "../db";

const paramValue = (value: string | string[]): string => Array.isArray(value) ? (value[0] ?? "") : value;

export function registerScheduledTaskRunRoutes(app: Express): void {
  app.post("/api/jarvis/scheduled-tasks/:id/run", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = paramValue(req.params.id);

      const [task] = await db
        .select()
        .from(schema.jarvisScheduledTasks)
        .where(and(eq(schema.jarvisScheduledTasks.id, id), eq(schema.jarvisScheduledTasks.userId, userId)))
        .limit(1);

      if (!task) return res.status(404).json({ error: "Task not found" });
      if (!task.shellCommand) return res.status(400).json({ error: "Task has no shell command" });

      const { sendDaemonOp, isDesktopDaemonActive, isDaemonActionAllowed } = await import("../daemon/bridge");

      if (!isDesktopDaemonActive(userId)) {
        return res.status(503).json({ error: "Desktop daemon is not connected." });
      }
      const shellAllowed = await isDaemonActionAllowed(userId, "shell");
      if (!shellAllowed) {
        return res.status(403).json({ error: "Shell execution is not permitted on this daemon." });
      }
      const allowOutsideRoot = await isDaemonActionAllowed(userId, "allow_outside_root");
      const timeoutMs = 120_000;
      const startedAt = Date.now();

      let runResult: { ok: boolean; exitCode: number; stdout: string; stderr: string; durationMs: number; error?: string };
      try {
        const daemonResult = await sendDaemonOp(
          userId,
          { type: "shell", cmd: task.shellCommand, timeoutMs, allowOutsideRoot },
          timeoutMs + 5_000,
        );
        const durationMs = Date.now() - startedAt;
        const data = (daemonResult.data || {}) as Record<string, unknown>;
        runResult = {
          ok: daemonResult.ok,
          exitCode: typeof data.code === "number" ? data.code : (daemonResult.ok ? 0 : 1),
          stdout: typeof data.stdout === "string" ? data.stdout : "",
          stderr: typeof data.stderr === "string" ? data.stderr : "",
          durationMs,
        };
      } catch (err) {
        runResult = {
          ok: false,
          exitCode: -1,
          stdout: "",
          stderr: "",
          durationMs: Date.now() - startedAt,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      const ranAt = new Date().toISOString();
      const shellResult = {
        exitCode: runResult.exitCode,
        stdout: runResult.stdout.slice(0, 8000),
        stderr: runResult.stderr.slice(0, 2000),
        durationMs: runResult.durationMs,
        ranAt,
      };

      await db
        .update(schema.jarvisScheduledTasks)
        .set({ lastShellResult: shellResult })
        .where(and(eq(schema.jarvisScheduledTasks.id, id), eq(schema.jarvisScheduledTasks.userId, userId)));

      console.log(`[Routes] Manual run: task id=${id} exit=${runResult.exitCode} dur=${runResult.durationMs}ms`);

      res.json({ ok: true, result: shellResult, error: runResult.error });
    } catch (err) {
      console.error("Error running scheduled task:", err);
      res.status(500).json({ error: "Failed to run task" });
    }
  });
}
