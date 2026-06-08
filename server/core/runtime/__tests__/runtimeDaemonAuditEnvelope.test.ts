import assert from "node:assert/strict";
import {
  buildRuntimeDaemonAuditEnvelope,
  persistRuntimeDaemonAuditEnvelope,
  type RuntimeDaemonAuditEnvelope,
} from "../index";

const now = new Date("2026-06-08T22:00:00.000Z").toISOString();

async function run(): Promise<void> {
  {
    const envelope = buildRuntimeDaemonAuditEnvelope({
      event: {
        eventId: "event-daemon-audit-shell",
        source: "daemon",
        userId: "user-daemon-audit",
        message: "Run the desktop connector smoke command.",
        createdAt: now,
      },
      toolName: "daemon_shell",
      argsPreview: {
        command: "echo secret-token",
        timeoutMs: 15000,
        accessToken: "secret-token",
        nested: { password: "secret-password" },
      },
      resultPreview: {
        stdout: "secret-token",
        stderr: "secret-password",
        code: 0,
      },
      status: "needs_approval",
    });

    const serialized = JSON.stringify(envelope);
    assert.equal(envelope.surface, "desktop");
    assert.equal(envelope.riskTier, "T3");
    assert.equal(envelope.approvalRequired, true);
    assert.equal(envelope.rawPayloadStored, false);
    assert.deepEqual(envelope.args.topLevelKeys, ["accessToken", "command", "nested", "timeoutMs"]);
    assert.deepEqual(envelope.result.topLevelKeys, ["code", "stderr", "stdout"]);
    assert.match(String(envelope.args.fingerprint), /^[a-f0-9]{64}$/);
    assert.match(String(envelope.result.fingerprint), /^[a-f0-9]{64}$/);
    assert.doesNotMatch(serialized, /echo secret-token|secret-password|secret-token/);
    console.log("OK: Runtime daemon audit envelope stores keys and fingerprints without raw args or output");
  }

  {
    const first = buildRuntimeDaemonAuditEnvelope({
      event: {
        eventId: "event-daemon-audit-fingerprint",
        source: "daemon",
        userId: "user-daemon-audit",
        message: "Tap the button.",
        createdAt: now,
      },
      toolName: "android_tap",
      argsPreview: { x: 10, y: 20, token: "first-secret" },
    });
    const second = buildRuntimeDaemonAuditEnvelope({
      event: {
        eventId: "event-daemon-audit-fingerprint",
        source: "daemon",
        userId: "user-daemon-audit",
        message: "Tap the button.",
        createdAt: now,
      },
      toolName: "android_tap",
      argsPreview: { y: 20, x: 10, token: "second-secret" },
    });

    assert.equal(first.surface, "android");
    assert.equal(first.args.fingerprint, second.args.fingerprint);
    assert.equal(first.approvalRequired, true);
    console.log("OK: Runtime daemon audit fingerprint is stable after redaction and key ordering");
  }

  {
    const envelope = buildRuntimeDaemonAuditEnvelope({
      event: {
        eventId: "event-daemon-audit-status",
        source: "app",
        userId: "user-daemon-audit",
        message: "Check daemon status.",
        createdAt: now,
      },
      toolName: "daemon_status",
    });

    assert.equal(envelope.status, "preflight");
    assert.equal(envelope.riskTier, "T1");
    assert.equal(envelope.approvalRequired, false);
    assert.equal(envelope.args.present, false);
    console.log("OK: Runtime daemon audit envelope keeps status checks low-risk and payload-free");
  }

  {
    const envelope = buildRuntimeDaemonAuditEnvelope({
      event: {
        eventId: "event-daemon-audit-persist",
        source: "daemon",
        userId: "user-daemon-audit",
        message: "Audit browser action.",
        createdAt: now,
      },
      toolName: "browser_click",
      argsPreview: { selector: "#submit", sessionId: "secret-session" },
    });
    const disabled = await persistRuntimeDaemonAuditEnvelope(envelope);
    const written: RuntimeDaemonAuditEnvelope[] = [];
    const persisted = await persistRuntimeDaemonAuditEnvelope(envelope, {
      writeEnvelope: async (item) => {
        written.push(item);
      },
    });

    assert.equal(disabled.persisted, false);
    assert.match(disabled.reason, /No runtime daemon audit writer/);
    assert.equal(persisted.persisted, true);
    assert.equal(written[0]?.auditId, envelope.auditId);
    console.log("OK: Runtime daemon audit persistence hook is explicit and storage-neutral");
  }

  console.log("\nAll Runtime Daemon Audit Envelope assertions passed.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
