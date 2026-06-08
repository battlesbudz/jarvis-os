export type RuntimeDiagnosticsRoute = "/api/runtime/dry-run" | "/api/runtime/read-only";
export type RuntimeDiagnosticsStatus = "idle" | "ready" | "approval" | "blocked" | "disabled";

export interface RuntimeDiagnosticToolDescriptor {
  name: string;
  provider?: string;
  requiredScopes?: string[];
  riskTier?: "T0" | "T1" | "T2" | "T3" | "T4" | "T5";
  approvalRequired?: boolean;
}

export interface RuntimeDiagnosticAuthSnapshot {
  connectedProviders?: string[];
  grantedScopes?: string[];
  unavailableProviders?: string[];
}

export interface RuntimeDiagnosticPolicySnapshot {
  blockedTools?: string[];
  approvalRequiredTools?: string[];
  maxAllowedRiskTier?: "T0" | "T1" | "T2" | "T3" | "T4" | "T5";
}

export interface RuntimeDiagnosticProbeBody {
  message: string;
  source: "app";
  channel: string;
  availableTools?: RuntimeDiagnosticToolDescriptor[];
  auth?: RuntimeDiagnosticAuthSnapshot;
  policy?: RuntimeDiagnosticPolicySnapshot;
}

export interface RuntimeDiagnosticProbe {
  id: "ready-auth" | "approval-tool" | "blocked-policy" | "readonly-owner";
  label: string;
  route: RuntimeDiagnosticsRoute;
  message: string;
  body: RuntimeDiagnosticProbeBody;
}

export type RuntimePreviewStatus = "ready" | "needs_approval" | "blocked" | "degraded" | string;

export interface RuntimePreviewReport {
  status: RuntimePreviewStatus;
  eventId: string;
  userId: string;
  intent: string;
  responseMode: string;
  riskTier: string;
  readyToolCount: number;
  blockedToolCount: number;
  approvalRequired: boolean;
  reasons: string[];
}

export interface RuntimeDiagnosticsResponse {
  ok?: boolean;
  previewOnly?: boolean;
  disabled?: boolean;
  reason?: string;
  eventId?: string;
  report?: RuntimePreviewReport;
  approvalPreview?: {
    approvalId: string;
    reason: string;
  } | null;
  formatted?: string;
  runtimeOwned?: boolean;
  routeOwner?: string;
  gateStatus?: string;
  runtimeWorkflowId?: string;
  execution?: {
    status?: string;
    executedToolCount?: number;
    response?: string;
  };
  decision?: {
    decisionId?: string;
    eventId?: string;
    userId?: string;
    intent?: string;
    responseMode?: string;
    riskTier?: string;
    approvalRequired?: boolean;
  };
}

export interface RuntimeDiagnosticRequest {
  route: RuntimeDiagnosticsRoute;
  body: RuntimeDiagnosticProbeBody;
}

export const RUNTIME_DIAGNOSTIC_PROBES: RuntimeDiagnosticProbe[] = [
  {
    id: "ready-auth",
    label: "Auth",
    route: "/api/runtime/dry-run",
    message: "What can you do?",
    body: {
      message: "What can you do?",
      source: "app",
      channel: "settings-runtime-preview",
      availableTools: [
        {
          name: "general_answer",
          provider: "runtime",
          requiredScopes: ["runtime.read"],
          riskTier: "T0",
          approvalRequired: false,
        },
      ],
      auth: {
        connectedProviders: ["runtime"],
        grantedScopes: ["runtime.read"],
      },
      policy: {
        maxAllowedRiskTier: "T2",
      },
    },
  },
  {
    id: "approval-tool",
    label: "Tool",
    route: "/api/runtime/dry-run",
    message: "Send an email to Bill.",
    body: {
      message: "Send an email to Bill.",
      source: "app",
      channel: "settings-runtime-preview",
      availableTools: [
        {
          name: "email_action",
          provider: "gmail",
          requiredScopes: ["gmail.send"],
          riskTier: "T4",
          approvalRequired: true,
        },
      ],
      auth: {
        connectedProviders: ["gmail"],
        grantedScopes: ["gmail.send"],
      },
      policy: {
        approvalRequiredTools: ["email_action"],
        maxAllowedRiskTier: "T4",
      },
    },
  },
  {
    id: "blocked-policy",
    label: "Policy",
    route: "/api/runtime/dry-run",
    message: "Send an email to Bill.",
    body: {
      message: "Send an email to Bill.",
      source: "app",
      channel: "settings-runtime-preview",
      availableTools: [
        {
          name: "approval_gated_action",
          provider: "gmail",
          requiredScopes: ["gmail.send"],
          riskTier: "T4",
          approvalRequired: false,
        },
      ],
      auth: {
        connectedProviders: ["gmail"],
        grantedScopes: ["gmail.send"],
      },
      policy: {
        blockedTools: ["approval_gated_action"],
      },
    },
  },
  {
    id: "readonly-owner",
    label: "Read-only",
    route: "/api/runtime/read-only",
    message: "What can you do?",
    body: {
      message: "What can you do?",
      source: "app",
      channel: "settings-runtime-readonly",
    },
  },
];

export function buildRuntimeDiagnosticRequest(
  probeId: RuntimeDiagnosticProbe["id"],
  messageOverride?: string,
): RuntimeDiagnosticRequest {
  const probe = RUNTIME_DIAGNOSTIC_PROBES.find((item) => item.id === probeId) ?? RUNTIME_DIAGNOSTIC_PROBES[0];
  const message = messageOverride?.trim() || probe.message;
  return {
    route: probe.route,
    body: {
      ...probe.body,
      message,
    },
  };
}

export function runtimeDiagnosticStatusFromResponse(
  response?: RuntimeDiagnosticsResponse,
  error?: string,
): RuntimeDiagnosticsStatus {
  if (!response && !error) return "idle";
  if (response?.disabled) return "disabled";
  if (response?.report?.status === "needs_approval" || response?.decision?.approvalRequired) return "approval";
  if (response?.report?.status === "blocked" || response?.gateStatus === "blocked") return "blocked";
  if (response?.runtimeOwned || response?.report?.status === "ready") return "ready";
  if (response?.report?.status === "degraded") return "approval";
  if (response?.ok === false && response?.gateStatus === "legacy_route_allowed") return "disabled";
  if (response?.ok === false) return "blocked";
  if (error) return /^409:/.test(error) ? "disabled" : "blocked";
  return "ready";
}

export function runtimeDiagnosticStatusLabel(status: RuntimeDiagnosticsStatus): string {
  if (status === "idle") return "Idle";
  if (status === "ready") return "Ready";
  if (status === "approval") return "Approval";
  if (status === "blocked") return "Blocked";
  return "Disabled";
}

export function summarizeRuntimeDiagnosticResponse(
  response?: RuntimeDiagnosticsResponse,
  error?: string,
): string {
  if (error) return error;
  if (!response) return "No preview yet";
  if (response.disabled) return response.reason ?? "Runtime disabled";
  if (response.report) {
    return `${response.report.intent} / ${response.report.riskTier} / ${response.report.readyToolCount} ready / ${response.report.blockedToolCount} blocked`;
  }
  if (response.runtimeOwned || response.runtimeWorkflowId) {
    const owner = response.routeOwner ?? "route";
    const workflow = response.runtimeWorkflowId ?? "runtime";
    const risk = response.decision?.riskTier ? ` / ${response.decision.riskTier}` : "";
    return `${workflow} / ${owner}${risk}`;
  }
  if (response.reason) return response.reason;
  return "Runtime response received";
}
