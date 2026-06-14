import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const readJson = (relativePath) =>
  JSON.parse(readFileSync(join(repoRoot, relativePath), "utf8"));

for (const relativePath of [".replit", "replit.nix", "replit.md"]) {
  assert.equal(
    existsSync(join(repoRoot, relativePath)),
    false,
    `${relativePath} should not exist in the local Jarvis repo`,
  );
}
for (const relativePath of [
  "server/replit_integrations",
  ".replit_integration_files",
  "scripts/copy-replit-user-to-railway.mjs",
]) {
  assert.equal(
    existsSync(join(repoRoot, relativePath)),
    false,
    `${relativePath} should not remain as active Replit migration/runtime code`,
  );
}

const packageJson = readJson("package.json");
assert.equal(
  Object.hasOwn(packageJson.dependencies ?? {}, "@replit/connectors-sdk"),
  false,
  "package.json should not depend on @replit/connectors-sdk",
);

assert.doesNotMatch(
  packageJson.scripts?.["expo:dev"] ?? "",
  /REPLIT/i,
  "expo:dev should not depend on Replit environment variables",
);

for (const relativePath of [
  "server/integrations/gmailClient.ts",
  "server/integrations/googleCalendar.ts",
  "server/integrations/outlook.ts",
  "server/intelligence/integrationValidator.ts",
]) {
  const contents = readFileSync(join(repoRoot, relativePath), "utf8");
  assert.doesNotMatch(
    contents,
    /REPLIT|@replit\/connectors-sdk|ReplitConnectors/i,
    `${relativePath} should not use Replit connector fallbacks`,
  );
}
