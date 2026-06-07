import type { Express, Request, Response } from "express";
import {
  formatRuntimePreview,
  jarvisEventFromMessage,
  tryRunRuntimeDryRun,
} from "../core/runtime";
import type { JarvisEvent, RuntimeRiskTier } from "../core/protocol";
import type {
  ToolGatewayAuthSnapshot,
  ToolGatewayPolicy,
  ToolGatewayToolDescriptor,
} from "../core/tools";

const EVENT_SOURCES = new Set<JarvisEvent["source"]>([
  "app",
  "telegram",
  "discord",
  "slack",
  "whatsapp",
  "webchat",
  "daemon",
  "job",
  "system",
  "unknown",
]);
const RISK_TIERS = new Set<RuntimeRiskTier>(["T0", "T1", "T2", "T3", "T4", "T5"]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function boolValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function riskTier(value: unknown): RuntimeRiskTier | undefined {
  return typeof value === "string" && RISK_TIERS.has(value as RuntimeRiskTier)
    ? value as RuntimeRiskTier
    : undefined;
}

function eventSource(value: unknown): JarvisEvent["source"] {
  return typeof value === "string" && EVENT_SOURCES.has(value as JarvisEvent["source"])
    ? value as JarvisEvent["source"]
    : "app";
}

function toolDescriptors(value: unknown): ToolGatewayToolDescriptor[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const name = optionalString(record.name);
    if (!name) return [];

    return [{
      name,
      provider: optionalString(record.provider),
      requiredScopes: stringArray(record.requiredScopes),
      riskTier: riskTier(record.riskTier),
      approvalRequired: boolValue(record.approvalRequired),
    }];
  });
}

function authSnapshot(value: unknown): ToolGatewayAuthSnapshot | undefined {
  const record = asRecord(value);
  const auth: ToolGatewayAuthSnapshot = {
    connectedProviders: stringArray(record.connectedProviders),
    grantedScopes: stringArray(record.grantedScopes),
    unavailableProviders: stringArray(record.unavailableProviders),
  };
  return Object.values(auth).some((item) => item !== undefined) ? auth : undefined;
}

function policySnapshot(value: unknown): ToolGatewayPolicy | undefined {
  const record = asRecord(value);
  const policy: ToolGatewayPolicy = {
    blockedTools: stringArray(record.blockedTools),
    approvalRequiredTools: stringArray(record.approvalRequiredTools),
    maxAllowedRiskTier: riskTier(record.maxAllowedRiskTier),
  };
  return Object.values(policy).some((item) => item !== undefined) ? policy : undefined;
}

function isInputError(error: unknown): boolean {
  return error instanceof Error && (
    error.name === "ZodError" ||
    error.message.includes("Invalid") ||
    error.message.includes("Too small")
  );
}

export function registerRuntimeDiagnosticsRoutes(app: Express): void {
  app.post("/api/runtime/dry-run", (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });

    const body = asRecord(req.body);
    const message = optionalString(body.message ?? body.userRequest ?? body.prompt);
    if (!message) return res.status(400).json({ error: "message is required" });

    try {
      const event = jarvisEventFromMessage({
        eventId: optionalString(body.eventId),
        source: eventSource(body.source),
        userId,
        message,
        channel: optionalString(body.channel) ?? "runtime-diagnostics",
        createdAt: optionalString(body.createdAt),
        metadata: asRecord(body.metadata),
      });
      const result = tryRunRuntimeDryRun({
        event,
        now: new Date(event.createdAt),
        availableTools: toolDescriptors(body.availableTools),
        auth: authSnapshot(body.auth),
        policy: policySnapshot(body.policy),
      }, process.env);

      if ("disabled" in result) {
        return res.json({
          ok: true,
          previewOnly: true,
          disabled: true,
          reason: result.reason,
        });
      }

      return res.json({
        ok: true,
        previewOnly: true,
        disabled: false,
        eventId: result.report.eventId,
        report: result.report,
        approvalPreview: result.approvalPreview,
        formatted: formatRuntimePreview(result),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("live execution is not supported")) {
        return res.status(409).json({ error: message });
      }
      if (isInputError(error)) {
        return res.status(400).json({ error: "Invalid runtime dry-run request", detail: message });
      }

      console.error("[runtime-diagnostics] dry run failed:", error);
      return res.status(500).json({ error: "Runtime dry run failed" });
    }
  });
}
