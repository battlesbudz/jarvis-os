import assert from "node:assert/strict";

import {
  LOCAL_RUNTIME_WORKING_CONTEXT_SCOPE_TYPE,
  LOCAL_RUNTIME_WORKING_CONTEXT_TTL_MS,
  buildRuntimeObservationContent,
  recordLocalRuntimeObservation,
  retrieveRelevantRuntimeWorkingContext,
  type StoredRuntimeWorkingContextRow,
} from "../runtimeWorkingContext";
import {
  auditLocalRuntimeResponse,
  repairLocalRuntimeToolCall,
} from "../localRuntimeTruthAudit";
import {
  buildRuntimeStateCard,
  buildRuntimeStateCardPrompt,
  type RuntimeStateCardDeps,
} from "../stateCard";

async function testWorkingContextUsesFiveMinuteRuntimeTtl() {
  const now = new Date("2026-07-03T00:00:00.000Z");
  const record = await recordLocalRuntimeObservation({
    userId: "user-local-runtime",
    kind: "notifications",
    sourceChannel: "voice",
    summary: "Two visible notifications were read.",
    detail: "Codex: Review finished\nLife360: Justin arrived Home",
    eventId: "evt_notifications_1",
    now,
  }, {
    async upsertWorkingContext(input) {
      assert.equal(input.scopeType, LOCAL_RUNTIME_WORKING_CONTEXT_SCOPE_TYPE);
      assert.equal(input.scopeId, "global:notifications");
      const expiresAt = new Date(now.getTime() + (input.ttlMs ?? LOCAL_RUNTIME_WORKING_CONTEXT_TTL_MS)).toISOString();
      return {
        userId: input.userId,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        activeGoal: input.activeGoal ?? null,
        currentStep: input.currentStep ?? null,
        lastEventId: input.lastEventId,
        content: input.content,
        state: "active",
        updatedAt: now.toISOString(),
        expiresAt,
      };
    },
  });

  assert.equal(Date.parse(record.expiresAt) - now.getTime(), LOCAL_RUNTIME_WORKING_CONTEXT_TTL_MS);
  assert.match(record.content, /Two visible notifications/);
  console.log("OK: local runtime working context stores observations with a five-minute TTL");
}

async function testWorkingContextIsSharedAndOnlyRetrievedWhenRelevant() {
  const now = new Date("2026-07-03T00:00:00.000Z");
  const rows: StoredRuntimeWorkingContextRow[] = [{
    scopeType: LOCAL_RUNTIME_WORKING_CONTEXT_SCOPE_TYPE,
    scopeId: "global:notifications",
    content: buildRuntimeObservationContent({
      userId: "user-local-runtime",
      kind: "notifications",
      sourceChannel: "voice",
      summary: "Two visible notifications were read.",
      detail: "Codex: Review finished\nLife360: Justin arrived Home",
      eventId: "evt_notifications_1",
      now,
    }),
    updatedAt: now,
    expiresAt: new Date(now.getTime() + LOCAL_RUNTIME_WORKING_CONTEXT_TTL_MS),
  }];

  const deps = {
    async listActiveWorkingContext() {
      return rows;
    },
  };

  const relevant = await retrieveRelevantRuntimeWorkingContext({
    userId: "user-local-runtime",
    query: "Summarize those notifications.",
    now,
  }, deps);
  assert.equal(relevant.length, 1);
  assert.equal(relevant[0]?.kind, "notifications");
  assert.match(relevant[0]?.content ?? "", /Codex: Review finished/);

  const unrelated = await retrieveRelevantRuntimeWorkingContext({
    userId: "user-local-runtime",
    query: "Tell me a joke.",
    now,
  }, deps);
  assert.equal(unrelated.length, 0);
  console.log("OK: local runtime working context is shared across turn channels and relevance-gated");
}

