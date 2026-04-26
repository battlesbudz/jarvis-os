/**
 * runNamedAgent — executes a named sub-agent for a user message.
 *
 * Flow:
 * 1. Load the agent record + validate active
 * 2. Build permission-filtered tool list via wrapToolsForAgent
 * 3. Retrieve relevant agent memories + optional global soul
 * 4. Build system prompt from persona + context
 * 5. Call runAgent() from harness
 * 6. Extract new memories and write them to the agent's namespace
 * 7. Return result
 *
 * Loop detection: if the same agent is invoked recursively > 3 levels deep,
 * throw AgentLoopError.
 */
import { runAgent } from "./harness";
import type { AgentRunResult } from "./harness";
import type { ToolContext } from "./types";
import { getAgentForChannel, getAgent } from "./agentManager";
import { wrapToolsForAgent } from "./agentPermissions";
import { readAgentMemories, writeAgentMemory } from "./agentMemory";
import { logAgentEvent } from "./agentLogger";
import type { DiscordAgent } from "@shared/schema";
import type OpenAI from "openai";

// ── Errors ─────────────────────────────────────────────────────────────────────

export class AgentLoopError extends Error {
  constructor(agentId: string, depth: number) {
    super(`Agent ${agentId} invoked recursively at depth ${depth} — loop detected`);
    this.name = "AgentLoopError";
  }
}

// ── Loop depth tracking (in-process, per userId+agentId chain) ─────────────────

const invocationDepths = new Map<string, number>();
const MAX_DEPTH = 3;

function depthKey(userId: string, agentId: string): string {
  return `${userId}:${agentId}`;
}

function incrementDepth(userId: string, agentId: string): number {
  const key = depthKey(userId, agentId);
  const current = invocationDepths.get(key) ?? 0;
  const next = current + 1;
  invocationDepths.set(key, next);
  return next;
}

function decrementDepth(userId: string, agentId: string): void {
  const key = depthKey(userId, agentId);
  const current = invocationDepths.get(key) ?? 1;
  const next = Math.max(0, current - 1);
  if (next === 0) invocationDepths.delete(key);
  else invocationDepths.set(key, next);
}

// Token count estimation (~4 chars per token)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ── runNamedAgent ──────────────────────────────────────────────────────────────

export interface RunNamedAgentOptions {
  agentId: string;
  userId: string;
  userMessage: string;
  platform: string;
  channelId?: string;
  conversationHistory?: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  onToken?: (chunk: string) => void;
}

export interface NamedAgentResult {
  reply: string;
  turns: number;
  toolCalls: AgentRunResult["toolCalls"];
  agentName: string;
  agentId: string;
}

