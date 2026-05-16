import { spawn } from "node:child_process";
import { runRailwayDatabaseRepair } from "./railway-db-repair.mjs";

try {
  await runRailwayDatabaseRepair();
} catch (error) {
  console.error("[railway-db-push] Database compatibility repair failed:", error);
  process.exit(1);
}

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const args = process.argv.slice(2);
const runningOnRailway =
  Boolean(process.env.RAILWAY_ENVIRONMENT) ||
  Boolean(process.env.RAILWAY_PROJECT_ID) ||
  Boolean(process.env.RAILWAY_SERVICE_ID);

if (runningOnRailway && !args.includes("--force")) {
  args.push("--force");
}

const child = spawn(npx, ["drizzle-kit", "push", ...args], {
  stdio: "inherit",
  shell: false,
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`[railway-db-push] drizzle-kit terminated with signal ${signal}`);
    process.exit(1);
  }

  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error("[railway-db-push] Failed to start drizzle-kit:", error);
  process.exit(1);
});