async function testStateCardInjectsOnlyRelevantWorkingContext() {
  const deps: RuntimeStateCardDeps = {
    now: () => new Date("2026-07-03T00:00:00.000Z"),
    async loadProfileState(userId) {
      return { userId, preferredName: "Justin", source: "profile_store" };
    },
    async loadTaskState() {
      return [];
    },
    async loadWorkingContext(input) {
      if (!/notifications/i.test(input.query)) return [];
      return [{
        source: "working_context",
        label: "Recent notifications",
        content: "Codex: Review finished",
        provenance: ["working_context:notifications:evt_notifications_1"],
      }];
    },
  };

  const withContext = await buildRuntimeStateCardPrompt({
    userId: "user-local-runtime",
    activeDevice: "android",
    activeModel: "local-gemma",
    seedQuery: "Which of those notifications matter?",
    includeMemoryContext: false,
    includeWorkingContext: true,
    renderMaxChars: 5_000,
  }, deps);
  assert.match(withContext, /Recent notifications/);
  assert.match(withContext, /Codex: Review finished/);
  assert.match(withContext, /working_context/);

  const withoutContext = await buildRuntimeStateCardPrompt({
    userId: "user-local-runtime",
    activeDevice: "android",
    activeModel: "local-gemma",
    seedQuery: "Tell me a joke.",
    includeMemoryContext: false,
    includeWorkingContext: true,
    renderMaxChars: 5_000,
  }, deps);
  assert.doesNotMatch(withoutContext, /Codex: Review finished/);

  const defaultCloudContext = await buildRuntimeStateCardPrompt({
    userId: "user-local-runtime",
    activeDevice: "web",
    activeModel: "claude",
    seedQuery: "Which of those notifications matter?",
    includeMemoryContext: false,
    renderMaxChars: 5_000,
  }, deps);
  assert.doesNotMatch(defaultCloudContext, /Codex: Review finished/);
  console.log("OK: runtime state card includes working context only when explicitly enabled and relevant");
}

async function testStateCardCombinesWorkingContextAndMemoryContext() {
  const deps: RuntimeStateCardDeps = {
    now: () => new Date("2026-07-03T00:00:00.000Z"),
    async loadProfileState(userId) {
      return { userId, preferredName: "Justin", source: "profile_store" };
    },
    async loadTaskState() {
      return [];
    },
    async loadWorkingContext() {
      return [{
        source: "working_context",
        label: "Recent notifications",
        content: "Codex: Review finished",
        provenance: ["working_context:notifications:evt_notifications_1"],
      }];
    },
    async retrieveMemoryContext(input) {
      return {
        userId: input.userId,
        query: input.query,
        caller: "runtime_working_context_truth_audit_test",
        items: [{
          memory: {
            id: "memory-1",
            content: "User wants JARVIS to prioritize phone control reliability.",
            category: "preferences",
            tier: "long_term",
            memoryType: "semantic",
            relevanceScore: 90,
            confidence: 95,
            accessCount: 1,
            score: 0.91,
            source: "canonical",
            sourceId: "memory-1",
            sourceRefs: [],
          },
          provenance: [{
            kind: "user_memory",
            id: "memory-1",
            source: "canonical",
            label: "preferences",
          }],
        }],
        sources: { memories: ["memory-1"], brainChunks: [], hotState: [] },
        provenance: [{
          kind: "user_memory",
          id: "memory-1",
          source: "canonical",
          label: "preferences",
        }],
        uncertainty: [],
      };
    },
  };

  const card = await buildRuntimeStateCard({
    userId: "user-local-runtime",
    activeDevice: "android",
    activeModel: "local-gemma",
    seedQuery: "Which of those notifications matter to me?",
    includeMemoryContext: true,
    includeWorkingContext: true,
  }, deps);

  assert.equal(card.relevantContext.length, 2);
  assert.equal(card.relevantContext[0]?.source, "working_context");
  assert.equal(card.relevantContext[1]?.source, "memory_os");
  assert.match(card.relevantContext.map((item) => item.content).join("\n"), /Codex: Review finished/);
  assert.match(card.relevantContext.map((item) => item.content).join("\n"), /phone control reliability/);
  assert.ok(card.provenance.includes("working_context"));
  assert.ok(card.provenance.includes("memory_os"));
  console.log("OK: runtime state card combines working context with MemoryOS context");
}

