import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLivingContextUpdateTool } from "../tools/livingContextUpdateTool";

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "living-context-"));
  const targetRel = "workspaces/battles/business/battles-budz/licensing/test-readiness.md";
  const targetAbs = path.join(root, targetRel);
  const auditLogPath = path.join(root, "audit.log");
  await fs.mkdir(path.dirname(targetAbs), { recursive: true });
  await fs.writeFile(targetAbs, "# Test Readiness\n\n## Open Questions\n- OCM status: Unknown\n", "utf-8");

  const tool = createLivingContextUpdateTool({
    rootDir: root,
    targets: { licensing_readiness: targetRel },
    auditLogPath,
    requireOwner: false,
    now: () => new Date("2026-05-05T12:00:00.000Z"),
  });

  const ctx = { userId: "test-user", state: {}, channel: "test" };

  const list = await tool.execute({ action: "list_targets" }, ctx);
  assert.equal(list.ok, true);
  assert.match(list.content, /licensing_readiness/);

  const read = await tool.execute({ action: "read", target: "licensing_readiness" }, ctx);
  assert.equal(read.ok, true);
  assert.match(read.content, /OCM status: Unknown/);

  const write = await tool.execute({
    action: "append_learning",
    target: "licensing_readiness",
    topic: "OCM status",
    learned: "Battles said the OCM final approval is pending facility readiness.",
    sourceType: "conversation",
    sourceRef: "direct user answer",
    confidence: 95,
    status: "confirmed",
    fillsQuestion: "What is the exact current OCM/licensing stage?",
    approvalSensitive: true,
  }, ctx);
  assert.equal(write.ok, true);

  const updated = await fs.readFile(targetAbs, "utf-8");
  assert.match(updated, /## Learned Updates/);
  assert.match(updated, /2026-05-05 - OCM status/);
  assert.match(updated, /Status: needs_review/);
  assert.match(updated, /pending facility readiness/);

  const duplicate = await tool.execute({
    action: "append_learning",
    target: "licensing_readiness",
    topic: "OCM status",
    learned: "Battles said the OCM final approval is pending facility readiness.",
    sourceType: "conversation",
  }, ctx);
  assert.equal(duplicate.ok, true);
  assert.match(duplicate.content, /No write needed/);

  const audit = await fs.readFile(auditLogPath, "utf-8");
  assert.match(audit, /living_context_append/);

  await fs.rm(root, { recursive: true, force: true });
  console.log("All living context update tool assertions passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
