import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { MemoryContext, MemoryModelTarget } from "../memory/memoryOs";
import { RESOURCE_PAUSED_STATUS } from "../agent/voiceRuntimeResourceCore";
import {
  retrieveRelevantRuntimeWorkingContext,
  type RuntimeWorkingContextItem,
} from "./runtimeWorkingContext";

export type RuntimeStateSource =
  | "state_kernel"
  | "profile_store"
  | "task_state_store"
  | "memory_os"
  | "working_context"
  | "provider_runtime"
  | "fallback";

export type RuntimeTaskStateSource =
  | "scheduled_task"
  | "agent_job"
  | "agent_workflow";

export interface RuntimeProfileState {
  userId: string;
  preferredName?: string;
  timezone?: string;
  language?: string;
  communicationStyle?: string;
  source: "profile_store" | "fallback";
}

export interface RuntimeSessionState {
  sessionId?: string;
  activeDevice?: string;
  activeModel?: string;
  currentContext?: string;
  generatedAt: string;
  source: "state_kernel" | "fallback";
}

export interface RuntimeTaskStateSummary {
  taskId: string;
  source: RuntimeTaskStateSource;
  goal: string;
  currentStep?: string;
  status: string;
  lastAction?: string;
  nextAction?: string;
  updatedAt?: string;
}

export interface RuntimeRelevantContext {
  source: "memory_os" | "working_context";
  label: string;
  content: string;
  provenance?: string[];
}

export interface RuntimeStateCard {
  assistantName: string;
  user: RuntimeProfileState;
  session: RuntimeSessionState;
  taskState: RuntimeTaskStateSummary[];
  relevantContext: RuntimeRelevantContext[];
  availableTools: string[];
  provenance: RuntimeStateSource[];
  uncertainty: string[];
}

export interface BuildRuntimeStateCardInput {
  userId: string;
  assistantName?: string;
  sessionId?: string;
  activeDevice?: string;
  activeModel?: string;
  currentContext?: string;
  seedQuery?: string;
  availableTools?: string[];
  includeMemoryContext?: boolean;
  includeWorkingContext?: boolean;
  taskLimit?: number;
  memoryLimit?: number;
  workingContextLimit?: number;
  renderMaxChars?: number;
}

export interface RenderRuntimeStateCardOptions {
  maxChars?: number;
}

export interface RuntimeStateCardDeps {
  loadProfileState?: (userId: string) => Promise<RuntimeProfileState | null>;
  loadTaskState?: (userId: string, limit: number) => Promise<RuntimeTaskStateSummary[]>;
  retrieveMemoryContext?: (input: {
    userId: string;
    query: string;
    limit: number;
    modelTarget?: MemoryModelTarget;
    allowRestrictedMemory?: boolean;
  }) => Promise<MemoryContext>;
  loadWorkingContext?: (input: {
    userId: string;
    query: string;
    limit: number;
    now: Date;
  }) => Promise<RuntimeRelevantContext[]>;
  now?: () => Date;
}

