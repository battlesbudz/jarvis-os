import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../../..");

function readIfPresent(relativePath: string): string {
  const absolutePath = path.join(projectRoot, relativePath);
  return existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : "";
}

const routeSource = [
  readIfPresent("server/routes.ts"),
  readIfPresent("server/routes/connectionsRoutes.ts"),
  readIfPresent("server/connectors/composio/connectionCenter.ts"),
].join("\n");

function assertRoute(method: string, route: string): void {
  assert.match(
    routeSource,
    new RegExp(`${method}\\s*\\(\\s*["'\`]${route.replaceAll("/", "\\/")}["'\`]`),
    `${method.toUpperCase()} ${route} should be registered for the Composio migration.`,
  );
}

assert.ok(routeSource.includes("COMPOSIO_API_KEY"), "Composio routes should report missing COMPOSIO_API_KEY clearly.");
assertRoute("app.get", "/api/connections/status");
assertRoute("app.post", "/api/connections/connect-link");
assertRoute("app.get", "/api/connections/callback");
assertRoute("app.post", "/api/connections/callback");
assertRoute("app.post", "/api/connections/disconnect");
assertRoute("app.post", "/api/connections/test");
console.log("OK: Composio connection route contract is registered");

assert.match(routeSource, /status\s*===\s*["']success["']|["']success["']\s*===\s*status/i);
assert.match(routeSource, /status\s*===\s*["']failed["']|["']failed["']\s*===\s*status/i);
assert.match(routeSource, /connected[_A-Za-z]*account[_A-Za-z]*id/i);
console.log("OK: Composio callback covers success, failure, and connected-account id markers");
