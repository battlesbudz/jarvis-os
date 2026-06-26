import assert from "node:assert/strict";

import {
  createRuntimeExplanation,
  renderRuntimeExplanation,
  renderRuntimeExplanationSources,
  runtimeDeterministicFallbackExplanation,
  runtimeSource,
  runtimeToolFailureExplanation,
} from "../runtimeExplanation";

{
  const explanation = createRuntimeExplanation({
    title: "Memory answer",
    message: "Here are the exact records.",
    usedSources: [
      runtimeSource("Soul", "profile-store"),
      runtimeSource("MemoryOS", "mem-1"),
      runtimeSource("Soul", "soul-file"),
      runtimeSource("MemoryOS", "mem-1"),
    ],
    attemptedSources: [runtimeSource("Tool", "memory_search")],
  });

  assert.equal(explanation.deterministic, true);
  assert.equal(explanation.severity, "info");
  assert.deepEqual(explanation.sources.used.map((source) => source.label), ["Soul", "MemoryOS", "Soul"]);
  assert.deepEqual(explanation.sources.attempted.map((source) => source.label), ["Tool"]);
  assert.equal(renderRuntimeExplanationSources(explanation), "Sources: Soul, MemoryOS. Attempted: Tool.");
  assert.equal(
    renderRuntimeExplanation(explanation),
    "Here are the exact records.\n\nSources: Soul, MemoryOS. Attempted: Tool.",
  );
}

{
  const explanation = createRuntimeExplanation({
    title: "Plain deterministic answer",
    message: "No source was needed.",
  });

  assert.equal(renderRuntimeExplanationSources(explanation), "");
  assert.equal(renderRuntimeExplanation(explanation), "No source was needed.");
}

{
  const explanation = createRuntimeExplanation({
    title: "Detailed metadata",
    message: "Multiple memory records contributed.",
    usedSources: [runtimeSource("MemoryOS", "mem-1"), runtimeSource("MemoryOS", "mem-2")],
  });

  assert.equal(explanation.sources.used.length, 2);
  assert.equal(renderRuntimeExplanationSources(explanation), "Sources: MemoryOS.");
}

{
  const explanation = runtimeToolFailureExplanation({
    toolLabel: "android_capture_screen",
    reason: "Android accessibility service is disabled.",
    actionLabel: "Try again",
  });

  assert.equal(explanation.title, "Tool unavailable");
  assert.equal(explanation.severity, "error");
  assert.equal(explanation.actions[0]?.id, "retry_tool");
  assert.deepEqual(explanation.sources.used, []);
  assert.deepEqual(explanation.sources.attempted.map((source) => source.label), ["Tool"]);
  assert.match(renderRuntimeExplanation(explanation), /Attempted: Tool\./);
}

{
  const explanation = runtimeDeterministicFallbackExplanation({
    title: "Runtime fallback",
    message: "Jarvis could not verify that state.",
  });

  assert.equal(explanation.severity, "warning");
  assert.deepEqual(explanation.sources.attempted.map((source) => source.label), ["Diagnostics"]);
  assert.equal(
    renderRuntimeExplanation(explanation),
    "Jarvis could not verify that state.\n\nAttempted: Diagnostics.",
  );
}

console.log("OK: runtime explanations render compact deterministic sources");
