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
  assert.match(result.content, /The user prefers crisp morning plans\./);
  assert.deepEqual(incrementedIds, [["__memory_os_tool_1__"]]);
  assert.equal(calls.length, 1);

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
