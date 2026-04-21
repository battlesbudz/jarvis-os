
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
  /** Called with each streamed token chunk on the final reply turn. When provided
   *  the final turn uses the OpenAI streaming API so callers receive incremental
   *  text updates (e.g. for Discord live-edit replies). Intermediate tool-call
   *  turns always run non-streaming for clean function-call parsing. */
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
 * Runs an OpenAI completion in a loop, executing any tool calls the model
 * requests and feeding the results back until the model returns a final
 * assistant message (or maxTurns is hit).
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
    console.log(`[${channel}/Agent] turn=${turn} finish=${lastFinish} tool_calls=${msg?.tool_calls?.length || 0}`);

    if (!msg) break;

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      // Push assistant message containing the tool_calls
      const assistantMsg: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
        role: "assistant",
        content: msg.content ?? null,
        tool_calls: msg.tool_calls,
      };
      messages.push(assistantMsg);

      // Execute every tool call in parallel
      const results = await Promise.all(
        msg.tool_calls.map(async (tc) => {
          const start = Date.now();
          const tool = toolMap.get(tc.function.name);
          let parsedArgs: Record<string, unknown> = {};
          try {
            const raw = JSON.parse(tc.function.arguments || "{}");
            if (raw && typeof raw === "object") parsedArgs = raw as Record<string, unknown>;
          } catch {
            parsedArgs = {};
          }

          if (!tool) {
            const result = {
              ok: false,
              content: `Unknown tool: ${tc.function.name}`,
              label: "Unknown tool",
            };
            toolCalls.push({ name: tc.function.name, args: parsedArgs, result, durationMs: Date.now() - start });
            return { tc, content: result.content };
          }

          try {
            const result = await tool.execute(parsedArgs, context);
            toolCalls.push({ name: tc.function.name, args: parsedArgs, result, durationMs: Date.now() - start });
            console.log(`[${channel}/Agent] tool=${tc.function.name} ok=${result.ok} ${result.label ? `label="${result.label}"` : ""} ${Date.now() - start}ms`);
            return { tc, content: result.content };
          } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            const result = {
              ok: false,
              content: `Tool ${tc.function.name} threw: ${detail}`,
              label: "Tool error",
              detail,
            };
            toolCalls.push({ name: tc.function.name, args: parsedArgs, result, durationMs: Date.now() - start });
            console.error(`[${channel}/Agent] tool=${tc.function.name} threw:`, err);
            return { tc, content: result.content };
          }
        })
      );

      // Append tool results in the same order
      for (const { tc, content } of results) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content,
        });
      }
      // Continue the loop — model gets another turn
      continue;
    }

    // No tool calls — model produced final reply (or stopped)
    reply = msg.content || "";
    // When a streaming callback is registered, emit the reply in small chunks
    // so callers can progressively update external UIs (e.g. Discord message edits).
    if (onToken && reply) {
      const CHUNK = 25;
      for (let i = 0; i < reply.length; i += CHUNK) {
        onToken(reply.slice(i, i + CHUNK));
      }
    }
    return { reply, turns: turn + 1, toolCalls, finishReason: lastFinish, messages };
  }

  // Hit max turns. Force a final answer with tools disabled.
  console.warn(`[${channel}/Agent] hit maxTurns=${maxTurns}, forcing final answer`);
  try {
    const final = await openai.chat.completions.create({
      model,
      messages,
      max_completion_tokens: maxCompletionTokens,
    });
    reply = final.choices[0]?.message?.content || "";
    lastFinish = final.choices[0]?.finish_reason || lastFinish;
  } catch (err) {
    console.error(`[${channel}/Agent] final-answer call failed:`, err);
  }

  return { reply, turns: maxTurns, toolCalls, finishReason: lastFinish, messages };
}
