/**
 * Unit tests for the provider layer conversion logic.
 *
 * Run with:  npx tsx server/agent/__tests__/providers.test.ts
 *
 * No test framework required — uses Node.js built-in assert/strict.
 * No real API calls — Anthropic and OpenAI SDK clients are replaced with typed
 * mock objects after construction so every test exercises the actual production
 * code in server/agent/providers/claude.ts and server/agent/providers/openai.ts.
 *
 * Private methods are accessed via typed proxy interfaces cast with
 * `as unknown as` — an explicit double-cast that avoids the looser `as any`
 * escape hatch.
 *
 * Covers:
 *   ClaudeProvider._extractSystem():
 *     SYS-1  single system message extracted
 *     SYS-2  multiple system messages concatenated with double newline
 *     SYS-3  no system message → empty string
 *
 *   ClaudeProvider._convertMessages():
 *     CM-1  system messages skipped (extracted separately)
 *     CM-2  plain user message → { role: "user", content: string }
 *     CM-3  plain assistant message → { role: "assistant", content: string }
 *     CM-4  assistant with tool_calls → tool_use content blocks
 *     CM-5  assistant text + tool_calls → both text block and tool_use block
 *     CM-6  tool result messages → grouped into a single user turn
 *     CM-7  multiple consecutive tool results → single user turn, multiple tool_result blocks
 *     CM-8  invalid tool_call JSON arguments → empty object fallback
 *     CM-9  mixed sequence: user → assistant(tool) → tool result → user
 *
 *   ClaudeProvider._convertResponse() (Anthropic.Message → ProviderChunk[]):
 *     CR-1  text block → text chunk
 *     CR-2  tool_use block → tool_call_start + tool_call_args chunks
 *     CR-3  stop_reason "tool_use" → finish reason "tool_calls"
 *     CR-4  stop_reason "end_turn" → finish reason "end_turn"
 *     CR-5  mixed text + tool_use → correct chunk order; finish chunk is last
 *
 *   OpenAIProvider._streamTurn() streaming delta accumulation:
 *     OA-1  text deltas streamed in real time (one chunk per delta)
 *     OA-2  tool call id/name/args fragments accumulated across multiple chunks
 *     OA-3  multiple tool calls accumulated independently by index
 *     OA-4  finish reason captured from last chunk
 *     OA-5  tool call with empty args → no tool_call_args chunk emitted
 */

import assert from "node:assert/strict";
import type OpenAI from "openai";
import type Anthropic from "@anthropic-ai/sdk";
import { ClaudeProvider } from "../providers/claude";
import { OpenAIProvider } from "../providers/openai";
import type { ProviderChunk, ProviderQueryParams } from "../providers/base";

// ═══════════════════════════════════════════════════════════════════════════════
// Typed interfaces matching the structures that the real provider methods use.
// These mirror SDK types minimally so we can mock without importing the full SDK.
// ═══════════════════════════════════════════════════════════════════════════════

type OAIMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/** Subset of Anthropic.MessageParam content variants that _convertMessages produces. */
interface AnthropicTextBlock  { type: "text"; text: string }
interface AnthropicToolUseBlock { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
interface AnthropicToolResultBlock { type: "tool_result"; tool_use_id: string; content: string }
type AnthropicAssistantBlock = AnthropicTextBlock | AnthropicToolUseBlock;
interface AnthropicMessageParam {
  role: "user" | "assistant";
  content: string | AnthropicAssistantBlock[] | AnthropicToolResultBlock[];
}

/**
 * Minimal shape of an Anthropic.Message that _convertResponse iterates.
 * The real SDK type has more fields; we only supply what the method reads.
 */
interface FakeAnthropicBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}
interface FakeAnthropicMessage {
  content: FakeAnthropicBlock[];
  stop_reason: string | null;
}

