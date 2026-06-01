import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

const wizardPath = "components/desktopConnector/WindowsConnectorSetupWizard.tsx";
const routePath = "app/desktop-connector-setup.tsx";

const wizard = read(wizardPath);
const route = read(routePath);

assert.match(wizard, /Use your ChatGPT subscription with Jarvis/);
assert.match(wizard, /Set it up for me/);
assert.match(wizard, /Skip desktop connector/);
assert.match(wizard, /Open installer again/);
assert.match(wizard, /control your desktop/);
assert.match(wizard, /run shell commands/);
assert.match(wizard, /mountedRef/);
assert.match(wizard, /cancelledRef/);
assert.match(wizard, /cancelFlow/);
assert.doesNotMatch(wizard, /PowerShell/i);
assert.doesNotMatch(wizard, /terminal/i);
assert.doesNotMatch(wizard, /\bnpm\b/i);
assert.doesNotMatch(wizard, /\bnpx\b/i);
assert.doesNotMatch(wizard, /copy\/paste/i);
assert.doesNotMatch(wizard, /pairing code/i);
assert.doesNotMatch(wizard, /JARVIS_PAIR_CODE/i);
assert.doesNotMatch(wizard, /node jarvis-daemon\.js/i);
assert.match(route, /WindowsConnectorSetupWizard/);

console.log("OK: commercial desktop connector web copy is present and technical setup copy is absent");
