import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "../db";
import * as schema from "@shared/schema";
import type { AgentTool, ToolArgs, ToolContext, ToolResult } from "./types";
import { isAndroidPhoneRuntimeToolName } from "./phoneRuntimeRouting";
import {
  isConcretePhoneRuntimeCommand,
  isPhoneRuntimeOperationReference,
  normalizePhoneRuntimeGoal,
  selectReferencedPhoneRuntimeOperation,
} from "./phoneRuntimeOperationMemory";

export { isConcretePhoneRuntimeCommand } from "./phoneRuntimeOperationMemory";

const MAX_EVENTS = 20;

function compactArgs(args: ToolArgs): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).slice(0, 20).map(([key, value]) => {
    if (/token|password|secret|authorization/i.test(key)) return [key, "<redacted>"];
    if (typeof value === "string") return [key, value.slice(0, 240)];
    if (typeof value === "number" || typeof value === "boolean" || value === null) return [key, value];
    return [key, "<structured>"];
  }));
}

function extractAppTarget(goal: string, args?: ToolArgs): string | undefined {
  const explicit = args?.appName ?? args?.app_name;
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim().slice(0, 100);
  const match = goal.match(/\b(?:open|launch|use|in|inside)\s+(?:up\s+)?(?:my\s+|the\s+)?([a-z][a-z0-9 .&+-]{1,40}?)(?:\s+app)?(?:\s+and|\s+then|\s+to|\s+marketplace|\s+search|$)/i);
  return match?.[1]?.trim();
}

function detailText(result: ToolResult): string {
  return String(result.content || result.detail || "").slice(0, 1200);
}

function failureState(detail: string): { blocker?: string; nextStep?: string } {
  try {
    const parsed = JSON.parse(detail) as Record<string, unknown>;
    const nested = parsed.detail && typeof parsed.detail === "object" ? parsed.detail as Record<string, unknown> : parsed;
    const blocker = String(nested.error ?? parsed.error ?? "").trim();
    const suggestion = String(nested.suggestion ?? parsed.suggestion ?? "").trim();
    return {
      blocker: blocker ? blocker.slice(0, 500) : undefined,
      nextStep: suggestion ? suggestion.slice(0, 500) : undefined,
    };
  } catch {
    return { blocker: detail.slice(0, 500) || undefined };
  }
}

export async function ensurePhoneRuntimeOperation(input: {
  userId: string;
  goal: string;
  sessionId?: string | null;
  originChannel?: string | null;
}): Promise<schema.PhoneRuntimeOperation> {
  const normalizedGoal = normalizePhoneRuntimeGoal(input.goal);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await db.select().from(schema.phoneRuntimeOperations).where(and(
    eq(schema.phoneRuntimeOperations.userId, input.userId),
    inArray(schema.phoneRuntimeOperations.status, ["active", "blocked"]),
    gte(schema.phoneRuntimeOperations.updatedAt, since),
  )).orderBy(desc(schema.phoneRuntimeOperations.updatedAt)).limit(12);
  const existing = recent.find((operation) => normalizePhoneRuntimeGoal(operation.goal) === normalizedGoal);
  if (existing) {
    const [updated] = await db.update(schema.phoneRuntimeOperations).set({
      sessionId: input.sessionId ?? existing.sessionId,
      originChannel: input.originChannel ?? existing.originChannel,
      updatedAt: new Date(),
    }).where(eq(schema.phoneRuntimeOperations.id, existing.id)).returning();
    return updated ?? existing;
  }
  const [created] = await db.insert(schema.phoneRuntimeOperations).values({
    userId: input.userId,
    sessionId: input.sessionId ?? null,
    originChannel: input.originChannel ?? "appchat",
    goal: input.goal.trim().slice(0, 2000),
    state: {
      appTarget: extractAppTarget(input.goal),
      plan: ["Resume the goal using Android Device Control", "Verify the result before reporting completion"],
      nextStep: "Start or continue the Android tool sequence",
      events: [],
    },
  }).returning();
  return created;
}

