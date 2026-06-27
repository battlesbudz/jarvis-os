import { and, asc, desc, eq, sql } from "drizzle-orm";
import * as schema from "@shared/schema";
import { db } from "../db";
import { attachDeliverableReviewState } from "../agent/reviewLoop";
import { attachJobReviewState } from "../agent/reviewLoop";
import {
  applyDailyPlanPatch,
  buildDailyCommandStatusReasons,
  classifyDailyCommandStatus,
  getLocalDateKey,
  getNextLocalDateKey,
  mergeGeneratedTasksIntoPlan,
  type DailyCommandContextWarning,
  type DailyPlanData,
  type DailyPlanPatch,
  type DailyPlanTask,
} from "./planOps";
import { getPlanForUser, savePlanForUser } from "./planPersistence";
import {
  DREAM_CAPABILITY_REVIEW_DEEP_LINK,
  DREAM_MEMORY_REVIEW_DEEP_LINK,
} from "../memory/dreamPolicy";

type DailyCommandDreamInsight = Pick<
  typeof schema.dreamInsights.$inferSelect,
  "id" | "dreamDate" | "insightText" | "confidenceScore" | "sourceMemoryIds" | "shownToUser" | "deliveredAt" | "createdAt"
>;

export interface DailyCommandSnapshot {
  date: string;
  timezone: string;
  status: ReturnType<typeof classifyDailyCommandStatus>;
  plan: DailyPlanData;
  attention: {
    inboxItems: Array<typeof schema.inboxItems.$inferSelect>;
    pendingCount: number;
  };
  jobs: {
    active: ReturnType<typeof attachJobReviewState>[];
    failed: ReturnType<typeof attachJobReviewState>[];
  };
  deliverables: {
    pending: ReturnType<typeof attachDeliverableReviewState>[];
    pendingCount: number;
  };
  approvals: {
    pending: Array<typeof schema.agentApprovalGates.$inferSelect>;
    pendingCount: number;
  };
  reminders: {
    morningBriefSent: boolean;
    eveningWrapSent: boolean;
  };
  eveningWrap: {
    sent: boolean;
    sentAt: string | null;
  };
  dream: {
    latestInsight: DailyCommandDreamInsight | null;
    pendingCount: number;
    pendingMemoryReviewCount: number;
    pendingCapabilityProposalCount: number;
    memoryReviewDeepLink: string;
    capabilityReviewDeepLink: string;
    lastCycle: unknown;
  };
  contextWarnings: DailyCommandContextWarning[];
  statusReasons: ReturnType<typeof buildDailyCommandStatusReasons>;
}

export async function getUserTimezone(userId: string): Promise<string> {
  const [prefsRow] = await db
    .select({ data: schema.userPreferences.data })
    .from(schema.userPreferences)
    .where(eq(schema.userPreferences.userId, userId))
    .limit(1);
  const prefs = (prefsRow?.data as { timezone?: unknown } | undefined) || {};
  return typeof prefs.timezone === "string" && prefs.timezone.trim() ? prefs.timezone : "America/New_York";
}

async function getUserPrefs(userId: string): Promise<Record<string, unknown>> {
  const [prefsRow] = await db
    .select({ data: schema.userPreferences.data })
    .from(schema.userPreferences)
    .where(eq(schema.userPreferences.userId, userId))
    .limit(1);
  return ((prefsRow?.data as Record<string, unknown> | undefined) || {});
}

function extractContextWarnings(plan: DailyPlanData | null): DailyCommandContextWarning[] {
  const warnings = plan?.meta?.dailyCommand?.contextWarnings;
  return Array.isArray(warnings) ? warnings : [];
}

function emptyPlan(date: string): DailyPlanData {
  return { date, tasks: [], meta: { dailyCommand: {
    source: "daily_command_snapshot",
    generatedAt: new Date().toISOString(),
    contextWarnings: [],
    aiTaskCount: 0,
    goalTaskCount: 0,
    preservedTaskCount: 0,
  } } };
}

