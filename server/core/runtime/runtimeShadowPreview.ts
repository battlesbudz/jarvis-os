import type { JarvisEvent, RuntimeDecision } from "../protocol";
import {
  assertRuntimeLiveExecutionDisabled,
  getRuntimeFeatureFlags,
  type RuntimeFeatureFlagEnv,
} from "./runtimeFeatureFlags";
import { jarvisEventFromMessage } from "./runtimeEventAdapter";
import { runRuntimeEvent } from "./runRuntimeEvent";

export interface RuntimeShadowPreviewInput {
  userId?: string | null;
  message?: string | null;
  channel?: string | null;
  now?: Date;
  env?: RuntimeFeatureFlagEnv;
}

export interface RuntimeShadowPreviewDisabled {
  enabled: false;
  reason: string;
}

export interface RuntimeShadowPreviewReady {
  enabled: true;
  previewOnly: true;
  event: JarvisEvent;
  decision: RuntimeDecision;
  summary: {
    eventId: string;
    intent: string;
    responseMode: RuntimeDecision["responseMode"];
    riskTier: RuntimeDecision["riskTier"];
    approvalRequired: boolean;
    routeChosen?: string;
  };
  formatted: string;
}

export interface RuntimeShadowPreviewFailed {
  enabled: true;
  previewOnly: true;
  error: string;
}

export type RuntimeShadowPreviewResult =
  | RuntimeShadowPreviewDisabled
  | RuntimeShadowPreviewReady
  | RuntimeShadowPreviewFailed;

function sourceFromChannel(channel: string | null | undefined): JarvisEvent["source"] {
  const normalized = (channel ?? "").trim().toLowerCase();
  if (normalized === "webchat") return "webchat";
  if (normalized === "telegram") return "telegram";
  if (normalized === "discord") return "discord";
  if (normalized === "slack") return "slack";
  if (normalized === "whatsapp") return "whatsapp";
  if (normalized.includes("daemon")) return "daemon";
  return "app";
}

export function formatRuntimeShadowPreviewSummary(result: RuntimeShadowPreviewResult): string {
  if (!result.enabled) {
    return `runtime_shadow disabled: ${result.reason}`;
  }
  if ("error" in result) {
    return `runtime_shadow failed: ${result.error}`;
  }
  return [
    "runtime_shadow preview",
    `event=${result.summary.eventId}`,
    `intent=${result.summary.intent}`,
    `response=${result.summary.responseMode}`,
    `risk=${result.summary.riskTier}`,
    `approval=${result.summary.approvalRequired ? "required" : "not_required"}`,
    result.summary.routeChosen ? `route=${result.summary.routeChosen}` : null,
  ].filter(Boolean).join(" ");
}

export async function previewRuntimeShadowForMessage(input: RuntimeShadowPreviewInput): Promise<RuntimeShadowPreviewResult> {
  const flags = getRuntimeFeatureFlags(input.env);
  try {
    assertRuntimeLiveExecutionDisabled(flags);
  } catch (error) {
    return {
      enabled: true,
      previewOnly: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (!flags.previewEnabled && !flags.dryRunEnabled) {
    return {
      enabled: false,
      reason: "Runtime shadow preview is disabled. Set JARVIS_RUNTIME_PREVIEW=1 to observe live-route decisions.",
    };
  }

  const userId = input.userId?.trim();
  const message = input.message?.trim();
  if (!userId || !message) {
    return {
      enabled: false,
      reason: "Runtime shadow preview requires an authenticated user and non-empty message.",
    };
  }

  try {
    const event = jarvisEventFromMessage({
      source: sourceFromChannel(input.channel),
      userId,
      message,
      channel: input.channel?.trim() || "appchat",
      createdAt: input.now?.toISOString(),
      metadata: {
        previewOnly: true,
        shadowRoute: "/api/coach/chat",
      },
    });
    const decision = await runRuntimeEvent(event, { now: input.now });
    const ready: RuntimeShadowPreviewReady = {
      enabled: true,
      previewOnly: true,
      event,
      decision,
      summary: {
        eventId: event.eventId,
        intent: decision.intent,
        responseMode: decision.responseMode,
        riskTier: decision.riskTier,
        approvalRequired: decision.approval.required,
        routeChosen: decision.trace.routeChosen,
      },
      formatted: "",
    };
    ready.formatted = formatRuntimeShadowPreviewSummary(ready);
    return ready;
  } catch (error) {
    return {
      enabled: true,
      previewOnly: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
