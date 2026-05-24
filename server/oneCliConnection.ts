import { existsSync } from "fs";
import path from "path";
import { spawnSync } from "child_process";

export const ONECLI_CONNECTIONS = ["whatsapp", "discord", "slack", "google", "microsoft"] as const;
export type OneCliConnection = typeof ONECLI_CONNECTIONS[number];

const DEFAULT_ONECLI_COMMANDS =
  process.platform === "win32"
    ? (["one.cmd", "one", "onecli.cmd", "onecli"] as const)
    : (["one", "onecli"] as const);

type OneCliInvocation = {
  command: string;
  argsPrefix: string[];
  display: string;
  viaCmd?: boolean;
};

function quoteWindowsArg(value: string): string {
  if (!/[ \t"&|<>^]/.test(value)) return value;
  return `"${value.replace(/(["^])/g, "^$1")}"`;
}

function runCliProbe(command: string, args: string[]) {
  if (process.platform === "win32" && command.endsWith(".cmd")) {
    const commandLine = [command, ...args].map(quoteWindowsArg).join(" ");
    return spawnSync("cmd.exe", ["/d", "/s", "/c", commandLine], {
      windowsHide: true,
      timeout: 10000,
      stdio: "ignore",
    });
  }
  return spawnSync(command, args, {
    windowsHide: true,
    timeout: 10000,
    stdio: "ignore",
  });
}

function getGlobalOneCliBin(): string | null {
  const roots = [
    process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "node_modules", "@withone", "cli", "bin", "cli.js") : null,
    path.join(process.env.USERPROFILE || "", "AppData", "Roaming", "npm", "node_modules", "@withone", "cli", "bin", "cli.js"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return roots.find((candidate) => existsSync(candidate)) ?? null;
}

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

export function resolveOneCliInvocation(): OneCliInvocation {
  const globalBin = getGlobalOneCliBin();
  if (globalBin && !process.env.ONECLI_COMMAND) {
    return {
      command: process.execPath,
      argsPrefix: [globalBin],
      display: "one.cmd",
    };
  }

  const candidates = [
    process.env.ONECLI_COMMAND,
    ...DEFAULT_ONECLI_COMMANDS,
  ].filter((command): command is string => Boolean(command));

  for (const command of candidates) {
    const result = runCliProbe(command, ["--help"]);
    if (result.status === 0) {
      return {
        command,
        argsPrefix: [],
        display: command,
        viaCmd: process.platform === "win32" && command.endsWith(".cmd"),
      };
    }
  }

  const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
  const npxResult = spawnSync(npxCommand, ["--yes", "@withone/cli", "--help"], {
    windowsHide: true,
    timeout: 10000,
    stdio: "ignore",
  });
  if (npxResult.status === 0) {
    return {
      command: npxCommand,
      argsPrefix: ["--yes", "@withone/cli"],
      display: "npx --yes @withone/cli",
      viaCmd: process.platform === "win32",
    };
  }

  const fallback = process.env.ONECLI_COMMAND || DEFAULT_ONECLI_COMMANDS[0];
  return {
    command: fallback,
    argsPrefix: [],
    display: fallback,
    viaCmd: process.platform === "win32" && fallback.endsWith(".cmd"),
  };
}

export function resolveOneCliCommand(): string {
  return resolveOneCliInvocation().display;
}

export function isOneCliInstalled(): boolean {
  const invocation = resolveOneCliInvocation();
  const result = runCliProbe(invocation.command, [...invocation.argsPrefix, "--help"]);
  return result.status === 0;
}

export type OneCliRunResult = {
  ok: boolean;
  command: string;
  stdout: string;
  stderr: string;
  status: number | null;
  error?: string;
};

export function runOneCli(args: string[], timeoutMs = 30000): OneCliRunResult {
  const invocation = resolveOneCliInvocation();
  const fullArgs = [...invocation.argsPrefix, ...args];
  const command = invocation.viaCmd ? "cmd.exe" : invocation.command;
  const spawnArgs = invocation.viaCmd
    ? ["/d", "/s", "/c", [invocation.command, ...fullArgs].map(quoteWindowsArg).join(" ")]
    : fullArgs;
  const result = spawnSync(command, spawnArgs, {
    encoding: "utf8",
    windowsHide: true,
    timeout: timeoutMs,
    maxBuffer: 2 * 1024 * 1024,
  });

  return {
    ok: result.status === 0 && !result.error,
    command: [invocation.display, ...args].join(" "),
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? "",
    status: result.status,
    error: result.error ? String(result.error.message || result.error) : undefined,
  };
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
