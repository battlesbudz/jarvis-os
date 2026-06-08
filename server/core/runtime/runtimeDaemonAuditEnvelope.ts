import { createHash } from "node:crypto";
import { JarvisEventSchema, redactRuntimeValue, type RuntimeRiskTier } from "../protocol";

export type RuntimeDaemonSurface = "desktop" | "android" | "browser" | "unknown";
export type RuntimeDaemonAuditStatus = "preflight" | "needs_approval" | "blocked" | "executed" | "failed";

export interface RuntimeDaemonAuditEnvelopeInput {
  event: unknown;
  toolName: string;
  surface?: RuntimeDaemonSurface;
  argsPreview?: unknown;
  resultPreview?: unknown;
  status?: RuntimeDaemonAuditStatus;
  approvalRequired?: boolean;
  riskTier?: RuntimeRiskTier;
  policyReasons?: string[];
  createdAt?: string;
}

export interface RuntimeDaemonAuditPreview {
  present: boolean;
  topLevelKeys: string[];
  fingerprint: string | null;
}

export interface RuntimeDaemonAuditEnvelope {
  auditId: string;
  eventId: string;
  userId: string;
  toolName: string;
  surface: RuntimeDaemonSurface;
  status: RuntimeDaemonAuditStatus;
  riskTier: RuntimeRiskTier;
  approvalRequired: boolean;
  args: RuntimeDaemonAuditPreview;
  result: RuntimeDaemonAuditPreview;
  policyReasons: string[];
  rawPayloadStored: false;
  createdAt: string;
}

export interface PersistRuntimeDaemonAuditDeps {
  writeEnvelope?: (envelope: RuntimeDaemonAuditEnvelope) => Promise<void> | void;
}

export interface PersistRuntimeDaemonAuditResult {
  persisted: boolean;
  envelope: RuntimeDaemonAuditEnvelope;
  reason: string;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (!value || typeof value !== "object") {
    return JSON.stringify(value);
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`).join(",")}}`;
}

function topLevelKeys(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value as Record<string, unknown>).sort();
}

function fingerprint(value: unknown): string | null {
  if (value === undefined) return null;
  const redacted = redactRuntimeValue(value);
  return createHash("sha256").update(stableStringify(redacted)).digest("hex");
}

function auditPreview(value: unknown): RuntimeDaemonAuditPreview {
  return {
    present: value !== undefined,
    topLevelKeys: topLevelKeys(value),
    fingerprint: fingerprint(value),
  };
}

function inferSurface(toolName: string, surface: RuntimeDaemonSurface | undefined): RuntimeDaemonSurface {
  if (surface) return surface;
  const normalized = toolName.toLowerCase();
  if (normalized.includes("android")) return "android";
  if (normalized.includes("browser")) return "browser";
  if (normalized.includes("daemon") || normalized.includes("shell")) return "desktop";
  return "unknown";
}

function inferRisk(toolName: string, surface: RuntimeDaemonSurface, approvalRequired: boolean): RuntimeRiskTier {
  const normalized = toolName.toLowerCase();
  if (approvalRequired || normalized.includes("shell") || normalized.includes("tap") || normalized.includes("type")) return "T3";
  if (normalized.includes("status") || normalized.includes("read") || normalized.includes("screenshot")) return "T1";
  if (surface === "unknown") return "T1";
  return "T2";
}

export function buildRuntimeDaemonAuditEnvelope(input: RuntimeDaemonAuditEnvelopeInput): RuntimeDaemonAuditEnvelope {
  const event = JarvisEventSchema.parse(input.event);
  const surface = inferSurface(input.toolName, input.surface);
  const approvalRequired = input.approvalRequired ?? input.status === "needs_approval";
  const riskTier = input.riskTier ?? inferRisk(input.toolName, surface, approvalRequired);
  const status = input.status ?? (approvalRequired ? "needs_approval" : "preflight");

  return {
    auditId: `runtime-daemon-audit-${event.eventId}-${input.toolName}`,
    eventId: event.eventId,
    userId: event.userId,
    toolName: input.toolName,
    surface,
    status,
    riskTier,
    approvalRequired: approvalRequired || riskTier === "T3",
    args: auditPreview(input.argsPreview),
    result: auditPreview(input.resultPreview),
    policyReasons:
      input.policyReasons && input.policyReasons.length > 0
        ? input.policyReasons
        : ["Daemon audit envelope stores payload fingerprints only; raw args and daemon output stay with the existing owner."],
    rawPayloadStored: false,
    createdAt: input.createdAt ?? event.createdAt,
  };
}

export async function persistRuntimeDaemonAuditEnvelope(
  envelope: RuntimeDaemonAuditEnvelope,
  deps: PersistRuntimeDaemonAuditDeps = {},
): Promise<PersistRuntimeDaemonAuditResult> {
  if (!deps.writeEnvelope) {
    return {
      persisted: false,
      envelope,
      reason: "No runtime daemon audit writer configured.",
    };
  }

  await deps.writeEnvelope(envelope);
  return {
    persisted: true,
    envelope,
    reason: "Runtime daemon audit writer accepted envelope.",
  };
}