function testTruthAuditBlocksFalseDenialsAndCompletions() {
  const falseDenial = auditLocalRuntimeResponse({
    userMessage: "Read my notifications.",
    responseText: "I cannot read notifications on this device.",
    capabilityState: { notifications: "available" },
  });
  assert.equal(falseDenial.status, "blocked_false_denial");
  assert.doesNotMatch(falseDenial.text, /android_|{|}/);

  const failedNotificationActionDenial = auditLocalRuntimeResponse({
    userMessage: "Read my notifications.",
    responseText: "I cannot read notifications on this device.",
    capabilityState: { notifications: "available" },
    actionResults: [{
      toolName: "android_read_notifications",
      ok: false,
      summary: "Notification access is disabled.",
    }],
  });
  assert.equal(failedNotificationActionDenial.status, "allow");

  const genericAppDenial = auditLocalRuntimeResponse({
    userMessage: "Open Gmail.",
    responseText: "I can't open Gmail.",
    capabilityState: { app_control: "available" },
  });
  assert.equal(genericAppDenial.status, "blocked_false_denial");

  const failedAppActionDenial = auditLocalRuntimeResponse({
    userMessage: "Open Gmail.",
    responseText: "I can't open Gmail.",
    capabilityState: { app_control: "available" },
    actionResults: [{
      toolName: "android_open_app_by_name",
      ok: false,
      target: "Gmail",
      summary: "Could not resolve an installed Android app named Gmail.",
    }],
  });
  assert.equal(failedAppActionDenial.status, "allow");

  const startAppDenial = auditLocalRuntimeResponse({
    userMessage: "Start Gmail.",
    responseText: "I can't start Gmail app.",
    capabilityState: { app_control: "available" },
  });
  assert.equal(startAppDenial.status, "blocked_false_denial");

  const bareStartAppDenial = auditLocalRuntimeResponse({
    userMessage: "Start Gmail.",
    responseText: "I can't start Gmail.",
    capabilityState: { app_control: "available" },
  });
  assert.equal(bareStartAppDenial.status, "blocked_false_denial");

  const startClarificationDenial = auditLocalRuntimeResponse({
    userMessage: "Can you continue?",
    responseText: "I can't start until you pick an account.",
    capabilityState: { app_control: "available" },
  });
  assert.equal(startClarificationDenial.status, "allow");

  const abstractStartDenial = auditLocalRuntimeResponse({
    userMessage: "Start the task.",
    responseText: "I can't start the task until you pick an account.",
    capabilityState: { app_control: "available" },
  });
  assert.equal(abstractStartDenial.status, "allow");

  const openSourceDenial = auditLocalRuntimeResponse({
    userMessage: "Can you open-source this repo?",
    responseText: "I can't open-source this repo.",
    capabilityState: { app_control: "available" },
  });
  assert.equal(openSourceDenial.status, "allow");

  const unavailableDenial = auditLocalRuntimeResponse({
    userMessage: "Read my notifications.",
    responseText: "I cannot read notifications on this device.",
    capabilityState: { notifications: "unavailable" },
  });
  assert.equal(unavailableDenial.status, "allow");

  const missingMemoryData = auditLocalRuntimeResponse({
    userMessage: "What is my favorite color?",
    responseText: "I can't remember your favorite color.",
    capabilityState: { memory: "available" },
    evidence: ["memory_search returned no matching favorite color memory."],
  });
  assert.equal(missingMemoryData.status, "allow");

  const memoryWriteDenial = auditLocalRuntimeResponse({
    userMessage: "Remember that my favorite color is green.",
    responseText: "I can't remember that.",
    capabilityState: { memory: "available" },
  });
  assert.equal(memoryWriteDenial.status, "blocked_false_denial");

  const memoryCapabilityDenial = auditLocalRuntimeResponse({
    userMessage: "Search your memory for my favorite color.",
    responseText: "I can't access JARVIS memory.",
    capabilityState: { memory: "available" },
  });
  assert.equal(memoryCapabilityDenial.status, "blocked_false_denial");

  const falseCompletion = auditLocalRuntimeResponse({
    userMessage: "Open YouTube.",
    responseText: "I opened YouTube.",
    capabilityState: { app_control: "available" },
    actionResults: [],
  });
  assert.equal(falseCompletion.status, "blocked_false_completion");
  assert.equal(falseCompletion.text, "I have not completed that yet.");

  const falseLaunchCompletion = auditLocalRuntimeResponse({
    userMessage: "Launch Gmail.",
    responseText: "I launched Gmail.",
    capabilityState: { app_control: "available" },
    actionResults: [],
  });
  assert.equal(falseLaunchCompletion.status, "blocked_false_completion");

  const nonDeviceStartedAnswer = auditLocalRuntimeResponse({
    userMessage: "Can you make a plan?",
    responseText: "I started by checking the constraints.",
    capabilityState: { app_control: "available" },
    actionResults: [],
  });
  assert.equal(nonDeviceStartedAnswer.status, "allow");

  const nonDeviceOpenedAnswer = auditLocalRuntimeResponse({
    userMessage: "Write a sentence about entering a room.",
    responseText: "I opened the door.",
    capabilityState: { app_control: "available" },
    actionResults: [],
  });
  assert.equal(nonDeviceOpenedAnswer.status, "allow");

  const nonDeviceCopiedAnswer = auditLocalRuntimeResponse({
    userMessage: "Explain the example.",
    responseText: "I copied the example into the explanation.",
    capabilityState: { clipboard: "available" },
    actionResults: [],
  });
  assert.equal(nonDeviceCopiedAnswer.status, "allow");

  const memoryBackedOpenedAnswer = auditLocalRuntimeResponse({
    userMessage: "What do you know about my business?",
    responseText: "You opened your shop in 2020.",
    capabilityState: { app_control: "available", memory: "available" },
    actionResults: [{ toolName: "memory_search", ok: true, summary: "Found business timeline memory." }],
  });
  assert.equal(memoryBackedOpenedAnswer.status, "allow");

  const unrelatedPhoneAndMemoryAnswer = auditLocalRuntimeResponse({
    userMessage: "What do you know about my business?",
    responseText: "You opened your shop in 2020.",
    capabilityState: { app_control: "available", memory: "available" },
    actionResults: [
      { toolName: "android_open_app_by_name", ok: true, target: "YouTube" },
      { toolName: "memory_search", ok: true, summary: "Found business timeline memory." },
    ],
  });
  assert.equal(unrelatedPhoneAndMemoryAnswer.status, "allow");

  const falseStartedAppCompletion = auditLocalRuntimeResponse({
    userMessage: "Start Gmail.",
    responseText: "I started Gmail app.",
    capabilityState: { app_control: "available" },
    actionResults: [],
  });
  assert.equal(falseStartedAppCompletion.status, "blocked_false_completion");

  const falseBareStartedAppCompletion = auditLocalRuntimeResponse({
    userMessage: "Start Gmail.",
    responseText: "I started Gmail.",
    capabilityState: { app_control: "available" },
    actionResults: [],
  });
  assert.equal(falseBareStartedAppCompletion.status, "blocked_false_completion");

  const falseUrlCompletion = auditLocalRuntimeResponse({
    userMessage: "Open https://example.com.",
    responseText: "I opened https://example.com.",
    capabilityState: { app_control: "available" },
    actionResults: [],
  });
  assert.equal(falseUrlCompletion.status, "blocked_false_completion");

  const falseDeepLinkCompletion = auditLocalRuntimeResponse({
    userMessage: "Open geo:0,0?q=coffee.",
    responseText: "I opened geo:0,0?q=coffee.",
    capabilityState: { app_control: "available" },
    actionResults: [],
  });
  assert.equal(falseDeepLinkCompletion.status, "blocked_false_completion");

  const falseTrailingUrlCompletion = auditLocalRuntimeResponse({
    userMessage: "Open https://example.com.",
    responseText: "I opened https://example.com in Chrome.",
    capabilityState: { app_control: "available" },
    actionResults: [],
  });
  assert.equal(falseTrailingUrlCompletion.status, "blocked_false_completion");

  const falseBareDomainClaimWithSchemeCompletion = auditLocalRuntimeResponse({
    userMessage: "Open example.com.",
    responseText: "I opened https://example.com.",
    capabilityState: { app_control: "available" },
    actionResults: [],
  });
  assert.equal(falseBareDomainClaimWithSchemeCompletion.status, "blocked_false_completion");

  const mismatchedBareDomainCompletion = auditLocalRuntimeResponse({
    userMessage: "Open example.com.",
    responseText: "I opened example.com.",
    capabilityState: { app_control: "available" },
    actionResults: [{
      toolName: "android_open_phone_url",
      ok: true,
      target: "https://notexample.com/path",
    }],
  });
  assert.equal(mismatchedBareDomainCompletion.status, "blocked_false_completion");

  const mismatchedBareDomainQueryCompletion = auditLocalRuntimeResponse({
    userMessage: "Open example.com?x=1.",
    responseText: "I opened example.com?x=1.",
    capabilityState: { app_control: "available" },
    actionResults: [{
      toolName: "android_open_phone_url",
      ok: true,
      target: "https://example.com?x=2",
    }],
  });
  assert.equal(mismatchedBareDomainQueryCompletion.status, "blocked_false_completion");

  const falseTrailingDeepLinkCompletion = auditLocalRuntimeResponse({
    userMessage: "Open spotify:search:foo.",
    responseText: "I opened spotify:search:foo in Spotify.",
    capabilityState: { app_control: "available" },
    actionResults: [],
  });
  assert.equal(falseTrailingDeepLinkCompletion.status, "blocked_false_completion");

  const confirmedCompletion = auditLocalRuntimeResponse({
    userMessage: "Open YouTube.",
    responseText: "I opened YouTube.",
    capabilityState: { app_control: "available" },
    actionResults: [{ toolName: "android_open_app_by_name", ok: true, target: "YouTube" }],
  });
  assert.equal(confirmedCompletion.status, "allow");

  const confirmedPoliteCompletion = auditLocalRuntimeResponse({
    userMessage: "Open YouTube.",
    responseText: "I opened YouTube for you.",
    capabilityState: { app_control: "available" },
    actionResults: [{ toolName: "android_open_app_by_name", ok: true, target: "YouTube" }],
  });
  assert.equal(confirmedPoliteCompletion.status, "allow");

  const confirmedAppPhraseCompletion = auditLocalRuntimeResponse({
    userMessage: "Open YouTube.",
    responseText: "I opened the YouTube app.",
    capabilityState: { app_control: "available" },
    actionResults: [{ toolName: "android_open_app_by_name", ok: true, target: "YouTube" }],
  });
  assert.equal(confirmedAppPhraseCompletion.status, "allow");

  const confirmedPackageNameCompletion = auditLocalRuntimeResponse({
    userMessage: "Open Gmail.",
    responseText: "I opened Gmail.",
    capabilityState: { app_control: "available" },
    actionResults: [{ toolName: "android_open_app_by_name", ok: true, target: "com.google.android.gm" }],
  });
  assert.equal(confirmedPackageNameCompletion.status, "allow");

  const confirmedYoutubeSearch = auditLocalRuntimeResponse({
    userMessage: "Search YouTube for AI videos.",
    responseText: "I opened YouTube.",
    capabilityState: { app_control: "available" },
    actionResults: [{
      toolName: "android_youtube_search",
      ok: true,
      target: "AI videos",
      summary: "Opened YouTube search for AI videos.",
    }],
  });
  assert.equal(confirmedYoutubeSearch.status, "allow");

  const confirmedYoutubeSearchResults = auditLocalRuntimeResponse({
    userMessage: "Search YouTube for AI videos.",
    responseText: "I opened YouTube search results for AI videos.",
    capabilityState: { app_control: "available" },
    actionResults: [{
      toolName: "android_youtube_search",
      ok: true,
      target: "AI videos",
      summary: "YouTube search: AI videos.",
    }],
  });
  assert.equal(confirmedYoutubeSearchResults.status, "allow");

  const youtubeSearchDoesNotConfirmGmailAppOpen = auditLocalRuntimeResponse({
    userMessage: "Search YouTube for Gmail.",
    responseText: "I opened Gmail.",
    capabilityState: { app_control: "available" },
    actionResults: [{
      toolName: "android_youtube_search",
      ok: true,
      target: "Gmail",
      summary: "YouTube search: Gmail.",
    }],
  });
  assert.equal(youtubeSearchDoesNotConfirmGmailAppOpen.status, "blocked_false_completion");

  const confirmedUrlOpen = auditLocalRuntimeResponse({
    userMessage: "Open example.com.",
    responseText: "I opened example.com.",
    capabilityState: { app_control: "available" },
    actionResults: [{
      toolName: "android_open_phone_url",
      ok: true,
      target: "https://example.com",
    }],
  });
  assert.equal(confirmedUrlOpen.status, "allow");

  const confirmedBareDomainQueryOpen = auditLocalRuntimeResponse({
    userMessage: "Open example.com?x=1.",
    responseText: "I opened example.com?x=1.",
    capabilityState: { app_control: "available" },
    actionResults: [{
      toolName: "android_open_phone_url",
      ok: true,
      target: "https://example.com?x=1",
    }],
  });
  assert.equal(confirmedBareDomainQueryOpen.status, "allow");

  const confirmedSchemeUrlOpen = auditLocalRuntimeResponse({
    userMessage: "Open https://example.com.",
    responseText: "I opened https://example.com.",
    capabilityState: { app_control: "available" },
    actionResults: [{
      toolName: "android_open_phone_url",
      ok: true,
      target: "https://example.com",
    }],
  });
  assert.equal(confirmedSchemeUrlOpen.status, "allow");

  const confirmedDeepLinkOpen = auditLocalRuntimeResponse({
    userMessage: "Open geo:0,0?q=coffee.",
    responseText: "I opened geo:0,0?q=coffee.",
    capabilityState: { app_control: "available" },
    actionResults: [{
      toolName: "android_open_phone_url",
      ok: true,
      target: "geo:0,0?q=coffee",
    }],
  });
  assert.equal(confirmedDeepLinkOpen.status, "allow");

  const confirmedTrailingDeepLinkOpen = auditLocalRuntimeResponse({
    userMessage: "Open spotify:search:foo.",
    responseText: "I opened spotify:search:foo in Spotify.",
    capabilityState: { app_control: "available" },
    actionResults: [{
      toolName: "android_open_phone_url",
      ok: true,
      target: "spotify:search:foo",
    }],
  });
  assert.equal(confirmedTrailingDeepLinkOpen.status, "allow");
  console.log("OK: truth audit blocks false denials and unconfirmed completions");
}