/** Minimal streaming chunk matching what OpenAI provider reads from the stream. */
interface FakeOpenAIStreamChunk {
  choices: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Typed proxy interfaces — expose only the private members we test.
// Access via `instance as unknown as ProxyType` (explicit double-cast).
// ═══════════════════════════════════════════════════════════════════════════════

interface ClaudeInternal {
  _extractSystem(messages: OAIMessage[]): string;
  _convertMessages(messages: OAIMessage[]): AnthropicMessageParam[];
  _convertResponse(response: FakeAnthropicMessage): Generator<ProviderChunk>;
  _completeTurn(params: ProviderQueryParams): AsyncGenerator<ProviderChunk>;
  client: { messages: { create(req: unknown, opts?: unknown): Promise<FakeAnthropicMessage> } };
}

interface OpenAIInternal {
  _streamTurn(params: ProviderQueryParams): AsyncGenerator<ProviderChunk>;
  client: {
    chat: { completions: { create(req: unknown, opts?: unknown): Promise<AsyncGenerator<FakeOpenAIStreamChunk>> } };
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function collect<T>(gen: AsyncGenerator<T> | Generator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of gen) items.push(item);
  return items;
}

function baseParams(messages: OAIMessage[], overrides: Partial<ProviderQueryParams> = {}): ProviderQueryParams {
  return {
    model: "test-model",
    messages,
    tools: undefined,
    toolChoice: "auto",
    maxCompletionTokens: 1024,
    stream: false,
    ...overrides,
  };
}

async function* fakeAsyncIterable<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

function makeClaudeInternal(): ClaudeInternal {
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "test-key";
  return new ClaudeProvider() as unknown as ClaudeInternal;
}

function makeOpenAIInternal(): OpenAIInternal {
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "test-key";
  return new OpenAIProvider() as unknown as OpenAIInternal;
}

// ── Convenience: run _convertResponse directly ────────────────────────────────

function convertResponse(
  blocks: FakeAnthropicBlock[],
  stopReason: string | null,
): ProviderChunk[] {
  const p = makeClaudeInternal();
  const msg: FakeAnthropicMessage = { content: blocks, stop_reason: stopReason };
  const gen = p._convertResponse(msg as unknown as Anthropic.Message);
  const chunks: ProviderChunk[] = [];
  for (const c of gen) chunks.push(c);
  return chunks;
}

// ── Convenience: run _completeTurn with a mocked client ───────────────────────

async function runCompleteTurn(
  blocks: FakeAnthropicBlock[],
  stopReason: string,
): Promise<ProviderChunk[]> {
  const p = makeClaudeInternal();
  const fakeResp: FakeAnthropicMessage = { content: blocks, stop_reason: stopReason };
  p.client = { messages: { create: async () => fakeResp } };
  return collect(p._completeTurn(baseParams([{ role: "user", content: "Hi" }])));
}

// ── Convenience: run _streamTurn with a mocked client ────────────────────────

async function runStreamTurn(fakeChunks: FakeOpenAIStreamChunk[]): Promise<ProviderChunk[]> {
  const p = makeOpenAIInternal();
  p.client = { chat: { completions: { create: async () => fakeAsyncIterable(fakeChunks) } } };
  return collect(p._streamTurn(baseParams([{ role: "user", content: "Hi" }], { stream: true })));
}

// ── Typed content accessors ───────────────────────────────────────────────────

function asAssistantBlocks(content: AnthropicMessageParam["content"]): AnthropicAssistantBlock[] {
  assert.ok(Array.isArray(content), "expected content to be an array of assistant blocks");
  return content as AnthropicAssistantBlock[];
}

function asToolResultBlocks(content: AnthropicMessageParam["content"]): AnthropicToolResultBlock[] {
  assert.ok(Array.isArray(content), "expected content to be an array of tool-result blocks");
  return content as AnthropicToolResultBlock[];
}

function findText(chunks: ProviderChunk[]): Extract<ProviderChunk, { type: "text" }> | undefined {
  return chunks.find((c): c is Extract<ProviderChunk, { type: "text" }> => c.type === "text");
}

function findStart(chunks: ProviderChunk[]): Extract<ProviderChunk, { type: "tool_call_start" }> | undefined {
  return chunks.find((c): c is Extract<ProviderChunk, { type: "tool_call_start" }> => c.type === "tool_call_start");
}

function findArgs(chunks: ProviderChunk[]): Extract<ProviderChunk, { type: "tool_call_args" }> | undefined {
  return chunks.find((c): c is Extract<ProviderChunk, { type: "tool_call_args" }> => c.type === "tool_call_args");
}

function findFinish(chunks: ProviderChunk[]): Extract<ProviderChunk, { type: "finish" }> | undefined {
  return chunks.find((c): c is Extract<ProviderChunk, { type: "finish" }> => c.type === "finish");
}

function findAllStarts(chunks: ProviderChunk[]): Array<Extract<ProviderChunk, { type: "tool_call_start" }>> {
  return chunks.filter((c): c is Extract<ProviderChunk, { type: "tool_call_start" }> => c.type === "tool_call_start");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Test runner
// ═══════════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {

  // ── _extractSystem ───────────────────────────────────────────────────────────

  {
    const p = makeClaudeInternal();
    const result = p._extractSystem([
      { role: "system", content: "You are Jarvis." },
      { role: "user", content: "Hello" },
    ]);
    assert.equal(result, "You are Jarvis.", "SYS-1");
    console.log("✓ SYS-1: single system message extracted");
  }

  {
    const p = makeClaudeInternal();
    const result = p._extractSystem([
      { role: "system", content: "You are Jarvis." },
      { role: "system", content: "Always respond in English." },
      { role: "user", content: "Hi" },
    ]);
    assert.equal(result, "You are Jarvis.\n\nAlways respond in English.", "SYS-2");
    console.log("✓ SYS-2: multiple system messages concatenated with double newline");
  }

  {
    const p = makeClaudeInternal();
    assert.equal(p._extractSystem([{ role: "user", content: "Hello" }]), "", "SYS-3");
    console.log("✓ SYS-3: no system messages → empty string");
  }

  // ── _convertMessages ─────────────────────────────────────────────────────────

  // CM-1: system messages skipped
  {
    const p = makeClaudeInternal();
    const result = p._convertMessages([
      { role: "system", content: "You are Jarvis." },
      { role: "user", content: "Hello" },
    ]);
    assert.equal(result.length, 1, "CM-1: system message skipped");
    assert.equal(result[0].role, "user", "CM-1: remaining message is user");
    console.log("✓ CM-1: system messages are skipped");
  }

  // CM-2: plain user message
  {
    const p = makeClaudeInternal();
    const result = p._convertMessages([{ role: "user", content: "Hello there" }]);
    assert.equal(result.length, 1, "CM-2: one output message");
    assert.equal(result[0].role, "user", "CM-2: role is user");
    assert.equal(result[0].content, "Hello there", "CM-2: content preserved");
    console.log("✓ CM-2: plain user message converted");
  }

  // CM-3: plain assistant message
  {
    const p = makeClaudeInternal();
    const result = p._convertMessages([{ role: "assistant", content: "I can help with that." }]);
    assert.equal(result.length, 1, "CM-3: one output message");
    assert.equal(result[0].role, "assistant", "CM-3: role is assistant");
    assert.equal(result[0].content, "I can help with that.", "CM-3: content preserved");
    console.log("✓ CM-3: plain assistant message converted");
  }

  // CM-4: assistant with tool_calls → tool_use content blocks
  {
    const p = makeClaudeInternal();
    const result = p._convertMessages([
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call_abc", type: "function", function: { name: "get_weather", arguments: '{"city":"London"}' } }],
      },
    ]);
    assert.equal(result.length, 1, "CM-4: one output message");
    assert.equal(result[0].role, "assistant", "CM-4: role is assistant");
    const blocks = asAssistantBlocks(result[0].content);
    const toolUse = blocks.find((b): b is AnthropicToolUseBlock => b.type === "tool_use");
    assert.ok(toolUse, "CM-4: tool_use block present");
    assert.equal(toolUse.id, "call_abc", "CM-4: tool_use id matches");
    assert.equal(toolUse.name, "get_weather", "CM-4: tool_use name matches");
    assert.deepEqual(toolUse.input, { city: "London" }, "CM-4: input parsed from JSON");
    console.log("✓ CM-4: assistant tool_calls → tool_use content blocks");
  }

