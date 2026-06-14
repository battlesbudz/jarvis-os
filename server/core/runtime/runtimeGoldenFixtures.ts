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
  expectedRuntimeOwner?: "core_runtime" | "existing_jarvis";
}

export const RUNTIME_GOLDEN_DRY_RUN_FIXTURES: RuntimeGoldenDryRunFixture[] = [
  {
    id: "plan-day-calendar-goals",
    message: "Plan my day around my calendar and my top goals.",
    expectedIntent: "daily_planning",
    expectedStatus: "ready",
    expectedResponseMode: "answer",
    expectedGateOutcome: "tool_candidate",
  },
  {
    id: "general-answer",
    message: "What can you do?",
    expectedIntent: "general",
    expectedStatus: "ready",
    expectedRuntimeOwner: "core_runtime",
  },
  {
    id: "memory-lookup",
    message: "What memory do you have about morning planning?",
    expectedIntent: "memory_query",
    expectedStatus: "ready",
    expectedRuntimeOwner: "core_runtime",
  },
  {
    id: "memory-provenance-lookup",
    message: "What memory provenance do you have about what I said about morning planning before?",
    expectedIntent: "memory_query",
    expectedStatus: "ready",
    expectedResponseMode: "answer",
    expectedGateOutcome: "inline_answer",
    expectedApprovalRequired: false,
  },
  {
    id: "email-draft-reply",
    message: "Draft a reply to this email.",
    expectedIntent: "email_draft",
    expectedStatus: "ready",
    expectedResponseMode: "answer",
    expectedGateOutcome: "inline_answer",
    expectedApprovalRequired: false,
    expectedRuntimeOwner: "core_runtime",
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
  {
    id: "goal-project-tree",
    message: "Turn this goal into a project tree.",
    expectedIntent: "general",
    expectedStatus: "ready",
    expectedResponseMode: "answer",
    expectedGateOutcome: "inline_answer",
  },
  {
    id: "goal-task-daily-plan",
    message: "Move the next task from this goal into today's plan.",
    expectedIntent: "daily_planning",
    expectedStatus: "ready",
    expectedResponseMode: "answer",
    expectedGateOutcome: "tool_candidate",
  },
  {
    id: "weekly-review",
    message: "Prepare my weekly review.",
    expectedIntent: "general",
    expectedStatus: "ready",
    expectedResponseMode: "answer",
    expectedGateOutcome: "inline_answer",
  },
  {
    id: "next-meeting-brief",
    message: "Prepare me for my next meeting.",
    expectedIntent: "calendar_query",
    expectedStatus: "ready",
    expectedResponseMode: "answer",
    expectedGateOutcome: "inline_answer",
    expectedApprovalRequired: false,
    expectedRuntimeOwner: "core_runtime",
  },
  {
    id: "diagnose-feature-failure",
    message: "Diagnose why daily plan generation failed.",
    expectedIntent: "daily_planning",
    expectedStatus: "ready",
    expectedResponseMode: "answer",
    expectedGateOutcome: "tool_candidate",
  },
];
