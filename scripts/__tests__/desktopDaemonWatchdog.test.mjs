import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

const startScript = path.join(repoRoot, "scripts/start-jarvis-desktop-daemon-watchdog.ps1");
const installScript = path.join(repoRoot, "scripts/install-jarvis-desktop-daemon-watchdog.ps1");
const uninstallScript = path.join(repoRoot, "scripts/uninstall-jarvis-desktop-daemon-watchdog.ps1");

for (const script of [startScript, installScript, uninstallScript]) {
  assert.equal(fs.existsSync(script), true, `${path.basename(script)} should exist`);
}

const startContent = fs.readFileSync(startScript, "utf8");
assert.match(startContent, /while\s*\(\$true\)/, "watchdog should restart forever");
assert.match(startContent, /jarvis-daemon\.js/, "watchdog should launch jarvis-daemon.js");
assert.match(startContent, /JARVIS_DAEMON_PLATFORM\s*=\s*"desktop"/, "watchdog should force desktop platform");
assert.match(startContent, /JARVIS_PAIR_CODE/, "watchdog should pass pair code only when explicitly supplied");
assert.match(startContent, /Start-Sleep/, "watchdog should back off between restarts");
assert.match(startContent, /jarvis-desktop-daemon-watchdog\.log/, "watchdog should write a stable log file");

const installContent = fs.readFileSync(installScript, "utf8");
assert.match(installContent, /Jarvis Desktop Daemon/, "installer should use the desktop daemon task name");
assert.match(installContent, /Register-ScheduledTask/, "installer should register a Windows scheduled task");
assert.match(installContent, /New-ScheduledTaskTrigger -AtLogOn/, "installer should start at user logon");
assert.doesNotMatch(installContent, /JARVIS_PAIR_CODE.*New-ScheduledTaskAction/s, "installer should not persist pair codes in the task action");
assert.match(installContent, /Startup folder launcher/i, "installer should have a startup folder fallback");

const uninstallContent = fs.readFileSync(uninstallScript, "utf8");
assert.match(uninstallContent, /Unregister-ScheduledTask/, "uninstaller should remove the scheduled task");

console.log("desktop daemon watchdog script assertions passed");
