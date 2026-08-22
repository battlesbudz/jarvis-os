import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const railway = JSON.parse(fs.readFileSync(path.join(root, "railway.json"), "utf8"));
const railpack = JSON.parse(fs.readFileSync(path.join(root, "railpack.json"), "utf8"));
const browserClient = fs.readFileSync(
  path.join(root, "server/agent/mcp/playwrightMcpClient.ts"),
  "utf8",
);

const buildCommand = railway.build?.buildCommand ?? "";
assert.doesNotMatch(
  buildCommand,
  /playwright.*install.*chromium/,
  "Railway builds must not depend on Playwright's external browser CDN",
);

assert.equal(
  railpack.deploy?.variables?.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  "/usr/bin/chromium",
  "the browser client must use Railpack's system Chromium",
);

const runtimePackages = new Set(railpack.deploy?.aptPackages ?? []);
assert.ok(runtimePackages.has("chromium"), "Railpack must install Chromium and its runtime dependencies");

assert.match(
  browserClient,
  /chrome-headless-shell-linux64\/chrome-headless-shell/,
  "the MCP browser resolver must recognize Playwright's installed headless shell",
);

console.log("Railpack browser runtime assertions passed");
