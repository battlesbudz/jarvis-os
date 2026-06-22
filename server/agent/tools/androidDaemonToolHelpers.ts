import { sendDaemonOp } from "../../daemon/bridge";

type AndroidTextInputFallbackResult = {
  methodUsed: string | null;
  inputOk: boolean;
  daemonVerified: boolean;
  fieldText: string | null;
};

export async function runAndroidTextInputFallback(
  userId: string,
  text: string,
  fieldDescription: string,
  steps: string[],
): Promise<AndroidTextInputFallbackResult> {
  let methodUsed: string | null = null;
  let inputOk = false;
  let daemonVerified = false;
  let fieldText: string | null = null;

  steps.push("Level 1 - android_type (accessibility ACTION_SET_TEXT)...");
  const typeResult = await sendDaemonOp(userId, { type: "android_type", text }, 10000);
  if (typeResult.ok) {
    methodUsed = "android_type";
    inputOk = true;
    steps.push("android_type accepted by accessibility service.");
  } else {
    steps.push(`android_type failed (${typeResult.error || "no editable field focused"}). Moving to Level 2.`);
  }

  if (!inputOk) {
    steps.push("Level 2 - android_paste_text (adb input text primary, clipboard fallback)...");
    const pasteResult = await sendDaemonOp(userId, { type: "android_paste_text", text, fieldDescription }, 15000);
    if (pasteResult.ok) {
      const pasteData = (pasteResult.data || {}) as Record<string, unknown>;
      const daemonMethod = typeof pasteData.method_used === "string" ? pasteData.method_used : "unknown";
      methodUsed = `android_paste_text:${daemonMethod}`;
      inputOk = true;
      daemonVerified = pasteData.verified === true;
      fieldText = typeof pasteData.field_text === "string" ? pasteData.field_text : null;
      steps.push(`android_paste_text succeeded via ${daemonMethod}. Daemon verified: ${daemonVerified}.`);
    } else {
      steps.push(`android_paste_text failed (${pasteResult.error || "unknown"}). Moving to Level 3.`);
    }
  }

  if (!inputOk) {
    steps.push("Level 3 - android_paste_text retry (clipboard-only path)...");
    const retryResult = await sendDaemonOp(userId, { type: "android_paste_text", text, fieldDescription }, 15000);
    if (retryResult.ok) {
      const retryData = (retryResult.data || {}) as Record<string, unknown>;
      const retryMethod = typeof retryData.method_used === "string" ? retryData.method_used : "unknown";
      methodUsed = `android_paste_text:${retryMethod}:L3`;
      inputOk = true;
      daemonVerified = retryData.verified === true;
      fieldText = typeof retryData.field_text === "string" ? retryData.field_text : null;
      steps.push(`Level 3 retry succeeded via ${retryMethod}. Daemon verified: ${daemonVerified}.`);
    } else {
      steps.push(`Level 3 retry failed (${retryResult.error || "unknown"}). All input methods exhausted.`);
    }
  }

  return { methodUsed, inputOk, daemonVerified, fieldText };
}

const MAX_SCREENSHOTS_PER_TURN = 4;
const screenshotCountPerCtx = new WeakMap<object, number>();

export function checkAndIncrementScreenshotBudget(ctx: object | undefined): boolean {
  if (!ctx) return true;
  const current = screenshotCountPerCtx.get(ctx) ?? 0;
  if (current >= MAX_SCREENSHOTS_PER_TURN) return false;
  screenshotCountPerCtx.set(ctx, current + 1);
  return true;
}
