import assert from "node:assert/strict";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const daemon = require("../../../daemon/jarvis-daemon.js") as {
  handleOp(op: Record<string, unknown>): Promise<Record<string, unknown>>;
  buildCodexSpawnCommand(command: string, args: string[]): { command: string; args: string[] };
  loadDaemonReconnectState(statePath: string): Record<string, unknown> | null;
  saveDaemonReconnectState(statePath: string, state: Record<string, unknown>): void;
  clearDaemonReconnectState(statePath: string): void;
  normalizeDaemonPlatform(platform: string): string;
};

async function createFakeCodexLauncher(dir: string): Promise<string> {
  const fakeCodexJs = join(dir, "fake-codex.js");
  await writeFile(
    fakeCodexJs,
    [
      "const fs = require('fs');",
      "const args = process.argv.slice(2);",
      "const outputIndex = args.indexOf('--output-last-message');",
      "const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : null;",
      "let stdin = '';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', (chunk) => { stdin += chunk; });",
      "process.stdin.on('end', () => {",
      "  if (!outputPath) { console.error('missing output path'); process.exit(2); }",
      "  fs.writeFileSync(outputPath, JSON.stringify({ type: 'final', content: 'fake codex saw: ' + stdin.slice(0, 12) }));",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );

  if (process.platform === "win32") {
    const launcher = join(dir, "fake-codex.cmd");
    await writeFile(
      launcher,
      `@echo off\r\n"${process.execPath}" "%~dp0fake-codex.js" %*\r\n`,
      "utf8",
    );
    return launcher;
  }

  const launcher = join(dir, "fake-codex");
  await writeFile(
    launcher,
    `#!/usr/bin/env sh\n"${process.execPath}" "$(dirname "$0")/fake-codex.js" "$@"\n`,
    "utf8",
  );
  await chmod(launcher, 0o755);
  return launcher;
}

async function main() {
  {
    const command = daemon.buildCodexSpawnCommand("C:\\Users\\justi\\AppData\\Roaming\\npm\\codex.cmd", ["exec"]);
    if (process.platform === "win32") {
      assert.match(command.command, /cmd\.exe$/i);
      assert.deepEqual(command.args.slice(0, 4), ["/d", "/s", "/c", "C:\\Users\\justi\\AppData\\Roaming\\npm\\codex.cmd"]);
    } else {
      assert.equal(command.command, "C:\\Users\\justi\\AppData\\Roaming\\npm\\codex.cmd");
      assert.deepEqual(command.args, ["exec"]);
    }
    const batCommand = daemon.buildCodexSpawnCommand("C:\\Tools\\codex.bat", ["exec"]);
    if (process.platform === "win32") {
      assert.match(batCommand.command, /cmd\.exe$/i);
      assert.equal(batCommand.args[3], "C:\\Tools\\codex.bat");
    }
    console.log("OK: Desktop daemon builds Codex launcher commands");
  }

  const dir = join(tmpdir(), `jarvis-daemon-codex-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  try {
    const launcher = await createFakeCodexLauncher(dir);
    const result = await daemon.handleOp({
      type: "codex_oauth_prompt",
      command: launcher,
      prompt: "hello from provider",
      timeoutMs: 30_000,
    });

    assert.equal(result.ok, true);
    assert.equal(result.content, `{"type":"final","content":"fake codex saw: hello from p"}`);
    console.log("OK: Desktop daemon codex_oauth_prompt runs codex exec-compatible command");
  } finally {
    await rm(dir, { force: true, recursive: true });
  }

  {
    const result = await daemon.handleOp({ type: "codex_oauth_prompt", prompt: "" });
    assert.equal(result.ok, false);
    assert.match(String(result.error), /prompt is required/);
    console.log("OK: Desktop daemon codex_oauth_prompt validates prompt");
  }

  {
    assert.equal(daemon.normalizeDaemonPlatform("win32"), "desktop");
    assert.equal(daemon.normalizeDaemonPlatform("darwin"), "desktop");
    assert.equal(daemon.normalizeDaemonPlatform("android"), "android");
    assert.equal(daemon.normalizeDaemonPlatform("desktop"), "desktop");
    console.log("OK: Desktop daemon normalizes OS platforms to server platforms");
  }

  {
    const dir = join(tmpdir(), `jarvis-daemon-state-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const statePath = join(dir, "state.json");
    try {
      assert.equal(daemon.loadDaemonReconnectState(statePath), null);
      daemon.saveDaemonReconnectState(statePath, {
        daemonId: "daemon-1",
        reconnectSecret: "secret-1",
        server: "https://gameplanjarvisai.up.railway.app",
        root: "C:\\Users\\justi\\jarvis-workspace",
        platform: "desktop",
      });
      assert.deepEqual(daemon.loadDaemonReconnectState(statePath), {
        daemonId: "daemon-1",
        reconnectSecret: "secret-1",
        server: "https://gameplanjarvisai.up.railway.app",
        root: "C:\\Users\\justi\\jarvis-workspace",
        platform: "desktop",
      });
      daemon.clearDaemonReconnectState(statePath);
      assert.equal(daemon.loadDaemonReconnectState(statePath), null);
      console.log("OK: Desktop daemon persists reconnect credentials for watchdog restarts");
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
