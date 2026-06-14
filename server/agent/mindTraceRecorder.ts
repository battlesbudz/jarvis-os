import { randomUUID } from "crypto";
import type OpenAI from "openai";
import { buildMindTrace, type JarvisMindTrace, type MindTraceMemoryInput, type MindTraceToolInput } from "./mindTrace";
import type { AgentToolCallRecord } from "./types";

export interface HarnessMindTraceCaptureInput {
  traceId?: string;
  userId: string;
  userRequest: string;
  channel?: string;
  model?: string;
  turns: number;
  finishReason: string | null;
  reply: string;
  toolCalls: AgentToolCallRecord[];
  durationMs: number;
  messages?: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  contextLoaded?: string[];
  errors?: string[];
  blockedSetupIssues?: string[];
}

interface MindTracePersistenceRecord {
  traceId: string;
  userId: string;
  userRequest: string;
  subtasks: unknown[];
  results: unknown[];
  finalAnswer: string;
  totalRetries: number;
  completedAt: Date;
  durationMs: number;
}

const MAX_TEXT = 2000;
const MEMORY_LINE_PATTERN =
  /^\[\d+\]\s+\[([^/\]]+)\/([^\]]+)\]\s+\(([^)]*)\)\s+(.+)$/;

function truncateText(value: string, max = MAX_TEXT): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function getToolStatus(call: AgentToolCallRecord): MindTraceToolInput["status"] {
  if (call.result.content?.startsWith("[Tool blocked]")) return "blocked";
  return call.result.ok ? "ok" : "failed";
}

function toolNeedsApproval(call: AgentToolCallRecord): boolean {
  const metadata = call.result.metadata ?? {};
  if (metadata.approvalRequired === true || metadata.requiresApproval === true) return true;
  const combined = `${call.result.label ?? ""} ${call.result.content ?? ""}`.toLowerCase();
  return combined.includes("approval") || combined.includes("requires confirmation");
}

function summarizeToolCall(call: AgentToolCallRecord): MindTraceToolInput {
  return {
    name: call.name,
    status: getToolStatus(call),
    args: call.args,
    result: {
      ok: call.result.ok,
      label: call.result.label,
      detail: call.result.detail,
      metadata: call.result.metadata,
      content: truncateText(call.result.content ?? "", 500),
      durationMs: call.durationMs,
    },
    approvalRequired: toolNeedsApproval(call),
    error: call.result.ok ? null : call.result.detail ?? call.result.content ?? "Tool returned an error",
  };
}

function extractMemoryLine(
  line: string,
  call: AgentToolCallRecord,
): MindTraceMemoryInput | null {
  const match = line.match(MEMORY_LINE_PATTERN);
  if (!match) return null;

  const [, tier, memoryType, metaText] = match;
  const confidenceMatch = metaText.match(/confidence:\s*(\d+)/i) ?? metaText.match(/(\d+)%\s*confidence/i);
  const categoryMatch = metaText.match(/^([^,]+),/);
  const args = call.args ?? {};
  const query = typeof args.query === "string" ? args.query : typeof args.category === "string" ? args.category : call.name;

  return {
    tier: tier || null,
    memoryType: memoryType || null,
    category: categoryMatch?.[1]?.trim() || (typeof args.category === "string" ? args.category : null),
    confidence: confidenceMatch ? Number(confidenceMatch[1]) : null,
    sourceType: call.name,
    reason: `Retrieved during ${call.name} for "${query}".`,
  };
}

export function extractMemoriesFromToolCalls(toolCalls: AgentToolCallRecord[]): MindTraceMemoryInput[] {
  const memories: MindTraceMemoryInput[] = [];
  for (const call of toolCalls) {
    if (call.name !== "memory_search" && call.name !== "memory_get") continue;
    const lines = String(call.result.content ?? "").split(/\r?\n/);
    for (const line of lines) {
      const memory = extractMemoryLine(line.trim(), call);
      if (memory) memories.push(memory);
    }
  }
  return memories.slice(0, 25);
}

