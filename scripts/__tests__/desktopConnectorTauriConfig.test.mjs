import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const connectorRoot = path.join(repoRoot, "desktop-connector");

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function assertExists(relativePath) {
  assert.equal(fs.existsSync(path.join(repoRoot, relativePath)), true, `${relativePath} should exist`);
}

for (const file of [
  "desktop-connector/package.json",
  "desktop-connector/index.html",
  "desktop-connector/vite.config.ts",
  "desktop-connector/tsconfig.json",
  "desktop-connector/src/main.tsx",
  "desktop-connector/src/App.tsx",
  "desktop-connector/src/connectorApi.ts",
  "desktop-connector/src/styles.css",
  "desktop-connector/src-tauri/Cargo.toml",
  "desktop-connector/src-tauri/build.rs",
  "desktop-connector/src-tauri/tauri.conf.json",
  "desktop-connector/src-tauri/capabilities/default.json",
  "desktop-connector/src-tauri/icons/icon.ico",
  "desktop-connector/src-tauri/src/main.rs",
  "desktop-connector/src-tauri/src/lib.rs",
  "desktop-connector/sidecar/package.json",
  "desktop-connector/sidecar/index.js",
  "desktop-connector/sidecar/rename-sidecar.mjs",
  "desktop-connector/sidecar/prepare-daemon.mjs",
  "desktop-connector/scripts/assert-config.mjs",
]) {
  assertExists(file);
}

const rootPackage = readJson("package.json");
assert.equal(
  rootPackage.scripts["jarvis:desktop-connector:test-config"],
  "node scripts/__tests__/desktopConnectorTauriConfig.test.mjs",
  "root package should expose the desktop connector config test",
);
assert.equal(
  rootPackage.scripts["jarvis:desktop-connector:build"],
  "npm --prefix desktop-connector install && npm --prefix desktop-connector run build",
  "root package should expose the desktop connector build",
);

const connectorPackage = readJson("desktop-connector/package.json");
assert.equal(connectorPackage.scripts.build, "npm run sidecar:build && vite build && tauri build");
assert.match(connectorPackage.scripts["sidecar:prepare"], /prepare-daemon\.mjs/);
assert.match(connectorPackage.scripts["sidecar:rename"], /rename-sidecar\.mjs/);
assert.match(connectorPackage.scripts["test:config"], /assert-config\.mjs/);
assert.ok(connectorPackage.dependencies["@tauri-apps/plugin-shell"], "shell plugin should be listed");
assert.ok(connectorPackage.dependencies["@tauri-apps/plugin-autostart"], "autostart plugin should be listed");
assert.ok(connectorPackage.dependencies["@tauri-apps/plugin-opener"], "opener plugin should be listed");

const tauriConfig = readJson("desktop-connector/src-tauri/tauri.conf.json");
const cargoToml = readText("desktop-connector/src-tauri/Cargo.toml");
assert.equal(tauriConfig.productName, "Jarvis Desktop Connector", "Tauri product name should be Jarvis Desktop Connector");
assert.deepEqual(tauriConfig.bundle.targets, ["nsis"], "Windows bundle target should be NSIS");
assert.deepEqual(
  tauriConfig.bundle.externalBin,
  ["binaries/jarvis-desktop-daemon"],
  "Tauri should register the daemon sidecar with bundle.externalBin",
);
assert.equal(
  tauriConfig.bundle.resources["../../scripts/jarvis-desktop-connector-awaken.ps1"],
  "jarvis-desktop-connector-awaken.ps1",
  "Tauri bundle should include the awakening ceremony script for installed verification",
);
assert.equal(tauriConfig.app.windows.length, 1, "connector should have one quiet status window");
assert.equal(tauriConfig.app.windows[0].visible, false, "status window should start hidden for quiet autostart");
assert.equal(tauriConfig.app.windows[0].title, "Jarvis Desktop Connector");
assert.equal(tauriConfig.app.security.csp, null, "connector should not depend on remote UI assets");
assert.deepEqual(tauriConfig.bundle.icon, ["icons/icon.ico"], "Windows bundle should include the connector icon");
assert.deepEqual(
  tauriConfig.plugins["deep-link"].desktop.schemes,
  ["jarvis"],
  "installed connector should register the jarvis:// desktop handoff scheme",
);

assert.match(cargoToml, /tauri-plugin-deep-link\s*=\s*"2"/, "Rust app should depend on Tauri deep-link plugin");
assert.match(cargoToml, /tauri-plugin-single-instance[\s\S]*features\s*=\s*\["deep-link"\]/, "Windows tray app should route repeated jarvis:// handoffs to the running instance");
assert.match(cargoToml, /serde_json\s*=\s*"1"/, "Rust app should persist pending setup handoffs as JSON");
assert.match(cargoToml, /url\s*=\s*"2"/, "Rust app should parse and validate setup handoff URLs");

