import type { Express, Request, Response } from "express";

type OpenAIVoice = "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";

const OPENAI_VOICES = new Set<string>(["alloy", "echo", "fable", "onyx", "nova", "shimmer"]);

function trimSpeechText(text: string): string {
  let trimmedText = text.slice(0, 4000);
  if (text.length > 4000) {
    const lastSentence = trimmedText.lastIndexOf(".");
    if (lastSentence > 0) {
      trimmedText = trimmedText.slice(0, lastSentence + 1);
    }
  }
  return trimmedText;
}

export function registerCoachAudioRoutes(app: Express): void {
  app.post("/api/coach/transcribe", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { audio } = req.body;
      if (!audio || typeof audio !== "string") {
        return res.status(400).json({ error: "audio (base64) is required" });
      }

      const { speechToText, detectAudioFormat } = await import("../integrations/audioClient");
      const rawBuffer = Buffer.from(audio, "base64");

      if (rawBuffer.length < 1024) {
        return res.json({ text: "" });
      }
      if (rawBuffer.length > 20 * 1024 * 1024) {
        return res.status(400).json({ error: "Audio file is too large (max 20 MB). Please send a shorter recording." });
      }

      const format = detectAudioFormat(rawBuffer);
      const text = await speechToText(rawBuffer, format);
      res.json({ text });
    } catch (error) {
      console.error("Error transcribing audio:", error);
      res.status(500).json({ error: "Failed to transcribe audio" });
    }
  });

  app.post("/api/coach/speak", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { text, voice: voiceParam } = req.body;
      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "text is required" });
      }

      let resolvedVoice = voiceParam && typeof voiceParam === "string" ? voiceParam : null;
      if (!resolvedVoice) {
        const { getUserTtsPrefs } = await import("../agent/tools/tts");
        const prefs = await getUserTtsPrefs(userId);
        resolvedVoice = OPENAI_VOICES.has(prefs.voice) ? prefs.voice : "nova";
      }

      const { textToSpeech } = await import("../integrations/audioClient");
      const audioBuffer = await textToSpeech(trimSpeechText(text), (resolvedVoice ?? "nova") as OpenAIVoice, "mp3");
      res.json({ audio: audioBuffer.toString("base64") });
    } catch (error) {
      console.error("Error generating speech:", error);
      res.status(500).json({ error: "Failed to generate speech" });
    }
  });
}
