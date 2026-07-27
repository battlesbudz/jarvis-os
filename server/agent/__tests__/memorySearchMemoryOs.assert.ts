import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { MemoryContext } from "../../memory/memoryOs";
import type { ToolArgs, ToolContext, ToolResult } from "../types";

process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test";

const ctx = { userId: "__memory_os_tool_user__", state: {}, channel: "Test" };

let executeMemorySearchForTest: (
  args: ToolArgs,
  ctx: ToolContext,
  deps: {
    retrieveMemoryContext: (
      input: {
        userId: string;
        query: string;
        limit?: number;
        caller: string;
        skipAccessUpdate?: boolean;
      },
    ) => Promise<MemoryContext>;
    incrementAccessCount: (ids: string[]) => void;
    fetchProfileIdentity: (userId: string) => Promise<string | null>;
  },
) => Promise<ToolResult>;

function context(): MemoryContext {
  return {
    userId: ctx.userId,
    query: "morning planning",
    caller: "memory_search",
    items: [
      {
        memory: {
          id: "__memory_os_tool_1__",
          content: "The user prefers crisp morning plans.",
          category: "preferences",
          tier: "long_term",
          memoryType: "semantic",
          relevanceScore: 86,
          confidence: 92,
          accessCount: 2,
          score: 0.93,
          sourceType: "task_guidance",
        },
        provenance: [{ kind: "user_memory", id: "__memory_os_tool_1__", source: "canonical" }],
      },
    ],
    sources: {
      memories: ["__memory_os_tool_1__"],
      brainChunks: [],
      hotState: [],
    },
    provenance: [{ kind: "user_memory", id: "__memory_os_tool_1__", source: "canonical" }],
    uncertainty: [],
  };
}

async function main(): Promise<void> {
  ({ executeMemorySearchForTest } = await import("../tools/memorySearch"));
  const toolSource = fs.readFileSync(path.resolve(process.cwd(), "server/agent/tools/memorySearch.ts"), "utf8");
  assert.match(
    toolSource,
    /memoryGetTool[\s\S]*COALESCE\(sensitivity, 'normal'\) = 'normal'[\s\S]*source_type[\s\S]*NOT SIMILAR TO[\s\S]*source_ref[\s\S]*NOT SIMILAR TO/,
    "memory_get should exclude restricted summaries and legacy restricted source rows",
  );
  assert.match(
    toolSource,
    /candidateLimit[\s\S]*Math\.min\(100, Math\.max\(limit, limit \* 4\)\)[\s\S]*LIMIT \$\{candidateLimit\}[\s\S]*containsRawRestrictedContent[\s\S]*slice\(0, limit\)/,
    "memory_get should over-fetch before filtering legacy raw restricted rows",
  );

  const calls: unknown[] = [];
  const incrementedIds: string[][] = [];
  const result = await executeMemorySearchForTest(
    { query: "morning planning", limit: 5 },
    ctx,
    {
      retrieveMemoryContext: async (input) => {
        calls.push(input);
        assert.equal(input.userId, ctx.userId);
        assert.equal(input.query, "morning planning");
        assert.equal(input.limit, 10, "tool should request extra candidates before local filters");
        assert.equal(input.caller, "memory_search");
        assert.equal(input.skipAccessUpdate, true);
        return context();
      },
      incrementAccessCount: (ids) => {
        incrementedIds.push(ids);
      },
      fetchProfileIdentity: async () => null,
    },
  );

  assert.equal(result.ok, true);
  assert.match(result.content, /Memory search returned 1 actual retrieved memory/);
  assert.match(result.content, /memory_id=__memory_os_tool_1__/);
  assert.match(result.content, /source: task_guidance/);
  assert.match(result.content, /The user prefers crisp morning plans\./);
  assert.match(result.content, /stored summaries, not verbatim quotes/i);
  assert.match(result.content, /never claim the user said the exact wording/i);
  assert.deepEqual(incrementedIds, [["__memory_os_tool_1__"]]);
  assert.equal(calls.length, 1);

  const broadIncrementedIds: string[][] = [];
  const broadResult = await executeMemorySearchForTest(
    { query: "Tell me one thing that you know about me, specifically from your memories.", limit: 5 },
    ctx,
    {
      retrieveMemoryContext: async (input) => {
        assert.equal(input.limit, 20, "broad personal searches should over-fetch before provenance filtering");
        return {
          ...context(),
          items: [
            {
              memory: {
                ...context().items[0].memory,
                id: "__task_guidance_memory__",
                content: `Task guidance for "Inventory": A: I don't understand the question.`,
                category: "Task Guidance",
                sourceType: "task_guidance",
              },
              provenance: [{ kind: "user_memory", id: "__task_guidance_memory__", source: "canonical" }],
            },
            {
              memory: {
                ...context().items[0].memory,
                id: "__personal_memory__",
                content: "The user prefers direct, concise answers.",
                category: "preferences",
                sourceType: "manual",
              },
              provenance: [{ kind: "user_memory", id: "__personal_memory__", source: "canonical" }],
            },
          ],
        };
      },
      incrementAccessCount: (ids) => {
        broadIncrementedIds.push(ids);
      },
      fetchProfileIdentity: async () => null,
    },
  );
  assert.equal(broadResult.ok, true);
  assert.doesNotMatch(broadResult.content, /Task guidance for/);
  assert.match(broadResult.content, /The user prefers direct, concise answers\./);
  assert.deepEqual(broadIncrementedIds, [["__personal_memory__"]]);

  const failure = await executeMemorySearchForTest(
    { query: "morning planning", limit: 5 },
    ctx,
    {
      retrieveMemoryContext: async () => ({
        userId: ctx.userId,
        query: "morning planning",
        caller: "memory_search",
        items: [],
        sources: { memories: [], brainChunks: [], hotState: [] },
        provenance: [],
        uncertainty: ["Memory retrieval failed: database unavailable"],
      }),
      incrementAccessCount: (ids) => {
        incrementedIds.push(ids);
      },
      fetchProfileIdentity: async () => null,
    },
  );

  assert.equal(failure.ok, false);
  assert.match(failure.content, /Memory retrieval failed: database unavailable/);
  assert.equal(failure.label, "Memory search error");

  console.log("OK: memory_search routes through Memory OS facade while preserving output");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
