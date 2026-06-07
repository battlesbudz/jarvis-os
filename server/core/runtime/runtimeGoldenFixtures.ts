import type { RuntimePreviewStatus } from "./runtimePreviewReport";

export interface RuntimeGoldenDryRunFixture {
  id: string;
  message: string;
  expectedIntent: string;
  expectedStatus: RuntimePreviewStatus;
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
  },
  {
    id: "research-queue",
    message: "Research the latest cannabis licensing updates.",
    expectedIntent: "research",
    expectedStatus: "ready",
  },
];
