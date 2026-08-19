import assert from "node:assert/strict";
import type OpenAI from "openai";

process.env.JARVIS_CODEX_OAUTH_ENABLED = "false";

function chatTool(name: string): OpenAI.Chat.Completions.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name,
      description: `${name} test tool`,
      parameters: { type: "object", properties: {}, required: [] },
    },
  };
}

async function main() {
  const {
    deterministicAndroidToolSummary,
    deterministicPhoneRuntimeToolCallFromRequest,
    hasContextualPhoneRuntimeActionRequest,
    hasPhoneRuntimeActionRequest,
    hasUnsupportedPhoneDeviceControlRequest,
    isContextualPhoneRuntimeCoveredRequest,
    isPhoneRuntimeCoveredRequest,
    isUnqualifiedPhoneAppOnlyRequest,
    unqualifiedPhoneAppTarget,
  } = await import("../phoneRuntimeRouting");
  const { resolveAndroidNotificationFollowUp } = await import("../androidNotificationFollowups");
  const {
    extractAndroidNotificationsFromScreenContext,
    normalizeAndroidNotifications,
    summarizeAndroidNotifications,
  } = await import("../androidNotificationSummary");

  const phoneTools = [
    chatTool("android_open_app_by_name"),
    chatTool("android_youtube_search"),
    chatTool("android_capture_screen"),
    chatTool("android_read_notifications"),
  ];
  const connectedPhoneRuntime = { androidActive: true, phoneRuntimeCoveredRequest: true };

  assert.equal(hasUnsupportedPhoneDeviceControlRequest("Open Facebook and record screen"), true);
  assert.equal(hasUnsupportedPhoneDeviceControlRequest("Record screen and open Facebook"), true);
  assert.equal(hasUnsupportedPhoneDeviceControlRequest("Open Facebook and check the weather"), false);
  assert.equal(hasUnsupportedPhoneDeviceControlRequest("Open Facebook"), false);

  assert.equal(isPhoneRuntimeCoveredRequest("Open Amazon"), true);
  const amazonOpen = deterministicPhoneRuntimeToolCallFromRequest("Open Amazon", phoneTools, connectedPhoneRuntime);
  assert.equal(amazonOpen?.function.name, "android_open_app_by_name");
  assert.deepEqual(JSON.parse(amazonOpen?.function.arguments ?? "{}"), { appName: "Amazon" });
  for (const preambledRequest of ["Okay, open Facebook", "Now open Facebook"]) {
    assert.equal(isPhoneRuntimeCoveredRequest(preambledRequest), true);
    assert.deepEqual(
      JSON.parse(
        deterministicPhoneRuntimeToolCallFromRequest(
          preambledRequest,
          phoneTools,
          connectedPhoneRuntime,
        )?.function.arguments ?? "{}",
      ),
      { appName: "Facebook" },
    );
  }
  for (const affirmativeIdiom of ["Don't forget to open Amazon", "Do not hesitate to open Amazon"]) {
    assert.equal(isPhoneRuntimeCoveredRequest(affirmativeIdiom), true);
    assert.deepEqual(
      JSON.parse(
        deterministicPhoneRuntimeToolCallFromRequest(
          affirmativeIdiom,
          phoneTools,
          connectedPhoneRuntime,
        )?.function.arguments ?? "{}",
      ),
      { appName: "Amazon" },
    );
  }
  for (const affirmativeCompound of [
    "Open Amazon; don't forget to open it",
    "Open Amazon—do not hesitate to open it",
  ]) {
    assert.equal(isPhoneRuntimeCoveredRequest(affirmativeCompound), true);
  }
  for (const [requestText, appName] of [
    ["Open Facebook Lite", "Facebook Lite"],
    ["Open Facebook Messenger", "Facebook Messenger"],
  ] as const) {
    const appOpen = deterministicPhoneRuntimeToolCallFromRequest(requestText, phoneTools, connectedPhoneRuntime);
    assert.equal(appOpen?.function.name, "android_open_app_by_name");
    assert.deepEqual(JSON.parse(appOpen?.function.arguments ?? "{}"), { appName });
  }
  for (const appName of ["Uber", "Netflix", "Pokémon GO", "微信", "Cash App"]) {
    const requestText = `Open ${appName}`;
    assert.equal(isPhoneRuntimeCoveredRequest(requestText), appName === "Uber" || appName === "Cash App");
    assert.deepEqual(
      JSON.parse(
        deterministicPhoneRuntimeToolCallFromRequest(requestText, phoneTools, {
          ...connectedPhoneRuntime,
          confirmedAppTarget: appName,
        })?.function.arguments ?? "{}",
      ),
      { appName },
    );
  }
  for (const appName of ["Dr. Driving", "St. John Ambulance"]) {
    const requestText = `Open ${appName}`;
    assert.equal(isPhoneRuntimeCoveredRequest(requestText), false);
    assert.deepEqual(
      JSON.parse(
        deterministicPhoneRuntimeToolCallFromRequest(requestText, phoneTools, {
          ...connectedPhoneRuntime,
          confirmedAppTarget: appName,
        })?.function.arguments ?? "{}",
      ),
      { appName },
    );
  }
  for (const excludedGenericAppRequest of [
    "Open anything but Facebook",
    "Open neither Amazon nor Facebook",
    "Open Amazon or Facebook",
  ]) {
    assert.equal(isPhoneRuntimeCoveredRequest(excludedGenericAppRequest), false);
    assert.equal(
      deterministicPhoneRuntimeToolCallFromRequest(
        excludedGenericAppRequest,
        phoneTools,
        connectedPhoneRuntime,
      ),
      null,
    );
  }
  for (const politeRequest of ["Could you please open Amazon", "Can you please launch Amazon", "Open Amazon, please"]) {
    assert.equal(isPhoneRuntimeCoveredRequest(politeRequest), true, `${politeRequest} must enter Phone Runtime`);
    assert.equal(
      deterministicPhoneRuntimeToolCallFromRequest(politeRequest, phoneTools, connectedPhoneRuntime)?.function.name,
      "android_open_app_by_name",
    );
  }
  for (const intentRequest of ["I want to open Facebook", "I'd like to open Facebook"]) {
    assert.equal(isPhoneRuntimeCoveredRequest(intentRequest), true);
    assert.deepEqual(
      JSON.parse(
        deterministicPhoneRuntimeToolCallFromRequest(intentRequest, phoneTools, connectedPhoneRuntime)?.function.arguments ?? "{}",
      ),
      { appName: "Facebook" },
    );
  }
  for (const deferredRequest of ["Open Amazon tomorrow", "Open Amazon at 5 PM"]) {
    assert.equal(isPhoneRuntimeCoveredRequest(deferredRequest), false, `${deferredRequest} must not launch immediately`);
    assert.equal(
      deterministicPhoneRuntimeToolCallFromRequest(deferredRequest, phoneTools, connectedPhoneRuntime),
      null,
      `${deferredRequest} must not dispatch a deterministic app-open call`,
    );
  }
  for (const immediateRequest of ["Open Facebook if possible", "Open Facebook as soon as possible"]) {
    assert.equal(isPhoneRuntimeCoveredRequest(immediateRequest), true);
    assert.deepEqual(
      JSON.parse(
        deterministicPhoneRuntimeToolCallFromRequest(immediateRequest, phoneTools, connectedPhoneRuntime)?.function.arguments ?? "{}",
      ),
      { appName: "Facebook" },
    );
  }
  for (const deferredRequest of [
    "Open Amazon after lunch",
    "Open Amazon when I get home",
    "Open Amazon at 17:00",
    "Open Amazon this evening",
    "Open Amazon in a while",
  ]) {
    assert.equal(isPhoneRuntimeCoveredRequest(deferredRequest), false, `${deferredRequest} must not launch immediately`);
  }
  const repeatRequest = "Open Amazon once again";
  assert.equal(isPhoneRuntimeCoveredRequest(repeatRequest), true);
  assert.deepEqual(
    JSON.parse(
      deterministicPhoneRuntimeToolCallFromRequest(repeatRequest, phoneTools, connectedPhoneRuntime)?.function.arguments ?? "{}",
    ),
    { appName: "Amazon" },
  );
  for (const negatedRequest of [
    "Don't open Amazon",
    "Do not launch YouTube",
    "Never start Spotify",
    "Open Amazon — actually don't",
    "Open Amazon — never mind",
    "Open Amazon, cancel that",
  ]) {
    assert.equal(isPhoneRuntimeCoveredRequest(negatedRequest), false, `${negatedRequest} must not enter Phone Runtime`);
    assert.equal(
      deterministicPhoneRuntimeToolCallFromRequest(negatedRequest, phoneTools, connectedPhoneRuntime),
      null,
      `${negatedRequest} must not dispatch a deterministic app-open call`,
    );
  }
  const mixedNegatedOpenRequest = "Don't open Amazon; read my notifications";
  assert.equal(isPhoneRuntimeCoveredRequest(mixedNegatedOpenRequest), true);
  assert.equal(
    deterministicPhoneRuntimeToolCallFromRequest(mixedNegatedOpenRequest, phoneTools, connectedPhoneRuntime)?.function.name,
    "android_read_notifications",
    "a negated app-open clause must not suppress an independent notification request",
  );
  const coordinatedNegatedNotificationRequest = "Don't read, show, or list my notifications";
  assert.equal(isPhoneRuntimeCoveredRequest(coordinatedNegatedNotificationRequest), false);
  assert.equal(
    deterministicPhoneRuntimeToolCallFromRequest(
      coordinatedNegatedNotificationRequest,
      phoneTools,
      connectedPhoneRuntime,
    ),
    null,
    "coordinated notification verbs must remain under the leading negation",
  );
  for (const informationalRequest of ["Why did you open Amazon?", "Explain how to open Amazon", "Can Android open Amazon?"]) {
    assert.equal(isPhoneRuntimeCoveredRequest(informationalRequest), false, `${informationalRequest} is not an app-open command`);
    assert.equal(
      deterministicPhoneRuntimeToolCallFromRequest(informationalRequest, phoneTools, connectedPhoneRuntime),
      null,
      `${informationalRequest} must not dispatch a deterministic app-open call`,
    );
  }
  for (const informationalYoutubeRequest of ["Can Android open YouTube?", "Why did you open YouTube?"]) {
    assert.equal(isPhoneRuntimeCoveredRequest(informationalYoutubeRequest), false);
  }
  const nestedOpenRequest = "Open a Google search for how to open Amazon";
  assert.equal(isPhoneRuntimeCoveredRequest(nestedOpenRequest), false);
  assert.equal(
    deterministicPhoneRuntimeToolCallFromRequest(nestedOpenRequest, phoneTools, connectedPhoneRuntime),
    null,
    "an app name nested in search text must not become the commanded target",
  );
  for (const documentRequest of ["Open the attached spreadsheet", "Open the quarterly PDF"]) {
    assert.equal(isPhoneRuntimeCoveredRequest(documentRequest), false);
    assert.equal(
      deterministicPhoneRuntimeToolCallFromRequest(documentRequest, phoneTools, connectedPhoneRuntime),
      null,
      `${documentRequest} must stay on the document tool surface`,
    );
  }
  for (const webRequest of ["Open dev.example.com", "Open dev.example.com/setup", "Open amazon.com", "Open facebook.com/help", "Open Amazon website"]) {
    assert.equal(isPhoneRuntimeCoveredRequest(webRequest), false, `${webRequest} is a web target, not an app-open command`);
    assert.equal(
      deterministicPhoneRuntimeToolCallFromRequest(webRequest, phoneTools, connectedPhoneRuntime),
      null,
      `${webRequest} must not dispatch a deterministic app-open call`,
    );
  }
  const excludedPackageRequest = "Open Facebook, not the Android app package com.facebook.lite";
  assert.equal(isPhoneRuntimeCoveredRequest(excludedPackageRequest), true);
  assert.equal(
    deterministicPhoneRuntimeToolCallFromRequest(excludedPackageRequest, phoneTools, connectedPhoneRuntime),
    null,
    "an excluded package must not override the requested app",
  );
  const unrelatedPackageRequest = "Open Facebook; OpenVPN's Android app package is de.blinkt.openvpn";
  assert.deepEqual(
    JSON.parse(
      deterministicPhoneRuntimeToolCallFromRequest(
        unrelatedPackageRequest,
        phoneTools,
        connectedPhoneRuntime,
      )?.function.arguments ?? "{}",
    ),
    { appName: "Facebook" },
    "an unrelated package statement must not override the commanded app",
  );
  const explicitPackageRequest = "Open the Android app package de.blinkt.openvpn";
  assert.deepEqual(
    JSON.parse(
      deterministicPhoneRuntimeToolCallFromRequest(
        explicitPackageRequest,
        phoneTools,
        connectedPhoneRuntime,
      )?.function.arguments ?? "{}",
    ),
    { appName: "de.blinkt.openvpn" },
  );
  const appInsteadOfWebsiteRequest = "Open Amazon app, not the website";
  assert.equal(isPhoneRuntimeCoveredRequest(appInsteadOfWebsiteRequest), true);
  assert.deepEqual(
    JSON.parse(
      deterministicPhoneRuntimeToolCallFromRequest(
        appInsteadOfWebsiteRequest,
        phoneTools,
        connectedPhoneRuntime,
      )?.function.arguments ?? "{}",
    ),
    { appName: "Amazon" },
  );

  const priorAmazonConversation = [
    "The correct Amazon Shopping package is com.amazon.mShop.android.shopping.",
  ];
  assert.equal(
    isContextualPhoneRuntimeCoveredRequest("Can you launch it directly now?", priorAmazonConversation),
    true,
  );
  const qualifiedPackageConversation = ["The Android app package is de.blinkt.openvpn."];
  const qualifiedPackageOpen = deterministicPhoneRuntimeToolCallFromRequest(
    "Launch it directly now",
    phoneTools,
    { ...connectedPhoneRuntime, recentConversation: qualifiedPackageConversation },
  );
  assert.deepEqual(JSON.parse(qualifiedPackageOpen?.function.arguments ?? "{}"), { appName: "de.blinkt.openvpn" });
  assert.equal(
    isContextualPhoneRuntimeCoveredRequest(
      "Launch it directly now",
      ["Package names: Facebook is com.facebook.katana and Amazon is com.amazon.mShop.android.shopping."],
    ),
    false,
    "multiple contextual packages must require clarification",
  );
  assert.equal(
    isContextualPhoneRuntimeCoveredRequest("Can you please launch it directly now?", priorAmazonConversation),
    true,
  );
  for (const contextualDeferredRequest of [
    "Launch it tomorrow",
    "Open it this evening",
    "Open it in a while",
    "Open it on Friday",
    "Open it on August 20",
    "Open it in two hours",
    "Open it whenever I get home",
    "Open it provided that Wi-Fi is connected",
    "Open it as long as Wi-Fi is connected",
    "Open it at five",
    "Open it next Friday",
  ]) {
    assert.equal(
      isContextualPhoneRuntimeCoveredRequest(contextualDeferredRequest, priorAmazonConversation),
      false,
      `${contextualDeferredRequest} must not execute immediately`,
    );
  }
  assert.equal(isPhoneRuntimeCoveredRequest("Open the When I Work app"), true);
  assert.equal(isPhoneRuntimeCoveredRequest("Open When I Work"), false);
  assert.deepEqual(
    JSON.parse(
      deterministicPhoneRuntimeToolCallFromRequest("Open When I Work", phoneTools, {
        ...connectedPhoneRuntime,
        confirmedAppTarget: "When I Work",
      })
        ?.function.arguments ?? "{}",
    ),
    { appName: "When I Work" },
  );
  assert.deepEqual(
    JSON.parse(
      deterministicPhoneRuntimeToolCallFromRequest(
        "Open The Weather Channel",
        phoneTools,
        { ...connectedPhoneRuntime, confirmedAppTarget: "Weather Channel" },
      )?.function.arguments ?? "{}",
    ),
    { appName: "Weather Channel" },
  );
  assert.equal(isPhoneRuntimeCoveredRequest("Open the When I Work app tomorrow"), false);
  assert.equal(
    isContextualPhoneRuntimeCoveredRequest("Can you launch it directly now?", ["Open https://docs.example.com/setup."]),
    false,
    "a contextual launch must not treat an unrelated domain as an Android package",
  );
  assert.equal(
    isContextualPhoneRuntimeCoveredRequest(
      "Launch it directly now",
      ["The Android app support site is dev.example.com."],
    ),
    false,
    "an Android app support domain is not a package declaration",
  );
  assert.equal(
    isContextualPhoneRuntimeCoveredRequest(
      "Can you launch it directly now?",
      ["Use Facebook, not the Android app package com.facebook.lite."],
    ),
    false,
    "a contextual launch must not reuse an excluded Android package",
  );
  assert.equal(
    isContextualPhoneRuntimeCoveredRequest(
      "Launch it directly now",
      ["Don't use the Android app package com.facebook.lite."],
    ),
    false,
    "a contextual launch must not reuse a negated Android package",
  );
  assert.equal(
    isContextualPhoneRuntimeCoveredRequest("Don't launch it directly now.", priorAmazonConversation),
    false,
    "a negated contextual follow-up must not reuse the prior Android package",
  );
  const contextualOpenAfterNegatedAction = "Don't search for it; open it directly now";
  assert.equal(
    isContextualPhoneRuntimeCoveredRequest(contextualOpenAfterNegatedAction, priorAmazonConversation),
    true,
  );
  assert.deepEqual(
    JSON.parse(
      deterministicPhoneRuntimeToolCallFromRequest(
        contextualOpenAfterNegatedAction,
        phoneTools,
        { ...connectedPhoneRuntime, recentConversation: priorAmazonConversation },
      )?.function.arguments ?? "{}",
    ),
    { appName: "com.amazon.mShop.android.shopping" },
  );
  assert.equal(
    isContextualPhoneRuntimeCoveredRequest("Why did you open it?", priorAmazonConversation),
    false,
    "a contextual launch must be an app-open command",
  );
  assert.equal(
    isContextualPhoneRuntimeCoveredRequest(
      "Can you launch it directly now?",
      [...priorAmazonConversation, "Let's discuss music instead.", "What would you like to know?"],
    ),
    false,
    "a contextual launch must not reuse an app from an older exchange",
  );
  assert.equal(
    isContextualPhoneRuntimeCoveredRequest("Open Spotify and launch it directly now", priorAmazonConversation),
    false,
    "a current explicit app target must prevent reuse of a prior package",
  );
  assert.equal(
    isContextualPhoneRuntimeCoveredRequest("Open Uber and launch it directly now", priorAmazonConversation),
    false,
    "an uncatalogued current app target must prevent reuse of a prior package",
  );
  const positiveAppAfterNegation = "Don't open Amazon; open Facebook";
  assert.equal(isPhoneRuntimeCoveredRequest(positiveAppAfterNegation), true);
  assert.deepEqual(
    JSON.parse(
      deterministicPhoneRuntimeToolCallFromRequest(
        positiveAppAfterNegation,
        phoneTools,
        connectedPhoneRuntime,
      )?.function.arguments ?? "{}",
    ),
    { appName: "Facebook" },
  );
  for (const cancelledRequest of [
    "Open Amazon; never mind",
    "Open Amazon; actually don't",
    "Open Amazon; wait, don't",
    "Open Amazon! Wait!",
    "Open Amazon? No.",
    "Open Amazon; don't do that",
    "Open Amazon; don't open Amazon",
  ]) {
    assert.equal(
      isPhoneRuntimeCoveredRequest(cancelledRequest),
      false,
      `${cancelledRequest} must not force the Phone Runtime tool surface`,
    );
    assert.equal(
      deterministicPhoneRuntimeToolCallFromRequest(cancelledRequest, phoneTools, connectedPhoneRuntime),
      null,
      `${cancelledRequest} must not dispatch an app launch`,
    );
  }
  for (const orderedAppRequest of [
    "Open Amazon after opening Facebook",
    "Open Amazon before opening Facebook",
    "Open Amazon. Open Facebook.",
    "Open Amazon\nOpen Facebook",
    "Open Amazon and Facebook",
    "Open Amazon. Actually, open Facebook.",
    "Open Amazon. No, open Facebook.",
    "Open Amazon. Instead, open Facebook.",
    "Open Amazon; scratch that and open Uber",
  ]) {
    assert.equal(isPhoneRuntimeCoveredRequest(orderedAppRequest), true);
    assert.equal(
      deterministicPhoneRuntimeToolCallFromRequest(orderedAppRequest, phoneTools, connectedPhoneRuntime),
      null,
      `${orderedAppRequest} must stay in the ordered multi-tool loop`,
    );
  }
  for (const mixedDomainRequest of [
    "Take a photo; open Gmail",
    "Check my calendar. Open Facebook.",
    "Open Facebook. Check my calendar.",
    "Open Facebook and check the weather",
    "Open Facebook, check the weather",
    "Open Facebook: check the weather",
    "Open Facebook — check the weather",
    "Open Facebook - check the weather",
    "Open Settings and turn on Bluetooth",
    "Email bob@example.com saying hi; open Facebook",
    "What's the weather? Open Facebook.",
    "Research quantum computing. Open Facebook.",
    "Open Facebook. Get my calendar.",
    "Open Facebook. Fetch my calendar.",
    "Cancel my 3pm meeting. Open Uber.",
    "Reschedule my 3pm meeting. Open Uber.",
    "Could you check my calendar? Open Facebook.",
    "Can you check my calendar? Open Facebook.",
    "Set my calendar event's title to Planning. Open Facebook.",
    "Open Gmail then archive the current email",
    "Open Amazon after checking the weather",
    "Open Amazon before checking the weather",
    "Open Amazon while checking the weather",
    "Are there meetings today? Open Uber.",
    "Do I have new emails? Open Facebook.",
    "Mark the current email as read. Open Facebook.",
  ]) {
    assert.equal(hasPhoneRuntimeActionRequest(mixedDomainRequest), true);
    assert.equal(isPhoneRuntimeCoveredRequest(mixedDomainRequest), false);
    assert.equal(
      deterministicPhoneRuntimeToolCallFromRequest(mixedDomainRequest, phoneTools, connectedPhoneRuntime),
      null,
      `${mixedDomainRequest} must retain the full tool surface`,
    );
  }
  assert.equal(isPhoneRuntimeCoveredRequest("I want to open a bank account"), false);
  assert.equal(
    deterministicPhoneRuntimeToolCallFromRequest("I want to open a bank account", phoneTools, connectedPhoneRuntime),
    null,
  );
  assert.equal(unqualifiedPhoneAppTarget("Open Obsidian, check the weather"), "Obsidian");
  assert.equal(unqualifiedPhoneAppTarget("Open Obsidian and check the weather"), "Obsidian");
  assert.equal(unqualifiedPhoneAppTarget("Open Obsidian and Logseq"), null);
  assert.equal(isUnqualifiedPhoneAppOnlyRequest("Open Obsidian"), true);
  assert.equal(isUnqualifiedPhoneAppOnlyRequest("Open Obsidian, check the weather"), false);
  assert.equal(isPhoneRuntimeCoveredRequest("Play jazz on YouTube"), true);
  assert.equal(
    deterministicPhoneRuntimeToolCallFromRequest("Play jazz on YouTube", phoneTools, connectedPhoneRuntime),
    null,
    "play requests must retain the full Phone Runtime tool surface",
  );
  const contextualAmazonOpen = deterministicPhoneRuntimeToolCallFromRequest(
    "Can you launch it directly now?",
    phoneTools,
    {
      ...connectedPhoneRuntime,
      recentConversation: priorAmazonConversation,
    },
  );
  assert.equal(contextualAmazonOpen?.function.name, "android_open_app_by_name");
  assert.deepEqual(
    JSON.parse(contextualAmazonOpen?.function.arguments ?? "{}"),
    { appName: "com.amazon.mShop.android.shopping" },
  );
  const contextualBareAppOpen = deterministicPhoneRuntimeToolCallFromRequest(
    "Open the app",
    phoneTools,
    { ...connectedPhoneRuntime, recentConversation: priorAmazonConversation },
  );
  assert.deepEqual(
    JSON.parse(contextualBareAppOpen?.function.arguments ?? "{}"),
    { appName: "com.amazon.mShop.android.shopping" },
  );
  assert.equal(
    deterministicPhoneRuntimeToolCallFromRequest(
      "Open it on the website",
      phoneTools,
      { ...connectedPhoneRuntime, recentConversation: priorAmazonConversation },
    ),
    null,
    "web-qualified contextual requests must not launch the native app",
  );
  for (const contextualMixedRequest of [
    "Open Spotify — launch it directly now",
    "Open Spotify, launch it directly now",
    "Open Spotify - launch it directly now",
    "Open Spotify & launch it directly now",
    "Open it and check the weather",
  ]) {
    assert.equal(
      hasPhoneRuntimeActionRequest(contextualMixedRequest) ||
        hasContextualPhoneRuntimeActionRequest(contextualMixedRequest, priorAmazonConversation),
      true,
    );
    assert.equal(
      deterministicPhoneRuntimeToolCallFromRequest(
        contextualMixedRequest,
        phoneTools,
        { ...connectedPhoneRuntime, recentConversation: priorAmazonConversation },
      ),
      null,
      `${contextualMixedRequest} must not reuse the prior app target`,
    );
  }
  assert.equal(
    deterministicPhoneRuntimeToolCallFromRequest(
      "Launch it, but not now",
      phoneTools,
      { ...connectedPhoneRuntime, recentConversation: priorAmazonConversation },
    ),
    null,
    "contextual app launches qualified with not now must not run immediately",
  );
  assert.equal(
    deterministicPhoneRuntimeToolCallFromRequest(
      "Open it if Wi-Fi is connected",
      phoneTools,
      { ...connectedPhoneRuntime, recentConversation: priorAmazonConversation },
    ),
    null,
    "conditional contextual app launches must not run before their condition is checked",
  );

  for (const [requestText, expectedQuery] of [
    ["Search YouTube for Jarvis Best Clips", "Jarvis Best Clips"],
    ["Find me local Gemma Android videos on YouTube", "local Gemma Android videos"],
    ["Open YouTube and search for agent routing tests", "agent routing tests"],
  ] as const) {
    const toolCall = deterministicPhoneRuntimeToolCallFromRequest(requestText, phoneTools, connectedPhoneRuntime);
    assert.equal(toolCall?.function.name, "android_youtube_search");
    assert.deepEqual(JSON.parse(toolCall?.function.arguments ?? "{}"), { query: expectedQuery });
  }
  const youtubeOpen = deterministicPhoneRuntimeToolCallFromRequest("Open YouTube", phoneTools, connectedPhoneRuntime);
  assert.equal(youtubeOpen?.function.name, "android_open_app_by_name");
  assert.deepEqual(JSON.parse(youtubeOpen?.function.arguments ?? "{}"), { appName: "YouTube" });
  assert.equal(
    deterministicPhoneRuntimeToolCallFromRequest("Research and summarize the best YouTube videos about Gemma", phoneTools, connectedPhoneRuntime),
    null,
    "YouTube research should stay on the server research route",
  );
  assert.equal(
    deterministicPhoneRuntimeToolCallFromRequest(
      "Open YouTube and search for cats and play the first video",
      phoneTools,
      connectedPhoneRuntime,
    ),
    null,
    "compound YouTube actions must stay in the multi-tool loop instead of leaking into the query",
  );
  assert.equal(
    deterministicPhoneRuntimeToolCallFromRequest(
      "Open Spotify and then open YouTube and search for jazz",
      phoneTools,
      connectedPhoneRuntime,
    ),
    null,
    "actions before a YouTube search must stay in the multi-tool loop",
  );
  for (const request of [
    "Open YouTube and search for cats, afterwards play the first video",
    "Open YouTube and search for cats, after that, tap the first video",
    "Open YouTube and search for cats, also watch the first video",
    "Open YouTube and search for cats and share the first video",
    "Open YouTube and search for cats then close YouTube",
    "Open YouTube and search for cats and subscribe to the channel",
    "Open YouTube and search for cats and pause the first video",
    "Open YouTube and search for cats, play the first video",
    "Open YouTube and search for cats; share the first video",
    "Open YouTube and search for cats, press the first result",
    "Open YouTube and search for cats; scroll down",
    "Open YouTube and search for cats. Press the first result.",
    "Open YouTube and search for cats: play the first video",
    "Open YouTube and search for cats. Now press the first result.",
    "Open YouTube and search for cats. Next, please scroll down.",
    "Open YouTube and search for cats. Turn the volume down.",
    "Open YouTube and search for cats; raise the volume.",
  ]) {
    assert.equal(
      deterministicPhoneRuntimeToolCallFromRequest(request, phoneTools, connectedPhoneRuntime),
      null,
      `compound YouTube connector must stay in the multi-tool loop: ${request}`,
    );
  }

  for (const requestText of [
    "Read my notifications",
    "What are my notifications?",
    "android_read _notifications and tell me what they are",
  ]) {
    assert.equal(
      isPhoneRuntimeCoveredRequest(requestText),
      true,
      `${requestText} should enter the deterministic Phone Runtime route`,
    );
    const toolCall = deterministicPhoneRuntimeToolCallFromRequest(requestText, phoneTools, connectedPhoneRuntime);
    assert.equal(toolCall?.function.name, "android_read_notifications");
  }

  assert.equal(
    deterministicPhoneRuntimeToolCallFromRequest("Read my notifications", phoneTools, {
      androidActive: false,
      phoneRuntimeCoveredRequest: false,
    }),
    null,
    "offline Android Device Control must not use the deterministic notification shortcut",
  );

  assert.equal(
    isPhoneRuntimeCoveredRequest("Summarize how Android notifications work."),
    false,
    "informational notification questions should not force phone-control routing",
  );
  assert.equal(isPhoneRuntimeCoveredRequest("Open that notification"), true);
  assert.equal(isPhoneRuntimeCoveredRequest("Search for Alex Hormozi on Facebook"), true);
  assert.equal(
    deterministicPhoneRuntimeToolCallFromRequest("Do not read my notifications.", phoneTools, connectedPhoneRuntime),
    null,
    "negated notification requests must not run phone control",
  );
  assert.equal(
    deterministicPhoneRuntimeToolCallFromRequest("Read my notifications and then open Gmail.", phoneTools, connectedPhoneRuntime),
    null,
    "compound phone requests must stay in the multi-tool loop",
  );
  assert.equal(
    deterministicPhoneRuntimeToolCallFromRequest("Read my notifications and open Gmail.", phoneTools, connectedPhoneRuntime),
    null,
    "plain-and compound phone requests must stay in the multi-tool loop",
  );
  const appThenNotificationsRequest = "Open Gmail then read my notifications";
  assert.equal(isPhoneRuntimeCoveredRequest(appThenNotificationsRequest), true);
  assert.equal(
    deterministicPhoneRuntimeToolCallFromRequest(appThenNotificationsRequest, phoneTools, connectedPhoneRuntime),
    null,
    "an app launch followed by a notification read must stay in the multi-tool loop",
  );
  const notificationSummaryRequest = "Read my notifications and summarize them";
  assert.equal(
    isPhoneRuntimeCoveredRequest(notificationSummaryRequest),
    true,
    "result processing must retain the Phone Runtime tool surface",
  );
  assert.equal(
    deterministicPhoneRuntimeToolCallFromRequest(notificationSummaryRequest, phoneTools, connectedPhoneRuntime),
    null,
    "notification result processing must stay in the multi-tool loop",
  );
  for (const request of [
    "Read my notifications. Turn the volume down.",
    "Read my notifications; open Gmail.",
    "Read my notifications. Now turn the volume up.",
    "Read my notifications: Next, please open Gmail.",
    "Read my notifications. Go back.",
    "Read my notifications. Go home.",
    "Read my notifications. Notify me when you're done.",
    "Read my notifications. Alert me when you're finished.",
    "Read my notifications. Let me know when you're done.",
    "Read my notifications. Wait for the screen to settle.",
    "Read my notifications and notify me when you're done.",
    "Read my notifications and wait for Gmail to open.",
    "Read my notifications. Navigate to https://example.com.",
    "Read my notifications. Browse to https://example.com.",
    "Read my notifications and navigate to https://example.com.",
    "Read my notifications and browse to https://example.com.",
  ]) {
    assert.equal(
      deterministicPhoneRuntimeToolCallFromRequest(request, phoneTools, connectedPhoneRuntime),
      null,
      `punctuation-separated notification actions must stay in the multi-tool loop: ${request}`,
    );
  }
  assert.equal(
    deterministicPhoneRuntimeToolCallFromRequest("Do I have any Gmail notifications?", phoneTools, connectedPhoneRuntime),
    null,
    "filtered notification requests must let the normal loop apply the filter",
  );
  assert.equal(
    deterministicPhoneRuntimeToolCallFromRequest("Read my notifications but only give me the count.", phoneTools, connectedPhoneRuntime),
    null,
    "count-only notification requests must not stream the broad notification list",
  );

  const finalText = deterministicAndroidToolSummary("android_read_notifications", {
    result: "success",
    label: "2 notifications",
    detail: JSON.stringify({
      notifications: [
        { app: "Life360", title: "Justin arrived Home", text: "", ts: Date.now() },
        { app: "Codex", title: "PR review finished", text: "No major issues found", ts: Date.now() },
      ],
      source: "notification_listener",
    }),
  }, {
    deterministicToolCall: true,
  });

  assert.match(finalText ?? "", /Life360/);
  assert.match(finalText ?? "", /Codex/);
  assert.doesNotMatch(finalText ?? "", /cannot|do not have access|language model/i);
  assert.equal(
    deterministicAndroidToolSummary("android_read_notifications", {
      result: "success",
      label: "2 notifications",
      detail: JSON.stringify({
        notifications: [
          { app: "Life360", title: "Justin arrived Home", text: "", ts: Date.now() },
          { app: "Codex", title: "PR review finished", text: "No major issues found", ts: Date.now() },
        ],
      }),
    }),
    null,
    "model-selected notification tool calls must not short-circuit the multi-tool loop",
  );

  const shadeScreenContext = JSON.stringify({
    package: "com.android.systemui",
    activity: "android.widget.FrameLayout",
    text: [
      "AT&T",
      "Bluetooth on.",
      "NFC on",
      "Alarm",
      "Battery 20 percent.",
      "Applications are using your location.",
      "Remote",
      "3:33 AM",
      "Codex is working",
      "Expand",
      "Life360",
      "3:16 AM",
      "Turn off Battery Optimization",
      "Jarvis app",
      "3:15 AM",
      "Connected to SM-F956U",
    ],
  });
  const shadeSummary = deterministicAndroidToolSummary("android_read_notifications", {
    result: "success",
    label: "Notification shade read",
    detail: JSON.stringify({
      source: "notification_shade_accessibility_tree",
      screenContext: shadeScreenContext,
    }),
  }, {
    deterministicToolCall: true,
  });
  assert.match(shadeSummary ?? "", /Codex|Life360|Jarvis app/);
  assert.doesNotMatch(shadeSummary ?? "", /com\.android\.systemui|"package"|\{"text"/);
  const shadeNotifications = extractAndroidNotificationsFromScreenContext(shadeScreenContext);
  assert.ok(shadeNotifications.length >= 2);
  assert.match(JSON.stringify(shadeNotifications), /Codex is working/);
  assert.doesNotMatch(JSON.stringify(shadeNotifications), /just now/);
  const shadeFollowUpSummary = resolveAndroidNotificationFollowUp("Summarize this", shadeNotifications);
  assert.equal(shadeFollowUpSummary?.kind, "summary");
  assert.match(shadeFollowUpSummary?.response ?? "", /Codex|Life360|Jarvis app/);
  const repeatedAppShadeNotifications = extractAndroidNotificationsFromScreenContext(JSON.stringify({
    text: [
      "Gmail",
      "3:16 AM",
      "Alice: First email",
      "3:15 AM",
      "Bob: Second email",
    ],
  }));
  assert.equal(repeatedAppShadeNotifications.length, 2);
  assert.equal(repeatedAppShadeNotifications[0]?.app, "Gmail");
  assert.equal(repeatedAppShadeNotifications[1]?.app, "Gmail");
  assert.doesNotMatch(JSON.stringify(repeatedAppShadeNotifications), /\"app\":\"Alice/);

  const followUpNotifications = [
    { app: "Gmail", pkg: "com.google.android.gm", title: "Reddit digest", text: "Trending posts from Reddit", ts: Date.now() },
    { app: "Reddit", pkg: "com.reddit.frontpage", title: "vivecoding thread", text: "New replies", ts: Date.now() },
  ];
  const referencedOpen = resolveAndroidNotificationFollowUp("Open the Reddit one", followUpNotifications);
  assert.equal(referencedOpen?.kind, "open");
  assert.equal(referencedOpen?.notification.app, "Reddit");

  const tiedBudgetNotifications = [
    { key: "gmail-budget-1", app: "Gmail", pkg: "com.google.android.gm", title: "Budget", text: "First update", ts: Date.now() },
    { key: "gmail-budget-2", app: "Gmail", pkg: "com.google.android.gm", title: "Budget", text: "Second update", ts: Date.now() },
  ];
  const ambiguousBudgetOpen = resolveAndroidNotificationFollowUp("Open the Budget notification", tiedBudgetNotifications);
  assert.equal(ambiguousBudgetOpen, null, "tied non-ordinal notification matches must not select an arbitrary key");
  const ordinalBudgetOpen = resolveAndroidNotificationFollowUp("Open the second one", tiedBudgetNotifications);
  assert.equal(ordinalBudgetOpen?.kind, "open");
  assert.equal(ordinalBudgetOpen?.notification.key, "gmail-budget-2");

  const plainOpen = resolveAndroidNotificationFollowUp("Open Reddit", [
    { app: "Gmail", pkg: "com.google.android.gm", title: "Reddit digest", text: "Trending posts from Reddit", ts: Date.now() },
  ]);
  assert.equal(plainOpen, null, "plain app opens must fall through to app control instead of notification context");

  const messagesOpen = resolveAndroidNotificationFollowUp("Open Messages", [
    { app: "Gmail", pkg: "com.google.android.gm", title: "New messages", text: "Unread messages are waiting", ts: Date.now() },
  ]);
  assert.equal(messagesOpen, null, "Messages app opens must not be treated as notification-message references");
  const partialAppNameOpen = resolveAndroidNotificationFollowUp("Open Google Maps", [
    { app: "Google Play Services", pkg: "com.google.android.gms", title: "Account action", text: "Review settings", ts: Date.now() },
  ]);
  assert.equal(partialAppNameOpen, null, "plain app opens must not match cached notifications by partial app-name terms");
  const exactAppNameOpen = resolveAndroidNotificationFollowUp("Open Google Play Services", [
    { app: "Google Play Services", pkg: "com.google.android.gms", title: "Account action", text: "Review settings", ts: Date.now() },
  ]);
  assert.equal(exactAppNameOpen?.kind, "open", "plain app opens may use cached context when the full app name matches");

  const metaQuestion = resolveAndroidNotificationFollowUp("What are notifications?", followUpNotifications);
  assert.equal(metaQuestion, null, "generic notification meta questions must not reveal current notifications");
  const ownNotificationQuestion = resolveAndroidNotificationFollowUp("What are my notifications?", followUpNotifications);
  assert.equal(ownNotificationQuestion, null, "explicit current notification requests must refresh from Android");
  const currentNotificationQuestion = resolveAndroidNotificationFollowUp("What are my current notifications?", followUpNotifications);
  assert.equal(currentNotificationQuestion, null, "current notification requests must not use stale follow-up context");
  const justReadNotificationQuestion = resolveAndroidNotificationFollowUp("What were the notifications you just read?", followUpNotifications);
  assert.equal(justReadNotificationQuestion?.kind, "summary");

  const olderVisibleNotification = resolveAndroidNotificationFollowUp("Read all of them", [
    { app: "Reddit", pkg: "com.reddit.frontpage", title: "Older thread", text: "Still visible", ts: Date.now() - 60 * 60 * 1000 },
  ]);
  assert.equal(olderVisibleNotification?.kind, "read_all", "observed notification context must not depend on post age");
  const explicitReadAllCurrentNotifications = resolveAndroidNotificationFollowUp("Read all my notifications", followUpNotifications);
  assert.equal(explicitReadAllCurrentNotifications, null, "explicit current all-notification requests must refresh from Android");
  const explicitShowAllCurrentNotifications = resolveAndroidNotificationFollowUp("Show every notification", followUpNotifications);
  assert.equal(explicitShowAllCurrentNotifications, null, "explicit all-notification requests must not use stale context");
  const pronounReadAllNotifications = resolveAndroidNotificationFollowUp("Show every one of these", followUpNotifications);
  assert.equal(pronounReadAllNotifications?.kind, "read_all", "pronoun all-notification follow-ups should still use cached context");
  const allHandsSpecificRead = resolveAndroidNotificationFollowUp("Read the All Hands notification", [
    { app: "Calendar", pkg: "com.google.android.calendar", title: "All Hands", text: "Starts at 3 PM", ts: Date.now() },
    { app: "Reddit", pkg: "com.reddit.frontpage", title: "Local models thread", text: "New replies", ts: Date.now() },
  ]);
  assert.equal(allHandsSpecificRead?.kind, "read", "specific notification titles containing All must not trigger read-all");
  assert.match(allHandsSpecificRead?.response ?? "", /Calendar: All Hands/);
  const bareAllNotificationsQuestion = resolveAndroidNotificationFollowUp("Are all notifications enabled?", followUpNotifications);
  assert.equal(bareAllNotificationsQuestion, null, "bare all-notifications questions must not dump cached notifications");
  const latestNewsRequest = resolveAndroidNotificationFollowUp("Read me the latest news", [
    { app: "News", pkg: "com.google.android.apps.magazines", title: "Markets rally", text: "Stocks rose today", ts: Date.now() },
  ]);
  assert.equal(latestNewsRequest, null, "content requests without a notification referent must fall through");
  const newsNotificationRequest = resolveAndroidNotificationFollowUp("Read the News notification", [
    { app: "News", pkg: "com.google.android.apps.magazines", title: "Markets rally", text: "Stocks rose today", ts: Date.now() },
  ]);
  assert.equal(newsNotificationRequest?.kind, "read", "explicit notification reads should still use cached context");
  const bareOrdinalRead = resolveAndroidNotificationFollowUp("Read the last paragraph", followUpNotifications);
  assert.equal(bareOrdinalRead, null, "bare ordinal reads must not use notification context");
  const bareOrdinalOpen = resolveAndroidNotificationFollowUp("Open the last project", followUpNotifications);
  assert.equal(bareOrdinalOpen, null, "bare ordinal opens must not use notification context");
  const ordinalNotificationRead = resolveAndroidNotificationFollowUp("Read the last one", followUpNotifications);
  assert.equal(ordinalNotificationRead?.kind, "read", "ordinal notification referents should still work when anchored by one");
  const unrelatedLastSummary = resolveAndroidNotificationFollowUp("Tell me about the last budget meeting", followUpNotifications);
  assert.equal(unrelatedLastSummary, null, "generic last/previous summary questions must not dump cached notifications");
  const unrelatedPronounQuestion = resolveAndroidNotificationFollowUp("What are those shoes?", followUpNotifications);
  assert.equal(unrelatedPronounQuestion, null, "bare pronoun questions must not dump cached notifications");
  const unrelatedItQuestion = resolveAndroidNotificationFollowUp("Tell me about it", followUpNotifications);
  assert.equal(unrelatedItQuestion, null, "generic tell-me-about-it questions must not dump cached notifications");
  const notificationSummaryAgain = resolveAndroidNotificationFollowUp("Summarize those again", followUpNotifications);
  assert.equal(notificationSummaryAgain?.kind, "summary", "pronoun-anchored notification summaries should still work");
  const spamRiskNotifications = [
    { app: "Missed call", pkg: "com.samsung.android.dialer", title: "Spam Risk", text: "", ts: Date.now() },
    { app: "Gmail", pkg: "com.google.android.gm", title: "Invoice due", text: "Invoice 123 is due tomorrow", ts: Date.now() },
  ];
  assert.equal(
    normalizeAndroidNotifications(spamRiskNotifications)[0]?.priority,
    "normal",
    "Spam Risk missed calls must not be elevated as important notifications",
  );
  const spamRiskSummary = summarizeAndroidNotifications(spamRiskNotifications);
  assert.doesNotMatch(spamRiskSummary, /important one is:\s*Missed call:\s*Spam Risk/i);
  const fullFollowUpSummary = resolveAndroidNotificationFollowUp("Can you summarize all of them?", spamRiskNotifications);
  assert.equal(fullFollowUpSummary?.kind, "summary");
  assert.match(fullFollowUpSummary?.response ?? "", /found 2/i);
  assert.match(fullFollowUpSummary?.response ?? "", /Spam Risk/);
  assert.match(fullFollowUpSummary?.response ?? "", /Gmail/);
  assert.doesNotMatch(fullFollowUpSummary?.response ?? "", /cannot summarize|restricted to/i);
  const manyNotificationSummary = resolveAndroidNotificationFollowUp(
    "Summarize all of them",
    Array.from({ length: 14 }, (_, index) => ({
      app: `App ${index + 1}`,
      title: `Notice ${index + 1}`,
      text: "",
      ts: Date.now(),
    })),
  );
  assert.equal(manyNotificationSummary?.kind, "summary");
  assert.match(manyNotificationSummary?.response ?? "", /App 14/);
  assert.doesNotMatch(manyNotificationSummary?.response ?? "", /more beyond this summary/i);
  const allHandsNamedSummary = resolveAndroidNotificationFollowUp(
    "Summarize that All Hands notification",
    Array.from({ length: 14 }, (_, index) => ({
      app: index === 0 ? "Calendar" : `App ${index + 1}`,
      title: index === 0 ? "All Hands" : `Notice ${index + 1}`,
      text: index === 0 ? "Starts at 3 PM" : "",
      ts: Date.now(),
    })),
  );
  assert.equal(allHandsNamedSummary?.kind, "summary");
  assert.doesNotMatch(allHandsNamedSummary?.response ?? "", /App 14/);
  const soleNotification = [
    { app: "Calendar", pkg: "com.google.android.calendar", title: "Team sync", text: "Starts in 5 minutes", ts: Date.now() },
  ];
  const soleNotificationRead = resolveAndroidNotificationFollowUp("Read it", soleNotification);
  assert.equal(soleNotificationRead?.kind, "read", "single-notification pronoun reads should resolve deterministically");
  const soleNotificationOpen = resolveAndroidNotificationFollowUp("Open that", soleNotification);
  assert.equal(soleNotificationOpen?.kind, "open", "single-notification pronoun opens should resolve deterministically");
  const soleGenericOneAppOpen = resolveAndroidNotificationFollowUp("Open one app", soleNotification);
  assert.equal(soleGenericOneAppOpen, null, "generic one-app requests must not target the sole notification");
  const solePluralNotificationOpen = resolveAndroidNotificationFollowUp("Open my notifications", soleNotification);
  assert.equal(solePluralNotificationOpen, null, "plural notification-shade requests must not target the sole notification");
  const emptyObservedNotifications = resolveAndroidNotificationFollowUp("Read all of them", []);
  assert.equal(emptyObservedNotifications?.kind, "read_all", "empty observations must remain valid follow-up context");
  assert.match(emptyObservedNotifications?.response ?? "", /no current notifications/i);

  console.log("All Phone Runtime notification E2E contract assertions passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
