import jwt from "jsonwebtoken";
import pg from "pg";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET env var is required");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL env var is required");

const PROD_URL = process.env.PROD_URL || "https://gameplanjarvisai.up.railway.app";

const DEV_USER_ID = process.argv[2];
const PROD_USER_ID = process.argv[3];

if (!DEV_USER_ID || !PROD_USER_ID) {
  console.error("Usage: npx tsx scripts/migrate-dev-to-prod.ts <dev-user-id> <prod-user-id>");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });

async function queryOne(table: string): Promise<unknown> {
  const result = await pool.query(`SELECT data FROM ${table} WHERE user_id = $1`, [DEV_USER_ID]);
  return result.rows.length > 0 ? (result.rows[0] as { data: unknown }).data : null;
}

async function queryDateKeyed(table: string): Promise<Record<string, unknown>> {
  const result = await pool.query(`SELECT date, data FROM ${table} WHERE user_id = $1`, [DEV_USER_ID]);
  const map: Record<string, unknown> = {};
  for (const row of result.rows as Array<{ date: string; data: unknown }>) {
    map[row.date] = row.data;
  }
  return map;
}

async function main() {
  console.log(`Migrating data from dev user ${DEV_USER_ID} to prod user ${PROD_USER_ID}`);
  console.log(`Production URL: ${PROD_URL}\n`);

  const prodToken = jwt.sign({ userId: PROD_USER_ID }, JWT_SECRET!, { expiresIn: "1h" });
  console.log("Generated production JWT token\n");

  console.log("Reading dev database...");
  const bundle = {
    goals: await queryOne("goals"),
    stats: await queryOne("stats"),
    lifeContext: await queryOne("life_context"),
    userPreferences: await queryOne("user_preferences"),
    chatHistory: await queryOne("chat_history"),
    timerSettings: await queryOne("timer_settings"),
    brainDumpInbox: await queryOne("brain_dump_inbox"),
    completionHistory: await queryOne("completion_history"),
    blockedTasks: await queryOne("blocked_tasks"),
    planSnapshots: await queryOne("plan_snapshots"),
    plans: await queryDateKeyed("plans"),
    energyCheckins: await queryDateKeyed("energy_checkins"),
    completedCalendarIds: await queryDateKeyed("completed_calendar_ids"),
  };

  console.log("  goals:", bundle.goals ? "present" : "null");
  console.log("  stats:", bundle.stats ? "present" : "null");
  console.log("  lifeContext:", bundle.lifeContext ? "present" : "null");
  console.log("  userPreferences:", bundle.userPreferences ? "present" : "null");
  console.log("  chatHistory:", bundle.chatHistory ? "present" : "null");
  console.log("  plans:", Object.keys(bundle.plans).length, "entries");
  console.log("  energyCheckins:", Object.keys(bundle.energyCheckins).length, "entries");
  console.log("  completedCalendarIds:", Object.keys(bundle.completedCalendarIds).length, "entries");

  console.log("\nPushing to production via POST /api/data/import...");
  const res = await fetch(`${PROD_URL}/api/data/import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${prodToken}`,
    },
    body: JSON.stringify({ data: bundle }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Import failed with status ${res.status}:`, text);
    process.exit(1);
  }

  const result = await res.json();
  console.log("Import result:", JSON.stringify(result));
  console.log("\nMigration complete!");
  await pool.end();
}

main().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
