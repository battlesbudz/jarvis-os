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
  insightsSource.includes("event.confirmationToken") &&
    insightsSource.includes("message.pendingConfirm?.token === confirmationToken"),
  "outside-app overlay approval events should target pending confirmations by token",
);
assert.ok(
  insightsSource.includes("pendingData.clearPendingConfirmationToken") &&
    insightsSource.includes("message.pendingConfirm?.token !== clearToken") &&
    insightsSource.includes("pendingConfirm: undefined"),
  "server-handled overlay approvals should clear matching saved confirmation cards on app resume",
);
assert.ok(
  insightsSource.includes("const refreshPendingCoachResponse = useCallback") &&
    insightsSource.includes("initialLoadCompleteRef.current = true") &&
    insightsSource.includes("if (initialLoadCompleteRef.current)") &&
    insightsSource.includes("await refreshPendingCoachResponse()") &&
    insightsSource.includes("refreshPendingCoachResponse().catch(() => {})"),
  "pending approval outcomes should refresh during initial load and foreground focus after history is loaded",
);
assert.ok(
  insightsSource.includes("confirmActionRef.current(pendingVoiceConfirmMessage.id, approved"),
  "foreground overlay approval events should execute the pending confirmation handler",
);
assert.ok(
  insightsSource.includes("/api/coach/ack-voice-approval") &&
    insightsSource.includes("pendingVoiceConfirmMessage.pendingConfirm.token"),
  "foreground overlay approval events should acknowledge handled tokens before executing",
);
assert.ok(
  insightsSource.includes("voiceConfirmationExecuting || isTranscribing || isStreaming || isWorkingOnPhone"),
  "outside-app overlay should stay in a working state while confirmed actions execute",
);
assert.ok(
  insightsSource.includes("voiceConfirmationExecutingRef.current"),
  "delayed Talk Mode recording starts should stay blocked while confirmed actions execute",
);
assert.ok(
  insightsSource.includes("setVoiceConfirmationExecutionState(true)") &&
    insightsSource.includes("setVoiceConfirmationExecutionState(false)"),
  "confirmed actions should explicitly mark confirmation execution as started and finished",
);
assert.ok(
  insightsSource.includes("Approve phone action?") &&
    insightsSource.includes("preview.to") &&
    insightsSource.includes("preview.message") &&
    insightsSource.includes("preview.replyText") &&
    insightsSource.includes("preview.notificationKey") &&
    insightsSource.includes("preview.durationMs") &&
    insightsSource.includes("preview.text") &&
    insightsSource.includes("preview.reason") &&
    insightsSource.includes("preview.request"),
  "Android confirmation cards should show phone action details before approval",
);
assert.ok(
  insightsSource.includes("setAndroidOutsideAppVoiceApproval(approvalPrompt, pendingConfirm.token)") &&
    insightsSource.includes("setAndroidOutsideAppVoiceApproval(voiceApprovalPrompt, voiceApprovalToken ?? '')"),
  "voice-mode high-risk confirmations should push the approval prompt and token to the native overlay",
);
assert.match(
  insightsSource,
  /if \(!talkModeEnabled\) \{\s*outsideAppVoiceStateRef\.current = null;\s*nativeVoiceStateSyncHeldRef\.current = false;\s*setVoiceApprovalPrompt\(null\);\s*setVoiceApprovalToken\(null\);\s*return;\s*\}/,
  "turning off Talk Mode should clear both stale voice approval prompt and token",
);
assert.ok(
  insightsSource.includes("speakTextRef.current(approvalPrompt, assistantId)"),
  "voice-mode high-risk confirmations should be spoken",
);

console.log("OK: app voice approval gates bridge overlay approval into pending confirmations");
