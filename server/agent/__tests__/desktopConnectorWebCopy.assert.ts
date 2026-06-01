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
assert.match(wizard, /control your desktop/);
assert.match(wizard, /run shell commands/);
assert.doesNotMatch(wizard, /JARVIS_PAIR_CODE/);
assert.doesNotMatch(wizard, /node jarvis-daemon\.js/);
assert.match(route, /WindowsConnectorSetupWizard/);

console.log("OK: commercial desktop connector web copy is present and technical setup copy is absent");