const DEFAULT_TASK_LIMIT = 5;
const DEFAULT_MEMORY_LIMIT = 4;
const DEFAULT_WORKING_CONTEXT_LIMIT = 3;
const DEFAULT_RENDER_MAX_CHARS = 2_400;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function nestedRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
  return asRecord(record[key]);
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  if (maxChars <= 3) return value.slice(0, Math.max(0, maxChars));
  return `${value.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function formatDate(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function taskStatusRank(task: RuntimeTaskStateSummary): number {
  if (task.source === "agent_workflow" && task.status === "active") return 100;
  if (task.source === "agent_job" && task.status === "running") return 95;
  if (task.status === "needs_attention") return 90;
  if (task.source === "agent_job" && task.status === "queued") return 85;
  if (task.source === "agent_job" && task.status === RESOURCE_PAUSED_STATUS) return 82;
  if (task.source === "agent_workflow" && task.status === "paused_waiting") return 80;
  if (task.source === "agent_workflow" && task.status === "paused") return 75;
  if (task.status === "running") return 70;
  if (task.status === "scheduled") return 50;
  return 10;
}

function taskUpdatedAtMs(task: RuntimeTaskStateSummary): number {
  if (!task.updatedAt) return 0;
  const timestamp = Date.parse(task.updatedAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function rankTaskRows(tasks: RuntimeTaskStateSummary[]): RuntimeTaskStateSummary[] {
  return [...tasks].sort((a, b) => {
    const rankDiff = taskStatusRank(b) - taskStatusRank(a);
    if (rankDiff !== 0) return rankDiff;
    const dateDiff = taskUpdatedAtMs(b) - taskUpdatedAtMs(a);
    if (dateDiff !== 0) return dateDiff;
    return a.goal.localeCompare(b.goal);
  });
}

export function limitRuntimeTaskStateRows(
  tasks: RuntimeTaskStateSummary[],
  limit: number,
): RuntimeTaskStateSummary[] {
  if (limit <= 0) return [];

  const ranked = rankTaskRows(tasks);
  const selected: RuntimeTaskStateSummary[] = [];
  const selectedIds = new Set<string>();
  const sourceOrder: RuntimeTaskStateSource[] = ["agent_workflow", "agent_job", "scheduled_task"];

  for (const source of sourceOrder) {
    if (selected.length >= limit) break;
    const candidate = ranked.find((task) => task.source === source && !selectedIds.has(task.taskId));
    if (!candidate) continue;
    selected.push(candidate);
    selectedIds.add(candidate.taskId);
  }

  for (const task of ranked) {
    if (selected.length >= limit) break;
    if (selectedIds.has(task.taskId)) continue;
    selected.push(task);
    selectedIds.add(task.taskId);
  }

  return selected;
}

function fallbackProfile(userId: string): RuntimeProfileState {
  return {
    userId,
    source: "fallback",
  };
}

export async function loadRuntimeProfileStateFromDb(userId: string): Promise<RuntimeProfileState | null> {
  if (typeof process !== "undefined" && !process.env.DATABASE_URL) return null;

  const [{ db }, schema] = await Promise.all([
    import("../db"),
    import("@shared/schema"),
  ]);

  const [userRows, preferenceRows] = await Promise.all([
    db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1),
    db.select().from(schema.userPreferences).where(eq(schema.userPreferences.userId, userId)).limit(1),
  ]);

  const user = userRows[0];
  if (!user && !preferenceRows[0]) return null;

  const preferences = asRecord(preferenceRows[0]?.data);
  const profile = nestedRecord(preferences, "profile");
  const locale = nestedRecord(preferences, "locale");

  return {
    userId,
    preferredName: firstString(
      preferences.preferredName,
      preferences.preferred_name,
      profile.preferredName,
      profile.preferred_name,
      profile.name,
      user?.displayName,
      user?.username,
    ),
    timezone: firstString(
      preferences.timezone,
      preferences.timeZone,
      locale.timezone,
      locale.timeZone,
      profile.timezone,
      profile.timeZone,
    ),
    language: firstString(
      preferences.language,
      preferences.locale,
      locale.language,
      locale.locale,
      profile.language,
    ),
    communicationStyle: firstString(
      preferences.communicationStyle,
      preferences.communication_style,
      profile.communicationStyle,
      profile.communication_style,
    ),
    source: "profile_store",
  };
}

async function loadTaskStateFromDb(userId: string, limit: number): Promise<RuntimeTaskStateSummary[]> {
  if (typeof process !== "undefined" && !process.env.DATABASE_URL) return [];

  const [{ db }, schema] = await Promise.all([
    import("../db"),
    import("@shared/schema"),
  ]);
  const perSourceLimit = Math.max(limit * 3, limit + 3);

  const [scheduledTasks, agentJobs, agentWorkflows] = await Promise.all([
    db.select()
      .from(schema.jarvisScheduledTasks)
      .where(and(
        eq(schema.jarvisScheduledTasks.userId, userId),
        eq(schema.jarvisScheduledTasks.active, true),
        isNull(schema.jarvisScheduledTasks.completedAt),
      ))
      .orderBy(asc(schema.jarvisScheduledTasks.scheduledAt))
      .limit(perSourceLimit),
    db.select()
      .from(schema.agentJobs)
      .where(and(
        eq(schema.agentJobs.userId, userId),
        inArray(schema.agentJobs.status, ["queued", "running", RESOURCE_PAUSED_STATUS]),
      ))
      .orderBy(
        sql`case when ${schema.agentJobs.status} = 'running' then 0 else 1 end`,
        desc(schema.agentJobs.startedAt),
        desc(schema.agentJobs.createdAt),
      )
      .limit(perSourceLimit),
    db.select()
      .from(schema.agentWorkflows)
      .where(and(
        eq(schema.agentWorkflows.userId, userId),
        inArray(schema.agentWorkflows.status, ["active", "paused_waiting", "paused"]),
      ))
      .orderBy(desc(schema.agentWorkflows.updatedAt), desc(schema.agentWorkflows.createdAt))
      .limit(perSourceLimit),
  ]);

  const taskRows: RuntimeTaskStateSummary[] = [
    ...scheduledTasks.map((task): RuntimeTaskStateSummary => ({
      taskId: task.id,
      source: "scheduled_task",
      goal: task.title,
      currentStep: task.description ?? undefined,
      status: task.needsAttention ? "needs_attention" : task.inProgressAt ? "running" : "scheduled",
      lastAction: task.lastShellResult ? "Last shell result recorded." : undefined,
      nextAction: task.needsAttention ? task.attentionQuestion ?? "Awaiting user attention." : undefined,
      updatedAt: formatDate(task.inProgressAt ?? task.createdAt),
    })),
    ...agentJobs.map((job): RuntimeTaskStateSummary => ({
      taskId: job.id,
      source: "agent_job",
      goal: job.title,
      currentStep: job.agentType,
      status: job.status,
      lastAction: job.error ? truncateText(job.error, 160) : undefined,
      nextAction: job.status === "queued"
        ? "Start queued agent job."
        : job.status === RESOURCE_PAUSED_STATUS
          ? "Resume after local voice call ends."
          : undefined,
      updatedAt: formatDate(job.startedAt ?? job.createdAt),
    })),
    ...agentWorkflows.map((workflow): RuntimeTaskStateSummary => {
      const steps = Array.isArray(workflow.steps) ? workflow.steps : [];
      const currentStep = steps[workflow.currentStepIndex];
      return {
        taskId: workflow.id,
        source: "agent_workflow",
        goal: workflow.title,
        currentStep: currentStep?.title ?? workflow.description ?? undefined,
        status: workflow.status,
        lastAction: currentStep?.status ? `Current step status: ${currentStep.status}` : undefined,
        nextAction: currentStep?.prompt ? truncateText(currentStep.prompt, 160) : undefined,
        updatedAt: formatDate(workflow.updatedAt ?? workflow.createdAt),
      };
    }),
  ];

  return limitRuntimeTaskStateRows(taskRows, limit);
}

async function retrieveMemoryContextFromMemoryOs(input: {
  userId: string;
  query: string;
  limit: number;
  modelTarget?: MemoryModelTarget;
  allowRestrictedMemory?: boolean;
}): Promise<MemoryContext> {
  const { retrieveMemoryContext } = await import("../memory/memoryOs");
  return retrieveMemoryContext({
    userId: input.userId,
    query: input.query,
    limit: input.limit,
    caller: "coach_context",
    skipAccessUpdate: true,
    modelTarget: input.modelTarget,
    allowRestrictedMemory: input.allowRestrictedMemory,
  });
}

export function memoryModelTargetFromActiveModel(activeModel?: string): MemoryModelTarget {
  const normalized = activeModel?.trim().toLowerCase() ?? "";
  return /\b(local|phone[_ -]?gemma|android[_ -]?local[_ -]?gemma|gemma)\b/.test(normalized)
    ? "local"
    : "cloud";
}

function memoryItemsFromContext(context: MemoryContext): RuntimeRelevantContext[] {
  return context.items.map((item) => ({
    source: "memory_os",
    label: item.memory.category,
    content: item.memory.content,
    provenance: item.provenance.map((ref) => `${ref.source}:${ref.kind}:${ref.id}`),
  }));
}

function workingContextItemsFromRuntime(items: RuntimeWorkingContextItem[]): RuntimeRelevantContext[] {
  return items.map((item) => ({
    source: "working_context",
    label: item.label,
    content: item.content,
    provenance: item.provenance,
  }));
}

function appendUncertainty(
  uncertainty: string[],
  message: string,
  error: unknown,
): void {
  const suffix = error instanceof Error && error.message ? ` ${error.message}` : "";
  uncertainty.push(`${message}${suffix}`.trim());
}

export async function buildRuntimeStateCard(
  input: BuildRuntimeStateCardInput,
  deps: RuntimeStateCardDeps = {},
): Promise<RuntimeStateCard> {
  const now = deps.now ?? (() => new Date());
  const taskLimit = Math.max(0, input.taskLimit ?? DEFAULT_TASK_LIMIT);
  const memoryLimit = Math.max(0, input.memoryLimit ?? DEFAULT_MEMORY_LIMIT);
  const workingContextLimit = Math.max(0, input.workingContextLimit ?? DEFAULT_WORKING_CONTEXT_LIMIT);
  const uncertainty: string[] = [];
  const provenance = new Set<RuntimeStateSource>(["state_kernel", "provider_runtime"]);

  const loadProfileState = deps.loadProfileState ?? loadRuntimeProfileStateFromDb;
  const loadTaskState = deps.loadTaskState ?? loadTaskStateFromDb;
  const retrieveMemoryContext = deps.retrieveMemoryContext ?? retrieveMemoryContextFromMemoryOs;
  const loadWorkingContext = deps.loadWorkingContext ?? (async (args) =>
    workingContextItemsFromRuntime(await retrieveRelevantRuntimeWorkingContext(args)));

  let user = fallbackProfile(input.userId);
  try {
    const profile = await loadProfileState(input.userId);
    if (profile) {
      user = profile;
      provenance.add(profile.source);
    } else {
      provenance.add("fallback");
      uncertainty.push("Profile store did not return a user profile.");
    }
  } catch (error) {
    provenance.add("fallback");
    appendUncertainty(uncertainty, "Profile store was unavailable.", error);
  }

  let taskState: RuntimeTaskStateSummary[] = [];
  if (taskLimit > 0) {
    try {
      taskState = await loadTaskState(input.userId, taskLimit);
      provenance.add("task_state_store");
    } catch (error) {
      appendUncertainty(uncertainty, "Task state store was unavailable.", error);
    }
  }

  let relevantContext: RuntimeRelevantContext[] = [];
  const query = input.seedQuery?.trim();
  if (input.includeWorkingContext === true && query && workingContextLimit > 0) {
    try {
      const workingContext = await loadWorkingContext({
        userId: input.userId,
        query,
        limit: workingContextLimit,
        now: now(),
      });
      if (workingContext.length > 0) {
        relevantContext.push(...workingContext);
        provenance.add("working_context");
      }
    } catch (error) {
      appendUncertainty(uncertainty, "Working context retrieval was unavailable.", error);
    }
  }

  if (input.includeMemoryContext && query && memoryLimit > 0) {
    try {
      const memoryContext = await retrieveMemoryContext({
        userId: input.userId,
        query,
        limit: memoryLimit,
        modelTarget: memoryModelTargetFromActiveModel(input.activeModel),
      });
      relevantContext.push(...memoryItemsFromContext(memoryContext));
      provenance.add("memory_os");
      uncertainty.push(...memoryContext.uncertainty);
    } catch (error) {
      appendUncertainty(uncertainty, "MemoryOS retrieval was unavailable.", error);
    }
  }

  return {
    assistantName: input.assistantName?.trim() || "Jarvis",
    user,
    session: {
      sessionId: input.sessionId,
      activeDevice: input.activeDevice,
      activeModel: input.activeModel,
      currentContext: input.currentContext,
      generatedAt: now().toISOString(),
      source: "state_kernel",
    },
    taskState,
    relevantContext,
    availableTools: uniqueStrings(input.availableTools ?? []),
    provenance: Array.from(provenance),
    uncertainty: uniqueStrings(uncertainty),
  };
}

function addLine(lines: string[], label: string, value: string | undefined): void {
  if (value) lines.push(`- ${label}: ${value}`);
}

function renderTaskState(tasks: RuntimeTaskStateSummary[]): string[] {
  if (tasks.length === 0) return ["- No active task state loaded."];

  return tasks.flatMap((task, index) => {
    const lines = [
      `- ${index + 1}. ${task.goal} (${task.status}, ${task.source})`,
    ];
    addLine(lines, "Current step", task.currentStep);
    addLine(lines, "Last action", task.lastAction);
    addLine(lines, "Next action", task.nextAction);
    addLine(lines, "Updated at", task.updatedAt);
    return lines;
  });
}

function renderRelevantContext(items: RuntimeRelevantContext[]): string[] {
  if (items.length === 0) return ["- No historical memory packet loaded for this turn."];

  return items.map((item, index) => (
    `- ${index + 1}. [${item.label}] ${truncateText(item.content, 220)}`
  ));
}

function renderAvailableTools(tools: string[]): string[] {
  if (tools.length === 0) return ["- No tools supplied by this route."];

  const visibleTools = tools.slice(0, 16);
  const lines = visibleTools.map((tool) => `- ${tool}`);
  if (tools.length > visibleTools.length) {
    lines.push(`- ${tools.length - visibleTools.length} additional tool(s) omitted from this compact state card.`);
  }
  return lines;
}

export function renderRuntimeStateCard(
  card: RuntimeStateCard,
  options: RenderRuntimeStateCardOptions = {},
): string {
  const lines: string[] = [
    "## Jarvis Runtime State Card",
    "Authoritative state generated by Jarvis. Models consume this card; they do not own memory or state.",
    "",
    `Assistant: ${card.assistantName}`,
    "",
    "Current User:",
  ];

  addLine(lines, "User id", card.user.userId);
  addLine(lines, "Preferred name", card.user.preferredName);
  addLine(lines, "Timezone", card.user.timezone);
  addLine(lines, "Language", card.user.language);
  addLine(lines, "Communication style", card.user.communicationStyle);
  addLine(lines, "Profile source", card.user.source);

  lines.push(
    "",
    "Current Session:",
  );
  addLine(lines, "Session id", card.session.sessionId);
  addLine(lines, "Active device", card.session.activeDevice);
  addLine(lines, "Active model", card.session.activeModel);
  addLine(lines, "Current context", card.session.currentContext);
  addLine(lines, "Generated at", card.session.generatedAt);

  lines.push(
    "",
    "Active Task State:",
    ...renderTaskState(card.taskState),
    "",
    "Relevant Historical Context:",
    ...renderRelevantContext(card.relevantContext),
    "",
    "Available Tools:",
    ...renderAvailableTools(card.availableTools),
    "",
    "Provenance:",
    `- ${card.provenance.join(", ") || "fallback"}`,
  );

  if (card.uncertainty.length > 0) {
    lines.push(
      "",
      "Uncertainty:",
      ...card.uncertainty.map((entry) => `- ${entry}`),
    );
  }

  return truncateText(lines.join("\n"), options.maxChars ?? DEFAULT_RENDER_MAX_CHARS);
}

export async function buildRuntimeStateCardPrompt(
  input: BuildRuntimeStateCardInput,
  deps?: RuntimeStateCardDeps,
): Promise<string> {
  const card = await buildRuntimeStateCard(input, deps);
  return renderRuntimeStateCard(card, { maxChars: input.renderMaxChars ?? DEFAULT_RENDER_MAX_CHARS });
}
