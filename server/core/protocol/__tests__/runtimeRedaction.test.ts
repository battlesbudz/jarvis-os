import assert from "node:assert/strict";
import { parseRuntimeDecision, redactRuntimeDecision, redactRuntimeValue } from "../index";

{
  const redacted = redactRuntimeValue({
    query: "morning planning",
    accessToken: "secret-token",
    nested: {
      api_key: "secret-key",
      safe: "visible",
      cookies: [{ session: "secret-session" }],
      clientSecret: "secret-client",
      sessionId: "secret-session-id",
      auth: "Bearer secret",
    },
    token: "secret-token-short",
  });

  assert.deepEqual(redacted, {
    query: "morning planning",
    accessToken: "[redacted]",
    nested: {
      api_key: "[redacted]",
      safe: "visible",
      cookies: "[redacted]",
      clientSecret: "[redacted]",
      sessionId: "[redacted]",
      auth: "[redacted]",
    },
    token: "[redacted]",
  });
  console.log("OK: Runtime redaction recursively redacts sensitive keys");
}

{
  const decision = parseRuntimeDecision({
    decisionId: "decision-redaction",
    eventId: "event-redaction",
    userId: "user-1",
    intent: "memory_query",
    confidence: 0.9,
    riskTier: "T0",
    responseMode: "answer",
    tools: [
      {
        toolName: "memory_search",
        status: "executed",
        riskTier: "T0",
        approvalRequired: false,
        argsPreview: {
          query: "morning planning",
          authorization: "Bearer secret",
        },
      },
    ],
    approval: {
      required: false,
      status: "not_required",
    },
    modelRoute: {
      provider: "runtime-test",
      model: "deterministic",
      reason: "Redaction test.",
    },
    trace: {
      traceId: "trace-redaction",
      source: "runtime",
    },
    createdAt: "2026-06-08T13:00:00.000Z",
  });

  const redacted = redactRuntimeDecision(decision);

  assert.equal((decision.tools[0]?.argsPreview as { authorization?: string }).authorization, "Bearer secret");
  assert.equal((redacted.tools[0]?.argsPreview as { authorization?: string }).authorization, "[redacted]");
  assert.equal((redacted.tools[0]?.argsPreview as { query?: string }).query, "morning planning");
  console.log("OK: Runtime redaction sanitizes decision tool args without mutating source");
}

console.log("\nAll Runtime redaction assertions passed.");
