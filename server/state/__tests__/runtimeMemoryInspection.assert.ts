import assert from "node:assert/strict";

import type { MemoryContext } from "../../memory/memoryOs";
import {
  answerRuntimeMemoryInspectionQuestion,
  classifyRuntimeMemoryInspectionIntent,
} from "../runtimeMemoryInspection";

const userId = "runtime-memory-inspection-user";

function memoryContext(query: string): MemoryContext {
  const isDoorDash = /doordash/i.test(query);
  return {
    userId,
    query,
    caller: "runtime_memory_inspection",
    items: isDoorDash
      ? [
          {
            memory: {
              id: "mem-doordash-1",
              content: "User manages DoorDash notifications personally and does not want Jarvis to prioritize all DoorDash alerts.",
              category: "preferences",
              tier: "long_term",
              memoryType: "semantic",
              relevanceScore: 91,
              confidence: 96,
              accessCount: 3,
              score: 0.97,
            },
            provenance: [{ kind: "user_memory", id: "mem-doordash-1", source: "canonical", label: "preferences" }],
          },
        ]
      : [
          {
            memory: {
              id: "mem-general-1",
              content: "User prefers terse next-step structures over broad intake questions.",
              category: "work_patterns",
              tier: "long_term",
              memoryType: "semantic",
              relevanceScore: 88,
              confidence: 94,
              accessCount: 5,
              score: 0.95,
            },
            provenance: [{ kind: "user_memory", id: "mem-general-1", source: "canonical", label: "work_patterns" }],
          },
        ],
    sources: {
      memories: isDoorDash ? ["mem-doordash-1"] : ["mem-general-1"],
      brainChunks: [],
      hotState: [],
    },
    provenance: [{
      kind: "user_memory",
      id: isDoorDash ? "mem-doordash-1" : "mem-general-1",
      source: "canonical",
    }],
    uncertainty: [],
  };
}

function memoryContextFromContents(
  query: string,
  memories: Array<{ id: string; content: string; category?: string }>,
): MemoryContext {
  return {
    userId,
    query,
    caller: "runtime_memory_inspection",
    items: memories.map((memory) => ({
      memory: {
        id: memory.id,
        content: memory.content,
        category: memory.category ?? "notes",
        tier: "long_term",
        memoryType: "semantic",
        relevanceScore: 88,
        confidence: 94,
        accessCount: 1,
        score: 0.9,
      },
      provenance: [{ kind: "user_memory", id: memory.id, source: "canonical", label: memory.category ?? "notes" }],
    })),
    sources: { memories: memories.map((memory) => memory.id), brainChunks: [], hotState: [] },
    provenance: memories.map((memory) => ({ kind: "user_memory", id: memory.id, source: "canonical" })),
    uncertainty: [],
  };
}

