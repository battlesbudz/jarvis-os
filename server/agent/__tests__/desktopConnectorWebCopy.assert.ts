import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

const wizardPath = "components/desktopConnector/WindowsConnectorSetupWizard.tsx";
const routePath = "app/desktop-connector-setup.tsx";
const cardPath = "components/desktopConnector/ConnectedWindowsPcCard.tsx";
const profilePath = "app/(tabs)/profile.tsx";

const wizard = read(wizardPath);
const route = read(routePath);
const card = read(cardPath);
const profile = read(profilePath);

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

assert.match(card, /Connected Windows PC/);
assert.match(card, /Check connection/);
assert.match(card, /Reconnect/);
assert.match(card, /Run verification again/);
assert.match(card, /Advanced troubleshooting/);
assert.match(card, /Disconnect connector/);
assert.doesNotMatch(card, /Uninstall connector/);
assert.doesNotMatch(card, /PowerShell/i);
assert.doesNotMatch(card, /terminal/i);
assert.doesNotMatch(card, /\bnpm\b/i);
assert.doesNotMatch(card, /\bnpx\b/i);
assert.doesNotMatch(card, /copy\/paste/i);
assert.doesNotMatch(card, /pairing code/i);
assert.doesNotMatch(card, /cd daemon/i);
assert.doesNotMatch(card, /JARVIS_PAIR_CODE/i);
assert.doesNotMatch(card, /node jarvis-daemon\.js/i);
assert.doesNotMatch(profile, /cd daemon/i);
assert.doesNotMatch(profile, /JARVIS_PAIR_CODE/i);
assert.doesNotMatch(profile, /node jarvis-daemon\.js/i);
assert.match(profile, /connect this Windows PC for ChatGPT-powered desktop work/);
assert.match(profile, /Jarvis created a fresh connector setup session\./);
assert.match(profile, /Desktop connector verification started\./);
assert.match(profile, /Desktop connector verified\./);
assert.match(profile, /data\?\.ok === false/);
assert.match(profile, /data\?\.result\?\.error/);
assert.match(profile, /Desktop connector verification failed\./);
assert.match(profile, /Desktop connector disconnected\./);
assert.match(profile, /Advanced troubleshooting is open below\./);
assert.doesNotMatch(profile, /desktop daemon/i);
assert.doesNotMatch(profile, /pair a desktop daemon/i);

console.log("OK: commercial desktop connector web copy is present and technical setup copy is absent");
