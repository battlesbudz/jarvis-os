import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../../..");
const helperSource = fs.readFileSync(path.join(repoRoot, "server/agent/tools/androidDaemonToolHelpers.ts"), "utf8");
const daemonToolSource = fs.readFileSync(path.join(repoRoot, "server/agent/tools/daemonShellTool.ts"), "utf8");

assert.ok(
  helperSource.includes("const MAX_SCREENSHOTS_PER_TURN = 4") &&
    helperSource.includes("const screenshotCountPerCtx = new WeakMap<object, number>()") &&
    helperSource.includes("if (current >= MAX_SCREENSHOTS_PER_TURN) return false"),
  "helper should preserve the per-turn screenshot budget cap",
);
assert.ok(
  helperSource.includes('sendDaemonOp(userId, { type: "android_type", text }, 10000)') &&
    helperSource.includes('type: "android_paste_text"') &&
    helperSource.includes('methodUsed = `android_paste_text:${retryMethod}:L3`'),
  "helper should preserve the three-level Android text input fallback chain",
);
assert.ok(
  helperSource.includes('type: "android_clear_field"') &&
    helperSource.includes('type: "android_press_key", key: "select_all"') &&
    helperSource.includes('type: "android_press_key", key: "delete"') &&
    helperSource.includes('type: "android_get_focused_field"'),
  "helper should preserve Android clear-field verification and fallback behavior",
);
assert.ok(
  helperSource.includes('raw.match(/focused="true"[^>]*text="([^"]+)"/i)') &&
    helperSource.includes('raw.match(/text="([^"]+)"[^>]*focused="true"/i)'),
  "helper should preserve focused-field XML parsing in both attribute orders",
);
assert.ok(
  daemonToolSource.includes('} from "./androidDaemonToolHelpers";') &&
    daemonToolSource.includes('export { checkAndIncrementScreenshotBudget } from "./androidDaemonToolHelpers";') &&
    daemonToolSource.includes("await clearFocusedAndroidField(ctx.userId, steps") &&
    daemonToolSource.includes("await clearFocusedAndroidField(ctx.userId, result.steps"),
  "daemonShellTool should consume the extracted Android helper functions without dropping exports",
);

console.log("OK: Android daemon helper extraction preserves budget, input, and clear-field contracts");
