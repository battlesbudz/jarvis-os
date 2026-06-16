import { spawn } from "node:child_process";
import "./load-env.mjs";
import { runRailwayDatabaseRepair } from "./railway-db-repair.mjs";

try {
  await runRailwayDatabaseRepair();
} catch (error) {
  console.error("[railway-db-push] Database compatibility repair failed:", error);
  process.exit(1);
}

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const args = process.argv.slice(2);
const railwayEnvKeys = [
  "RAILWAY_ENVIRONMENT",
  "RAILWAY_ENVIRONMENT_ID",
  "RAILWAY_PROJECT_ID",
  "RAILWAY_SERVICE_ID",
  "RAILWAY_DEPLOYMENT_ID",
  "RAILWAY_REPLICA_ID",
  "RAILWAY_PUBLIC_DOMAIN",
  "RAILWAY_PRIVATE_DOMAIN",
];
const runningOnRailway =
  railwayEnvKeys.some((key) => Boolean(process.env[key])) || process.cwd() === "/app";

if (runningOnRailway && !args.includes("--force")) {
  console.log("[railway-db-push] Railway runtime detected; adding --force for noninteractive deploy.");
  args.push("--force");
}

const child = process.platform === "win32"
  ? spawn("cmd.exe", ["/d", "/s", "/c", npx, "drizzle-kit", "push", ...args], {
      stdio: "inherit",
      shell: false,
    })
  : spawn(npx, ["drizzle-kit", "push", ...args], {
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
