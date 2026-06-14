import type { Express } from "express";
import type OpenAI from "openai";
import { eq } from "drizzle-orm"; import { db } from "../db";
import * as schema from "@shared/schema"; import { userMemories } from "@shared/schema";
const validCategories = ["personality", "values", "work_style", "accomplishment", "goal_discovered", "relationship", "pattern", "preference", "fact", "goal", "achievement"];
const normalizeMemoryContent = (content: string) => content.trim().toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ");

function conversationText(convo: any): string | null {
  const lines: string[] = [];
  if (convo.title) lines.push(`[Conversation: ${convo.title}]`);
  if (Array.isArray(convo.messages)) {
    for (const msg of convo.messages) {
      if (msg.role && typeof msg.text === "string") lines.push(`${msg.role}: ${msg.text.slice(0, 500)}`);
    }
  } else if (convo.mapping && typeof convo.mapping === "object") {
    const values = Object.values(convo.mapping) as any[];
    const nodes = values.filter((n) => n?.message?.create_time).sort((a, b) => (a.message.create_time || 0) - (b.message.create_time || 0));
    for (const node of [...nodes, ...values.filter((n) => !n?.message?.create_time)]) {
      const msg = node?.message;
      const role = msg?.author?.role;
      if (role !== "user" && role !== "assistant") continue;
      const text = msg.content?.parts?.filter((p: any) => typeof p === "string").join(" ").trim();
      if (text) lines.push(`${role}: ${text.slice(0, 500)}`);
    }
  }
  return lines.length > 1 ? lines.join("\n") : null;
}

function memoryPrompt(batchText: string, existingMemories: string[]): string {
  const existingList = existingMemories.length > 0
    ? `\nExisting memories (DO NOT duplicate these):\n${existingMemories.map((m) => `- ${m}`).join("\n")}`
    : "";
  return `You are extracting profile facts about a user from their ChatGPT conversation history.\nOutput a JSON array of { category, content } objects. Only extract facts that are specific, meaningful, and not already captured.\nFocus on discovering: personality traits, values, work patterns, goals, relationships, preferences, and recurring behaviors.\n\nCategories:\n- personality — how they communicate, humor, energy, decision style\n- values — what they care about deeply, what motivates them\n- work_style — when/how they focus, work patterns, tools they use\n- accomplishment — wins, achievements, proud moments mentioned\n- goal_discovered — goals inferred from behavior (not just stated)\n- relationship — key people in their life (family, teammates, boss)\n- pattern — recurring behaviors, habits, tendencies\n- preference — explicit preferences (meeting times, communication style, etc.)\n- fact — general facts about the user\n- goal — explicitly stated goals\n- achievement — specific achievements mentioned\n${existingList}\n\nConversations:\n${batchText}\n\nReturn JSON: { "memories": [{"content": "string describing the fact", "category": "one of the categories above"}] }\nReturn { "memories": [] } if nothing new was learned. Do NOT repeat or rephrase existing memories.\nExtract up to 8 memories per batch.`;
}

export function registerChatGptImportRoutes(app: Express, openai: OpenAI): void {
  app.get("/api/chatgpt-import/status", async (req, res) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const rows = await db.select().from(schema.chatgptImports).where(eq(schema.chatgptImports.userId, userId));
      if (rows.length === 0) return res.json({ imported: false });
      const row = rows[0]; res.json({ imported: true, importedAt: row.importedAt, memoriesAdded: row.memoriesAdded });
    } catch (error) { console.error("Error getting ChatGPT import status:", error); res.status(500).json({ error: "Failed to get import status" }); }
  });

  app.post("/api/chatgpt-import", async (req, res) => {
    try {
      const userId = req.userId; if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const conversations = req.body.conversations; if (!Array.isArray(conversations) || conversations.length === 0) return res.status(400).json({ error: "No conversations found. Please upload a valid ChatGPT export file." });
      const allTexts = conversations.slice(-150).map(conversationText).filter(Boolean) as string[];
      if (allTexts.length === 0) return res.status(400).json({ error: "No readable conversations found in the file." });
      const existingRows = await db.select({ content: userMemories.content }).from(userMemories).where(eq(userMemories.userId, userId));
      const existingMemories = existingRows.map((r) => r.content);
      const normalizedExisting = new Set(existingMemories.map(normalizeMemoryContent)); let totalAdded = 0;

      for (let i = 0; i < allTexts.length; i += 10) {
        try {
          const response = await openai.chat.completions.create({
            model: "gpt-4o-mini", messages: [{ role: "user", content: memoryPrompt(allTexts.slice(i, i + 10).join("\n\n---\n\n").slice(0, 12000), existingMemories) }],
            response_format: { type: "json_object" }, max_completion_tokens: 800,
          });
          const parsed = JSON.parse(response.choices[0]?.message?.content || '{"memories":[]}');
          const rawMemories = Array.isArray(parsed.memories) ? parsed.memories : (Array.isArray(parsed) ? parsed : []);
          for (const mem of rawMemories.slice(0, 8)) {
            if (!mem.content || typeof mem.content !== "string" || mem.content.trim().length === 0) continue;
            const normalized = normalizeMemoryContent(mem.content);
            if (normalizedExisting.has(normalized)) continue;
            const category = validCategories.includes(mem.category) ? mem.category : "fact";
            await db.insert(userMemories).values({ userId, content: mem.content.trim(), category });
            normalizedExisting.add(normalized); existingMemories.push(mem.content.trim()); totalAdded++;
            console.log(`[ChatGPT Import] Extracted: [${category}] ${mem.content.trim().slice(0, 60)}...`);
          }
        } catch (err) {
          console.error("[ChatGPT Import] Batch extraction error:", err);
        }
      }

      await db.insert(schema.chatgptImports).values({ userId, importedAt: new Date(), memoriesAdded: totalAdded }).onConflictDoUpdate({ target: [schema.chatgptImports.userId], set: { importedAt: new Date(), memoriesAdded: totalAdded } });
      console.log(`[ChatGPT Import] User ${userId}: imported ${totalAdded} memories from ${allTexts.length} conversations`);
      res.json({ imported: totalAdded, importedAt: new Date().toISOString() });
    } catch (error) { console.error("Error importing ChatGPT history:", error); res.status(500).json({ error: "Failed to import ChatGPT history" }); }
  });
}
