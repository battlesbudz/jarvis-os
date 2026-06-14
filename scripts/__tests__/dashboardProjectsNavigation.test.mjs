import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const read = (relativePath) => readFileSync(join(repoRoot, relativePath), "utf8");

const sidebar = read("dashboard/components/Sidebar.tsx");
const mobileProjects = read("app/(tabs)/projects.tsx");
const e2e = read("e2e/jarvis.spec.ts");

assert.match(sidebar, /href:\s*"\/projects"[\s\S]*label:\s*"Projects"/, "dashboard sidebar should expose a visible Projects link to /projects");
assert.match(sidebar, /data-testid=\{`dashboard-nav-\$\{item\.label\.toLowerCase\(\)\.replace\(/, "dashboard Projects navigation should have a stable click target");
assert.match(mobileProjects, /headerTitle[\s\S]*>\s*Projects\s*</, "mobile Projects tab should keep the Projects label");
assert.match(e2e, /dashboard home can navigate to Projects by clicking UI/, "E2E should cover clicking from dashboard home to Projects");
assert.match(e2e, /getByTestId\("dashboard-nav-projects"\)/, "E2E should click the dashboard Projects navigation target");