export async function getDailyCommandSnapshot(userId: string, now = new Date()): Promise<DailyCommandSnapshot> {
  const [timezone, prefs] = await Promise.all([
    getUserTimezone(userId),
    getUserPrefs(userId),
  ]);
  const date = getLocalDateKey(now, timezone);

  const [
    plan,
    inboxItems,
    activeJobs,
    failedJobs,
    deliverables,
    approvals,
    scheduleLogs,
    latestDreamRows,
    pendingDreamRows,
    dreamMemoryReviewRows,
    dreamCapabilityProposalRows,
  ] = await Promise.all([
    getPlanForUser(userId, date),
    db
      .select()
      .from(schema.inboxItems)
      .where(and(eq(schema.inboxItems.userId, userId), eq(schema.inboxItems.status, "pending")))
      .orderBy(desc(schema.inboxItems.surfacedAt))
      .limit(10),
    db
      .select()
      .from(schema.agentJobs)
      .where(and(eq(schema.agentJobs.userId, userId), sql`${schema.agentJobs.status} IN ('queued', 'running', 'cancelling')`))
      .orderBy(asc(schema.agentJobs.createdAt))
      .limit(20),
    db
      .select()
      .from(schema.agentJobs)
      .where(and(eq(schema.agentJobs.userId, userId), eq(schema.agentJobs.status, "failed")))
      .orderBy(desc(schema.agentJobs.createdAt))
      .limit(10),
    db
      .select()
      .from(schema.deliverables)
      .where(and(eq(schema.deliverables.userId, userId), eq(schema.deliverables.status, "pending_approval")))
      .orderBy(desc(schema.deliverables.createdAt))
      .limit(20),
    db
      .select()
      .from(schema.agentApprovalGates)
      .where(and(eq(schema.agentApprovalGates.userId, userId), eq(schema.agentApprovalGates.status, "pending")))
      .orderBy(desc(schema.agentApprovalGates.createdAt))
      .limit(20),
    db
      .select()
      .from(schema.proactiveScheduleLog)
      .where(and(
        eq(schema.proactiveScheduleLog.userId, userId),
        eq(schema.proactiveScheduleLog.sentDate, date),
        sql`${schema.proactiveScheduleLog.messageType} IN ('morning_briefing', 'evening_wrap', 'evening_wrapup')`,
      )),
    db
      .select({
        id: schema.dreamInsights.id,
        dreamDate: schema.dreamInsights.dreamDate,
        insightText: schema.dreamInsights.insightText,
        confidenceScore: schema.dreamInsights.confidenceScore,
        sourceMemoryIds: schema.dreamInsights.sourceMemoryIds,
        shownToUser: schema.dreamInsights.shownToUser,
        deliveredAt: schema.dreamInsights.deliveredAt,
        createdAt: schema.dreamInsights.createdAt,
      })
      .from(schema.dreamInsights)
      .where(eq(schema.dreamInsights.userId, userId))
      .orderBy(desc(schema.dreamInsights.createdAt))
      .limit(1),
    db
      .select({ id: schema.dreamInsights.id })
      .from(schema.dreamInsights)
      .where(and(eq(schema.dreamInsights.userId, userId), eq(schema.dreamInsights.shownToUser, false)))
      .orderBy(desc(schema.dreamInsights.createdAt))
      .limit(10),
    db
      .select({ cnt: sql<number>`COUNT(*)::int` })
      .from(schema.userMemories)
      .where(and(
        eq(schema.userMemories.userId, userId),
        eq(schema.userMemories.pendingReview, true),
        eq(schema.userMemories.reviewStatus, "pending"),
        eq(schema.userMemories.sourceType, "dream_cycle"),
      )),
    db
      .select({ cnt: sql<number>`COUNT(*)::int` })
      .from(schema.deliverables)
      .where(and(
        eq(schema.deliverables.userId, userId),
        eq(schema.deliverables.status, "pending_approval"),
        sql`${schema.deliverables.meta}->>'source' = 'dream_cycle_capability_proposal'`,
      )),
  ]);

  const resolvedPlan = plan ?? emptyPlan(date);
  const contextWarnings = extractContextWarnings(resolvedPlan);
  const reviewedDeliverables = deliverables.map(attachDeliverableReviewState);
  const reviewedActiveJobs = activeJobs.map(attachJobReviewState);
  const reviewedFailedJobs = failedJobs.map(attachJobReviewState);
  const morningLog = scheduleLogs.find((log) => log.messageType === "morning_briefing");
  const eveningLog = scheduleLogs.find((log) => log.messageType === "evening_wrap" || log.messageType === "evening_wrapup");
  const deliverableGateIds = new Set(
    reviewedDeliverables
      .filter((item) => item.type === "approval_gate")
      .map((item) => (item.meta as { gateId?: unknown } | null)?.gateId)
      .filter((gateId): gateId is string => typeof gateId === "string"),
  );
  const pendingApprovalDeliverables = deliverableGateIds.size;
  const unmirroredApprovals = approvals.filter((approval) => !deliverableGateIds.has(approval.id));

  const statusInput = {
    activeJobsCount: reviewedActiveJobs.length,
    failedJobsCount: reviewedFailedJobs.length,
    pendingApprovalCount: unmirroredApprovals.length,
    pendingDeliverableApprovalCount: pendingApprovalDeliverables,
    planTaskCount: resolvedPlan.tasks.length,
    contextWarnings,
  };
  const status = classifyDailyCommandStatus(statusInput);
  const statusReasons = buildDailyCommandStatusReasons(statusInput);

  return {
    date,
    timezone,
    status,
    plan: resolvedPlan,
    attention: {
      inboxItems,
      pendingCount: inboxItems.length,
    },
    jobs: {
      active: reviewedActiveJobs,
      failed: reviewedFailedJobs,
    },
    deliverables: {
      pending: reviewedDeliverables,
      pendingCount: reviewedDeliverables.length,
    },
    approvals: {
      pending: approvals,
      pendingCount: unmirroredApprovals.length + pendingApprovalDeliverables,
    },
    reminders: {
      morningBriefSent: Boolean(morningLog),
      eveningWrapSent: Boolean(eveningLog),
    },
    eveningWrap: {
      sent: Boolean(eveningLog),
      sentAt: eveningLog?.sentAt ? new Date(eveningLog.sentAt).toISOString() : null,
    },
    dream: {
      latestInsight: latestDreamRows[0] ?? null,
      pendingCount: pendingDreamRows.length,
      pendingMemoryReviewCount: dreamMemoryReviewRows[0]?.cnt ?? 0,
      pendingCapabilityProposalCount: dreamCapabilityProposalRows[0]?.cnt ?? 0,
      memoryReviewDeepLink: DREAM_MEMORY_REVIEW_DEEP_LINK,
      capabilityReviewDeepLink: DREAM_CAPABILITY_REVIEW_DEEP_LINK,
      lastCycle: prefs.lastDreamCycle ?? null,
    },
    contextWarnings,
    statusReasons,
  };
}