  // CM-5: assistant text + tool_calls → text block + tool_use block
  {
    const p = makeClaudeInternal();
    const result = p._convertMessages([
      {
        role: "assistant",
        content: "Let me check that.",
        tool_calls: [{ id: "call_xyz", type: "function", function: { name: "search", arguments: '{"query":"test"}' } }],
      },
    ]);
    const blocks = asAssistantBlocks(result[0].content);
    const textBlock = blocks.find((b): b is AnthropicTextBlock => b.type === "text");
    const toolBlock = blocks.find((b): b is AnthropicToolUseBlock => b.type === "tool_use");
    assert.ok(textBlock, "CM-5: text block present");
    assert.equal(textBlock.text, "Let me check that.", "CM-5: text content correct");
    assert.ok(toolBlock, "CM-5: tool_use block present");
    assert.equal(toolBlock.name, "search", "CM-5: tool_use name correct");
    console.log("✓ CM-5: assistant text + tool_calls → text block + tool_use block");
  }

  // CM-6: single tool result → user turn with tool_result block
  {
    const p = makeClaudeInternal();
    const result = p._convertMessages([
      { role: "tool", content: '{"temp":20}', tool_call_id: "call_abc" },
    ]);
    assert.equal(result.length, 1, "CM-6: one output message");
    assert.equal(result[0].role, "user", "CM-6: tool result in user turn");
    const blocks = asToolResultBlocks(result[0].content);
    assert.equal(blocks[0].type, "tool_result", "CM-6: block type is tool_result");
    assert.equal(blocks[0].tool_use_id, "call_abc", "CM-6: tool_use_id matches");
    assert.equal(blocks[0].content, '{"temp":20}', "CM-6: content preserved");
    console.log("✓ CM-6: single tool result → user turn with tool_result block");
  }

