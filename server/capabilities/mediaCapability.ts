import type { Capability } from "./types";
import { speakTool } from "../agent/tools/tts";
import { imageGenerateTool } from "../agent/tools/imageGenerate";

export const mediaCapability: Capability = {
  id: "media",
  label: "Media (TTS & Image Generation)",
  toolGroups: ["media"],
  tools: [speakTool, imageGenerateTool],
  configRequirements: [
    { key: "ELEVENLABS_API_KEY", label: "ElevenLabs API Key", optional: true },
  ],
  async healthCheck() {
    return { healthy: true };
  },
};
