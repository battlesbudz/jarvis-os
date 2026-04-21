
import OpenAI from "openai";
import type { AgentTool, AgentToolCallRecord, ToolContext } from "./types";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export interface RunAgentOptions {
  model?: string;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  tools: AgentTool[];
  context: ToolContext;
  maxTurns?: number;
  maxCompletionTokens?: number;
  toolChoice?: "auto" | "required" | "none";
  /**
   * When provided, the final text-reply turn uses the OpenAI streaming API.
   * Called with each token delta as it arrives from the model so callers
   * can progressively update external UIs (e.g. Discord live-edit replies).
   * Intermediate tool-call turns always run non-streaming for clean parsing.
   */
  onToken?: (chunk: string) => void;
}

export interface AgentRunResult {
  reply: string;
  turns: number;
  toolCalls: AgentToolCallRecord[];
  finishReason: string | null;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
}

function toOpenAITool(t: AgentTool): OpenAI.Chat.Completions.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  };
}

/**
 * Run a single turn using the OpenAI streaming API.
 * Accumulates tool-call deltas across chunks so the caller can execute tools
 * after the stream completes.
 *
 * Text deltas are buffered and NOT forwarded to onToken during the stream.
 * The caller inspects the result: if toolCallList is empty (text-only reply)
 * it replays the buffer via onToken. This prevents intermediate tool-call
 * content from leaking into live-edit UIs (e.g. Discord placeholder edits).
 */
async function runStreamingTurn(params: {
  model: string;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  openAITools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined;
  toolChoice: "auto" | "required" | "none";
  maxCompletionTokens: number;
}): Promise<{
  textContent: string;
  textChunks: string[];
  toolCallList: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
  finishReason: string | null;
}> {
  const stream = await openai.chat.completions.create({
    model: params.model,
    messages: params.messages,
    tools: params.openAITools,
    tool_choice: params.openAITools ? params.toolChoice : undefined,
    max_completion_tokens: params.maxCompletionTokens,
    stream: true,
  });

  let textContent = "";
  const textChunks: string[] = [];
  // Accumulate tool-call arguments across chunks keyed by index
  const toolCallAccum = new Map<
    number,
    { id: string; name: string; args: string }
  >();
  let finishReason: string | null = null;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    const fr = chunk.choices[0]?.finish_reason;
    if (fr) finishReason = fr;

    if (delta?.content) {
      textContent += delta.content;
      textChunks.push(delta.content); // buffered — caller decides when to emit
    }

    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index;
        if (!toolCallAccum.has(idx)) {
          toolCallAccum.set(idx, { id: "", name: "", args: "" });
        }
        const acc = toolCallAccum.get(idx)!;
        if (tc.id) acc.id += tc.id;
        if (tc.function?.name) acc.name += tc.function.name;
        if (tc.function?.arguments) acc.args += tc.function.arguments;
      }
    }
  }

  // Reconstruct OpenAI-compatible tool_calls array from accumulated deltas
  const toolCallList: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] =
    Array.from(toolCallAccum.entries())
      .sort(([a], [b]) => a - b)
      .map(([, acc]) => ({
        id: acc.id,
        type: "function" as const,
        function: { name: acc.name, arguments: acc.args },
      }));

  return { textContent, textChunks, toolCallList, finishReason };
}

/**
 * Runs an OpenAI completion in a loop, executing any tool calls the model
 * requests and feeding the results back until the model returns a final
 * assistant message (or maxTurns is hit).
 *
 * When `onToken` is provided, the turn that produces the final text reply
 * uses the streaming API so the caller receives token deltas in real time.
 * Tool-call turns always run non-streaming for clean function-call parsing.
 */
