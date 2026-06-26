export type RuntimeExplanationSeverity = "info" | "warning" | "error";
export type RuntimeSourceLabel = "MemoryOS" | "Soul" | "Tool" | "Connector" | "Diagnostics";
export type RuntimeSourceRole = "used" | "attempted";

export interface RuntimeExplanationAction {
  id: string;
  label: string;
  kind?: "retry" | "open_settings" | "review" | "dismiss" | "custom";
}

export interface RuntimeExplanationSource {
  label: RuntimeSourceLabel;
  detail?: string;
}

export interface RuntimeExplanation {
  title: string;
  message: string;
  severity: RuntimeExplanationSeverity;
  actions: RuntimeExplanationAction[];
  sources: {
    used: RuntimeExplanationSource[];
    attempted: RuntimeExplanationSource[];
  };
  deterministic: true;
}

export function runtimeSource(label: RuntimeSourceLabel, detail?: string): RuntimeExplanationSource {
  return detail?.trim() ? { label, detail: detail.trim() } : { label };
}

function uniqueSources(sources: RuntimeExplanationSource[]): RuntimeExplanationSource[] {
  const seen = new Set<string>();
  const unique: RuntimeExplanationSource[] = [];
  for (const source of sources) {
    const key = `${source.label}:${source.detail ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(source);
  }
  return unique;
}

export function createRuntimeExplanation(input: {
  title: string;
  message: string;
  severity?: RuntimeExplanationSeverity;
  actions?: RuntimeExplanationAction[];
  usedSources?: RuntimeExplanationSource[];
  attemptedSources?: RuntimeExplanationSource[];
}): RuntimeExplanation {
  return {
    title: input.title,
    message: input.message,
    severity: input.severity ?? "info",
    actions: input.actions ?? [],
    sources: {
      used: uniqueSources(input.usedSources ?? []),
      attempted: uniqueSources(input.attemptedSources ?? []),
    },
    deterministic: true,
  };
}

function sourceLabels(sources: RuntimeExplanationSource[]): string {
  return Array.from(new Set(sources.map((source) => source.label))).join(", ");
}

export function renderRuntimeExplanationSources(explanation: RuntimeExplanation): string {
  const parts: string[] = [];
  if (explanation.sources.used.length > 0) {
    parts.push(`Sources: ${sourceLabels(explanation.sources.used)}.`);
  }
  if (explanation.sources.attempted.length > 0) {
    parts.push(`Attempted: ${sourceLabels(explanation.sources.attempted)}.`);
  }
  return parts.join(" ");
}

export function renderRuntimeExplanation(explanation: RuntimeExplanation): string {
  const sources = renderRuntimeExplanationSources(explanation);
  return sources ? `${explanation.message}\n\n${sources}` : explanation.message;
}

export function runtimeToolFailureExplanation(input: {
  title?: string;
  toolLabel: string;
  reason: string;
  actionLabel?: string;
  actionId?: string;
  actionKind?: RuntimeExplanationAction["kind"];
  attemptedSources?: RuntimeExplanationSource[];
}): RuntimeExplanation {
  return createRuntimeExplanation({
    title: input.title ?? "Tool unavailable",
    message: `${input.toolLabel} could not run: ${input.reason}`,
    severity: "error",
    attemptedSources: input.attemptedSources ?? [runtimeSource("Tool", input.toolLabel)],
    actions: input.actionLabel
      ? [{ id: input.actionId ?? "retry_tool", label: input.actionLabel, kind: input.actionKind ?? "retry" }]
      : [],
  });
}

export function runtimeDeterministicFallbackExplanation(input: {
  title: string;
  message: string;
  attempted?: RuntimeSourceLabel[];
}): RuntimeExplanation {
  return createRuntimeExplanation({
    title: input.title,
    message: input.message,
    severity: "warning",
    attemptedSources: (input.attempted ?? ["Diagnostics"]).map((label) => runtimeSource(label)),
  });
}
