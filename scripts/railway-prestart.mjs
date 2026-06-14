import { runRailwayDatabaseRepair } from "./railway-db-repair.mjs";

try {
  await runRailwayDatabaseRepair();
} catch (error) {
  console.error("[railway-prestart] Database compatibility repair failed:", error);
  process.exitCode = 1;
}
