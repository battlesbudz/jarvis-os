import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  includeConnectedPhoneRuntimeTools,
  isConnectedPhoneCapabilityDenial,
  isPhoneRuntimeCoveredRequest,
  resolvePhoneRuntimeRequestText,
} from "../phoneRuntimeRouting";


const reproducedPhoneRetryConversation = [
  { role: "user", content: "Let's try this again can you open up Chrome and search for best movies of all time" },
  { role: "assistant", content: "The request was incorrectly routed to the browser service." },
  { role: "user", content: "Okay so you understood that my intent was for you to open up the Chrome app on my phone correct" },
  { role: "assistant", content: "Yes." },
  { role: "user", content: "Did you search for what I asked" },
  { role: "assistant", content: "No." },
  { role: "user", content: "Can you try the search again?" },
] as const;
assert.equal(
  resolvePhoneRuntimeRequestText([...reproducedPhoneRetryConversation]),
  reproducedPhoneRetryConversation[0].content,
  "a retry must retain the explicit Android Chrome target instead of inheriting browser-service failure prose",
);
assert.equal(
  resolvePhoneRuntimeRequestText([
    { role: "user", content: "Open Facebook and search Marketplace for used cars." },
    { role: "assistant", content: "Background launch was blocked by Android." },
    { role: "assistant", content: "The voice session ended unexpectedly. Do you want me to restore the conversation context before we continue?" },
    { role: "user", content: "Yes" },
    { role: "assistant", content: "Context restored. We were working inside Facebook Marketplace." },
    { role: "user", content: "Retry the entire operation once more." },
  ]),
  "Open Facebook and search Marketplace for used cars.",
  "an accepted voice restoration is control flow and must not sever a contextual phone retry",
);
assert.equal(
  resolvePhoneRuntimeRequestText([
    { role: "user", content: "Open Facebook on my phone." },
    { role: "assistant", content: "Would you like coffee?" },
    { role: "user", content: "Yes" },
    { role: "assistant", content: "Okay." },
    { role: "user", content: "Try again." },
  ]),
  "Try again.",
  "an unrelated acknowledgement must still stop phone retry backtracking",
);
for (const denial of [
  "I can't control your phone from here.",
  "I cannot open apps on your Android device.",
  "There is no available device-control tool.",
]) {
  assert.equal(isConnectedPhoneCapabilityDenial(denial), true, "generic connected-phone denials must be blocked");
}
assert.equal(
  isConnectedPhoneCapabilityDenial("Background launch was blocked by Samsung One UI."),
  false,
  "a concrete Android action failure must remain reportable",
);
assert.equal(
  resolvePhoneRuntimeRequestText([
    { role: "user", content: "Open Chrome on my phone." },
    { role: "assistant", content: "The phone action failed." },
    { role: "user", content: "Could you please try that again?" },
  ]),
  "Open Chrome on my phone.",
  "a retry must accept stacked modal and politeness prefixes",
);
assert.equal(
  resolvePhoneRuntimeRequestText([
    { role: "user", content: "Tell me a joke" },
    { role: "assistant", content: "That failed." },
    { role: "user", content: "Try again." },
  ]),
  "Try again.",
  "a retry must not revive an unrelated stale phone command",
);
assert.equal(
  resolvePhoneRuntimeRequestText([
    ...reproducedPhoneRetryConversation,
    { role: "assistant", content: "The phone action failed." },
    { role: "user", content: "Why does this request currently provide no tools?" },
  ]),
  "Why does this request currently provide no tools?",
  "a diagnostic question must remain conversational",
);

