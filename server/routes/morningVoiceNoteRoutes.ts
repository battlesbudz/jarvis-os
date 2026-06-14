import type { Express, Request, Response } from "express";
import OpenAI from "openai";
import { and, desc, eq } from "drizzle-orm";
import { morningVoiceNotes, userMemories } from "@shared/schema";
import { getOpenAIClientConfig } from "../agent/providers/env";
import { db } from "../db";
import { clearMorningNoteSummary, getUserLocalDate } from "../services/aiCoachContextService";

const openai = new OpenAI(getOpenAIClientConfig());
const validMoods = ["calm", "energized", "stressed", "overwhelmed", "uncertain"];

function normalizeMorningSignals(extracted: any) {
  return {
    moodSignal: validMoods.includes(extracted.moodSignal) ? extracted.moodSignal : "calm",
    themes: Array.isArray(extracted.themes) ? extracted.themes.slice(0, 5).map(String) : [],
    blockers: Array.isArray(extracted.blockers) ? extracted.blockers.slice(0, 3).map(String) : [],
    wins: Array.isArray(extracted.wins) ? extracted.wins.slice(0, 3).map(String) : [],
    intention: typeof extracted.intention === "string" ? extracted.intention : null,
  };
}

async function extractMorningNoteSignals(transcript: string) {
  const extractionPrompt = `Analyze this morning voice note transcript and extract structured data.

Transcript: "${transcript}"

Extract:
1. moodSignal: one of "calm", "energized", "stressed", "overwhelmed", "uncertain" — infer from tone and content
2. themes: up to 5 short topic phrases mentioned (e.g. "client presentation", "exercise", "sleep quality")
3. blockers: up to 3 things preventing progress (e.g. "waiting on feedback", "too many meetings")
4. wins: up to 3 positive things mentioned (e.g. "finished report", "good workout")
5. intention: one sentence capturing what they want to accomplish or focus on today

Return JSON: { "moodSignal": "...", "themes": [...], "blockers": [...], "wins": [...], "intention": "..." }
Return ONLY the JSON object.`;
  const extraction = await openai.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: extractionPrompt }], response_format: { type: "json_object" }, max_completion_tokens: 400 });
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(extraction.choices[0]?.message?.content || "{}"); } catch {}
  return normalizeMorningSignals(parsed);
}

export function registerMorningVoiceNoteRoutes(app: Express): void {
  app.get("/api/morning-voice-notes", async (req: Request, res: Response) => { try { const userId = req.userId; if (!userId) return res.status(401).json({ error: "Not authenticated" }); const limit = parseInt(req.query.limit as string) || 30; const notes = await db.select().from(morningVoiceNotes).where(eq(morningVoiceNotes.userId, userId)).orderBy(desc(morningVoiceNotes.recordedAt)).limit(limit); res.json({ notes }); } catch (error) { console.error("Error fetching morning voice notes:", error); res.status(500).json({ error: "Failed to fetch morning voice notes" }); } });

  app.get("/api/morning-voice-notes/today", async (req: Request, res: Response) => { try { const userId = req.userId; if (!userId) return res.status(401).json({ error: "Not authenticated" }); const today = await getUserLocalDate(userId); const notes = await db.select().from(morningVoiceNotes).where(and(eq(morningVoiceNotes.userId, userId), eq(morningVoiceNotes.recordedAt, today))).limit(1); res.json({ note: notes[0] || null }); } catch (error) { console.error("Error fetching today's morning voice note:", error); res.status(500).json({ error: "Failed to fetch today's morning voice note" }); } });

  app.post("/api/morning-voice-notes/extract", async (req: Request, res: Response) => { try { const userId = req.userId; if (!userId) return res.status(401).json({ error: "Not authenticated" }); const { transcript } = req.body; if (!transcript || typeof transcript !== "string" || !transcript.trim()) return res.status(400).json({ error: "transcript is required" }); res.json({ extracted: await extractMorningNoteSignals(transcript.trim()) }); } catch (error) { console.error("Error extracting morning note signals:", error); res.status(500).json({ error: "Failed to extract signals" }); } });

  app.post("/api/morning-voice-notes", async (req: Request, res: Response) => {
    try {
      const userId = req.userId; if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { transcript, extracted: preExtracted } = req.body; if (!transcript || typeof transcript !== "string" || !transcript.trim()) return res.status(400).json({ error: "transcript is required" });
      const today = await getUserLocalDate(userId);
      const existing = await db.select({ id: morningVoiceNotes.id }).from(morningVoiceNotes).where(and(eq(morningVoiceNotes.userId, userId), eq(morningVoiceNotes.recordedAt, today))).limit(1);
      if (existing.length > 0) return res.status(409).json({ error: "Morning note already recorded today" });
      const extracted = preExtracted && preExtracted.moodSignal ? preExtracted : await extractMorningNoteSignals(transcript.trim());
      const { moodSignal, themes, blockers, wins, intention } = normalizeMorningSignals(extracted);
      const [inserted] = await db.insert(morningVoiceNotes).values({ userId, recordedAt: today, transcript: transcript.trim(), moodSignal, themes, blockers, wins, intention }).returning();
      try { await db.insert(userMemories).values({ userId, content: `Morning note (${today}): Mood=${moodSignal}. Themes: ${themes.join(", ") || "none"}. ${intention ? `Intention: ${intention}` : ""}`, category: "pattern" }); } catch {}
      clearMorningNoteSummary(userId); res.json({ note: inserted, extracted: { moodSignal, themes, blockers, wins, intention } });
    } catch (error) { console.error("Error creating morning voice note:", error); res.status(500).json({ error: "Failed to create morning voice note" }); }
  });

  app.post("/api/morning-voice-notes/transcribe", async (req: Request, res: Response) => { try { const userId = req.userId; if (!userId) return res.status(401).json({ error: "Not authenticated" }); const { audioBase64, mimeType } = req.body; if (!audioBase64) return res.status(400).json({ error: "audioBase64 is required" }); const buffer = Buffer.from(audioBase64, "base64"); const ext = (mimeType || "audio/webm").includes("mp4") ? "mp4" : "webm"; const file = new File([buffer], `recording.${ext}`, { type: mimeType || "audio/webm" }); const transcription = await openai.audio.transcriptions.create({ model: "whisper-1", file }); res.json({ transcript: transcription.text || "" }); } catch (error) { console.error("Error transcribing audio:", error); res.status(500).json({ error: "Failed to transcribe audio" }); } });
}
