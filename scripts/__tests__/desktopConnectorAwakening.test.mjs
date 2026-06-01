import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

const awakeningScript = path.join(repoRoot, "scripts/jarvis-desktop-connector-awaken.ps1");
const packageJsonPath = path.join(repoRoot, "package.json");

assert.equal(fs.existsSync(awakeningScript), true, "awakening ceremony script should exist");

const scriptContent = fs.readFileSync(awakeningScript, "utf8");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

assert.match(scriptContent, /\[string\]\$Server\s*=\s*"https:\/\/gameplanjarvisai\.up\.railway\.app"/, "script should default to the hosted Jarvis server");
assert.match(scriptContent, /\[string\]\$SetupId\s*=\s*""/, "script should accept an optional setup id");
assert.match(scriptContent, /\[switch\]\$SkipCodexProbe/, "script should allow skipping the Codex probe");

for (const phrase of [
  "Local shell verified",
  "Codex / ChatGPT sign-in verified",
  "Test response received from Codex",
  "JARVIS: Hello, world. I am awake.",
  "Press any key to close this window.",
]) {
  assert.match(scriptContent, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `script should show '${phrase}'`);
}

assert.match(scriptContent, /\[Console\]::ReadKey\(\$true\)/, "script should leave the terminal open until a keypress");
assert.doesNotMatch(scriptContent, /Invoke-Expression/i, "script should not use Invoke-Expression");
assert.doesNotMatch(scriptContent, /Remove-Item\s+.*-Recurse/is, "script should not recursively delete anything");
assert.doesNotMatch(scriptContent, /\brm\s+-r\b/i, "script should not use recursive rm patterns");

assert.match(scriptContent, /Write-Host\s+'[^']*JARVIS[^']*'/, "script should include a visible JARVIS banner");
assert.match(scriptContent, /Write-Host\s+'\s*[|+\\\/_-]{3,}/, "script should include ASCII art, not only plain text");
assert.match(scriptContent, /Start-Sleep/, "script should stage the ceremony with visible timing");
assert.match(scriptContent, /ForegroundColor/, "script should use colored status lines");

assert.equal(
  packageJson.scripts["jarvis:desktop-connector:awaken"],
  "powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/jarvis-desktop-connector-awaken.ps1",
  "package script should launch the awakening ceremony",
);

console.log("desktop connector awakening ceremony assertions passed");