  // CM-7: multiple consecutive tool results → single user turn
  {
    const p = makeClaudeInternal();
    const result = p._convertMessages([
      { role: "tool", content: "result-A", tool_call_id: "call_1" },
      { role: "tool", content: "result-B", tool_call_id: "call_2" },
      { role: "tool", content: "result-C", tool_call_id: "call_3" },
    ]);
    assert.equal(result.length, 1, "CM-7: three tool messages grouped into one user turn");
    const blocks = asToolResultBlocks(result[0].content);
    assert.equal(blocks.length, 3, "CM-7: three tool_result blocks");
    assert.equal(blocks[0].tool_use_id, "call_1", "CM-7: first block id");
    assert.equal(blocks[1].tool_use_id, "call_2", "CM-7: second block id");
    assert.equal(blocks[2].tool_use_id, "call_3", "CM-7: third block id");
    console.log("✓ CM-7: multiple consecutive tool results grouped into one user turn");
  }

  // CM-8: invalid JSON → empty object fallback (no crash)
  {
    const p = makeClaudeInternal();
    const result = p._convertMessages([
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call_bad", type: "function", function: { name: "broken_tool", arguments: "NOT_VALID_JSON" } }],
      },
    ]);
    const blocks = asAssistantBlocks(result[0].content);
    const toolBlock = blocks.find((b): b is AnthropicToolUseBlock => b.type === "tool_use");
    assert.ok(toolBlock, "CM-8: tool_use block present despite bad JSON");
    assert.deepEqual(toolBlock.input, {}, "CM-8: bad JSON → empty object fallback");
    console.log("✓ CM-8: invalid tool_call JSON → empty object fallback (no crash)");
  }

  // CM-9: realistic sequence user → assistant(tool) → tool result → user
  {
    const p = makeClaudeInternal();
    const result = p._convertMessages([
      { role: "user", content: "What is the weather in Paris?" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call_w", type: "function", function: { name: "get_weather", arguments: '{"city":"Paris"}' } }],
      },
      { role: "tool", content: '{"temp":18,"unit":"C"}', tool_call_id: "call_w" },
      { role: "user", content: "Thanks!" },
    ]);
    assert.equal(result.length, 4, "CM-9: four output messages");
    assert.equal(result[0].role, "user", "CM-9: first is user");
    assert.equal(result[0].content, "What is the weather in Paris?", "CM-9: user content");
    assert.equal(result[1].role, "assistant", "CM-9: second is assistant");
    const assistantBlocks = asAssistantBlocks(result[1].content);
    assert.equal(assistantBlocks[0].type, "tool_use", "CM-9: assistant has tool_use block");
    assert.equal(result[2].role, "user", "CM-9: third is user (tool results)");
    const toolBlocks = asToolResultBlocks(result[2].content);
    assert.equal(toolBlocks[0].type, "tool_result", "CM-9: tool result block present");
    assert.equal(result[3].role, "user", "CM-9: fourth is user");
    assert.equal(result[3].content, "Thanks!", "CM-9: final user content");
    console.log("✓ CM-9: full round-trip sequence converted correctly");
  }

