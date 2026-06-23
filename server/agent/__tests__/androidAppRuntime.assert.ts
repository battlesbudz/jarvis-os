import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test";

async function main() {
  const runtimeSource = fs.readFileSync(path.resolve("server/agent/tools/androidAppRuntime.ts"), "utf8");
  assert.match(runtimeSource, /checkAndIncrementScreenshotBudget/);
  assert.match(runtimeSource, /runAndroidCaptureScreen\(args,\s*ctx\.userId,\s*ctx\)/);
  assert.match(runtimeSource, /normalizedQuery\.length > 2 && normalizedCandidate\.includes\(normalizedQuery\)/);

  const {
    ANDROID_PHONE_RUNTIME_TOOL_NAMES,
    androidPhoneRuntimeTools,
    buildAndroidYoutubeSearchUrl,
    resolveAndroidAppName,
  } = await import("../tools/androidAppRuntime");

  assert.deepEqual(
    androidPhoneRuntimeTools.map((tool) => tool.name),
    [...ANDROID_PHONE_RUNTIME_TOOL_NAMES],
  );
  assert.equal(new Set(ANDROID_PHONE_RUNTIME_TOOL_NAMES).size, ANDROID_PHONE_RUNTIME_TOOL_NAMES.length);
  assert.ok(ANDROID_PHONE_RUNTIME_TOOL_NAMES.includes("android_capture_screen"));
  assert.ok(ANDROID_PHONE_RUNTIME_TOOL_NAMES.includes("android_open_phone_url"));

  const youtube = await resolveAndroidAppName("user-phone", "YouTube", { includeLiveInventory: false });
  assert.equal(youtube.app?.packageName, "com.google.android.youtube");
  assert.equal(youtube.app?.source, "static_catalog");

  const linkedIn = await resolveAndroidAppName("user-phone", "linked in", { includeLiveInventory: false });
  assert.equal(linkedIn.app?.packageName, "com.linkedin.android");

  const facebook = await resolveAndroidAppName("user-phone", "FB", { includeLiveInventory: false });
  assert.equal(facebook.app?.packageName, "com.facebook.katana");

  const camera = await resolveAndroidAppName("user-phone", "Camera", { includeLiveInventory: false });
  assert.equal(camera.app?.packageName, "com.android.camera2");
  assert.equal(camera.app?.source, "static_catalog");

  const samsungCamera = await resolveAndroidAppName("user-phone", "Samsung camera", { includeLiveInventory: false });
  assert.equal(samsungCamera.app?.packageName, "com.sec.android.app.camera");

  const phoneSettings = await resolveAndroidAppName("user-phone", "phone settings", { includeLiveInventory: false });
  assert.equal(phoneSettings.app?.packageName, "com.android.settings");

  const settingsOnPhone = await resolveAndroidAppName("user-phone", "settings on phone", { includeLiveInventory: false });
  assert.equal(settingsOnPhone.app?.packageName, "com.android.settings");

  const xApp = await resolveAndroidAppName("user-phone", "X", { includeLiveInventory: false });
  assert.equal(xApp.app?.packageName, "com.twitter.android");

  const excel = await resolveAndroidAppName("user-phone", "Excel", { includeLiveInventory: false });
  assert.equal(excel.app, null);

  assert.equal(
    buildAndroidYoutubeSearchUrl("local Gemma on Android videos"),
    "vnd.youtube://results?search_query=local%20Gemma%20on%20Android%20videos",
  );

  console.log("All Android app runtime assertions passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