function inferLoadedContext(input: HarnessMindTraceCaptureInput): string[] {
  const packs = new Set(input.contextLoaded ?? []);
  packs.add("always_on_kernel");

  const toolNames = input.toolCalls.map((call) => call.name);
  if (toolNames.some((name) => name.startsWith("memory_") || name.includes("living_context"))) {
    packs.add("memory_context");
  }
  if (toolNames.some((name) => /mail|gmail|outlook|email/i.test(name))) {
    packs.add("email_context");
  }
  if (toolNames.some((name) => /calendar/i.test(name))) {
    packs.add("calendar_context");
  }
  if (toolNames.some((name) => /daemon|android|desktop/i.test(name))) {
    packs.add("daemon_context");
  }
  if (toolNames.some((name) => /research|search|browser/i.test(name))) {
    packs.add("research_context");
  }

  return [...packs];
}

export function buildHarnessMindTrace(input: HarnessMindTraceCaptureInput): JarvisMindTrace {
  const toolInputs = input.toolCalls.map(summarizeToolCall);
  const approvalRequired = toolInputs.some((tool) => tool.approvalRequired);
  const errors = [
    ...(input.errors ?? []),
    ...toolInputs
      .filter((tool) => tool.status === "failed")
      .map((tool) => `${tool.name}: ${tool.error ?? "failed"}`),
  ];

  return buildMindTrace({
    traceId: input.traceId ?? randomUUID(),
    userId: input.userId,
    userRequest: input.userRequest,
    channel: input.channel ?? "agent_harness",
    contextLoaded: inferLoadedContext(input),
    memoriesRetrieved: extractMemoriesFromToolCalls(input.toolCalls),
    toolsCalled: toolInputs,
    approvalRequired,
    confidenceNotes: [
      `Captured from real harness run: turns=${input.turns}, finish=${input.finishReason ?? "unknown"}.`,
    ],
    uncertaintyNotes: input.toolCalls.length === 0 ? ["No tool calls were made in this harness run."] : [],
    errors,
    blockedSetupIssues: input.blockedSetupIssues ?? [],
  });
}

export function buildMindTracePersistenceRecord(
  input: HarnessMindTraceCaptureInput,
): MindTracePersistenceRecord {
  const trace = buildHarnessMindTrace(input);
  const subtasks = jsonSafe([
    {
      type: "harness_run",
      channel: trace.channel,
      model: input.model,
      taskType: trace.taskTypeDetected,
      route: trace.routeChosen,
      riskLevel: trace.riskLevel,
      contextLoaded: trace.contextLoaded,
      toolsRequested: input.toolCalls.length,
      turns: input.turns,
    },
  ]);
  const results = jsonSafe([
    {
      type: "mind_trace",
      trace,
    },
    ...trace.toolsCalled.map((tool) => ({
      type: "tool_event",
      name: tool.name,
      status: tool.status,
      approvalRequired: tool.approvalRequired,
      error: tool.error,
    })),
  ]);

  return {
    traceId: trace.traceId,
    userId: input.userId,
    userRequest: truncateText(input.userRequest, 1000),
    subtasks,
    results,
    finalAnswer: truncateText(input.reply ?? ""),
    totalRetries: 0,
    completedAt: new Date(),
    durationMs: input.durationMs,
  };
}

export async function persistHarnessMindTrace(
  input: HarnessMindTraceCaptureInput,
): Promise<string | null> {
  if (!input.userId || !input.userRequest.trim() || !process.env.DATABASE_URL) {
    return null;
  }

  try {
    const record = buildMindTracePersistenceRecord(input);
    const [{ db }, schema] = await Promise.all([
      import("../db"),
      import("@shared/schema"),
    ]);
    await db.insert(schema.orchestrationTraces).values(record);
    return record.traceId;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[MindTrace] failed to persist harness trace: ${message}`);
    return null;
  }
}
