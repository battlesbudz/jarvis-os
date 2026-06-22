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

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

export function extractFocusedFieldText(data: unknown): { focused: boolean; text?: string; hint?: string; resourceId?: string } {
  if (!data || typeof data !== "object") return { focused: false };
  const d = data as Record<string, unknown>;
  if (typeof d.focused === "boolean") {
    return {
      focused: d.focused,
      text: typeof d.text === "string" ? d.text : undefined,
      hint: typeof d.hint === "string" ? d.hint : undefined,
      resourceId: typeof d.resourceId === "string" ? d.resourceId : undefined,
    };
  }

  const raw = typeof d.content === "string" ? d.content : typeof d === "string" ? String(d) : "";
  const focused = /focused="true"/i.test(raw) || /\bfocused=true\b/i.test(raw);
  const textMatch = raw.match(/focused="true"[^>]*text="([^"]+)"/i)
    || raw.match(/text="([^"]+)"[^>]*focused="true"/i);
  return { focused, text: textMatch?.[1] };
}

export async function clearFocusedAndroidField(
  userId: string,
  steps: string[],
  options: { detailedSuccess?: boolean } = {},
): Promise<void> {
  steps.push("Clearing field (android_clear_field)...");
  const clearResult = await sendDaemonOp(userId, { type: "android_clear_field" }, 8000);
  if (clearResult.ok) {
    if (options.detailedSuccess) {
      const clearData = (clearResult.data || {}) as Record<string, unknown>;
      const clearMethod = typeof clearData.method === "string" ? clearData.method : "unknown";
      const verified = clearData.verifiedEmpty === true;
      const alreadyEmpty = clearData.fieldWasAlreadyEmpty === true;
      steps.push(alreadyEmpty ? "Field was already empty." : `Field cleared via ${clearMethod}. Verified empty: ${verified}.`);
    } else {
      steps.push("Field cleared.");
    }
    await sleep(150);
    return;
  }

  steps.push(`android_clear_field failed (${clearResult.error || "unknown"}); trying select-all + delete fallback...`);
  const selAllResult = await sendDaemonOp(userId, { type: "android_press_key", key: "select_all" }, 4000);
  await sleep(100);
  const delResult = await sendDaemonOp(userId, { type: "android_press_key", key: "delete" }, 4000);
  await sleep(150);
  if (selAllResult.ok && delResult.ok) {
    steps.push("Select-all + delete fallback sent successfully.");
  } else {
    steps.push(`Select-all + delete fallback partial/failed (select-all: ${selAllResult.ok}, delete: ${delResult.ok}); proceeding anyway.`);
  }

  const fallbackVerifyResult = await sendDaemonOp(userId, { type: "android_get_focused_field" }, 6000);
  if (!fallbackVerifyResult.ok) {
    steps.push("Select-all + delete fallback: verification inconclusive (android_get_focused_field failed). Proceeding with unknown clear status.");
    return;
  }

  const fallbackRemainingText = extractFocusedFieldText(fallbackVerifyResult.data).text;
  if (fallbackRemainingText === undefined || fallbackRemainingText === "") {
    steps.push("Select-all + delete fallback verified: field is empty.");
  } else {
    steps.push(`Select-all + delete fallback: field not empty after clear attempt. Remaining text: "${fallbackRemainingText}". Level 2/3 paste may append to existing content.`);
  }
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