export async function runNamedAgent(opts: RunNamedAgentOptions): Promise<NamedAgentResult> {
  const { agentId, userId, userMessage, platform } = opts;

  // ── Load agent ────────────────────────────────────────────────────────────
  const agent = await getAgent(agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);
  if (!agent.isActive) throw new Error(`Agent ${agentId} is disabled`);

  // ── Loop detection ────────────────────────────────────────────────────────
  const depth = incrementDepth(userId, agentId);
  if (depth > MAX_DEPTH) {
    decrementDepth(userId, agentId);
    throw new AgentLoopError(agentId, depth);
  }

  const start = Date.now();
  logAgentEvent({ event: "agent_invoked", agentId, userId, detail: `platform=${platform} depth=${depth}` });

  try {
    // ── Load tools with permission wrapping ──────────────────────────────────
    const { ALL_TOOLS } = await import("./tools/index");
    const permittedTools = wrapToolsForAgent(ALL_TOOLS, agent);

    // ── Build context ────────────────────────────────────────────────────────
    const ctx: ToolContext = {
      userId,
      channel: `${platform}/${agent.name}`,
      state: { pendingAttachments: [] },
    };

    // ── Retrieve agent memories ──────────────────────────────────────────────
    let memoryBlock = "";
    try {
      const memories = await readAgentMemories(agentId, userId, userMessage, 8);
      if (memories.length > 0) {
        memoryBlock = `\n\n## My Memory (${agent.name})\n` +
          memories.map((m) => `- [${m.category}] ${m.content}`).join("\n");
      }
    } catch { /* non-blocking */ }

    // ── Optionally include global soul ───────────────────────────────────────
    let soulBlock = "";
    if (agent.accessGlobalMemory) {
      try {
        const { getSoulPromptBlock } = await import("../memory/soul");
        const soul = await getSoulPromptBlock(userId);
        if (soul) soulBlock = `\n\n## User Context (Global)\n${soul.trim()}`;
      } catch { /* non-blocking */ }
    }

    // ── Compose system prompt ────────────────────────────────────────────────
    const persona = agent.persona ?? `You are ${agent.name}, a ${agent.role} assistant.`;
    const systemPrompt = `${persona}${soulBlock}${memoryBlock}`;

    // ── Build messages ───────────────────────────────────────────────────────
    const history = opts.conversationHistory ?? [];
    let totalHistoryTokens = history.reduce((acc, m) => acc + estimateTokens(String((m as { content?: string }).content ?? "")), 0);

    // Trim history if it exceeds ~6000 tokens
    let trimmedHistory = history;
    if (totalHistoryTokens > 6000) {
      trimmedHistory = [];
      let accumTokens = 0;
      for (const msg of [...history].reverse()) {
        const t = estimateTokens(String((msg as { content?: string }).content ?? ""));
        if (accumTokens + t > 5000) break;
        trimmedHistory.unshift(msg);
        accumTokens += t;
      }
    }

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...trimmedHistory,
      { role: "user", content: userMessage },
    ];

    // ── Run the agent ─────────────────────────────────────────────────────────
    const { getModel } = await import("../lib/modelPrefs");
    const model = await getModel(userId, "chat");

    const result = await runAgent({
      model,
      messages,
      tools: permittedTools,
      context: ctx,
      maxTurns: 6,
      maxCompletionTokens: 2000,
      onToken: opts.onToken,
    });

    // ── Write extracted memories ──────────────────────────────────────────────
    extractAndWriteMemories(agentId, userId, userMessage, result.reply).catch(() => {});

    logAgentEvent({
      event: "task_completed",
      agentId,
      userId,
      durationMs: Date.now() - start,
      detail: `turns=${result.turns} tools=${result.toolCalls.length}`,
    });

    return {
      reply: result.reply,
      turns: result.turns,
      toolCalls: result.toolCalls,
      agentName: agent.name,
      agentId,
    };
  } catch (err) {
    logAgentEvent({
      event: "task_failed",
      agentId,
      userId,
      durationMs: Date.now() - start,
      detail: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    throw err;
  } finally {
    decrementDepth(userId, agentId);
  }
}

// ── extractAndWriteMemories ────────────────────────────────────────────────────

/**
 * Post-conversation: extract durable facts from the exchange and write them
 * to the agent's memory namespace. Best-effort, non-blocking.
 */
async function extractAndWriteMemories(
  agentId: string,
  userId: string,
  userMessage: string,
  agentReply: string,
): Promise<void> {
  try {
    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });

    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Extract 0-3 durable facts or preferences from this conversation that would be useful to remember in future interactions.
Return ONLY a JSON array of {"content": "...", "category": "fact|preference|goal|relationship"} objects.
Return [] if nothing worth storing. Keep each content under 150 chars. No preamble.`,
        },
        {
          role: "user",
          content: `User: ${userMessage.slice(0, 500)}\nAgent: ${agentReply.slice(0, 500)}`,
        },
      ],
      max_completion_tokens: 300,
    });

    const text = resp.choices[0]?.message?.content?.trim() ?? "[]";
    let extracted: Array<{ content: string; category: string }> = [];
    try {
      extracted = JSON.parse(text);
    } catch { return; }

    for (const item of extracted.slice(0, 3)) {
      if (item.content && item.content.length > 5) {
        await writeAgentMemory(agentId, userId, item.content, item.category || "fact");
      }
    }
  } catch { /* best-effort */ }
}

// ── routeToNamedAgent ──────────────────────────────────────────────────────────

/**
 * Convenience: look up the agent for a given channel, run it, and return the result.
 * Returns null if no agent is assigned to that channel (caller should fall back to main agent).
 */
export async function routeToNamedAgent(
  userId: string,
  platform: string,
  channelId: string,
  userMessage: string,
  conversationHistory?: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  onToken?: (chunk: string) => void,
): Promise<NamedAgentResult | null> {
  const agent = await getAgentForChannel(userId, platform, channelId);
  if (!agent) return null;

  return runNamedAgent({
    agentId: agent.id,
    userId,
    userMessage,
    platform,
    channelId,
    conversationHistory,
    onToken,
  });
}