for (const cancellation of ["Don't try that again.", "Do not run that again.", "Try that again—actually don't."]) {
  assert.equal(
    resolvePhoneRuntimeRequestText([
      { role: "user", content: "Open Chrome on my phone." },
      { role: "assistant", content: "The phone action failed." },
      { role: "user", content: cancellation },
    ]),
    cancellation,
    "a negated retry must not revive a canceled phone command",
  );
}
assert.equal(
  resolvePhoneRuntimeRequestText([
    { role: "user", content: "Open Facebook on my phone." },
    { role: "assistant", content: "The phone action failed." },
    { role: "user", content: "Try opening Instagram again." },
  ]),
  "Try opening Instagram again.",
  "a retry with a new explicit target must not revive the previous app",
);
assert.equal(
  resolvePhoneRuntimeRequestText([
    { role: "user", content: "Search for cats on Facebook." },
    { role: "assistant", content: "The phone action failed." },
    { role: "user", content: "Try searching for dogs on Instagram again." },
  ]),
  "Try searching for dogs on Instagram again.",
  "a retry with a new in-app search target must not revive the previous app or query",
);
assert.equal(
  resolvePhoneRuntimeRequestText([
    { role: "user", content: "Open Facebook on my phone." },
    { role: "assistant", content: "The phone action failed." },
    { role: "user", content: "Why are cats nocturnal?" },
    { role: "assistant", content: "They are adapted to low-light hunting." },
    { role: "user", content: "Try that again." },
  ]),
  "Try that again.",
  "an unrelated intervening question must stop phone retry backtracking",
);
assert.equal(isPhoneRuntimeCoveredRequest("Find tutorials on app development"), false);
assert.equal(isPhoneRuntimeCoveredRequest("Find tutorials in the app"), true);
assert.equal(isPhoneRuntimeCoveredRequest("How do screenshots work on Android?"), false);
assert.equal(isPhoneRuntimeCoveredRequest("Can you please take a screenshot of my phone?"), true);
assert.equal(isPhoneRuntimeCoveredRequest("Screenshot my phone"), true);
assert.equal(isPhoneRuntimeCoveredRequest("Show me a screenshot from last week's chat"), false);
assert.equal(isPhoneRuntimeCoveredRequest("Get me a screenshot of the homepage"), false);
assert.equal(isPhoneRuntimeCoveredRequest("Show me a screenshot of my phone"), true);
assert.equal(isPhoneRuntimeCoveredRequest("Why does Chrome navigate to a website automatically?"), false);
assert.equal(isPhoneRuntimeCoveredRequest("Can you navigate to a website on my phone?"), true);
assert.equal(isPhoneRuntimeCoveredRequest("Where can I find privacy settings in Facebook?"), false);
assert.equal(isPhoneRuntimeCoveredRequest("I can\'t find privacy settings in Facebook"), false);
assert.equal(isPhoneRuntimeCoveredRequest("Show that one"), false);
assert.equal(isPhoneRuntimeCoveredRequest("Show that notification"), true);
assert.equal(isPhoneRuntimeCoveredRequest("Open that notification"), true);
assert.equal(isPhoneRuntimeCoveredRequest("What happens when I open a notification?"), false);
assert.equal(isPhoneRuntimeCoveredRequest("Can you show me what happens when I open a notification?"), false);

const tool = (name: string) => ({
  type: "function" as const,
  function: { name, description: name, parameters: { type: "object", properties: {} } },
});
const researchTools = [tool("search_web")];
const allConnectedTools = [
  ...researchTools,
  tool("android_open_app_by_name"),
  tool("android_search_in_app"),
  tool("android_read_screen_context"),
];
assert.deepEqual(
  includeConnectedPhoneRuntimeTools(researchTools, allConnectedTools, true).map((candidate) => candidate.function.name),
  ["search_web", "android_open_app_by_name", "android_search_in_app", "android_read_screen_context"],
  "a connected phone capability must compose with another focused tool route instead of being filtered out",
);
assert.deepEqual(
  includeConnectedPhoneRuntimeTools(researchTools, allConnectedTools, false).map((candidate) => candidate.function.name),
  ["search_web"],
  "phone tools must remain unavailable when Android Device Control is disconnected",
);
assert.equal(
  resolvePhoneRuntimeRequestText([
    { role: "user", content: "Open Facebook on my phone." },
    { role: "assistant", content: "The phone action failed." },
    { role: "user", content: "What should I do again?" },
  ]),
  "What should I do again?",
  "a question containing do and again must not be treated as a retry command",
);

