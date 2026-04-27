import type { Capability } from "./types";
import { speakTool } from "../agent/tools/tts";
import { imageGenerateTool } from "../agent/tools/imageGenerate";
import { videoGenerateTool } from "../agent/tools/videoGenerate";

export const mediaCapability: Capability = {
  id: "media",
  label: "Media (TTS, Image & Video Generation)",
  toolGroups: ["media"],
  tools: [speakTool, imageGenerateTool, videoGenerateTool],
  configRequirements: [
    { key: "ELEVENLABS_API_KEY", label: "ElevenLabs API Key", optional: true },
    { key: "INFSH_API_KEY", label: "inference.sh API Key (FLUX images & AI video)", optional: true },
  ],
  async healthCheck() {
    return { healthy: true };
  },
};
