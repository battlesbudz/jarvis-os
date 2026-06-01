import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const testPath = path.join(repoRoot, "scripts", "__tests__", "desktopConnectorTauriConfig.test.mjs");

const result = spawnSync(process.execPath, [testPath], {
  cwd: repoRoot,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
