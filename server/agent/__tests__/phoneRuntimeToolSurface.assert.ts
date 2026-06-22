import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const routesSource = fs.readFileSync(path.resolve("server/routes.ts"), "utf8");
const runtimeSource = fs.readFileSync(path.resolve("server/agent/tools/androidAppRuntime.ts"), "utf8");
const bridgeSource = fs.readFileSync(path.resolve("server/daemon/bridge.ts"), "utf8");
const androidOpHandlerSource = fs.readFileSync(path.resolve("android-daemon/app/src/main/java/com/jarvis/daemon/OpHandler.kt"), "utf8");

assert.match(routesSource, /ANDROID_PHONE_RUNTIME_TOOL_NAMES/);
assert.match(routesSource, /function filterPhoneRuntimeModelTools/);
assert.match(routesSource, /allowDaemonActionFallback/);
assert.match(routesSource, /SERVER_YOUTUBE_TOOL_NAMES/);
assert.match(routesSource, /allowServerYoutubeTools/);
assert.match(routesSource, /name === ["']daemon_action["']\)\s+return options\.allowDaemonActionFallback === true/);
assert.match(routesSource, /!options\.allowServerYoutubeTools && SERVER_YOUTUBE_TOOL_NAMES\.has\(name\)/);
assert.match(routesSource, /name\.startsWith\(["']android_["']\) && !isAndroidPhoneRuntimeToolName\(name\)/);
assert.match(routesSource, /keepDaemonActionFallback[\s\S]*focusedToolNames\.add\(["']daemon_action["']\)/);
assert.match(routesSource, /routeRequiredToolNames[\s\S]*keepDaemonActionFallback[\s\S]*\["daemon_action"\]/);
assert.match(routesSource, /usePhoneRuntimeToolSurfaceOnly[\s\S]*filterPhoneRuntimeModelTools\(firstTurnToolPolicy\.tools,\s*\{/);
assert.match(routesSource, /allowServerYoutubeTools:\s*isYoutubeServerResearchRequest\(lastUserContent\)/);
assert.match(routesSource, /usePhoneRuntimeToolSurfaceOnly\s*=\s*androidActive[\s\S]*phoneRuntimeCoveredRequest[\s\S]*keepDaemonActionFallback/);
assert.doesNotMatch(routesSource, /isAndroidLocalGemmaModelName/);
assert.match(routesSource, /\.\.\.ANDROID_PHONE_RUNTIME_TOOL_NAMES/);
assert.match(routesSource, /function buildPhoneRuntimeRequiredToolNames/);
assert.match(routesSource, /function isYoutubeServerResearchRequest/);
assert.match(routesSource, /function isPhoneRuntimeCoveredRequest/);
assert.match(routesSource, /const youtubeResearchRequest = isYoutubeServerResearchRequest\(lastUserContent\)/);
assert.match(routesSource, /if \(!youtubeResearchRequest\)[\s\S]*requiredToolNames\.add\(["']android_youtube_search["']\)[\s\S]*\} else \{[\s\S]*requiredToolNames\.add\(["']search_youtube["']\)/);
assert.match(routesSource, /requiredToolNames\.add\(["']search_youtube["']\)/);
assert.match(routesSource, /requiredToolNames\.add\(["']fetch_youtube_transcript["']\)/);
assert.match(routesSource, /effectiveToolAwareRoute[\s\S]*priorityToolNames:\s*uniqueToolNames/);
assert.match(routesSource, /buildToolExecutionPolicy\(\{[\s\S]*route:\s*effectiveToolAwareRoute/);
assert.match(routesSource, /tc\.function\.name === 'android_return_to_jarvis_chat'[\s\S]*savePendingCoachResponse/);
assert.match(routesSource, /daemonAbsoluteRuleBase/);
assert.match(routesSource, /daemon_action fallback exposed for this unsupported phone action/);

assert.match(runtimeSource, /export const ANDROID_PHONE_RUNTIME_TOOL_NAMES/);
assert.match(runtimeSource, /export const androidPhoneRuntimeTools/);
assert.match(runtimeSource, /androidOpenAppByNameTool/);
assert.match(runtimeSource, /androidCaptureScreenTool/);
assert.match(runtimeSource, /androidReadNotificationsTool/);
assert.match(runtimeSource, /\{ type: ["']android_notify["'], title, body \}/);
assert.match(runtimeSource, /galleryPersistence:\s*["']temporary_chat_preview/);
assert.match(runtimeSource, /fallback capture cleanup is best-effort/);
assert.doesNotMatch(runtimeSource, /savedToGallery:\s*false/);
assert.doesNotMatch(runtimeSource, /not saved to the user's gallery/i);
assert.doesNotMatch(runtimeSource, /Missing Android permissions: \$\{missing\.join/);
assert.match(runtimeSource, /Missing Android permission: android_browse/);

assert.match(bridgeSource, /\| \{ type: ["']android_notify["']; title: string; body: string \}/);
assert.match(androidOpHandlerSource, /"notify", "android_notify" -> handleNotify/);
assert.match(runtimeSource, /\{ label: ["']Camera["'], packageName: ["']com\.android\.camera2["'], aliases: \["camera"/);
assert.match(androidOpHandlerSource, /"com\.android\.camera2"\s+to listOf\("com\.sec\.android\.app\.camera", "com\.google\.android\.GoogleCamera"/);
assert.match(androidOpHandlerSource, /"com\.sec\.android\.app\.camera"\s+to listOf\("com\.android\.camera2", "com\.google\.android\.GoogleCamera"/);

console.log("All Phone Runtime tool surface assertions passed.");
