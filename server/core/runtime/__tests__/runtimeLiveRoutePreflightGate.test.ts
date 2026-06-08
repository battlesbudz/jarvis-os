import assert from "node:assert/strict";
import { preflightRuntimeLiveRoute } from "../index";

const now = new Date("2026-06-08T16:00:00.000Z");

function event(message: string, eventId = "event-live-gate") {
  return {
    eventId,
    source: "app",
    userId: "user-live-gate",
    message,
    createdAt: now.toISOString(),
  };
}

{
  const gate = preflightRuntimeLiveRoute(
    { event: event("What can you do?"), now },
    {},
  );

  assert.equal(gate.status, "runtime_disabled");
  assert.equal(gate.routeOwner, "legacy_route");
  assert.equal(gate.shouldUseRuntime, false);
  assert.equal(gate.shouldContinueLegacy, true);
  assert.equal(gate.runtime, null);
  console.log("OK: Runtime live-route preflight stays disabled unless live execution is explicit");
}

{
  const gate = preflightRuntimeLiveRoute(
    { event: event("What can you do?", "event-live-readonly"), now },
    { JARVIS_RUNTIME_LIVE_EXECUTION: "1" },
  );

  assert.equal(gate.status, "runtime_readonly_allowed");
  assert.equal(gate.routeOwner, "core_runtime");
  assert.equal(gate.shouldUseRuntime, true);
  assert.equal(gate.shouldContinueLegacy, false);
  assert.equal(gate.runtime?.execution.status, "completed");
  assert.equal(gate.runtime?.execution.executedToolCount, 0);
  console.log("OK: Runtime live-route preflight allows read-only runtime ownership");
}

{
  const gate = preflightRuntimeLiveRoute(
    { event: event("Send an email to Bill.", "event-live-email"), now },
    { JARVIS_RUNTIME_LIVE_EXECUTION: "true" },
  );

  assert.equal(gate.status, "legacy_route_allowed");
  assert.equal(gate.routeOwner, "legacy_route");
  assert.equal(gate.shouldUseRuntime, false);
  assert.equal(gate.shouldContinueLegacy, true);
  assert.equal(gate.runtime?.decision.approval.required, true);
  assert.equal(gate.runtime?.execution.status, "declined");
  console.log("OK: Runtime live-route preflight leaves approval-required work with legacy routes");
}

{
  const gate = preflightRuntimeLiveRoute(
    {
      event: {
        source: "app",
        message: "Missing required user and event identifiers.",
        createdAt: now.toISOString(),
      },
      now,
    },
    { JARVIS_RUNTIME_LIVE_EXECUTION: "1" },
  );

  assert.equal(gate.status, "blocked");
  assert.equal(gate.routeOwner, "core_runtime");
  assert.equal(gate.shouldUseRuntime, false);
  assert.equal(gate.shouldContinueLegacy, false);
  assert.equal(gate.runtime?.execution.status, "blocked");
  console.log("OK: Runtime live-route preflight blocks invalid runtime events");
}

console.log("\nAll Runtime Live Route Preflight Gate assertions passed.");
