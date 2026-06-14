import assert from "node:assert/strict";
import type { RetrievedMemory } from "../../memory/retrieve";
import type { ToolArgs, ToolContext, ToolResult } from "../types";

process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test";

const ctx = { userId: "__identity_fallback_user__", state: {}, channel: "Test" };

type SearchDeps = {
  retrieveMemories: (
    userId: string,
    query: string,
    limit: number,
    skipAccessUpdate: boolean,
  ) => Promise<RetrievedMemory[]>;
  incrementAccessCount: (ids: string[]) => void;
  fetchProfileIdentity: (userId: string) => Promise<string | null>;
};

let executeMemorySearchForTest: (
  args: ToolArgs,
  ctx: ToolContext,
  deps: SearchDeps,
) => Promise<ToolResult>;

function memory(overrides: Partial<RetrievedMemory> = {}): RetrievedMemory {
  return {
    id: "__memory_1__",
    content: "The user prefers concise morning planning.",
    category: "preferences",
    tier: "long_term",
    memoryType: "semantic",
    relevanceScore: 87,
    confidence: 91,
    accessCount: 0,
    score: 93,
    ...overrides,
  };
}

async function runSearch(options: {
  query: string;
  memories?: RetrievedMemory[];
  profileIdentity?: string | null;
}) {
  const incrementedIds: string[][] = [];
  const result = await executeMemorySearchForTest(
    { query: options.query },
    ctx,
    {
      retrieveMemories: async () => options.memories ?? [],
      incrementAccessCount: (ids) => {
        incrementedIds.push(ids);
      },
      fetchProfileIdentity: async () => options.profileIdentity ?? null,
    },
  );
  return { result, incrementedIds };
}

async function main() {
({ executeMemorySearchForTest } = await import("../tools/memorySearch"));

{
  const { result, incrementedIds } = await runSearch({
    query: "Search my memory for what name you should call me.",
    profileIdentity: "Battles",
  });

  assert.equal(result.ok, true);
  assert.match(result.content, /No memories found/);
  assert.match(result.content, /Profile identity fallback: Battles/);
  assert.doesNotMatch(result.content, /retrieved memor(?:y|ies).*Battles/i);
  assert.deepEqual(incrementedIds, [[]]);
  console.log("OK: name query with no memories returns profile identity fallback");
}

{
  const { result } = await runSearch({
    query: "user name identity what is my name",
    memories: [memory()],
    profileIdentity: "Battles Budz",
  });

  assert.equal(result.ok, true);
  assert.match(result.content, /^Profile identity fallback: Battles Budz/);
  assert.match(result.content, /answer with this fallback identity/i);
  console.log("OK: model-expanded identity query puts profile fallback first");
}

{
  const { result } = await runSearch({
    query: "What do you remember about my work hours?",
    profileIdentity: "Battles",
  });

  assert.equal(result.ok, true);
  assert.match(result.content, /No memories found/);
  assert.doesNotMatch(result.content, /Profile identity fallback/);
  console.log("OK: ordinary memory query omits profile identity fallback");
}

{
  const { result, incrementedIds } = await runSearch({
    query: "What nickname or preferred name should you call me?",
    memories: [memory({ content: "The user said their preferred name is JB." })],
    profileIdentity: "Justin",
  });

  assert.equal(result.ok, true);
  assert.match(result.content, /actual retrieved memory/);
  assert.match(result.content, /The user said their preferred name is JB\./);
  assert.match(result.content, /Profile identity fallback: Justin/);
  assert.match(result.content, /not a retrieved memory or stated preference/i);
  assert.deepEqual(incrementedIds, [["__memory_1__"]]);
  console.log("OK: memory result and profile fallback are clearly separated");
}

console.log("\nAll memory search identity fallback assertions passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
