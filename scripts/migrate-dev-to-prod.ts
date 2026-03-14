import jwt from "jsonwebtoken";
import fs from "fs";
import pg from "pg";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET env var is required");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL env var is required");

const PROD_URL = process.env.PROD_URL || "https://gameplanai.replit.app";

const DEV_USER_ID = process.argv[2];
const PROD_USER_ID = process.argv[3];

if (!DEV_USER_ID || !PROD_USER_ID) {
  console.error("Usage: npx tsx scripts/migrate-dev-to-prod.ts <dev-user-id> <prod-user-id>");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });

async function queryDev(sql: string, params: string[] = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

async function putProd(path: string, data: unknown, token: string) {
  const res = await fetch(`${PROD_URL}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ data }),
  });
  const json = await res.json();
  console.log(`  PUT ${path} → ${res.status}`, JSON.stringify(json));
  return json;
}

async function postProd(path: string, body: unknown, token: string) {
  const res = await fetch(`${PROD_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  console.log(`  POST ${path} → ${res.status}`, JSON.stringify(json));
  return json;
}

async function main() {
  console.log(`Migrating data from dev user ${DEV_USER_ID} to prod user ${PROD_USER_ID}`);
  console.log(`Production URL: ${PROD_URL}`);

  const prodToken = jwt.sign({ userId: PROD_USER_ID }, JWT_SECRET!, { expiresIn: "1h" });
  console.log("Generated production JWT token");

  const simpleTables = ["goals", "stats", "life_context", "chat_history", "timer_settings",
    "brain_dump_inbox", "completion_history", "blocked_tasks", "plan_snapshots", "user_preferences"];

  const apiPaths: Record<string, string> = {
    goals: "goals", stats: "stats", life_context: "life-context",
    chat_history: "chat-history", timer_settings: "timer-settings",
    brain_dump_inbox: "brain-dump-inbox", completion_history: "completion-history",
    blocked_tasks: "blocked-tasks", plan_snapshots: "plan-snapshots",
    user_preferences: "user-preferences",
  };

  for (const table of simpleTables) {
    const rows = await queryDev(`SELECT data FROM ${table} WHERE user_id = $1`, [DEV_USER_ID]);
    if (rows.length > 0 && rows[0].data !== null) {
      console.log(`\nMigrating ${table}...`);
      await putProd(`/api/data/${apiPaths[table]}`, rows[0].data, prodToken);
    } else {
      console.log(`\nSkipping ${table} (no data)`);
    }
  }

  const plans = await queryDev("SELECT date, data FROM plans WHERE user_id = $1", [DEV_USER_ID]);
  console.log(`\nMigrating ${plans.length} plans...`);
  for (const plan of plans) {
    await putProd(`/api/data/plans/${plan.date}`, plan.data, prodToken);
  }

  const energyCheckins = await queryDev("SELECT date, data FROM energy_checkins WHERE user_id = $1", [DEV_USER_ID]);
  console.log(`\nMigrating ${energyCheckins.length} energy checkins...`);
  for (const row of energyCheckins) {
    await putProd(`/api/data/energy-checkins/${row.date}`, row.data, prodToken);
  }

  const calendarIds = await queryDev("SELECT date, data FROM completed_calendar_ids WHERE user_id = $1", [DEV_USER_ID]);
  console.log(`\nMigrating ${calendarIds.length} completed calendar IDs...`);
  for (const row of calendarIds) {
    await putProd(`/api/data/completed-calendar-ids/${row.date}`, row.data, prodToken);
  }

  console.log("\nMigration complete!");
  await pool.end();
}

main().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