function fallbackTask(dateKey: string): DailyPlanTask {
  return {
    id: `jarvis_${dateKey}_fallback`,
    title: "Review today's top priorities",
    category: "personal",
    priority: "high",
    duration: 20,
    description: "Fallback task created because Jarvis could not produce a reliable generated plan.",
    completed: false,
    fromJarvis: true,
    dailyCommandDate: dateKey,
    originSurface: "daily_command",
    sourceIntent: "fallback_plan",
    createdAt: Date.now(),
  };
}

export async function generateDailyCommandPlan(userId: string, opts: {
  mode?: "merge" | "replace";
  confirmReplace?: boolean;
  now?: Date;
  source?: string;
  allowAiSuggestions?: boolean;
} = {}): Promise<{ plan: DailyPlanData; insertedTaskCount: number; contextWarnings: DailyCommandContextWarning[] }> {
  const timezone = await getUserTimezone(userId);
  const dateKey = getLocalDateKey(opts.now ?? new Date(), timezone);
  const existingPlan = await getPlanForUser(userId, dateKey);
  const mode = opts.mode ?? "merge";

  if (mode === "replace" && opts.confirmReplace !== true) {
    const error = new Error("Replacing today's plan requires confirmReplace=true.");
    (error as Error & { status?: number }).status = 409;
    throw error;
  }

  const basePlan: DailyPlanData = mode === "replace"
    ? { date: dateKey, tasks: [] }
    : existingPlan ?? { date: dateKey, tasks: [] };
  const existingTasks = Array.isArray(basePlan.tasks) ? basePlan.tasks : [];

  let generatedTasks: Array<Partial<DailyPlanTask> & { title: string }> = [];
  let contextWarnings: DailyCommandContextWarning[] = [];
  let reasoning = "";

  if (opts.allowAiSuggestions !== false) {
    const { buildPlanForUser } = await import("../services/planGenerationService");
    const result = await buildPlanForUser(userId, {
      dateKey,
      timezone,
      existingTasks,
    });
    generatedTasks = (result?.tasks ?? []) as Array<Partial<DailyPlanTask> & { title: string }>;
    contextWarnings = result?.contextWarnings ?? [];
    reasoning = result?.reasoning ?? "";
  }

  if (generatedTasks.length === 0 && existingTasks.length === 0) {
    generatedTasks = [fallbackTask(dateKey)];
    contextWarnings = [
      ...contextWarnings,
      { source: "plan_generation", severity: "warning", message: "Jarvis used a fallback task because generated plan output was empty." },
    ];
  }

  let merged = mergeGeneratedTasksIntoPlan(basePlan, generatedTasks, {
    dateKey,
    source: opts.source ?? "daily_command_api",
    mode,
    contextWarnings,
  });
  let goalTaskCount = 0;

  try {
    const { getInjectableGoalTasks, getPlanPacingContextFromTasks, markTasksInjected } = await import("../goalScheduler");
    const picks = await getInjectableGoalTasks(userId, dateKey, getPlanPacingContextFromTasks(merged.plan.tasks));
    const insertedPicks = [];
    const { mergeGoalTaskIntoPlan } = await import("../goalPlanHandoff");
    let nextPlan = merged.plan;
    for (const pick of picks) {
      const result = mergeGoalTaskIntoPlan(nextPlan, pick, dateKey);
      nextPlan = result.plan;
      if (result.inserted) {
        insertedPicks.push(pick);
      }
    }
    if (insertedPicks.length > 0) {
      await markTasksInjected(userId, insertedPicks, dateKey);
      goalTaskCount = insertedPicks.length;
    }
    merged = {
      ...merged,
      plan: {
        ...nextPlan,
        meta: {
          ...nextPlan.meta,
          dailyCommand: {
            ...nextPlan.meta?.dailyCommand,
            source: opts.source ?? "daily_command_api",
            generatedAt: new Date().toISOString(),
            mode,
            contextWarnings,
            aiTaskCount: merged.inserted.length,
            goalTaskCount,
            preservedTaskCount: existingTasks.length,
            reasoning,
          },
        },
      },
    };
  } catch (err) {
    contextWarnings = [
      ...contextWarnings,
      { source: "goals", severity: "warning", message: `Goal task handoff failed: ${err instanceof Error ? err.message : "unknown error"}` },
    ];
    merged.plan = {
      ...merged.plan,
      meta: {
        ...merged.plan.meta,
        dailyCommand: {
          ...merged.plan.meta?.dailyCommand,
          source: opts.source ?? "daily_command_api",
          generatedAt: new Date().toISOString(),
          mode,
          contextWarnings,
          goalTaskCount,
          reasoning,
        },
      },
    };
  }

  await savePlanForUser({
    userId,
    date: dateKey,
    data: merged.plan,
    previousData: existingPlan,
  });

  return {
    plan: merged.plan,
    insertedTaskCount: merged.inserted.length + goalTaskCount,
    contextWarnings,
  };
}

