import path from "path";

// Mirrors the daemon-side commandEscapesRoot strategy so the agent gets a fast
// error message before the round-trip. The daemon remains the authority.
const SAFE_DEVICE_FILES_SET = new Set(["/dev/null", "/dev/stdin", "/dev/stdout", "/dev/stderr", "/dev/zero"]);

// The first token of each shell segment may be an absolute path to a system
// binary; file arguments must stay inside the workspace.
const CMD_BIN_PREFIXES = [
  "/usr/", "/bin/", "/sbin/", "/opt/homebrew/", "/usr/local/",
  "/nix/", "/home/linuxbrew/", "/Applications/", "/System/", "/Library/",
];

function isCmdBin(p: string): boolean {
  const norm = path.normalize(p);
  return CMD_BIN_PREFIXES.some((prefix) => norm.startsWith(prefix));
}

export function detectsOutsideRoot(cmd: string): boolean {
  if (/\bcd\s+\.\./.test(cmd)) return true;
  if (/\bsudo\s+rm/.test(cmd)) return true;
  if (/\brm\s+-rf\s+\//.test(cmd)) return true;

  const HOME = process.env.HOME || process.env.USERPROFILE || "";
  if (!HOME && /~|\$\{?HOME\}?/.test(cmd)) return true;
  const expanded = HOME
    ? cmd
        .replace(/\$\{HOME\}/g, HOME)
        .replace(/\$HOME(?=[/\s;|&>'")\x60]|$)/g, HOME)
        .replace(/~/g, HOME)
    : cmd;

  if (/\bcd\s+\//.test(expanded)) return true;

  const redirectMatches = expanded.match(/>\s*(\/[^\s;|&]*)/g) || [];
  for (const redir of redirectMatches) {
    const target = redir.replace(/^>\s*/, "");
    const norm = path.normalize(target);
    if (!SAFE_DEVICE_FILES_SET.has(norm)) return true;
  }

  const segments = expanded.split(/[|;]|&&|\|\|/);
  for (const segment of segments) {
    const tokens = segment.trim().split(/[\s<>()$\x60]+/).map((t) => t.replace(/^['"\x60]|['"\x60]$/g, ""));
    let isCmd = true;
    for (const token of tokens) {
      if (!token) continue;
      if (/^-/.test(token)) continue;

      if (token.startsWith("/")) {
        const norm = path.normalize(token);
        if (!SAFE_DEVICE_FILES_SET.has(norm)) {
          if (!isCmd || !isCmdBin(norm)) return true;
        }
      } else if (token.includes("..")) {
        return true;
      }

      isCmd = false;
    }
  }
  return false;
}
