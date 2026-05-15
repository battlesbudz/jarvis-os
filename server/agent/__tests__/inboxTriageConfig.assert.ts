import assert from "node:assert/strict";
import { isInboxTriageEnabled } from "../../inboxTriageConfig";

const original = process.env.JARVIS_INBOX_TRIAGE_ENABLED;

try {
  delete process.env.JARVIS_INBOX_TRIAGE_ENABLED;
  assert.equal(isInboxTriageEnabled(), false, "automatic inbox triage is opt-in by default");

  process.env.JARVIS_INBOX_TRIAGE_ENABLED = "true";
  assert.equal(isInboxTriageEnabled(), true, "true enables automatic inbox triage");

  process.env.JARVIS_INBOX_TRIAGE_ENABLED = "1";
  assert.equal(isInboxTriageEnabled(), true, "1 enables automatic inbox triage");

  process.env.JARVIS_INBOX_TRIAGE_ENABLED = "false";
  assert.equal(isInboxTriageEnabled(), false, "false keeps automatic inbox triage disabled");

  console.log("OK: inbox triage config is opt-in");
} finally {
  if (original === undefined) {
    delete process.env.JARVIS_INBOX_TRIAGE_ENABLED;
  } else {
    process.env.JARVIS_INBOX_TRIAGE_ENABLED = original;
  }
}
