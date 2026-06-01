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

assert.match(scriptContent, /codex\.cmd/, "script should prefer codex.cmd on Windows");
assert.match(scriptContent, /Get-Command codex\.cmd/, "script should resolve the cmd shim before bare codex");
assert.match(scriptContent, /codex exec/, "script should run an actual codex exec probe");
assert.match(scriptContent, /JARVIS_AWAKE_OK/, "script should require a deterministic response marker");
assert.match(scriptContent, /--ephemeral/, "codex exec should use an ephemeral session");
assert.match(scriptContent, /--sandbox[\s\S]*read-only/, "codex exec should be read-only");
assert.match(scriptContent, /--ask-for-approval[\s\S]*never/, "codex exec should not ask for approvals");
assert.match(scriptContent, /--ask-for-approval[\s\S]*never[\s\S]*"exec"/, "approval policy should be passed before exec for this Codex CLI");
assert.match(scriptContent, /--output-last-message/, "codex exec should write a bounded last-message proof");
assert.match(scriptContent, /WaitForExit\(\d+\)/, "codex exec should be bounded by a timeout");
assert.match(scriptContent, /ExitCode\s+-eq\s+0[\s\S]*ExpectedMarker[\s\S]*Codex \/ ChatGPT sign-in verified/, "success phrase should be guarded by exit code and marker output");
assert.match(scriptContent, /ExitCode\s+-eq\s+0[\s\S]*ExpectedMarker[\s\S]*Test response received from Codex/, "response phrase should be guarded by exit code and marker output");
assert.match(scriptContent, /Codex probe not completed/, "failed or unavailable probes should warn instead of claiming success");
assert.match(scriptContent, /Probe skipped; Codex verification was not claimed/, "skip mode should avoid false verification language");
assert.doesNotMatch(scriptContent, /--version[\s\S]*Codex \/ ChatGPT sign-in verified/, "codex --version should not prove sign-in");
assert.equal((scriptContent.match(/Codex \/ ChatGPT sign-in verified/g) ?? []).length, 1, "sign-in success phrase should only appear in the real proof branch");
assert.equal((scriptContent.match(/Test response received from Codex/g) ?? []).length, 1, "response success phrase should only appear in the real proof branch");

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