export async function runAgent(opts: RunAgentOptions): Promise<AgentRunResult> {
  const {
    model = "gpt-5-mini",
    tools,
    context,
    maxTurns = 6,
    maxCompletionTokens = 2000,
    toolChoice = "auto",
    onToken,
  } = opts;

  const channel = context.channel || "Agent";
  const toolMap = new Map(tools.map((t) => [t.name, t]));
  const openAITools = tools.length > 0 ? tools.map(toOpenAITool) : undefined;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    ...opts.messages,
  ];
  const toolCalls: AgentToolCallRecord[] = [];
  let lastFinish: string | null = null;
  let reply = "";

  for (let turn = 0; turn < maxTurns; turn++) {
    // ── Non-streaming path (default, tool-call turns) ───────────────────
    let msgContent: string | null = null;
    let msgToolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | undefined;

    if (!onToken) {
      // Original non-streaming behaviour — unchanged for all existing callers.
      const completion = await openai.chat.completions.create({
        model,
        messages,
        tools: openAITools,
        tool_choice: openAITools ? toolChoice : undefined,
        max_completion_tokens: maxCompletionTokens,
      });

      const choice = completion.choices[0];
      lastFinish = choice?.finish_reason || null;
      const msg = choice?.message;
      console.log(
        `[${channel}/Agent] turn=${turn} finish=${lastFinish} tool_calls=${msg?.tool_calls?.length || 0}`,
      );
      if (!msg) break;
      msgContent = msg.content ?? null;
      msgToolCalls = msg.tool_calls ?? undefined;
    } else {
      // ── Streaming path ─────────────────────────────────────────────────
      // All turns run streaming so tool-call deltas can be accumulated.
      // Text chunks are buffered inside runStreamingTurn and are only
      // forwarded to onToken AFTER we confirm this is a text-only turn
      // (no tool calls). This prevents partial tool-orchestration text
      // from leaking into live-edit UIs such as Discord placeholder edits.
      const streamResult = await runStreamingTurn({
        model,
        messages,
        openAITools,
        toolChoice,
        maxCompletionTokens,
      });

      lastFinish = streamResult.finishReason;
      console.log(
        `[${channel}/Agent] turn=${turn} (streaming) finish=${lastFinish} tool_calls=${streamResult.toolCallList.length}`,
      );
      msgContent = streamResult.textContent || null;
      msgToolCalls =
        streamResult.toolCallList.length > 0
          ? streamResult.toolCallList
          : undefined;

      // Replay buffered text tokens only for pure text replies so the
      // caller's live-edit UI (e.g. Discord) sees progressive updates on
      // the final turn but stays quiet during tool-call turns.
      if (!msgToolCalls && streamResult.textChunks.length > 0) {
        for (const chunk of streamResult.textChunks) {
          onToken(chunk);
        }
      }
    }

    // ── Tool-call branch ───────────────────────────────────────────────
    if (msgToolCalls && msgToolCalls.length > 0) {
      const assistantMsg: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam =
        {
          role: "assistant",
          content: msgContent,
          tool_calls: msgToolCalls,
        };
      messages.push(assistantMsg);

      const results = await Promise.all(
        msgToolCalls.map(async (tc) => {
          const start = Date.now();
          const tool = toolMap.get(tc.function.name);
          let parsedArgs: Record<string, unknown> = {};
          try {
            const raw = JSON.parse(tc.function.arguments || "{}");
            if (raw && typeof raw === "object")
              parsedArgs = raw as Record<string, unknown>;
          } catch {
            parsedArgs = {};
          }

          if (!tool) {
            const result = {
              ok: false,
              content: `Unknown tool: ${tc.function.name}`,
              label: "Unknown tool",
            };
            toolCalls.push({
              name: tc.function.name,
              args: parsedArgs,
              result,
              durationMs: Date.now() - start,
            });
            return { tc, content: result.content };
          }

          try {
            const result = await tool.execute(parsedArgs, context);
            toolCalls.push({
              name: tc.function.name,
              args: parsedArgs,
              result,
              durationMs: Date.now() - start,
            });
            console.log(
              `[${channel}/Agent] tool=${tc.function.name} ok=${result.ok}${result.label ? ` label="${result.label}"` : ""} ${Date.now() - start}ms`,
            );
            return { tc, content: result.content };
          } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            const result = {
              ok: false,
              content: `Tool ${tc.function.name} threw: ${detail}`,
              label: "Tool error",
              detail,
            };
            toolCalls.push({
              name: tc.function.name,
              args: parsedArgs,
              result,
              durationMs: Date.now() - start,
            });
            console.error(
              `[${channel}/Agent] tool=${tc.function.name} threw:`,
              err,
            );
            return { tc, content: result.content };
          }
        }),
      );

      for (const { tc, content } of results) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content,
        });
      }
      continue; // next turn
    }

    // ── Text reply — no tool calls ─────────────────────────────────────
    reply = msgContent || "";
    return { reply, turns: turn + 1, toolCalls, finishReason: lastFinish, messages };
  }

  // Hit max turns. Force a final answer with tools disabled.
  console.warn(`[${channel}/Agent] hit maxTurns=${maxTurns}, forcing final answer`);
  try {
    if (onToken) {
      const streamResult = await runStreamingTurn({
        model,
        messages,
        openAITools: undefined, // no tools — force text reply
        toolChoice: "none",
        maxCompletionTokens,
      });
      reply = streamResult.textContent;
      lastFinish = streamResult.finishReason;
      // Replay buffered chunks — this is always a text-only turn (no tools).
      for (const chunk of streamResult.textChunks) {
        onToken(chunk);
      }
    } else {
      const final = await openai.chat.completions.create({
        model,
        messages,
        max_completion_tokens: maxCompletionTokens,
      });
      reply = final.choices[0]?.message?.content || "";
      lastFinish = final.choices[0]?.finish_reason || lastFinish;
    }
  } catch (err) {
    console.error(`[${channel}/Agent] final-answer call failed:`, err);
  }

  return { reply, turns: maxTurns, toolCalls, finishReason: lastFinish, messages };
}