  // ── ClaudeProvider._convertResponse() ───────────────────────────────────────

  // CR-1: text block → text chunk
  {
    const chunks = convertResponse([{ type: "text", text: "Hello from Claude." }], "end_turn");
    const textChunk = findText(chunks);
    assert.ok(textChunk, "CR-1: text chunk present");
    assert.equal(textChunk.delta, "Hello from Claude.", "CR-1: text delta correct");
    console.log("✓ CR-1: text block → text chunk");
  }

  // CR-2: tool_use block → tool_call_start + tool_call_args chunks
  {
    const chunks = convertResponse(
      [{ type: "tool_use", id: "tu_1", name: "calculator", input: { expr: "2+2" } }],
      "tool_use",
    );
    const start = findStart(chunks);
    const args = findArgs(chunks);
    assert.ok(start, "CR-2: tool_call_start present");
    assert.equal(start.id, "tu_1", "CR-2: start id correct");
    assert.equal(start.name, "calculator", "CR-2: start name correct");
    assert.ok(args, "CR-2: tool_call_args present");
    assert.deepEqual(JSON.parse(args.args), { expr: "2+2" }, "CR-2: args JSON correct");
    console.log("✓ CR-2: tool_use block → tool_call_start + tool_call_args");
  }

  // CR-3: stop_reason "tool_use" → finish reason "tool_calls"
  {
    const chunks = convertResponse([{ type: "tool_use", id: "tu_2", name: "x", input: {} }], "tool_use");
    const finish = findFinish(chunks);
    assert.ok(finish, "CR-3: finish chunk present");
    assert.equal(finish.reason, "tool_calls", 'CR-3: stop_reason "tool_use" → "tool_calls"');
    console.log('✓ CR-3: stop_reason "tool_use" → finish reason "tool_calls"');
  }

  // CR-4: stop_reason "end_turn" → finish reason "end_turn"
  {
    const chunks = convertResponse([{ type: "text", text: "Done." }], "end_turn");
    const finish = findFinish(chunks);
    assert.ok(finish, "CR-4: finish chunk present");
    assert.equal(finish.reason, "end_turn", 'CR-4: stop_reason "end_turn" passed through');
    console.log('✓ CR-4: stop_reason "end_turn" → finish reason "end_turn"');
  }

  // CR-5: mixed text + tool_use → correct chunk order; finish chunk is last
  {
    const chunks = convertResponse(
      [
        { type: "text", text: "Sure, let me calculate." },
        { type: "tool_use", id: "tu_3", name: "calc", input: { op: "add" } },
      ],
      "tool_use",
    );
    const types = chunks.map((c) => c.type);
    assert.ok(types.indexOf("text") < types.indexOf("tool_call_start"), "CR-5: text before tool_call_start");
    assert.ok(types.indexOf("tool_call_start") < types.indexOf("tool_call_args"), "CR-5: start before args");
    assert.equal(types.indexOf("finish"), chunks.length - 1, "CR-5: finish is last");
    console.log("✓ CR-5: mixed text + tool_use → correct chunk order");
  }

  // ── _completeTurn() — integration sanity (mocked client) ────────────────────
  // Verifies that _completeTurn delegates to _convertResponse correctly.
  {
    const chunks = await runCompleteTurn(
      [{ type: "text", text: "Hello via completeTurn." }],
      "end_turn",
    );
    const textChunk = findText(chunks);
    assert.ok(textChunk, "CT-1: text chunk from _completeTurn");
    assert.equal(textChunk.delta, "Hello via completeTurn.", "CT-1: text delta correct");
    const finish = findFinish(chunks);
    assert.ok(finish, "CT-1: finish chunk present");
    assert.equal(finish.reason, "end_turn", "CT-1: finish reason correct");
    console.log("✓ CT-1: _completeTurn delegates correctly to _convertResponse");
  }

