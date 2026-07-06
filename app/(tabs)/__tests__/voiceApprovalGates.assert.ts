import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../../..");
const insightsSource = fs.readFileSync(path.join(repoRoot, "app/(tabs)/insights.tsx"), "utf8");

assert.ok(
  insightsSource.includes("action === 'approval_approve' || action === 'approval_deny'"),
  "outside-app overlay approval events should be handled by the app listener",
);
assert.ok(
  insightsSource.includes("confirmActionRef.current(pendingVoiceConfirmMessage.id, approved"),
  "overlay approval events should execute the pending confirmation handler",
);
assert.ok(
  insightsSource.includes("voiceConfirmationExecuting || isTranscribing || isStreaming || isWorkingOnPhone"),
  "outside-app overlay should stay in a working state while confirmed actions execute",
);
assert.ok(
  insightsSource.includes("setVoiceConfirmationExecutionState(true)") &&
    insightsSource.includes("setVoiceConfirmationExecutionState(false)"),
  "confirmed actions should explicitly mark confirmation execution as started and finished",
);
assert.ok(
  insightsSource.includes("setAndroidOutsideAppVoiceApproval(approvalPrompt)"),
  "voice-mode high-risk confirmations should push the approval prompt to the native overlay",
);
assert.ok(
  insightsSource.includes("speakTextRef.current(approvalPrompt, assistantId)"),
  "voice-mode high-risk confirmations should be spoken",
);

console.log("OK: app voice approval gates bridge overlay approval into pending confirmations");