async function main(): Promise<void> {
  assert.deepEqual(
    classifyRuntimeMemoryInspectionIntent([{ role: "user", content: "What do you know about me?" }]),
    { kind: "exact_memory_inspection", query: "user profile preferences relationships work patterns goals blockers values", scopeLabel: "about you" },
  );
  assert.deepEqual(
    classifyRuntimeMemoryInspectionIntent([{ role: "user", content: "Show exact memories about DoorDash." }]),
    { kind: "exact_memory_inspection", query: "DoorDash", scopeLabel: "DoorDash" },
  );
  assert.deepEqual(
    classifyRuntimeMemoryInspectionIntent([{ role: "user", content: "Show memory about DoorDash." }]),
    { kind: "exact_memory_inspection", query: "DoorDash", scopeLabel: "DoorDash" },
  );
  assert.deepEqual(
    classifyRuntimeMemoryInspectionIntent([{ role: "user", content: "Show me my memories about DoorDash." }]),
    { kind: "exact_memory_inspection", query: "DoorDash", scopeLabel: "DoorDash" },
  );
  assert.deepEqual(
    classifyRuntimeMemoryInspectionIntent([{ role: "user", content: "list my memories about Stripe" }]),
    { kind: "exact_memory_inspection", query: "Stripe", scopeLabel: "Stripe" },
  );
  assert.deepEqual(
    classifyRuntimeMemoryInspectionIntent([{ role: "user", content: "Show memories about DoorDash please." }]),
    { kind: "exact_memory_inspection", query: "DoorDash", scopeLabel: "DoorDash" },
  );
  assert.deepEqual(
    classifyRuntimeMemoryInspectionIntent([{ role: "user", content: "Show memories about DoorDash for me." }]),
    { kind: "exact_memory_inspection", query: "DoorDash", scopeLabel: "DoorDash" },
  );
  assert.deepEqual(
    classifyRuntimeMemoryInspectionIntent([{ role: "user", content: "Show memories about my launch plan." }]),
    { kind: "exact_memory_inspection", query: "launch plan", scopeLabel: "launch plan" },
  );
  assert.deepEqual(
    classifyRuntimeMemoryInspectionIntent([{ role: "user", content: "What's in my memory?" }]),
    { kind: "exact_memory_inspection", query: "user profile preferences relationships work patterns goals blockers values", scopeLabel: "about you" },
  );
  assert.deepEqual(
    classifyRuntimeMemoryInspectionIntent([{ role: "user", content: "What’s in my memory?" }]),
    { kind: "exact_memory_inspection", query: "user profile preferences relationships work patterns goals blockers values", scopeLabel: "about you" },
  );
  assert.equal(
    classifyRuntimeMemoryInspectionIntent([{ role: "user", content: "Interpret what my memories say about DoorDash." }]),
    null,
  );
  assert.equal(
    classifyRuntimeMemoryInspectionIntent([{ role: "user", content: "What do you know about Kubernetes?" }]),
    null,
  );
  assert.equal(
    classifyRuntimeMemoryInspectionIntent([{ role: "user", content: "What do you know about DoorDash?" }]),
    null,
  );
  assert.equal(
    classifyRuntimeMemoryInspectionIntent([{ role: "user", content: "Show memories about DoorDash and draft a reply using them." }]),
    null,
  );
  assert.equal(
    classifyRuntimeMemoryInspectionIntent([{ role: "user", content: "Show memories about DoorDash to draft a reply." }]),
    null,
  );
  assert.equal(
    classifyRuntimeMemoryInspectionIntent([{ role: "user", content: "Show memories about DoorDash so you can draft a reply." }]),
    null,
  );
  assert.equal(
    classifyRuntimeMemoryInspectionIntent([{ role: "user", content: "Show memories about DoorDash and can you draft a reply using them?" }]),
    null,
  );
  assert.equal(
    classifyRuntimeMemoryInspectionIntent([{ role: "user", content: "Show memories about DoorDash, and then draft a reply using them." }]),
    null,
  );
  assert.equal(
    classifyRuntimeMemoryInspectionIntent([{ role: "user", content: "Show memories about DoorDash and email them to me." }]),
    null,
  );
  assert.equal(
    classifyRuntimeMemoryInspectionIntent([{ role: "user", content: "Show memories about DoorDash and remind me to review them." }]),
    null,
  );
  assert.equal(
    classifyRuntimeMemoryInspectionIntent([{ role: "user", content: "Show memories about DoorDash and save them to Drive." }]),
    null,
  );
  assert.equal(
    classifyRuntimeMemoryInspectionIntent([{ role: "user", content: "Show memories about DoorDash and tell me what they say." }]),
    null,
  );
  assert.equal(
    classifyRuntimeMemoryInspectionIntent([{ role: "user", content: "Show memories about DoorDash and compare with Uber." }]),
    null,
  );
  assert.equal(
    classifyRuntimeMemoryInspectionIntent([{ role: "user", content: "Show memories about DoorDash and could you compare with Uber?" }]),
    null,
  );
  assert.equal(
    classifyRuntimeMemoryInspectionIntent([{ role: "user", content: "Show memories about DoorDash and help me draft an email." }]),
    null,
  );
  assert.equal(
    classifyRuntimeMemoryInspectionIntent([{ role: "user", content: "Show memories about DoorDash and give me a summary." }]),
    null,
  );
  assert.equal(
    classifyRuntimeMemoryInspectionIntent([{ role: "user", content: "Show memories about DoorDash and explain them." }]),
    null,
  );
  assert.equal(
    classifyRuntimeMemoryInspectionIntent([{ role: "user", content: "Show memories about DoorDash and describe them." }]),
    null,
  );
  assert.equal(
    classifyRuntimeMemoryInspectionIntent([{ role: "user", content: "Show memories about DoorDash and put them in a doc." }]),
    null,
  );
  assert.equal(
    classifyRuntimeMemoryInspectionIntent([{ role: "user", content: "Show memories about DoorDash. Summarize them." }]),
    null,
  );
  assert.equal(
    classifyRuntimeMemoryInspectionIntent([{ role: "user", content: "Show memories about DoorDash, email them to me." }]),
    null,
  );
  assert.deepEqual(
    classifyRuntimeMemoryInspectionIntent([{ role: "user", content: "Show memories about how to build apps." }]),
    { kind: "exact_memory_inspection", query: "how to build apps", scopeLabel: "how to build apps" },
  );

  const answer = await answerRuntimeMemoryInspectionQuestion(
    {
      messages: [{ role: "user", content: "What do you know about me?" }],
      userId,
      route: { providerName: "android-local-gemma", model: "gemma-4-e4b-it" },
    },
    {
      loadCoreProfile: async () => ({
        userId,
        preferredName: "Justin",
        timezone: "America/New_York",
        language: "en",
        communicationStyle: "direct and product-focused",
        source: "profile_store",
      }),
      loadSoul: async () => ({
        content: "JARVIS purpose: help the user operate across devices.",
        manualOverride: "Pinned note: keep responses concise.",
        generatedAt: new Date("2026-06-24T12:00:00.000Z"),
        updatedAt: new Date("2026-06-24T12:00:00.000Z"),
      }),
      retrieveMemoryContext: async (input) => {
        assert.equal(input.limit, 10);
        return memoryContext(input.query);
      },
    },
  );

  assert(answer);
  assert.equal(answer.providerName, "jarvis-runtime");
  assert.equal(answer.model, "gemma-4-e4b-it");
  assert.match(answer.textContent, /limited MemoryOS inspection/);
  assert.match(answer.textContent, /up to 10 matching records/);
  assert.match(answer.textContent, /Soul\/Core Profile/);
  assert.match(answer.textContent, /Preferred name: Justin/);
  assert.match(answer.textContent, /Timezone: America\/New_York/);
  assert.match(answer.textContent, /Language: en/);
  assert.match(answer.textContent, /Communication style: direct and product-focused/);
  assert.match(answer.textContent, /JARVIS purpose: help the user operate across devices\./);
  assert.match(answer.textContent, /Pinned note: keep responses concise\./);
  assert.match(answer.textContent, /MemoryOS/);
  assert.match(answer.textContent, /User prefers terse next-step structures over broad intake questions\./);
  assert(
    answer.textContent.indexOf("Soul/Core Profile") < answer.textContent.indexOf("## MemoryOS"),
    "Soul/Core Profile should render before MemoryOS memories",
  );

  const profileFieldsAnswer = await answerRuntimeMemoryInspectionQuestion(
    {
      messages: [{ role: "user", content: "What do you know about me?" }],
      userId,
      route: { providerName: "android-local-gemma", model: "gemma-4-e4b-it" },
    },
    {
      loadCoreProfile: async () => ({
        userId,
        timezone: "America/Chicago",
        language: "en",
        communicationStyle: "concise",
        source: "profile_store",
      }),
      loadSoul: async () => null,
      retrieveMemoryContext: async (input) => ({
        userId,
        query: input.query,
        caller: "runtime_memory_inspection",
        items: [],
        sources: { memories: [], brainChunks: [], hotState: [] },
        provenance: [],
        uncertainty: [],
      }),
    },
  );
  assert(profileFieldsAnswer);
  assert.match(profileFieldsAnswer.textContent, /Timezone: America\/Chicago/);
  assert.match(profileFieldsAnswer.textContent, /Language: en/);
  assert.match(profileFieldsAnswer.textContent, /Communication style: concise/);
  assert.match(profileFieldsAnswer.textContent, /Sources: Soul\/Core Profile\./);
  assert.doesNotMatch(profileFieldsAnswer.textContent, /No stored Soul\/Core Profile entries found/);

  const topicAnswer = await answerRuntimeMemoryInspectionQuestion(
    {
      messages: [{ role: "user", content: "Show memories about DoorDash." }],
      userId,
      route: { providerName: "google", model: "gemini-2.5-flash" },
    },
    {
      loadCoreProfile: async () => {
        assert.fail("topic-scoped memory inspection must not load broad core profile data");
      },
      loadSoul: async () => {
        assert.fail("topic-scoped memory inspection must not load broad Soul data");
      },
      retrieveMemoryContext: async (input) => {
        assert.equal(input.query, "DoorDash");
        assert.equal(input.limit, 40);
        assert.equal(input.canonicalOnly, true);
        return memoryContext(input.query);
      },
    },
  );
  assert(topicAnswer);
  assert.match(topicAnswer.textContent, /DoorDash notifications personally/);
  assert.doesNotMatch(topicAnswer.textContent, /terse next-step/);
  assert.doesNotMatch(topicAnswer.textContent, /Soul\/Core Profile/);
  assert.doesNotMatch(topicAnswer.textContent, /Preferred name/);

  const derivedBrainFilteredAnswer = await answerRuntimeMemoryInspectionQuestion(
    {
      messages: [{ role: "user", content: "Show memories about DoorDash." }],
      userId,
      route: { providerName: "android-local-gemma", model: "gemma-4-e4b-it" },
    },
    {
      retrieveMemoryContext: async (input) => ({
        userId,
        query: input.query,
        caller: "runtime_memory_inspection",
        items: [
          {
            memory: {
              id: "mem-derived-doordash",
              content: "Synthesized DoorDash pattern from a derived brain chunk.",
              category: "fact",
              tier: "long_term",
              memoryType: "semantic",
              relevanceScore: 92,
              confidence: 80,
              accessCount: 0,
              score: 0.95,
              source: "gbrain",
              sourceId: "memory/doordash:0",
              sourceRefs: [{ kind: "user_memory", id: "mem-doordash-cited" }],
            },
            provenance: [
              { kind: "brain_chunk", id: "memory/doordash:0", source: "gbrain", label: "fact" },
              { kind: "user_memory", id: "mem-doordash-cited", source: "canonical", label: "fact" },
            ],
          },
          {
            memory: {
              id: "mem-doordash-exact",
              content: "Exact stored DoorDash memory.",
              category: "preferences",
              tier: "long_term",
              memoryType: "semantic",
              relevanceScore: 91,
              confidence: 96,
              accessCount: 3,
              score: 0.9,
            },
            provenance: [{ kind: "user_memory", id: "mem-doordash-exact", source: "canonical", label: "preferences" }],
          },
        ],
        sources: {
          memories: ["mem-doordash-cited", "mem-doordash-exact"],
          brainChunks: ["memory/doordash:0"],
          hotState: [],
        },
        provenance: [
          { kind: "brain_chunk", id: "memory/doordash:0", source: "gbrain", label: "fact" },
          { kind: "user_memory", id: "mem-doordash-cited", source: "canonical", label: "fact" },
          { kind: "user_memory", id: "mem-doordash-exact", source: "canonical", label: "preferences" },
        ],
        uncertainty: [],
      }),
    },
  );
  assert(derivedBrainFilteredAnswer);
  assert.match(derivedBrainFilteredAnswer.textContent, /Exact stored DoorDash memory\./);
  assert.doesNotMatch(derivedBrainFilteredAnswer.textContent, /Synthesized DoorDash pattern/);
  assert.doesNotMatch(derivedBrainFilteredAnswer.textContent, /memory\/doordash:0/);

  const politeTopicAnswer = await answerRuntimeMemoryInspectionQuestion(
    {
      messages: [{ role: "user", content: "Show memories about DoorDash for me." }],
      userId,
      route: { providerName: "android-local-gemma", model: "gemma-4-e4b-it" },
    },
    {
      retrieveMemoryContext: async (input) => {
        assert.equal(input.query, "DoorDash");
        assert.equal(input.limit, 40);
        return memoryContext(input.query);
      },
    },
  );
  assert(politeTopicAnswer);
  assert.match(politeTopicAnswer.textContent, /DoorDash notifications personally/);

  const emptyAnswer = await answerRuntimeMemoryInspectionQuestion(
    {
      messages: [{ role: "user", content: "Show memories about Stripe." }],
      userId,
      route: { providerName: "android-local-gemma", model: "gemma-4-e4b-it" },
    },
    {
      loadCoreProfile: async () => null,
      loadSoul: async () => ({ content: "", manualOverride: null, generatedAt: null, updatedAt: new Date("2026-06-24T12:00:00.000Z") }),
      retrieveMemoryContext: async (input) => {
        assert.equal(input.query, "Stripe");
        return memoryContext(input.query);
      },
    },
  );
  assert(emptyAnswer);
  assert.doesNotMatch(emptyAnswer.textContent, /Soul\/Core Profile/);
  assert.doesNotMatch(emptyAnswer.textContent, /terse next-step/);
  assert.match(emptyAnswer.textContent, /No matching MemoryOS memories found for Stripe/);

  const acronymAnswer = await answerRuntimeMemoryInspectionQuestion(
    {
      messages: [{ role: "user", content: "Show memories about HR." }],
      userId,
      route: { providerName: "android-local-gemma", model: "gemma-4-e4b-it" },
    },
    {
      retrieveMemoryContext: async (input) => {
        assert.equal(input.query, "HR");
        return memoryContext(input.query);
      },
    },
  );
  assert(acronymAnswer);
  assert.doesNotMatch(acronymAnswer.textContent, /terse next-step/);
  assert.match(acronymAnswer.textContent, /No matching MemoryOS memories found for HR/);

  const cppTopicAnswer = await answerRuntimeMemoryInspectionQuestion(
    {
      messages: [{ role: "user", content: "Show memories about C++." }],
      userId,
      route: { providerName: "android-local-gemma", model: "gemma-4-e4b-it" },
    },
    {
      retrieveMemoryContext: async (input) => {
        assert.equal(input.query, "C++");
        return memoryContextFromContents("C++", [
          { id: "mem-cpp", content: "User has notes about C++ build tooling.", category: "technical" },
          { id: "mem-c", content: "User has notes about C language examples.", category: "technical" },
        ]);
      },
    },
  );
  assert(cppTopicAnswer);
  assert.match(cppTopicAnswer.textContent, /C\+\+ build tooling/);
  assert.doesNotMatch(cppTopicAnswer.textContent, /C language examples/);

  const csharpTopicAnswer = await answerRuntimeMemoryInspectionQuestion(
    {
      messages: [{ role: "user", content: "Show memories about C#." }],
      userId,
      route: { providerName: "android-local-gemma", model: "gemma-4-e4b-it" },
    },
    {
      retrieveMemoryContext: async (input) => {
        assert.equal(input.query, "C#");
        return memoryContextFromContents("C#", [
          { id: "mem-csharp", content: "User explored C# desktop automation.", category: "technical" },
          { id: "mem-cpp", content: "User has notes about C++ build tooling.", category: "technical" },
        ]);
      },
    },
  );
  assert(csharpTopicAnswer);
  assert.match(csharpTopicAnswer.textContent, /C# desktop automation/);
  assert.doesNotMatch(csharpTopicAnswer.textContent, /C\+\+ build tooling/);

  const mixedCppTopicAnswer = await answerRuntimeMemoryInspectionQuestion(
    {
      messages: [{ role: "user", content: "Show memories about C++ build tooling." }],
      userId,
      route: { providerName: "android-local-gemma", model: "gemma-4-e4b-it" },
    },
    {
      retrieveMemoryContext: async (input) => {
        assert.equal(input.query, "C++ build tooling");
        return memoryContextFromContents("C++ build tooling", [
          { id: "mem-cpp-build", content: "User has notes about C++ build tooling.", category: "technical" },
          { id: "mem-python-build", content: "User has notes about Python build tooling.", category: "technical" },
          { id: "mem-cpp-general", content: "User has notes about C++ language examples.", category: "technical" },
        ]);
      },
    },
  );
  assert(mixedCppTopicAnswer);
  assert.match(mixedCppTopicAnswer.textContent, /C\+\+ build tooling/);
  assert.doesNotMatch(mixedCppTopicAnswer.textContent, /Python build tooling/);
  assert.doesNotMatch(mixedCppTopicAnswer.textContent, /C\+\+ language examples/);

  const w2TopicAnswer = await answerRuntimeMemoryInspectionQuestion(
    {
      messages: [{ role: "user", content: "Show memories about W-2 taxes." }],
      userId,
      route: { providerName: "android-local-gemma", model: "gemma-4-e4b-it" },
    },
    {
      retrieveMemoryContext: async (input) => {
        assert.equal(input.query, "W-2 taxes");
        return memoryContextFromContents("W-2 taxes", [
          { id: "mem-w2", content: "User needs W-2 taxes tracked for filing.", category: "finance" },
          { id: "mem-taxes", content: "User has a generic taxes checklist.", category: "finance" },
        ]);
      },
    },
  );
  assert(w2TopicAnswer);
  assert.match(w2TopicAnswer.textContent, /W-2 taxes tracked/);
  assert.doesNotMatch(w2TopicAnswer.textContent, /generic taxes checklist/);

  const rTopicAnswer = await answerRuntimeMemoryInspectionQuestion(
    {
      messages: [{ role: "user", content: "Show memories about R." }],
      userId,
      route: { providerName: "android-local-gemma", model: "gemma-4-e4b-it" },
    },
    {
      retrieveMemoryContext: async (input) => {
        assert.equal(input.query, "R");
        return memoryContextFromContents("R", [
          { id: "mem-r", content: "User uses R for statistical analysis.", category: "technical" },
          { id: "mem-general-r", content: "User prefers shorter reports.", category: "work_patterns" },
        ]);
      },
    },
  );
  assert(rTopicAnswer);
  assert.match(rTopicAnswer.textContent, /R for statistical analysis/);
  assert.doesNotMatch(rTopicAnswer.textContent, /shorter reports/);

  const multiWordTopicAnswer = await answerRuntimeMemoryInspectionQuestion(
    {
      messages: [{ role: "user", content: "Show memories about New York." }],
      userId,
      route: { providerName: "android-local-gemma", model: "gemma-4-e4b-it" },
    },
    {
      retrieveMemoryContext: async (input) => {
        assert.equal(input.query, "New York");
        assert.equal(input.limit, 40);
        return {
          userId,
          query: "New York",
          caller: "runtime_memory_inspection",
          items: [
            {
              memory: {
                id: "mem-new-app",
                content: "User is working on a new app for the York client.",
                category: "projects",
                tier: "long_term",
                memoryType: "semantic",
                relevanceScore: 88,
                confidence: 94,
                accessCount: 5,
                score: 0.95,
              },
              provenance: [{ kind: "user_memory", id: "mem-new-app", source: "canonical", label: "projects" }],
            },
            {
              memory: {
                id: "mem-new-york",
                content: "York client asked about a New York trip.",
                category: "travel",
                tier: "long_term",
                memoryType: "semantic",
                relevanceScore: 90,
                confidence: 95,
                accessCount: 2,
                score: 0.96,
              },
              provenance: [{ kind: "user_memory", id: "mem-new-york", source: "canonical", label: "travel" }],
            },
          ],
          sources: { memories: ["mem-new-app", "mem-new-york"], brainChunks: [], hotState: [] },
          provenance: [
            { kind: "user_memory", id: "mem-new-app", source: "canonical" },
            { kind: "user_memory", id: "mem-new-york", source: "canonical" },
          ],
          uncertainty: [],
        };
      },
    },
  );
  assert(multiWordTopicAnswer);
  assert.doesNotMatch(multiWordTopicAnswer.textContent, /working on a new app for the York client/);
  assert.match(multiWordTopicAnswer.textContent, /York client asked about a New York trip/);

  const stopwordTopicAnswer = await answerRuntimeMemoryInspectionQuestion(
    {
      messages: [{ role: "user", content: "Show memories about DoorDash and Uber." }],
      userId,
      route: { providerName: "android-local-gemma", model: "gemma-4-e4b-it" },
    },
    {
      retrieveMemoryContext: async (input) => {
        assert.equal(input.query, "DoorDash and Uber");
        assert.equal(input.limit, 40);
        return memoryContextFromContents("DoorDash and Uber", [
          {
            id: "mem-doordash-uber",
            content: "User compared DoorDash and Uber delivery patterns.",
            category: "work_patterns",
          },
          {
            id: "mem-uber-doordash",
            content: "User compared Uber and DoorDash courier reliability.",
            category: "work_patterns",
          },
          {
            id: "mem-doordash-general",
            content: "User manages DoorDash notifications personally.",
            category: "preferences",
          },
        ]);
      },
    },
  );
  assert(stopwordTopicAnswer);
  assert.match(stopwordTopicAnswer.textContent, /DoorDash and Uber delivery patterns/);
  assert.match(stopwordTopicAnswer.textContent, /Uber and DoorDash courier reliability/);
  assert.doesNotMatch(stopwordTopicAnswer.textContent, /DoorDash notifications personally/);

  const orTopicAnswer = await answerRuntimeMemoryInspectionQuestion(
    {
      messages: [{ role: "user", content: "Show memories about DoorDash or Uber." }],
      userId,
      route: { providerName: "android-local-gemma", model: "gemma-4-e4b-it" },
    },
    {
      retrieveMemoryContext: async (input) => {
        assert.equal(input.query, "DoorDash or Uber");
        assert.equal(input.limit, 40);
        return memoryContextFromContents("DoorDash or Uber", [
          { id: "mem-doordash-only", content: "User manages DoorDash notifications personally.", category: "preferences" },
          { id: "mem-uber-only", content: "User tracks Uber courier reliability.", category: "work_patterns" },
          { id: "mem-stripe", content: "User has Stripe payout notes.", category: "finance" },
        ]);
      },
    },
  );
  assert(orTopicAnswer);
  assert.match(orTopicAnswer.textContent, /DoorDash notifications personally/);
  assert.match(orTopicAnswer.textContent, /Uber courier reliability/);
  assert.doesNotMatch(orTopicAnswer.textContent, /Stripe payout notes/);

  const versusTopicAnswer = await answerRuntimeMemoryInspectionQuestion(
    {
      messages: [{ role: "user", content: "Show memories about DoorDash versus Uber." }],
      userId,
      route: { providerName: "android-local-gemma", model: "gemma-4-e4b-it" },
    },
    {
      retrieveMemoryContext: async (input) => {
        assert.equal(input.query, "DoorDash versus Uber");
        assert.equal(input.limit, 40);
        return memoryContextFromContents("DoorDash versus Uber", [
          { id: "mem-versus", content: "User compared DoorDash and Uber courier reliability.", category: "work_patterns" },
          { id: "mem-doordash-only", content: "User manages DoorDash notifications personally.", category: "preferences" },
        ]);
      },
    },
  );
  assert(versusTopicAnswer);
  assert.match(versusTopicAnswer.textContent, /DoorDash and Uber courier reliability/);
  assert.doesNotMatch(versusTopicAnswer.textContent, /DoorDash notifications personally/);

  const cappedTopicAnswer = await answerRuntimeMemoryInspectionQuestion(
    {
      messages: [{ role: "user", content: "Show memories about Alpha." }],
      userId,
      route: { providerName: "android-local-gemma", model: "gemma-4-e4b-it" },
    },
    {
      retrieveMemoryContext: async (input) => {
        assert.equal(input.query, "Alpha");
        assert.equal(input.limit, 40);
        return memoryContextFromContents(
          "Alpha",
          Array.from({ length: 12 }, (_, index) => ({
            id: `mem-alpha-${index + 1}`,
            content: `Alpha record ${index + 1}.`,
            category: "technical",
          })),
        );
      },
    },
  );
  assert(cappedTopicAnswer);
  assert.match(cappedTopicAnswer.textContent, /Alpha record 10/);
  assert.doesNotMatch(cappedTopicAnswer.textContent, /Alpha record 11/);

  const uncertaintyAnswer = await answerRuntimeMemoryInspectionQuestion(
    {
      messages: [{ role: "user", content: "Show memories about Stripe." }],
      userId,
      route: { providerName: "android-local-gemma", model: "gemma-4-e4b-it" },
    },
    {
      loadCoreProfile: async () => null,
      loadSoul: async () => ({ content: "", manualOverride: null, generatedAt: null, updatedAt: new Date("2026-06-24T12:00:00.000Z") }),
      retrieveMemoryContext: async () => ({
        userId,
        query: "Stripe",
        caller: "runtime_memory_inspection",
        items: [],
        sources: { memories: [], brainChunks: [], hotState: [] },
        provenance: [],
        uncertainty: ["Memory retrieval failed: DATABASE_URL postgres://user:password@example leaked"],
      }),
    },
  );
  assert(uncertaintyAnswer);
  assert.match(uncertaintyAnswer.textContent, /MemoryOS retrieval was unavailable\./);
  assert.doesNotMatch(uncertaintyAnswer.textContent, /DATABASE_URL/);
  assert.doesNotMatch(uncertaintyAnswer.textContent, /postgres/);
  assert.doesNotMatch(uncertaintyAnswer.textContent, /password/);

  const originalWarn = console.warn;
  const warningText: string[] = [];
  let errorAnswer: Awaited<ReturnType<typeof answerRuntimeMemoryInspectionQuestion>> = null;
  console.warn = (...args: unknown[]) => {
    warningText.push(args.map(String).join(" "));
  };
  try {
    errorAnswer = await answerRuntimeMemoryInspectionQuestion(
      {
        messages: [{ role: "user", content: "What do you know about me?" }],
        userId,
        route: { providerName: "android-local-gemma", model: "gemma-4-e4b-it" },
      },
      {
        loadCoreProfile: async () => {
          throw new Error("database password leaked in raw error");
        },
        loadSoul: async () => {
          throw new Error("soul query raw detail");
        },
        retrieveMemoryContext: async () => {
          throw new Error("memory connection string raw detail");
        },
      },
    );
  } finally {
    console.warn = originalWarn;
  }
  assert(errorAnswer);
  assert.match(errorAnswer.textContent, /Core profile was unavailable\./);
  assert.match(errorAnswer.textContent, /Soul was unavailable\./);
  assert.match(errorAnswer.textContent, /MemoryOS was unavailable\./);
  assert.doesNotMatch(errorAnswer.textContent, /database password/);
  assert.doesNotMatch(errorAnswer.textContent, /query raw detail/);
  assert.doesNotMatch(errorAnswer.textContent, /connection string/);
  assert.match(warningText.join("\n"), /RuntimeMemoryInspection/);
  assert.doesNotMatch(warningText.join("\n"), /database password/);
  assert.doesNotMatch(warningText.join("\n"), /query raw detail/);
  assert.doesNotMatch(warningText.join("\n"), /connection string/);

  console.log("OK: runtime memory inspection returns exact Soul/Core and MemoryOS records");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
