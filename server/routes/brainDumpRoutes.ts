import type { Express, Request, Response } from "express";
import type OpenAI from "openai";

export function registerBrainDumpRoutes(app: Express, openai: OpenAI): void {
  app.post("/api/ai/parse-brain-dump", async (req: Request, res: Response) => {
    try {
      const { text } = req.body;
      if (!text?.trim()) {
        return res.json({ tasks: [] });
      }

      const prompt = `You are a productivity assistant helping organize a brain dump into actionable tasks.

Brain dump text: "${text.trim()}"

Read the text above and identify each distinct action item or topic. Different subjects become different tasks. If one task has multiple steps, list them as subtasks.

For each task provide:
- title: concise action phrase starting with a verb
- description: one sentence of context (or null if title is self-explanatory)
- priority: "high", "medium", or "low"
- category: one of "personal", "career", "finance", "fitness", "social"
- subtasks: array of short action strings (empty array if not needed)

Return ONLY a JSON object with a "tasks" array. No other text.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_completion_tokens: 8192,
      });

      const content = response.choices[0]?.message?.content || '{"tasks":[]}';
      try {
        const parsed = JSON.parse(content);
        const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
        res.json({ tasks });
      } catch {
        res.json({ tasks: [] });
      }
    } catch (error) {
      console.error("Error parsing brain dump:", error);
      res.json({ tasks: [] });
    }
  });
}
