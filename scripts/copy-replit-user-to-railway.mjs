import pg from "pg";

const SOURCE_USER_ID = process.env.SOURCE_USER_ID || "c06aae28-159a-4716-9222-d1389fb6618f";
const DEST_USER_ID = process.env.DEST_USER_ID || "08f68bc9-8054-4ec5-af01-a44b4e4e37fe";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
if (!process.env.RAILWAY_DATABASE_URL) throw new Error("RAILWAY_DATABASE_URL is not set");

const source = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const dest = new pg.Pool({ connectionString: process.env.RAILWAY_DATABASE_URL });

const q = (name) => `"${String(name).replaceAll('"', '""')}"`;

function coerceValue(value, destType) {
  if ((destType === "json" || destType === "jsonb") && typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

async function userTables() {
  const tables = await source.query(`
    select table_name
    from information_schema.columns
    where table_schema = 'public' and column_name = 'user_id'
    order by table_name
  `);
  return tables.rows.map((row) => row.table_name);
}

async function commonColumns(tableName) {
  const srcColsRes = await source.query(`
    select column_name
    from information_schema.columns
    where table_schema = 'public' and table_name = $1
    order by ordinal_position
  `, [tableName]);

  const dstColsRes = await dest.query(`
    select column_name, data_type
    from information_schema.columns
    where table_schema = 'public' and table_name = $1
    order by ordinal_position
  `, [tableName]);

  if (dstColsRes.rows.length === 0) return null;

  const dstTypeByCol = new Map(dstColsRes.rows.map((row) => [row.column_name, row.data_type]));
  const dstCols = new Set(dstColsRes.rows.map((row) => row.column_name));
  const cols = srcColsRes.rows.map((row) => row.column_name).filter((col) => dstCols.has(col));

  if (!cols.includes("user_id")) return null;
  return { cols, dstTypeByCol };
}

async function copyTable(tableName, cols, dstTypeByCol) {
  const rows = await source.query(
    `select ${cols.map(q).join(", ")} from ${q(tableName)} where user_id = $1`,
    [SOURCE_USER_ID],
  );

  if (rows.rows.length === 0) return 0;

  await dest.query("begin");
  try {
    await dest.query(`delete from ${q(tableName)} where user_id = $1`, [DEST_USER_ID]);

    for (const row of rows.rows) {
      row.user_id = DEST_USER_ID;
      const values = cols.map((col) => coerceValue(row[col], dstTypeByCol.get(col)));
      const placeholders = cols.map((_, index) => `$${index + 1}`).join(", ");

      await dest.query(
        `insert into ${q(tableName)} (${cols.map(q).join(", ")}) values (${placeholders})`,
        values,
      );
    }

    await dest.query("commit");
    return rows.rows.length;
  } catch (error) {
    await dest.query("rollback");
    throw error;
  }
}

async function main() {
  console.log(`Copying Replit user ${SOURCE_USER_ID} -> Railway user ${DEST_USER_ID}`);

  const tables = await userTables();
  const copied = [];
  const skipped = [];

  for (const tableName of tables) {
    try {
      const metadata = await commonColumns(tableName);
      if (!metadata) {
        skipped.push({ table: tableName, reason: "missing or incompatible in Railway" });
        continue;
      }

      const count = await copyTable(tableName, metadata.cols, metadata.dstTypeByCol);
      if (count > 0) copied.push({ table: tableName, rows: count });
    } catch (error) {
      skipped.push({ table: tableName, reason: error.message });
    }
  }

  console.log("\nCOPIED");
  console.table(copied);
  console.log("\nSKIPPED");
  console.table(skipped);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await source.end();
    await dest.end();
  });
