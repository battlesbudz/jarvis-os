import { ensureTablesExist, pool } from "../server/db";

async function main(): Promise<void> {
  try {
    await ensureTablesExist();
    console.log("Test database schema prepared.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
