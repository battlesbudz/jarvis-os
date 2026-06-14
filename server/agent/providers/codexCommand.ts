export interface CodexSpawnCommand {
  command: string;
  args: string[];
}

export function buildCodexSpawnCommand(command: string, args: string[]): CodexSpawnCommand {
  const trimmed = command.trim();
  if (process.platform !== "win32") {
    return { command: trimmed, args };
  }

  const lower = trimmed.toLowerCase();
  if (!lower.endsWith(".cmd") && !lower.endsWith(".bat")) {
    return { command: trimmed, args };
  }

  return {
    command: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", trimmed, ...args],
  };
}