const routesSource = fs.readFileSync(path.resolve("server/routes.ts"), "utf8");
const channelCoachSource = fs.readFileSync(path.resolve("server/channels/coachAgent.ts"), "utf8");
const insightsSource = fs.readFileSync(path.resolve("app/(tabs)/insights.tsx"), "utf8");
const deviceControlCardSource = fs.readFileSync(path.resolve("components/androidDaemon/AndroidDeviceControlCard.tsx"), "utf8");
const routingSource = fs.readFileSync(path.resolve("server/agent/phoneRuntimeRouting.ts"), "utf8");
const runtimeToolNamesSource = fs.readFileSync(path.resolve("server/agent/androidPhoneRuntimeToolNames.ts"), "utf8");
const runtimeSource = fs.readFileSync(path.resolve("server/agent/tools/androidAppRuntime.ts"), "utf8");
const daemonShellSource = fs.readFileSync(path.resolve("server/agent/tools/daemonShellTool.ts"), "utf8");
const bridgeSource = fs.readFileSync(path.resolve("server/daemon/bridge.ts"), "utf8");
const androidOpHandlerSource = fs.readFileSync(path.resolve("android-daemon/app/src/main/java/com/jarvis/daemon/OpHandler.kt"), "utf8");
const androidAccessibilitySource = fs.readFileSync(path.resolve("android/app/src/main/java/com/gameplan/daemon/JarvisAccessibilityService.kt"), "utf8");
const pluginAndroidAccessibilitySource = fs.readFileSync(path.resolve("plugins/android-daemon-native/src/main/java/com/gameplan/daemon/JarvisAccessibilityService.kt"), "utf8");
const standaloneAndroidAccessibilitySource = fs.readFileSync(path.resolve("android-daemon/app/src/main/java/com/jarvis/daemon/JarvisAccessibilityService.kt"), "utf8");
const generatedAndroidOpHandlerSource = fs.readFileSync(path.resolve("android/app/src/main/java/com/gameplan/daemon/OpHandler.kt"), "utf8");
const pluginAndroidOpHandlerSource = fs.readFileSync(path.resolve("plugins/android-daemon-native/src/main/java/com/gameplan/daemon/OpHandler.kt"), "utf8");
const approvalToolRiskSource = fs.readFileSync(path.resolve("server/agent/approvalToolRisk.ts"), "utf8");
const notificationSummarySource = fs.readFileSync(path.resolve("server/agent/androidNotificationSummary.ts"), "utf8");
const daemonActionSource = fs.readFileSync(path.resolve("server/agent/tools/daemon.ts"), "utf8");
const actionOntologySource = fs.readFileSync(path.resolve("server/agent/actionOntology.ts"), "utf8");

