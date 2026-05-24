import { spawnSync } from "child_process";

export const ONECLI_CONNECTIONS = ["whatsapp", "discord", "slack", "google", "microsoft"] as const;
export type OneCliConnection = typeof ONECLI_CONNECTIONS[number];

const DEFAULT_ONECLI_COMMANDS = ["one", "onecli"] as const;

export function isOneCliConnection(value: string): value is OneCliConnection {
  return (ONECLI_CONNECTIONS as readonly string[]).includes(value);
}

export function getOneCliConnectUrl(connection: OneCliConnection): string | null {
  const base =
    process.env.ONECLI_CONNECT_BASE_URL ||
    process.env.ONECLI_DASHBOARD_URL ||
    process.env.ONECLI_URL ||
    null;
  if (!base) return null;
  try {
    const url = new URL(base);
    url.searchParams.set("connection", connection);
    return url.toString();
  } catch {
    return null;
  }
}

export function resolveOneCliCommand(): string {
  const candidates = [
    process.env.ONECLI_COMMAND,
    ...DEFAULT_ONECLI_COMMANDS,
  ].filter((command): command is string => Boolean(command));

  for (const command of candidates) {
    const result = spawnSync(command, ["--help"], {
      windowsHide: true,
      timeout: 2500,
      stdio: "ignore",
    });
    if (result.status === 0) return command;
  }

  return process.env.ONECLI_COMMAND || DEFAULT_ONECLI_COMMANDS[0];
}

export function isOneCliInstalled(): boolean {
  const command = resolveOneCliCommand();
  const result = spawnSync(command, ["--help"], {
    windowsHide: true,
    timeout: 2500,
    stdio: "ignore",
  });
  return result.status === 0;
}

export function getOneCliConnectionHint(connection: OneCliConnection): string {
  const command = resolveOneCliCommand();
  const dashboard = process.env.ONECLI_DASHBOARD_URL || "http://127.0.0.1:10254";
  return [
    `Connect ${connection} through OneCLI OAuth instead of a Jarvis-built adapter.`,
    `Open ${dashboard} or run ${command} --help to start the OneCLI Agent Vault flow.`,
    "Telegram remains the only separate Jarvis-owned channel.",
  ].join(" ");
}