function testTruthAuditBlocksUnsupportedMemoryClaims() {
  const unsupportedClaim = auditLocalRuntimeResponse({
    userMessage: "Who am I?",
    responseText: "Your name is Justin.",
    capabilityState: { memory: "available" },
    evidence: [],
  });
  assert.equal(unsupportedClaim.status, "blocked_unsupported_claim");
  assert.match(unsupportedClaim.text, /check JARVIS memory or profile/);

  const supportedClaim = auditLocalRuntimeResponse({
    userMessage: "Who am I?",
    responseText: "Your name is Justin.",
    capabilityState: { memory: "available" },
    evidence: ["- Preferred name: Justin"],
  });
  assert.equal(supportedClaim.status, "allow");

  const ordinarySecondPerson = auditLocalRuntimeResponse({
    userMessage: "What am I asking?",
    responseText: "You are asking about your notifications.",
    capabilityState: { memory: "available" },
    evidence: [],
  });
  assert.equal(ordinarySecondPerson.status, "allow");
  console.log("OK: truth audit checks strong personal claims against supplied evidence");
}

function testTruthAuditPreservesAllowedFormatting() {
  const formatted = "Here are the important ones:\n- Codex review finished\n- Life360 arrived home";
  const allowed = auditLocalRuntimeResponse({
    userMessage: "Summarize my notifications.",
    responseText: formatted,
    capabilityState: { notifications: "available" },
  });
  assert.equal(allowed.status, "allow");
  assert.equal(allowed.text, formatted);
  console.log("OK: truth audit preserves allowed response formatting");
}

