import type { Express, Request, Response } from "express";
import OpenAI from "openai";
import { getOpenAIClientConfig } from "../agent/providers/env";
import { generateSmartPlan, resizeTask, unblockTask } from "../ai";
import { buildPlanFromInputs } from "../services/planGenerationService";

const openai = new OpenAI(getOpenAIClientConfig());

export function registerPlanGenerationRoutes(app: Express): void {
  app.post("/api/ai/resize-task", async (req: Request, res: Response) => {
    try {
      const { taskTitle, taskDescription, detailLevel, direction, history } = req.body;

      if (!taskTitle || detailLevel === undefined || !direction) {
        return res.status(400).json({ error: "taskTitle, detailLevel, and direction are required" });
      }

      if (typeof detailLevel !== 'number' || detailLevel < 1 || detailLevel > 5) {
        return res.status(400).json({ error: "detailLevel must be a number between 1 and 5" });
      }

      if (direction !== 'smaller' && direction !== 'bigger') {
        return res.status(400).json({ error: "direction must be 'smaller' or 'bigger'" });
      }

      const result = await resizeTask({
        taskTitle,
        taskDescription,
        detailLevel: Math.min(5, Math.max(1, detailLevel)),
        direction,
        history: history || [],
        userId: (req as any).userId,
      });

      res.json(result);
    } catch (error) {
      console.error("Error resizing task:", error);
      res.status(500).json({ error: "Failed to resize task" });
    }
  });

  app.post("/api/ai/generate-plan", async (req: Request, res: Response) => {
    try {
      const { goals, history, dayOfWeek, lifeContext, gmailItems, energyCheckin, brainDumpTasks, carriedOverTasks, blockedTasks } = req.body;

      const result = await generateSmartPlan({
        goals: goals || [],
        history: history || [],
        dayOfWeek: dayOfWeek || new Date().toLocaleDateString('en-US', { weekday: 'long' }),
        lifeContext: lifeContext || null,
        gmailItems: gmailItems || [],
        energyCheckin: energyCheckin || null,
        existingTasks: brainDumpTasks || [],
        carriedOverTasks: carriedOverTasks || [],
        blockedTasks: blockedTasks || [],
        userId: (req as any).userId,
      });

      res.json(result);
    } catch (error) {
      console.error("Error generating plan:", error);
      res.status(500).json({ error: "Failed to generate plan" });
    }
  });

  app.post("/api/ai/unblock-task", async (req: Request, res: Response) => {
    try {
      const { taskTitle, taskDescription, blockerType, skipDays } = req.body;
      if (!taskTitle || !blockerType) {
        return res.status(400).json({ error: "taskTitle and blockerType are required" });
      }
      const result = await unblockTask({ taskTitle, taskDescription, blockerType, skipDays: skipDays || 1, userId: (req as any).userId });
      res.json(result);
    } catch (error) {
      console.error("Error unblocking task:", error);
      res.status(500).json({ error: "Failed to generate suggestion" });
    }
  });

  app.post("/api/coach/build-plan", async (req: Request, res: Response) => {
    try {
      const result = await buildPlanFromInputs(req.body);
      res.json(result);

      // Auto-save to Google Drive (non-fatal, fire-and-forget).
      const userId = (req as any).userId as string | undefined;
      if (userId && result && result.tasks.length > 0) {
        (async () => {
          try {
            const { getUserDriveSettings } = await import('../driveRoutes');
            const { createDriveTextFile } = await import('../integrations/googleDrive');
            const drive = await getUserDriveSettings(userId);
            if (drive.enabled && drive.autoSavePlans && drive.accessToken) {
              const today = new Date().toISOString().slice(0, 10);
              const lines: string[] = [`# Daily Plan — ${today}`, '', '## Tasks', ''];
              for (const t of result.tasks) {
                const dur = t.duration ? ` (${t.duration} min)` : '';
                const tm = t.time ? ` @ ${t.time}` : '';
                lines.push(`⬜ **${t.title}**${tm}${dur}`);
                if (t.description) lines.push(`   ${t.description}`);
              }
              if (result.reasoning) lines.unshift(`> ${result.reasoning}`, '', lines.shift()!);
              await createDriveTextFile(
                drive.accessToken,
                `Daily Plan — ${today}`,
                lines.join('\n'),
                { convertToDoc: true, folderId: drive.folderId || undefined }
              );
              console.log(`[Route] Drive auto-save (build-plan) for user ${userId}`);
            }
          } catch (driveErr) {
            console.error('[Route] Drive auto-save (build-plan) failed:', driveErr);
          }
        })();
      }
    } catch (error) {
      console.error("Error building plan:", error);
      res.status(500).json({ error: "Failed to build plan" });
    }
  });

  app.post("/api/coach/break-down-task", async (req: Request, res: Response) => {
    try {
      const { title, description } = req.body;
      if (!title) return res.status(400).json({ error: "title is required" });

      const prompt = `Break down the following task into exactly 3-5 clear, actionable sub-steps that can each be completed independently.

Task: "${title}"${description ? `\nContext: ${description}` : ""}

Return JSON only — no markdown, no explanation:
{
  "subtasks": [
    { "title": "concise action-verb sub-task", "category": "work|personal|health|finance|social|learning", "priority": "high|medium|low" }
  ]
}

Rules:
- Each sub-task title should start with a verb (e.g. "Write", "Review", "Send", "Schedule")
- Keep each title under 60 characters
- Choose category that best fits the subtask
- Assign priority based on urgency/importance relative to the overall task`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_completion_tokens: 600,
      });

      const content = response.choices[0]?.message?.content || '{"subtasks":[]}';
      const parsed = JSON.parse(content);
      const subtasks = Array.isArray(parsed.subtasks) ? parsed.subtasks.slice(0, 5) : [];
      res.json({ subtasks });
    } catch (error) {
      console.error("Error breaking down task:", error);
      res.status(500).json({ error: "Failed to break down task" });
    }
  });

}