const capability = readJson("desktop-connector/src-tauri/capabilities/default.json");
for (const permission of [
  "core:default",
  "opener:default",
  "autostart:allow-enable",
  "autostart:allow-disable",
  "autostart:allow-is-enabled",
]) {
  assert.ok(capability.permissions.includes(permission), `capability should include ${permission}`);
}
assert.equal(capability.permissions.includes("shell:allow-spawn"), false, "shell spawn permission should be scoped, not bare broad allow-spawn");
assert.equal(capability.permissions.includes("shell:allow-execute"), false, "spawn-only sidecar flow should not request execute permission");
const shellSpawnPermission = capability.permissions.find(
  (permission) => permission && typeof permission === "object" && permission.identifier === "shell:allow-spawn",
);
assert.ok(shellSpawnPermission, "capability should include a scoped shell:allow-spawn permission object");
assert.ok(Array.isArray(shellSpawnPermission.allow), "scoped shell spawn permission should include an allow array");
const sidecarPermission = shellSpawnPermission.allow.find((entry) => entry.name === "binaries/jarvis-desktop-daemon");
assert.ok(sidecarPermission, "sidecar spawn permission should name the registered externalBin");
assert.equal(sidecarPermission.sidecar, true, "sidecar spawn permission should mark the daemon as a sidecar");
assert.equal(sidecarPermission.args, true, "sidecar spawn permission should allow sidecar args for future reconnect flags");
const powershellPermission = shellSpawnPermission.allow.find((entry) => entry.name === "powershell.exe");
assert.ok(powershellPermission, "PowerShell launch permission should be scoped");
assert.equal(powershellPermission.cmd, "powershell.exe", "PowerShell permission should run powershell.exe only");
assert.equal(powershellPermission.sidecar, false, "PowerShell permission should not be marked as a sidecar");
assert.ok(Array.isArray(powershellPermission.args), "PowerShell permission should restrict allowed argument positions");