function testTruthAuditRepairsOneSafeToolCallAttempt() {
  const repaired = repairLocalRuntimeToolCall({
    requestedToolName: "android_view_screenshot",
    availableToolNames: ["android_capture_screen"],
  });
  assert.deepEqual(repaired, {
    status: "repair_tool_call",
    repairedToolName: "android_capture_screen",
  });

  const failed = repairLocalRuntimeToolCall({
    requestedToolName: "google_search",
    availableToolNames: ["android_capture_screen"],
    repairAttempted: true,
  });
  assert.equal(failed.status, "friendly_failure");
  assert.doesNotMatch(failed.text, /google_search|android_capture_screen|{|}|stack|provider/i);
  console.log("OK: truth audit supports one safe hidden repair and friendly repair failure");
}

async function main() {
  await testWorkingContextUsesFiveMinuteRuntimeTtl();
  await testWorkingContextIsSharedAndOnlyRetrievedWhenRelevant();
  await testStateCardInjectsOnlyRelevantWorkingContext();
  await testStateCardCombinesWorkingContextAndMemoryContext();
  testTruthAuditBlocksFalseDenialsAndCompletions();
  testTruthAuditBlocksUnsupportedMemoryClaims();
  testTruthAuditPreservesAllowedFormatting();
  testTruthAuditRepairsOneSafeToolCallAttempt();
  console.log("\nAll runtime working context and truth audit assertions passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