function findTask(tasks: DailyPlanTask[], taskId: string): DailyPlanTask | null {
  for (const task of tasks) {
    if (task.id === taskId) return task;
    if (Array.isArray(task.subtasks)) {
      const found = findTask(task.subtasks, taskId);
      if (found) return found;
    }
  }
  return null;
}

export async function patchDailyCommandPlan(userId: string, patch: DailyPlanPatch, now = new Date()): Promise<{
  plan: DailyPlanData;
  carriedTo?: string;
}> {
  const timezone = await getUserTimezone(userId);
  const date = getLocalDateKey(now, timezone);
  const current = await getPlanForUser(userId, date) ?? { date, tasks: [] };

  if (patch.op === "carry_over_task") {
    const targetDate = patch.targetDate || getNextLocalDateKey(date);
    const task = findTask(current.tasks, patch.taskId);
    if (!task) {
      const error = new Error("Task not found.");
      (error as Error & { status?: number }).status = 404;
      throw error;
    }
    const targetPlan = await getPlanForUser(userId, targetDate) ?? { date: targetDate, tasks: [] };
    const carriedTask: DailyPlanTask = {
      ...task,
      id: `${task.id}_carry_${targetDate}`,
      completed: false,
      fromCarryover: true,
      carriedFromDate: date,
      dailyCommandDate: targetDate,
      originSurface: "daily_command",
      sourceIntent: "carry_over",
      createdAt: Date.now(),
    };
    const nextTargetPlan = applyDailyPlanPatch(targetPlan, { op: "add_task", task: carriedTask });
    await savePlanForUser({ userId, date: targetDate, data: nextTargetPlan, previousData: targetPlan });
    return { plan: current, carriedTo: targetDate };
  }

  const next = applyDailyPlanPatch(current, patch);
  await savePlanForUser({ userId, date, data: next, previousData: current });
  return { plan: next };
}
