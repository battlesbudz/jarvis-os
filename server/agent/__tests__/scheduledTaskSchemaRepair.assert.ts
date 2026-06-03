import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const serverDbSource = readFileSync(path.join(root, "server", "db.ts"), "utf8");
const railwayRepairSource = readFileSync(path.join(root, "scripts", "railway-db-repair.mjs"), "utf8");

for (const source of [
  { name: "server/db.ts", text: serverDbSource, tablePrefix: "jarvis_scheduled_tasks" },
  { name: "scripts/railway-db-repair.mjs", text: railwayRepairSource, tablePrefix: "public.jarvis_scheduled_tasks" },
]) {
  assert.match(
    source.text,
    new RegExp(`ALTER TABLE ${source.tablePrefix} ADD COLUMN IF NOT EXISTS task_kind\\s+varchar`, "i"),
    `${source.name} must repair missing jarvis_scheduled_tasks.task_kind for older Railway databases`,
  );
  assert.match(
    source.text,
    new RegExp(`ALTER TABLE ${source.tablePrefix} ADD COLUMN IF NOT EXISTS needs_attention\\s+boolean`, "i"),
    `${source.name} must repair missing jarvis_scheduled_tasks.needs_attention for attention routing`,
  );
  assert.match(
    source.text,
    new RegExp(`ALTER TABLE ${source.tablePrefix} ADD COLUMN IF NOT EXISTS attention_question\\s+text`, "i"),
    `${source.name} must repair missing jarvis_scheduled_tasks.attention_question for attention routing`,
  );
  assert.match(
    source.text,
    /SET\s+(?:"?task_kind"?|task_kind)\s*=\s*'jarvis_action'[\s\S]+(?:"?shell_command"?|shell_command)\s+IS\s+NOT\s+NULL/i,
    `${source.name} must backfill existing shell-command tasks as jarvis_action`,
  );
}

console.log("OK: scheduled task schema repair covers task kind and attention columns");
