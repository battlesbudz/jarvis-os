import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const railway = JSON.parse(fs.readFileSync(path.join(root, "railway.json"), "utf8"));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
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

assert.equal(packageJson.dependencies?.["@sparticuz/chromium"], "147.0.2");

assert.match(
  browserClient,
  /chrome-headless-shell-linux64\/chrome-headless-shell/,
  "the MCP browser resolver must recognize Playwright's installed headless shell",
);
assert.match(browserClient, /serverlessChromium\.executablePath\(\)/);
assert.match(browserClient, /args:\s*serverlessChromium\.args/);

console.log("Railpack browser runtime assertions passed");