const libRs = readText("desktop-connector/src-tauri/src/lib.rs");
for (const label of ["Open Jarvis", "Check connection", "Reconnect", "Run verification again", "Quit"]) {
  assert.match(libRs, new RegExp(label), `tray menu should include ${label}`);
}
assert.match(libRs, /TrayIconBuilder/, "tray should use TrayIconBuilder");
assert.match(libRs, /tauri_plugin_autostart/, "Rust app should initialize the autostart plugin");
assert.match(libRs, /use\s+tauri_plugin_autostart::[\s\S]*ManagerExt/, "Rust app should import autostart ManagerExt");
assert.match(libRs, /\.autolaunch\(\)\.enable\(\)/, "setup should enable autostart");
assert.match(libRs, /tauri_plugin_deep_link::DeepLinkExt/, "Rust app should import deep-link helpers");
assert.match(libRs, /tauri_plugin_single_instance::init/, "Rust app should install single-instance handling for repeated setup handoffs");
assert.match(libRs, /tauri_plugin_single_instance::init[\s\S]*tauri_plugin_deep_link::init/, "single-instance plugin should be registered before deep-link plugin");
assert.match(libRs, /tauri_plugin_deep_link::init\(\)/, "Rust app should initialize the deep-link plugin");
assert.match(libRs, /app\.deep_link\(\)\.on_open_url/, "running tray app should receive jarvis:// setup handoffs");
assert.match(libRs, /app\.deep_link\(\)\.get_current\(\)/, "tray app should read startup setup handoffs");
assert.match(libRs, /parse_pending_setup_url/, "tray app should parse setup handoff URLs");
assert.match(libRs, /url\.scheme\(\)\s*!=\s*"jarvis"/, "tray app should validate the jarvis URL scheme");
assert.match(libRs, /host_str\(\)\s*!=\s*Some\("desktop-connector"\)/, "tray app should validate the setup handoff host");
assert.match(libRs, /serverUrl/, "tray app should accept serverUrl from the setup handoff");
assert.match(libRs, /setupId/, "tray app should accept setupId from the setup handoff");
assert.match(libRs, /pairCode/, "tray app should accept pairCode from the setup handoff");
assert.match(libRs, /pending-setup\.json/, "tray app should persist pending setup handoffs");
assert.match(libRs, /serde_json::to_string_pretty/, "tray app should write pending setup handoff JSON");
assert.match(libRs, /read_pending_setup/, "tray app should replay saved setup handoffs when starting the daemon");
assert.match(libRs, /"--server"[\s\S]*setup\.server_url[\s\S]*"--code"[\s\S]*setup\.pair_code/, "tray app should pass pairing context to the sidecar");
assert.match(libRs, /tauri_plugin_shell/, "Rust app should initialize the shell plugin");
assert.match(libRs, /tauri_plugin_opener/, "Rust app should initialize the opener plugin");
assert.match(libRs, /\.opener\(\)\s*[\s\S]*\.open_url\("https:\/\/gameplanjarvisai\.up\.railway\.app"/, "Open Jarvis should use the Tauri opener plugin");
assert.match(libRs, /\.shell\(\)[\s\S]*\.sidecar\("jarvis-desktop-daemon"\)/, "Rust app should launch the registered sidecar");
assert.match(libRs, /\.spawn\(\)/, "Rust app should spawn the sidecar");
assert.match(libRs, /process::CommandEvent/, "Rust app should import CommandEvent for sidecar lifecycle monitoring");
assert.match(libRs, /let\s+\(mut rx,\s*child\)/, "Rust app should keep the sidecar event receiver");
assert.match(libRs, /tauri::async_runtime::spawn/, "Rust app should consume sidecar events without blocking setup");
assert.match(libRs, /while let Some\(event\)\s*=\s*rx\.recv\(\)\.await/, "Rust app should continuously drain sidecar events");
assert.match(libRs, /CommandEvent::Terminated/, "Rust app should handle sidecar termination");
assert.match(libRs, /CommandEvent::Stderr/, "Rust app should observe sidecar stderr");
assert.match(libRs, /"attention"[\s\S]*daemon stopped/i, "sidecar termination should update status to attention with a stopped-daemon detail");
assert.match(libRs, /fn attention_for_spawn_error/, "Rust app should have a shared sidecar spawn failure status helper");
assert.match(libRs, /sidecar spawn failed/i, "sidecar lookup or spawn errors should be reflected in status detail");
assert.match(libRs, /Use Reconnect to try again/i, "spawn failure detail should include a reconnect hint");
assert.doesNotMatch(libRs, /\.sidecar\("jarvis-desktop-daemon"\)[\s\S]{0,120}\.map_err\(\|err\| err\.to_string\(\)\)\?[\s\S]{0,120}\.spawn\(\)[\s\S]{0,120}\.map_err\(\|err\| err\.to_string\(\)\)\?/, "spawn_daemon should not early-return on sidecar/spawn errors before updating status");
assert.doesNotMatch(libRs, /let _ = spawn_daemon\(app\.handle\(\), &state\);/, "setup should not ignore daemon spawn failure");
assert.match(libRs, /if let Err\(err\) = spawn_daemon\(app\.handle\(\), &state\)/, "setup should explicitly handle daemon spawn failure");
assert.match(libRs, /reconnect_daemon/, "Rust app should expose reconnect control");
assert.match(libRs, /run_verification_again/, "Rust app should expose verification control");
assert.match(libRs, /jarvis:desktop-connector:awaken/, "verification action should launch the awakening ceremony");
assert.match(libRs, /BaseDirectory::Resource/, "verification action should use the bundled awakening resource");
assert.doesNotMatch(libRs, /--window-style/i, "verification action should not pass invalid --window-style to PowerShell");
assert.match(libRs, /-WindowStyle[\s\S]*Normal/, "verification action should open a visible PowerShell window");
assert.match(libRs, /Start-Process[\s\S]*-FilePath[\s\S]*powershell\.exe[\s\S]*-ArgumentList/, "verification action should use valid Start-Process PowerShell semantics");
assert.match(libRs, /\.on_window_event\(/, "window close should be handled by the tray wrapper");
assert.match(libRs, /WindowEvent::CloseRequested/, "main window close requests should be intercepted");
assert.match(libRs, /api\.prevent_close\(\)/, "main window close should be prevented");
assert.match(libRs, /\.hide\(\)/, "main window close should hide to tray instead of quitting");

const appTsx = readText("desktop-connector/src/App.tsx");
for (const text of ["Jarvis Desktop Connector", "Reconnect", "Run verification again", "Open Jarvis", "Quiet startup"]) {
  assert.match(appTsx, new RegExp(text), `status UI should include ${text}`);
}
assert.doesNotMatch(appTsx, /npm install|PowerShell|command line|\bCLI\b/i, "tray UI should not show setup commands");
assert.match(appTsx, /const \[errorMessage, setErrorMessage\]/, "status UI should track frontend command errors");
assert.match(appTsx, /catch\s*\([^)]*err[^)]*\)/, "status UI should catch command errors");
assert.match(appTsx, /role="alert"/, "status UI should surface command errors accessibly");

const connectorApi = readText("desktop-connector/src/connectorApi.ts");
for (const command of ["get_status", "reconnect_daemon", "run_verification_again", "open_jarvis"]) {
  assert.match(connectorApi, new RegExp(command), `connector API should invoke ${command}`);
}

