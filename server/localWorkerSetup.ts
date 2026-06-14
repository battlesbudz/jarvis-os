import { getOrCreateWorkerToken, getWorkerStatus } from "./lib/localWorkerQueue";

function commandForShell(shell: "powershell" | "cmd", token: string, serverBaseUrl: string): string {
  if (shell === "cmd") {
    return `set TOKEN=${token}\nset SERVER=${serverBaseUrl}\nnode scripts\\jarvis-local-worker.js`;
  }
  return `$env:TOKEN="${token}"\n$env:SERVER="${serverBaseUrl}"\nnode scripts\\jarvis-local-worker.js`;
}

export function buildLocalWorkerTelegramSetupMessage(userId: string, serverBaseUrl: string): string {
  const token = getOrCreateWorkerToken(userId);
  const status = getWorkerStatus(userId);
  const lastSeen = status.lastSeen
    ? new Date(status.lastSeen).toLocaleString("en-US", { timeZone: "America/New_York" })
    : "never";
  const capabilities = status.capabilities.length > 0 ? status.capabilities.join(", ") : "none";
  const voiceStatus = status.audioOnline
    ? "Voice transcription worker: ONLINE"
    : "Voice transcription worker: OFFLINE";

  return [
    voiceStatus,
    `Last heartbeat: ${lastSeen}`,
    `Capabilities: ${capabilities}`,
    "",
    "To enable Telegram voice notes from this PC, run this in PowerShell from the Jarvis repo:",
    "```",
    commandForShell("powershell", token, serverBaseUrl),
    "```",
    "",
    "If you use Command Prompt instead:",
    "```",
    commandForShell("cmd", token, serverBaseUrl),
    "```",
    "",
    "This worker will advertise audio-transcription when local faster-whisper is available.",
  ].join("\n");
}
