import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const railway = JSON.parse(fs.readFileSync(path.join(root, "railway.json"), "utf8"));
const railpack = JSON.parse(fs.readFileSync(path.join(root, "railpack.json"), "utf8"));

const buildCommand = railway.build?.buildCommand ?? "";
assert.match(
  buildCommand,
  /PLAYWRIGHT_BROWSERS_PATH=\.\/.cache\/ms-playwright\s+node\s+node_modules\/@playwright\/mcp\/node_modules\/playwright\/cli\.js\s+install\s+--no-shell\s+chromium/,
  "Railway must install the Chromium revision used by the Playwright MCP package into the app image",
);
assert.ok(
  buildCommand.indexOf("install --no-shell chromium") < buildCommand.indexOf("npm run server:build"),
  "Chromium must be installed before the server build completes",
);

assert.equal(
  railpack.deploy?.variables?.PLAYWRIGHT_BROWSERS_PATH,
  "/app/.cache/ms-playwright",
  "the runtime must resolve the same browser directory populated during the build",
);

const runtimePackages = new Set(railpack.deploy?.aptPackages ?? []);
for (const dependency of ["libnss3", "libgbm1", "libasound2t64", "fonts-liberation"]) {
  assert.ok(runtimePackages.has(dependency), `Railpack runtime is missing Chromium dependency ${dependency}`);
}

console.log("Railpack browser runtime assertions passed");