const sidecarPackage = readJson("desktop-connector/sidecar/package.json");
assert.equal(sidecarPackage.bin["jarvis-desktop-daemon"], "index.js", "sidecar package should expose the daemon launcher binary");
assert.match(sidecarPackage.scripts.prepareDaemon, /prepare-daemon\.mjs/);
assert.match(sidecarPackage.scripts.rename, /rename-sidecar\.mjs/);
assert.ok(Array.isArray(sidecarPackage.pkg.scripts), "sidecar package should compile bundled daemon scripts into the pkg snapshot");
assert.ok(
  sidecarPackage.pkg.scripts.includes("bundled-daemon/jarvis-daemon.js"),
  "bundled daemon should be a pkg.scripts input so pkg statically traverses daemon require() calls such as ws",
);
assert.ok(
  sidecarPackage.pkg.assets.includes("bundled-daemon/jarvis-daemon.js"),
  "bundled daemon may also remain a pkg asset for readable stack traces and debugging",
);

const sidecarIndex = readText("desktop-connector/sidecar/index.js");
assert.match(sidecarIndex, /bundled-daemon[\\/]jarvis-daemon\.js/, "sidecar should require the bundled daemon copy");
assert.match(sidecarIndex, /require\("\.\/bundled-daemon\/jarvis-daemon\.js"\)/, "sidecar should use a literal daemon require so pkg can bundle dependencies");
assert.match(sidecarIndex, /function arg\(name\)/, "sidecar should accept pairing context args from the tray wrapper");
assert.match(sidecarIndex, /arg\("server"\)/, "sidecar should accept --server from a setup handoff");
assert.match(sidecarIndex, /arg\("code"\)/, "sidecar should accept --code from a setup handoff");
assert.match(sidecarIndex, /JARVIS_PAIR_CODE/, "sidecar should forward the handoff pair code to the daemon env");
assert.match(sidecarIndex, /JARVIS_DAEMON_PLATFORM/, "sidecar should set desktop daemon platform env");
assert.match(sidecarIndex, /\.connect\(\)/, "sidecar launcher should call the daemon connect export");
assert.doesNotMatch(sidecarIndex, /..[\\/]..[\\/]daemon[\\/]jarvis-daemon\.js/, "sidecar should not run daemon from a source repo checkout");

const prepareDaemon = readText("desktop-connector/sidecar/prepare-daemon.mjs");
assert.match(prepareDaemon, /daemon[\\/]jarvis-daemon\.js/, "prepare step should copy the existing daemon source");
assert.match(prepareDaemon, /bundled-daemon/, "prepare step should copy into the sidecar package");
assert.match(prepareDaemon, /path\.resolve\(__dirname,\s*"\.\.\/\.\."\)/, "prepare step should resolve the repo root from desktop-connector/sidecar");

const renameSidecar = readText("desktop-connector/sidecar/rename-sidecar.mjs");
assert.match(renameSidecar, /src-tauri[\\/]binaries/, "rename script should place the sidecar under Tauri binaries");
assert.match(renameSidecar, /jarvis-desktop-daemon-\$\{targetTriple\}/, "rename script should append the target triple");
assert.match(renameSidecar, /pc-windows-msvc/, "rename script should default to the Windows target triple");

const daemon = readText("daemon/jarvis-daemon.js");
assert.match(daemon, /module\.exports\s*=\s*\{[\s\S]*connect,/, "daemon should export connect for the packaged sidecar wrapper");

const assertConfig = readText("desktop-connector/scripts/assert-config.mjs");
assert.match(assertConfig, /desktopConnectorTauriConfig\.test\.mjs/, "connector config script should delegate to the root static assertions");

const connectorSourceFiles = fs
  .readdirSync(connectorRoot, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => path.join(entry.parentPath || entry.path, entry.name))
  .filter((file) => {
    const relative = path.relative(connectorRoot, file).replace(/\\/g, "/");
    return !relative.startsWith("node_modules/")
      && !relative.startsWith("dist/")
      && !relative.startsWith("sidecar/dist/")
      && !relative.startsWith("sidecar/bundled-daemon/")
      && !relative.startsWith("src-tauri/target/")
      && !relative.startsWith("src-tauri/binaries/");
  });
for (const file of connectorSourceFiles) {
  if (path.relative(repoRoot, file).replace(/\\/g, "/") === "desktop-connector/src-tauri/icons/icon.ico") continue;
  const text = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(text, /app-icon/i, `${path.relative(repoRoot, file)} should not reference missing app-icon assets`);
}

console.log("desktop connector Tauri scaffold assertions passed");