export async function findReferencedPhoneRuntimeOperation(input: {
  userId: string;
  text: string;
  now?: Date;
}): Promise<schema.PhoneRuntimeOperation | null> {
  if (!isPhoneRuntimeOperationReference(input.text)) return null;
  const operations = await db.select().from(schema.phoneRuntimeOperations).where(and(
    eq(schema.phoneRuntimeOperations.userId, input.userId),
    inArray(schema.phoneRuntimeOperations.status, ["active", "blocked"]),
  )).orderBy(desc(schema.phoneRuntimeOperations.updatedAt));
  return selectReferencedPhoneRuntimeOperation(input.text, operations, input.now);
}

export async function recordPhoneRuntimeToolResult(
  operationId: string,
  toolName: string,
  args: ToolArgs,
  result: ToolResult,
): Promise<void> {
  const [operation] = await db.select().from(schema.phoneRuntimeOperations)
    .where(eq(schema.phoneRuntimeOperations.id, operationId)).limit(1);
  if (!operation || operation.status === "cancelled" || operation.status === "completed") return;
  const now = new Date();
  const detail = detailText(result);
  const completed = result.ok && toolName === "android_return_to_jarvis_chat";
  const failure = result.ok ? {} : failureState(detail);
  const compactedArgs = compactArgs(args);
  const eventResult: schema.PhoneRuntimeOperationEvent["result"] = result.ok ? "success" : "error";
  const state: schema.PhoneRuntimeOperationState = {
    ...(operation.state ?? {}),
    appTarget: extractAppTarget(operation.goal, args) ?? operation.state?.appTarget,
    lastToolName: toolName,
    lastToolArgs: compactedArgs,
    lastResult: result.ok ? "success" : "error",
    blocker: result.ok ? undefined : failure.blocker ?? result.label ?? "Android action failed",
    nextStep: completed
      ? "Completed"
      : result.ok
        ? "Continue the remaining steps and verify the goal"
        : failure.nextStep ?? `Retry ${toolName} from the last verified step`,
    events: [
      ...(operation.state?.events ?? []),
      {
        at: now.toISOString(),
        tool: toolName,
        args: compactedArgs,
        result: eventResult,
        detail: detail.slice(0, 500) || undefined,
      },
    ].slice(-MAX_EVENTS),
  };
  await db.update(schema.phoneRuntimeOperations).set({
    status: completed ? "completed" : result.ok ? "active" : "blocked",
    state,
    updatedAt: now,
    completedAt: completed ? now : null,
  }).where(eq(schema.phoneRuntimeOperations.id, operationId));
}

export function formatPhoneRuntimeOperationContext(operation: schema.PhoneRuntimeOperation | null): string {
  if (!operation) return "";
  const state = operation.state ?? {};
  return [
    "## Durable Phone Operation",
    `Operation ID: ${operation.id}`,
    `Original goal: ${operation.goal}`,
    `Status: ${operation.status}`,
    state.appTarget ? `App target: ${state.appTarget}` : "",
    state.lastToolName ? `Last tool: ${state.lastToolName} (${state.lastResult ?? "unknown"})` : "",
    state.blocker ? `Last blocker: ${state.blocker}` : "",
    state.nextStep ? `Next step: ${state.nextStep}` : "",
    "Resume this goal from its recorded state. Do not ask the user to restate it and do not restart completed steps unless verification requires it.",
  ].filter(Boolean).join("\n");
}

export function wrapPhoneRuntimeOperationTools(
  tools: AgentTool[],
  operationId: string | null | undefined,
): AgentTool[] {
  if (!operationId) return tools;
  return tools.map((tool) => {
    if (!isAndroidPhoneRuntimeToolName(tool.name) && tool.name !== "daemon_action") return tool;
    return {
      ...tool,
      async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
        const result = await tool.execute(args, ctx);
        await recordPhoneRuntimeToolResult(operationId, tool.name, args, result).catch((error) => {
          console.error("[phone-operation] result persistence failed:", error);
        });
        return result;
      },
    };
  });
}