  // ── OpenAIProvider._streamTurn() ─────────────────────────────────────────────

  // OA-1: text deltas streamed in real time (one ProviderChunk per raw delta)
  {
    const chunks = await runStreamTurn([
      { choices: [{ delta: { content: "Hello" } }] },
      { choices: [{ delta: { content: ", world" } }] },
      { choices: [{ delta: { content: "!" }, finish_reason: "stop" }] },
    ]);
    const textChunks = chunks.filter((c): c is Extract<ProviderChunk, { type: "text" }> => c.type === "text");
    assert.equal(textChunks.length, 3, "OA-1: three text chunks emitted");
    assert.equal(textChunks.map((c) => c.delta).join(""), "Hello, world!", "OA-1: full text correct");
    console.log("✓ OA-1: text deltas streamed in real time");
  }

  // OA-2: tool call id/name/args fragments accumulated across chunks
  {
    const chunks = await runStreamTurn([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_", function: { name: "get_" } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "abc", function: { name: "weather", arguments: '{"city"' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':"Paris"}' } }] }, finish_reason: "tool_calls" }] },
    ]);
    const start = findStart(chunks);
    const args = findArgs(chunks);
    assert.ok(start, "OA-2: tool_call_start emitted");
    assert.equal(start.id, "call_abc", "OA-2: id fragments concatenated");
    assert.equal(start.name, "get_weather", "OA-2: name fragments concatenated");
    assert.ok(args, "OA-2: tool_call_args emitted");
    assert.deepEqual(JSON.parse(args.args), { city: "Paris" }, "OA-2: args produce valid JSON");
    console.log("✓ OA-2: tool call fragments accumulated correctly across chunks");
  }

  // OA-3: multiple tool calls accumulated independently by index
  {
    const chunks = await runStreamTurn([
      {
        choices: [{
          delta: {
            tool_calls: [
              { index: 0, id: "id0", function: { name: "tool_a", arguments: '{"x":1}' } },
              { index: 1, id: "id1", function: { name: "tool_b", arguments: '{"y":2}' } },
            ],
          },
          finish_reason: "tool_calls",
        }],
      },
    ]);
    const starts = findAllStarts(chunks);
    assert.equal(starts.length, 2, "OA-3: two tool_call_start chunks");
    const a = starts.find((c) => c.index === 0);
    const b = starts.find((c) => c.index === 1);
    assert.ok(a, "OA-3: tool at index 0 present");
    assert.ok(b, "OA-3: tool at index 1 present");
    assert.equal(a.name, "tool_a", "OA-3: index 0 name correct");
    assert.equal(b.name, "tool_b", "OA-3: index 1 name correct");
    console.log("✓ OA-3: multiple tool calls accumulated independently by index");
  }

  // OA-4: finish reason captured from last chunk
  {
    const chunks = await runStreamTurn([
      { choices: [{ delta: { content: "some text" } }] },
      { choices: [{ delta: {}, finish_reason: "stop" }] },
    ]);
    const finish = findFinish(chunks);
    assert.ok(finish, "OA-4: finish chunk present");
    assert.equal(finish.reason, "stop", 'OA-4: finish reason "stop" captured');
    console.log('✓ OA-4: finish reason "stop" captured from stream');
  }

  // OA-5: empty args → no tool_call_args chunk; start chunk still emitted
  {
    const chunks = await runStreamTurn([
      {
        choices: [{
          delta: { tool_calls: [{ index: 0, id: "call_empty", function: { name: "no_args_tool", arguments: "" } }] },
          finish_reason: "tool_calls",
        }],
      },
    ]);
    const argsChunks = chunks.filter((c) => c.type === "tool_call_args");
    assert.equal(argsChunks.length, 0, "OA-5: no tool_call_args chunk for empty arguments");
    assert.ok(findStart(chunks), "OA-5: tool_call_start still emitted");
    console.log("✓ OA-5: empty args → no args chunk (start chunk still emitted)");
  }

  console.log("\n✅ All provider unit tests passed.");
}

main().catch((err) => {
  console.error("\n❌ Test failed:", err);
  process.exit(1);
});
