import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), "utf8");
}

function functionBody(source: string, name: string): string {
  const match = source.match(new RegExp(`export\\s+async\\s+function\\s+${name}\\([^)]*\\)\\s*:[^{]+\\{([\\s\\S]*?)\\n\\}`));
  assert(match, `${name} should be exported as an async function`);
  return match[1] ?? "";
}

function testSchemaAndBootTable(): void {
  const schema = read("shared/schema.ts");
  const boot = read("server/db.ts");
  const rootMigration = read("migrations/0013_soul_edit_events.sql");
  const serverMigration = read("server/migrations/015_soul_edit_events.sql");

  assert.match(schema, /export const soulEditEvents = pgTable\("soul_edit_events"/);
  for (const column of [
    "oldValue: text(\"old_value\")",
    "newValue: text(\"new_value\").notNull()",
    "source: varchar(\"source\")",
    "approvedBy: varchar(\"approved_by\")",
    "reason: text(\"reason\")",
    "resolvedAt: timestamp(\"resolved_at\")",
  ]) {
    assert.ok(schema.includes(column), `soul_edit_events schema should include ${column}`);
  }

  for (const source of [boot, rootMigration, serverMigration]) {
    assert.match(source, /CREATE TABLE IF NOT EXISTS soul_edit_events/);
    assert.match(source, /old_value TEXT/);
    assert.match(source, /new_value TEXT NOT NULL/);
    assert.match(source, /approved_by VARCHAR/);
    assert.match(source, /CREATE INDEX IF NOT EXISTS soul_edit_events_user_status_created_idx/);
  }

  console.log("OK: Soul edit events have durable schema, boot DDL, and migrations");
}

function testSoulEditLifecycleFunctions(): void {
  const source = read("server/memory/soul.ts");

  assert.match(source, /export type SoulEditTarget = "content" \| "manual_override"/);
  assert.match(source, /export type SoulEditStatus = "pending" \| "approved" \| "rejected"/);

  const propose = functionBody(source, "proposeSoulEdit");
  assert.match(propose, /status:\s*"pending"/);
  assert.doesNotMatch(propose, /writeSoulEditValue\(/, "chat proposals must not apply Soul edits");

  const approve = functionBody(source, "approveSoulEdit");
  assert.match(approve, /status\s*=\s*'pending'/);
  assert.match(approve, /writeSoulEditValue\(/);
  assert.match(approve, /status\s*=\s*'approved'/);
  assert.match(approve, /approved_by\s*=/);
  assert.match(approve, /resolved_at\s*=/);

  const reject = functionBody(source, "rejectSoulEdit");
  assert.match(reject, /status\s*=\s*'pending'/);
  assert.match(reject, /status\s*=\s*'rejected'/);
  assert.doesNotMatch(reject, /writeSoulEditValue\(/, "rejected Soul edits must never apply");

  assert.match(functionBody(source, "setSoulContent"), /recordSoulEditAudit\(/);
  assert.match(functionBody(source, "setManualOverride"), /recordSoulEditAudit\(/);
  assert.match(functionBody(source, "listSoulEditHistory"), /ORDER BY created_at DESC/);

  console.log("OK: Soul edit lifecycle distinguishes proposals, approvals, rejections, and direct editor audit");
}

function testRoutesAndProfileUiExposeEditorOnlyReview(): void {
  const routes = read("server/routes/profileMemoryRoutes.ts");
  const profile = read("app/(tabs)/profile.tsx");

  assert.match(routes, /listSoulEditHistory\(userId/);
  assert.match(routes, /pendingSoulEdits/);
  assert.match(routes, /app\.post\("\/api\/soul\/proposals"/);
  assert.match(routes, /app\.patch\("\/api\/soul\/proposals\/:id\/review"/);
  assert.match(routes, /approveSoulEdit\(/);
  assert.match(routes, /rejectSoulEdit\(/);

  assert.match(profile, /pendingSoulEdits/);
  assert.match(profile, /soul\??\.auditHistory/);
  assert.match(profile, /Soul edit history/);
  assert.match(profile, /Approve/);
  assert.match(profile, /Reject/);
  assert.doesNotMatch(read("server/state/runtimeMemoryInspection.ts"), /soulEditEvents|auditHistory|pendingSoulEdits/);

  console.log("OK: Soul proposals and audit history are visible in the Soul editor, not normal chat");
}

function testModelCanOnlyProposeSoulEdits(): void {
  const tool = read("server/agent/tools/soulEdit.ts");
  const capability = read("server/capabilities/memoryCapability.ts");
  const index = read("server/agent/tools/index.ts");

  assert.match(tool, /name:\s*"soul_edit_propose"/);
  assert.match(tool, /proposeSoulEdit\(/);
  assert.doesNotMatch(tool, /approveSoulEdit|setSoulContent|setManualOverride/, "model-facing tool should not apply edits");
  assert.match(tool, /queued for approval/);
  assert.match(capability, /soulEditProposeTool/);
  assert.match(index, /soulEditProposeTool/);

  console.log("OK: model-facing Soul tool can propose changes but cannot apply them");
}

function main(): void {
  testSchemaAndBootTable();
  testSoulEditLifecycleFunctions();
  testRoutesAndProfileUiExposeEditorOnlyReview();
  testModelCanOnlyProposeSoulEdits();
}

main();