assert.match(routesSource, /ANDROID_PHONE_RUNTIME_TOOL_NAMES/);
assert.match(routesSource, /filterPhoneRuntimeModelTools/);
assert.match(routingSource, /function filterPhoneRuntimeModelTools/);
assert.match(routingSource, /allowDaemonActionFallback/);
assert.match(routingSource, /SERVER_YOUTUBE_TOOL_NAMES/);
assert.match(routingSource, /allowServerYoutubeTools/);
assert.match(routingSource, /if \(!name\) return false/);
assert.match(routingSource, /isAndroidPhoneRuntimeToolName\(name\)\) return true/);
assert.match(routingSource, /name === ["']daemon_action["']\)\s+return options\.allowDaemonActionFallback === true/);
assert.match(routingSource, /SERVER_YOUTUBE_TOOL_NAMES\.has\(name\)\) return options\.allowServerYoutubeTools === true/);
assert.match(routingSource, /return false;\s*\}\);/);
assert.match(routesSource, /keepDaemonActionFallback[\s\S]*focusedToolNames\.add\(["']daemon_action["']\)/);
assert.match(routesSource, /routeRequiredToolNames[\s\S]*keepDaemonActionFallback[\s\S]*\["daemon_action"\]/);
assert.match(routesSource, /phoneRuntimeCoveredRequest \? phoneRuntimeRequiredToolNames : \[\]/);
assert.match(routesSource, /mixedPhoneRuntimeActionRequest[\s\S]*priorityToolNames: \[\]/);
assert.match(routesSource, /priorityToolNames:\s*uniqueToolNames\(\[[\s\S]*priorityRuntimeToolNames/);
assert.doesNotMatch(routesSource, /priorityToolNames:\s*uniqueToolNames\(\[[\s\S]{0,200}routeRequiredToolNames/);
assert.match(routesSource, /const youtubeServerResearchRequest =[\s\S]{0,160}isYoutubeServerResearchRequest\(phoneRuntimeRequestText\)/);
assert.match(routesSource, /keepDaemonActionFallback[\s\S]*hasUnsupportedPhoneDeviceControlRequest\(phoneRuntimeRequestText\)[\s\S]*!youtubeServerResearchRequest/);
assert.match(routesSource, /const useFocusedRequestTools = toolAwareRoute\.shouldPreferTool \|\|[\s\S]*phoneRuntimeCoveredRequest \|\|[\s\S]*keepDaemonActionFallback \|\|[\s\S]*youtubeServerResearchRequest/);
assert.match(routesSource, /const useMetadataToolLoop = relevantMetadataToolNames\.length > 0/);
assert.match(routesSource, /usePhoneRuntimeToolSurfaceOnly[\s\S]*filterPhoneRuntimeModelTools\(firstTurnToolPolicy\.tools,\s*\{/);
assert.match(routesSource, /includeConnectedPhoneRuntimeTools\(routedModelRequestTools, requestTools, androidActive\)/);
assert.match(routesSource, /const shouldRunToolLoop = androidActive[\s\S]*\|\| useToolFocusedLoop/);
assert.match(routesSource, /allowServerYoutubeTools:\s*youtubeServerResearchRequest/);
assert.match(routesSource, /usePhoneRuntimeToolSurfaceOnly\s*=\s*phoneRuntimeCoveredRequest/);
assert.match(routesSource, /const phoneRuntimeActionRequest[\s\S]*hasPhoneRuntimeActionRequest[\s\S]*hasContextualPhoneRuntimeActionRequest/);
assert.match(routesSource, /buildPhoneRuntimeRequiredToolNames\(\s*phoneRuntimeRequestText,\s*isDeviceControlRequest,\s*phoneRuntimeActionRequest/);
assert.doesNotMatch(routesSource, /isAndroidLocalGemmaModelName/);
assert.match(routesSource, /\.\.\.ANDROID_PHONE_RUNTIME_TOOL_NAMES/);
assert.match(routingSource, /function buildPhoneRuntimeRequiredToolNames/);
assert.match(routingSource, /function deterministicPhoneRuntimeToolCallFromRequest/);
assert.match(runtimeSource, /confirmInstalledAndroidAppName/);
assert.match(runtimeSource, /takeConfirmedAndroidAppResolution/);
assert.match(routingSource, /android_read_notifications/);
assert.match(routingSource, /!options\.androidActive \|\| !options\.phoneRuntimeCoveredRequest/);
assert.match(routesSource, /Routing notification request to Android Device Control/);
assert.match(routesSource, /Routing app launch to Android Device Control/);
assert.match(routesSource, /deterministicPhoneRuntimeToolCallFromRequest\(phoneRuntimeRequestText, modelRequestTools,[\s\S]*androidActive,[\s\S]*phoneRuntimeCoveredRequest/);
assert.match(routesSource, /isConnectedPhoneCapabilityDenial\(modelPhase1\.textContent/);
assert.match(routesSource, /denialRecoveryTool[\s\S]*android_read_screen_context/);
assert.match(routesSource, /deterministicAndroidToolSummary\(tc\.function\.name, execResult,[\s\S]*deterministicToolCall:\s*deterministicToolCall\?\.id === tc\.id/);
assert.match(routesSource, /getRecentNotificationObservation\(userId, 20\)/);
assert.match(routesSource, /resolveAndroidNotificationFollowUp\(lastUserOrigText, recentNotificationObservation\)/);
assert.match(routesSource, /appNotificationFollowUp\.kind === "summary"/);
assert.match(routesSource, /previousTurnWasNotificationRead/);
const previousTurnDetectorStart = routesSource.indexOf("const previousTurnWasNotificationRead");
const previousTurnDetectorEnd = routesSource.indexOf("const currentHasNotificationAnchor", previousTurnDetectorStart);
const previousTurnDetectorSource = routesSource.slice(previousTurnDetectorStart, previousTurnDetectorEnd);
assert.match(previousTurnDetectorSource, /I checked your Android notifications/);
assert.doesNotMatch(previousTurnDetectorSource, /notification shade/i);
assert.match(routesSource, /canUseRecentNotificationObservation/);
assert.match(routesSource, /recentNotificationObservation && canUseRecentNotificationObservation/);
assert.match(routingSource, /function isYoutubeServerResearchRequest/);
assert.match(routingSource, /function isYoutubePhoneActionRequest/);
assert.match(routingSource, /function isMemoryPhoneBypassRequest/);
assert.match(routingSource, /function isPhoneOpenActionRequest/);
assert.match(routingSource, /function hasAffirmativeWebTargetQualifier/);
assert.match(routingSource, /project\|build\|create\|make\|generate\|scaffold\|code\|web\\s\+app/);
assert.match(routingSource, /function isPhoneOpenActionRequest[\s\S]*project\|build\|create[\s\S]*extractExplicitPhoneAppTarget\(text\)/);
assert.match(routingSource, /function hasPhoneRuntimeContext/);
assert.match(routingSource, /function isPhoneRuntimeCoveredRequest/);
assert.match(routingSource, /negatesPhoneAction[\s\S]*if \(negatesPhoneAction\) return false/);
assert.match(routingSource, /asksForInstructions[\s\S]*if \(asksForInstructions\) return false/);
assert.match(routingSource, /isPhoneNotificationReadRequest\(normalized\)/);
assert.match(
  routingSource,
  /const youtubePhoneActionRequest = !isYoutubeServerResearchRequest\(normalized\)[\s\S]*?isYoutubePhonePlayRequest\(normalized\)/,
);
assert.match(routingSource, /const youtubePhoneActionRequest = isYoutubePhoneRequest\(lastUserContent\) && isYoutubePhoneActionRequest\(lastUserContent\)/);
assert.doesNotMatch(routingSource, /\(\?:you\\s\*tube\|youtube\|yt\)\?\\s\*videos/);
assert.match(routingSource, /\(\?:you\\s\*tube\|youtube\|yt\)\\s\*videos/);
assert.match(routingSource, /return youtubePhoneActionRequest \|\|\s*hasCurrentTargetBeforePhoneOpenFollowUp\(normalized\) \|\|\s*isPhoneOpenActionRequest\(normalized\) \|\|/);
assert.match(
  routingSource,
  new RegExp("hasPhoneRuntimeContext\\(normalized\\) && /\\\\b\\(\\?:tap\\|swipe\\|scroll\\|type\\|press\\|back\\|home\\|recents\\|enter\\)"),
);
assert.match(routesSource, /phoneRuntimeRequestText[\s\S]*isPhoneRuntimeCoveredRequest\(phoneRuntimeRequestText\)/);
assert.match(routesSource, /phoneRuntimeActionRequest \|\|[\s\S]*isPhoneDeviceControlKeywordRequest/);
assert.match(insightsSource, /originPlatform: Platform\.OS/);
assert.match(deviceControlCardSource, /const statusReady = healthy && !checkingAccessibility && !needsAccessibility;/);
assert.doesNotMatch(deviceControlCardSource, /const statusReady =[\s\S]{0,180}notificationPermission/);
assert.match(deviceControlCardSource, /detail: !healthy[\s\S]{0,100}Connect Device Control to check Notification Access/);
assert.match(deviceControlCardSource, /notificationPermissionGranted === true && status\?\.notificationServiceConnected === true[\s\S]{0,180}Permission granted and listener connected/);
assert.doesNotMatch(routesSource, /isAndroidVoiceOrigin|rawOriginPlatform/);
assert.match(routesSource, /const phoneRuntimeAvailable = androidActive;/);
assert.match(channelCoachSource, /resolvePhoneRuntimeRequestText\(\[[\s\S]*cachedSessionMessages[\s\S]*\[\.\.\.chatMessages\]\.reverse\(\)[\s\S]*role: ["']user["'][\s\S]*classifyToolAwareRoute\(phoneRuntimeRequestText\)/);
assert.match(channelCoachSource, /classifiedToolAwareRoute\.actionType === ["']jarvis_device_action["'] && !androidActive/);
assert.match(channelCoachSource, /phoneRuntimeUnavailable[\s\S]*toolGroups: \[\][\s\S]*priorityToolNames: \[\][\s\S]*shouldPreferTool: false/);
assert.match(channelCoachSource, /phoneRuntimeUnavailable[\s\S]*new Set<string>\(ANDROID_PHONE_RUNTIME_TOOL_NAMES\)[\s\S]*scopedTools = scopedTools\.filter/);
assert.match(channelCoachSource, /queryText: phoneRuntimeUnavailable \? undefined : userText/);
assert.match(channelCoachSource, /The Android daemon is not active\. Do not request a phone tool or approval\./);
assert.match(routesSource, /phoneRuntimeAvailable && !memoryPhoneBypassRequest && \([\s\S]*isPhoneRuntimeCoveredRequest\(phoneRuntimeRequestText\)/);
assert.match(
  routesSource,
  /!phoneRuntimeAvailable && classifiedToolAwareRoute\.actionType === ["']jarvis_device_action["'][\s\S]*shouldPreferTool: hasNonPhoneToolRoute/,
);
assert.match(routesSource, /nonPhoneIntents[\s\S]*intent !== ["']research["'][\s\S]*intent !== ["']browser["']/);
assert.match(routesSource, /intents: hasNonPhoneToolRoute \? classifiedToolAwareRoute\.intents : \[\]/);
assert.match(routesSource, /priorityToolNames: hasNonPhoneToolRoute \? nonPhonePriorityToolNames : \[\]/);
assert.doesNotMatch(routesSource, /androidActive \|\| originChannel === ["']voice["']/);
assert.doesNotMatch(routesSource, /'launch',/);
assert.doesNotMatch(routesSource, /'look it up'/);
assert.doesNotMatch(routesSource, /'find me a video'/);
assert.match(routingSource, /const youtubeResearchRequest = isYoutubeServerResearchRequest\(lastUserContent\)/);
assert.match(routingSource, /if \(!youtubeResearchRequest\)[\s\S]*requiredToolNames\.add\(["']android_youtube_search["']\)[\s\S]*\} else \{[\s\S]*requiredToolNames\.add\(["']search_youtube["']\)/);
assert.match(routingSource, /requiredToolNames\.add\(["']search_youtube["']\)/);
assert.match(routingSource, /requiredToolNames\.add\(["']fetch_youtube_transcript["']\)/);
assert.match(routesSource, /effectiveToolAwareRoute[\s\S]*priorityToolNames:\s*uniqueToolNames/);
assert.match(routesSource, /buildToolExecutionPolicy\(\{[\s\S]*route:\s*effectiveToolAwareRoute/);
assert.match(routesSource, /forceRequired:\s*isDeviceControlRequest \|\| isDiagnosticsRequest \|\| isResearchRequest \|\| routeRequiredToolNames\.length > 0/);
assert.match(routesSource, /tc\.function\.name === 'android_return_to_jarvis_chat'[\s\S]*savePendingCoachResponse/);
assert.match(routesSource, /daemonAbsoluteRuleBase/);
assert.match(routesSource, /daemon_action fallback exposed for this unsupported phone action/);
assert.match(routesSource, /treat it as a valid phone action/);
assert.match(routesSource, /Use android_notify_user, then android_return_to_jarvis_chat at the end of multi-step phone tasks/);

assert.match(runtimeToolNamesSource, /export const ANDROID_PHONE_RUNTIME_TOOL_NAMES/);
assert.match(runtimeSource, /export \{ ANDROID_PHONE_RUNTIME_TOOL_NAMES \}/);
assert.match(runtimeSource, /export const androidPhoneRuntimeTools/);
assert.match(runtimeSource, /androidOpenAppByNameTool/);
assert.match(runtimeSource, /androidCaptureScreenTool/);
assert.match(runtimeSource, /androidReadNotificationsTool/);
assert.match(runtimeSource, /androidOpenNotificationTool/);
assert.match(runtimeToolNamesSource, /android_open_notification/);
assert.match(runtimeToolNamesSource, /android_search_in_app/);
assert.match(runtimeSource, /type: ["']android_notification_open["']/);
assert.match(bridgeSource, /type: ["']android_notification_open["']/);
assert.match(daemonShellSource, /type: ["']android_press_key["'], key: ["']enter["']/);
assert.match(daemonShellSource, /if \(!screenRaw\)[\s\S]*submit_search_baseline/);
assert.match(daemonShellSource, /function parseSubmitElement/);
assert.match(daemonShellSource, /node\.contentDesc[\s\S]{0,160}node\.content_desc/);
assert.match(daemonShellSource, /\^\(\?:search\|go\|submit\)\\b/);
assert.match(daemonShellSource, /coordinateMatch = ranked[\s\S]*extractNodeCoords[\s\S]*\.find\(\(entry\) => entry\.coords !== null\)/);
const androidApprovalGateStart = routesSource.indexOf("const androidRouteApprovalRequired");
const androidApprovalGateEnd = routesSource.indexOf("const isHighStakes", androidApprovalGateStart);
const androidApprovalGateSource = routesSource.slice(androidApprovalGateStart, androidApprovalGateEnd);
assert.match(androidApprovalGateSource, /isAndroidPhoneRuntimeToolName/);
assert.match(androidApprovalGateSource, /daemon_action[\s\S]*startsWith\('android_'\)/);
assert.doesNotMatch(androidApprovalGateSource, /toolAwareRoute\.approvalRequired/);
assert.match(routesSource, /androidRouteApprovalRequired \|\|[\s\S]*androidSubmitApprovalRequired/);
assert.match(routesSource, /operationArgs: diagnosticOperationArgs\(tc\.function\.name, args\)/);
assert.doesNotMatch(routesSource, /detail:\s*String\(execResult\.detail/);
const voiceApprovalStart = routesSource.indexOf("setDaemonVoiceApprovalHandler(async");
const voiceApprovalEnd = routesSource.indexOf("registerCoachActionConfirmationRoutes", voiceApprovalStart);
const voiceApprovalSource = routesSource.slice(voiceApprovalStart, voiceApprovalEnd);
assert.doesNotMatch(voiceApprovalSource, /detail:\s*execResult\.detail/);
assert.doesNotMatch(voiceApprovalSource, /failed:\s*\$\{execResult\.detail/);
assert.match(routesSource, /const redactValue = \(key: string, value: unknown\)[\s\S]*Array\.isArray\(value\)[\s\S]*Object\.fromEntries/);
assert.match(routesSource, /\^\(\?:action\|type\)\$[\s\S]*value\.slice\(0, 80\)/);
assert.match(runtimeSource, /notificationsByKey = new Map<string, Record<string, unknown>>/);
assert.match(runtimeSource, /if \(!notificationsByKey\.has\(mapKey\)\) notificationsByKey\.set\(mapKey, notification\)/);
assert.match(runtimeSource, /appIdentityFields = \[notification\.app, notification\.pkg\]/);
assert.match(runtimeSource, /containsNormalizedPhrase\(field, normalizedApp\)/);
assert.doesNotMatch(runtimeSource, /appMatches = !normalizedApp \|\| haystack\.includes\(normalizedApp\)/);
assert.match(daemonShellSource, /node\.className \|\| node\.class_name \|\| node\.class/);
assert.match(androidAccessibilitySource, /fun notificationRowHasAppLabel\(candidate: AccessibilityNodeInfo, app: String\)/);
assert.match(androidAccessibilitySource, /root\.packageName\?\.toString\(\) != ["']com\.android\.systemui["']\) continue/);
assert.match(standaloneAndroidAccessibilitySource, /root\.packageName\?\.toString\(\) != ["']com\.android\.systemui["']\) continue/);
assert.match(androidAccessibilitySource, /AccessibilityNodeInfo\.AccessibilityAction::class\.java[\s\S]*getField\("ACTION_IME_ENTER"\)/);
assert.doesNotMatch(androidAccessibilitySource, /0x00002000/);
assert.match(androidAccessibilitySource, /\.any \{ value -> value == app \}/);
assert.match(androidAccessibilitySource, /clickCandidate != null && notificationRowHasAppLabel\(clickCandidate, normalizedApp\)/);
assert.match(androidAccessibilitySource, /meaningfulPartialMatch = queryTokens\.size >= 2[\s\S]*matchedTokens >= 2[\s\S]*>= 0\.6/);
assert.match(androidAccessibilitySource, /fun aggregateNotificationRowLabel\(candidate: AccessibilityNodeInfo\)/);
assert.match(androidAccessibilitySource, /clickCandidate\?\.let\(::aggregateNotificationRowLabel\)/);
assert.match(androidAccessibilitySource, /fun containsBoundedNotificationTerm\(value: String, term: String\)/);
assert.match(androidAccessibilitySource, /matchedTokens = queryTokens\.count \{ token -> containsBoundedNotificationTerm\(label, token\) \}/);
assert.match(androidAccessibilitySource, /matchedAmbiguous = true[\s\S]*Multiple visible notifications matched/);
assert.match(androidAccessibilitySource, /fun closeNotificationShadeAfterFailure\(\)[\s\S]*GLOBAL_ACTION_BACK/);
assert.match(androidAccessibilitySource, /if \(target == null\) \{[\s\S]*closeNotificationShadeAfterFailure\(\)/);
assert.match(androidAccessibilitySource, /if \(!leftShade\) closeNotificationShadeAfterFailure\(\)/);
assert.match(runtimeSource, /matchedTokens = queryTokens\.filter\(\(token\) => containsNormalizedPhrase\(normalizeAppLookup\(haystack\), normalizeAppLookup\(token\)\)\)/);
assert.match(runtimeSource, /replace\(\/\[\^\\p\{L\}\\p\{N\}\]\+\/gu, " "\)/);
assert.match(runtimeSource, /exactQueryMatch = fields\.some[\s\S]*containsNormalizedPhrase\(normalizeAppLookup\(field\), normalizedQuery\)/);
assert.match(runtimeSource, /if \(ranked\.length === 0\) \{[\s\S]*if \(!allowShadeFallback\)/);
assert.match(androidAccessibilitySource, /Regex\("\[\^\\\\p\{L\}\\\\p\{N\}\]\+"\)/);
assert.match(androidAccessibilitySource, /queryTokens\.size > 1 -> containsBoundedNotificationTerm\(label, normalizedQuery\)/);
assert.match(androidAccessibilitySource, /score = if \(appMatches && queryMatches\)/);
assert.match(daemonShellSource, /keyboardDismissed && hasNewResultEvidence/);
assert.match(daemonShellSource, /Array\.isArray\(node\.text\)[\s\S]*for \(const value of labelValues\)/);
assert.match(daemonShellSource, /resumeFromStepRaw > 5/);
assert.doesNotMatch(daemonShellSource, /resume_from_step: 6/);
assert.match(daemonShellSource, /hasNewResultContainer[\s\S]*newLabels\.length >= 2/);
assert.doesNotMatch(daemonShellSource, /contentGrew|contentChanged|preSubmitLen|preSubmitNodeCount/);
assert.equal(
  pluginAndroidAccessibilitySource,
  androidAccessibilitySource,
  "the Expo plugin's canonical accessibility service must stay identical to the generated Android copy",
);
assert.match(standaloneAndroidAccessibilitySource, /fun notificationRowHasAppLabel\(candidate: AccessibilityNodeInfo, app: String\)/);
assert.match(standaloneAndroidAccessibilitySource, /clickCandidate != null && notificationRowHasAppLabel\(clickCandidate, normalizedApp\)/);
assert.match(standaloneAndroidAccessibilitySource, /meaningfulPartialMatch = queryTokens\.size >= 2[\s\S]*matchedTokens >= 2[\s\S]*>= 0\.6/);
assert.equal(
  pluginAndroidOpHandlerSource,
  generatedAndroidOpHandlerSource,
  "the Expo plugin's canonical operation handler must stay identical to the generated Android copy",
);
for (const opHandlerSource of [generatedAndroidOpHandlerSource, pluginAndroidOpHandlerSource, androidOpHandlerSource]) {
  assert.match(opHandlerSource, /allowShadeFallback = op\.optBoolean\("allowShadeFallback", false\)/);
  assert.match(opHandlerSource, /!allowShadeFallback[\s\S]*android_read_screen permission is required for the notification-shade fallback/);
  assert.doesNotMatch(opHandlerSource, /"enter"\s*->\s*Pair\("KEYCODE_ENTER"/);
  assert.match(opHandlerSource, /query\.isEmpty\(\) && appName == null/);
}
assert.match(runtimeSource, /allowShadeFallback,\s*\n/);
assert.match(runtimeSource, /const allowShadeFallback = screenReadAllowed;/);
assert.doesNotMatch(runtimeSource, /Array\.from\(normalizeAppLookup\(appName\)\)\.length/);
assert.doesNotMatch(runtimeSource, /directContentIntentPackage/);
assert.match(runtimeSource, /destinationPackage = foregroundPackageAfter \|\| daemonDestinationPackage/);
assert.match(bridgeSource, /allowShadeFallback\?: boolean/);
assert.match(bridgeSource, /op\.type === "android_notification_open" && op\.allowShadeFallback === true[\s\S]*android_read_screen/);
const highRiskToolsStart = approvalToolRiskSource.indexOf("const HIGH_RISK_TOOLS");
const irreversibleToolsStart = approvalToolRiskSource.indexOf("export const STRICTLY_IRREVERSIBLE_TOOLS");
assert.match(approvalToolRiskSource.slice(highRiskToolsStart, irreversibleToolsStart), /\.\.\.ANDROID_PHONE_RUNTIME_TOOL_NAMES/);
assert.match(approvalToolRiskSource.slice(irreversibleToolsStart), /\.\.\.ANDROID_PHONE_RUNTIME_TOOL_NAMES/);
assert.match(notificationSummarySource, /key\?: string/);
assert.match(notificationSummarySource, /key: String\(item\.key \|\| item\.notificationKey/);
assert.match(routesSource, /notificationKey: appNotificationFollowUp\.notification\.key/);
assert.match(actionOntologySource, /isPhoneRuntimeCoveredRequest\(normalized\)/);
assert.doesNotMatch(actionOntologySource, /open\|launch\|tap\|press\|swipe\|scroll\|type\|search\|find\|read\|show[\s\S]*android\|phone\|screen\|app/);
assert.match(daemonActionSource, /import \{ runAndroidOpenNotification \} from "\.\/androidAppRuntime"/);
assert.match(daemonActionSource, /rawAction === "android_notification_open"[\s\S]*runAndroidOpenNotification\(args, ctx\.userId\)/);
assert.doesNotMatch(daemonActionSource, /rawAction === "android_notification_open"[\s\S]{0,800}sendDaemonOp\(ctx\.userId, op/);
assert.match(routesSource, /runAndroidOpenNotification\(args, userId\)/);
assert.match(bridgeSource, /android_read_screen:\s*"android_read_screen"/);
assert.doesNotMatch(daemonShellSource, /type: ["']android_type["'], text: ["']\\n["']/);
assert.match(runtimeSource, /\{ type: ["']android_notify["'], title, body \}/);
assert.match(runtimeSource, /galleryPersistence:\s*["']temporary_chat_preview/);
assert.match(runtimeSource, /userFacingSummary:\s*["']Attached to this chat as a temporary preview/);
assert.match(runtimeSource, /explainUnsupportedPhoneRuntimeAction/);
assert.match(routesSource, /Phone action unavailable/);
assert.match(routesSource, /buttonLabel\?:\s*string/);
assert.match(routesSource, /execResult\.buttonLabel[\s\S]*linkData\.buttonLabel = execResult\.buttonLabel/);
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
