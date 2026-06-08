import assert from "node:assert/strict";
import {
  buildRuntimeMemoryCalibrationPreview,
  persistRuntimeMemoryCalibrationPreview,
  type RuntimeMemoryCalibrationPreview,
} from "../index";

const now = new Date("2026-06-08T21:00:00.000Z").toISOString();

async function run(): Promise<void> {
  {
    const preview = buildRuntimeMemoryCalibrationPreview({
      event: {
        eventId: "event-memory-calibration",
        source: "app",
        userId: "user-memory-calibration",
        message: "Actually, remember my planning block starts at 8:30 now.",
        createdAt: now,
      },
      currentMemory: {
        id: "mem-planning",
        content: "User starts planning at 9:00.",
        category: "work_patterns",
        memoryType: "semantic",
        confidence: 82,
        confidenceScale: "percent",
        metadata: { accessToken: "secret-token" },
      },
      correction: {
        content: "User starts the daily planning block at 8:30.",
        reason: "User corrected the prior schedule.",
        confidence: 0.94,
        confidenceScale: "ratio",
        metadata: { sourceCookie: "secret-cookie" },
      },
    });

    assert.equal(preview.operation, "correct_existing_memory");
    assert.equal(preview.status, "review_required");
    assert.equal(preview.riskTier, "T2");
    assert.equal(preview.approvalRequired, true);
    assert.equal(preview.writeAllowed, false);
    assert.equal(preview.currentMemory?.confidence?.normalized, 0.82);
    assert.equal(preview.proposedMemory.confidence?.normalized, 0.94);
    assert.equal(preview.currentMemory?.metadata.accessToken, "[redacted]");
    assert.equal(preview.proposedMemory.metadata.sourceCookie, "[redacted]");
    assert.doesNotMatch(JSON.stringify(preview), /secret-token|secret-cookie/);
    assert.match(preview.reviewReasons.join(" "), /memory review\/write controls/);
    console.log("OK: Runtime memory calibration preview redacts and requires review for corrections");
  }

  {
    const preview = buildRuntimeMemoryCalibrationPreview({
      event: {
        eventId: "event-memory-calibration-new",
        source: "telegram",
        userId: "user-memory-calibration",
        message: "Remember I prefer brief status updates.",
        createdAt: now,
      },
      correction: {
        content: "User prefers brief status updates.",
        confidence: 97,
        confidenceScale: "percent",
      },
    });

    assert.equal(preview.operation, "propose_new_memory");
    assert.equal(preview.status, "review_required");
    assert.equal(preview.proposedMemory.confidence?.normalized, 0.97);
    assert.match(preview.reviewReasons.join(" "), /channel provenance/);
    console.log("OK: Runtime memory calibration preview handles new memory proposals with provenance reasons");
  }

  {
    const preview = buildRuntimeMemoryCalibrationPreview({
      event: {
        eventId: "event-memory-calibration-invalid",
        source: "app",
        userId: "user-memory-calibration",
        message: "Correct that memory.",
        createdAt: now,
      },
      correction: {
        content: "   ",
      },
    });

    assert.equal(preview.status, "invalid");
    assert.deepEqual(preview.errors, ["Memory correction content is required."]);
    console.log("OK: Runtime memory calibration preview fails closed on empty correction content");
  }

  {
    const preview = buildRuntimeMemoryCalibrationPreview({
      event: {
        eventId: "event-memory-calibration-persist",
        source: "app",
        userId: "user-memory-calibration",
        message: "Remember I use Codex daily.",
        createdAt: now,
      },
      correction: {
        content: "User uses Codex daily.",
      },
    });
    const disabled = await persistRuntimeMemoryCalibrationPreview(preview);
    const written: RuntimeMemoryCalibrationPreview[] = [];
    const persisted = await persistRuntimeMemoryCalibrationPreview(preview, {
      writePreview: async (item) => {
        written.push(item);
      },
    });

    assert.equal(disabled.persisted, false);
    assert.match(disabled.reason, /No runtime memory calibration writer/);
    assert.equal(persisted.persisted, true);
    assert.equal(written[0]?.previewId, preview.previewId);
    console.log("OK: Runtime memory calibration persistence hook is explicit and storage-neutral");
  }

  console.log("\nAll Runtime Memory Calibration assertions passed.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
