import type { JarvisEvent, RuntimeDecision } from "../protocol";
import type { RuntimeGateOutcome } from "./runtimeTypes";
import type { RuntimePreviewStatus } from "./runtimePreviewReport";

export interface RuntimeGoldenDryRunFixture {
  id: string;
  message: string;
  source?: JarvisEvent["source"];
  channel?: string;
  metadata?: Record<string, unknown>;
  expectedIntent: string;
  expectedStatus: RuntimePreviewStatus;
  expectedResponseMode?: RuntimeDecision["responseMode"];
  expectedGateOutcome?: RuntimeGateOutcome;
  expectedApprovalRequired?: boolean;
}

export const RUNTIME_GOLDEN_DRY_RUN_FIXTURES: RuntimeGoldenDryRunFixture[] = [
  {
    id: "general-answer",
    message: "What can you do?",
    expectedIntent: "general",
    expectedStatus: "ready",
  },
  {
    id: "memory-lookup",
    message: "What memory do you have about morning planning?",
    expectedIntent: "memory_query",
    expectedStatus: "ready",
  },
  {
    id: "email-approval",
    message: "Send this email to Bill.",
    expectedIntent: "email_action",
    expectedStatus: "needs_approval",
    expectedResponseMode: "approval_required",
    expectedGateOutcome: "needs_approval",
    expectedApprovalRequired: true,
  },
  {
    id: "diagnostics-route-approval-preview",
    message: "Send this email to Bill.",
    source: "app",
    channel: "settings-runtime-preview",
    metadata: {
      route: "/api/runtime/dry-run",
      token: "should-not-leak",
    },
    expectedIntent: "email_action",
    expectedStatus: "needs_approval",
    expectedResponseMode: "approval_required",
    expectedGateOutcome: "needs_approval",
    expectedApprovalRequired: true,
  },
  {
    id: "research-queue",
    message: "Research the latest cannabis licensing updates.",
    expectedIntent: "research",
    expectedStatus: "ready",
    expectedResponseMode: "queue",
    expectedGateOutcome: "queue_job",
  },
];
