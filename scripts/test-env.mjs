import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

export function loadEnvFile(filePath, env = process.env) {
  if (!existsSync(filePath)) return;

  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;

    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!env[key]) env[key] = value;
  }
}

export function loadEnvFiles(projectRoot, env = process.env) {
  for (const fileName of [".env", ".env.local", ".env.test.local"]) {
    loadEnvFile(path.join(projectRoot, fileName), env);
  }
}

export function configureDatabaseEnvForTests(env = process.env) {
  if (env.JARVIS_TEST_DATABASE_URL) {
    env.DATABASE_URL = env.JARVIS_TEST_DATABASE_URL;
    return true;
  }

  const explicitLiveDbOptIn = TRUE_VALUES.has(
    String(env.JARVIS_RUN_DB_TESTS_WITH_DATABASE_URL ?? "").toLowerCase(),
  );
  return Boolean(env.DATABASE_URL && explicitLiveDbOptIn);
}
