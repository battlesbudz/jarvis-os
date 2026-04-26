/**
 * DiagnosticsService — Jarvis system health monitoring.
 *
 * Central hub for emitting, detecting, and recovering from system-wide
 * anomalies. All subsystems call `emit()` for errors and key milestones.
 * Pattern detection runs after every emit: 3+ errors in 15 min on the same
 * subsystem triggers a degraded-state alert and proactive user notification.
 * Auto-recovery is attempted for known fixable issues.
 */

import { db } from "../db";
import { eq, and, desc, gte, sql as sqlExpr } from "drizzle-orm";
import * as schema from "@shared/schema";
import type { DiagnosticSubsystem, DiagnosticSeverity } from "@shared/schema";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmitOptions {
  userId?: string;
  subsystem: DiagnosticSubsystem;
  severity: DiagnosticSeverity;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface SubsystemStatus {
  name: DiagnosticSubsystem;
  label: string;
  status: "healthy" | "degraded" | "down" | "unknown";
  lastEvent?: string;
  lastEventAt?: Date;
  errorCount15m: number;
}

export interface HealthReport {
  overallStatus: "healthy" | "degraded" | "down";
  subsystems: SubsystemStatus[];
  recentErrors: schema.DiagnosticEvent[];
  degradedSubsystems: DiagnosticSubsystem[];
  generatedAt: Date;
  openAiReachable: boolean;
  dbReachable: boolean;
  jobQueueDepth: number;
  staleJobCount: number;
}

// ─── In-memory degraded state (cleared on recovery) ──────────────────────────

const degradedSince = new Map<string, Date>(); // key = `${subsystem}:${userId ?? "global"}`
const notifiedDegradedAt = new Map<string, Date>();

const SUBSYSTEM_LABELS: Record<DiagnosticSubsystem, string> = {
  job_queue: "Job Queue",
  workflow_engine: "Workflow Engine",
  agent_harness: "Agent Harness",
  channel_registry: "Channel Delivery",
  integration: "Integrations",
  heartbeat: "Heartbeat",
  memory: "Memory",
  database: "Database",
};

// ─── Core emit ────────────────────────────────────────────────────────────────

export async function emit(opts: EmitOptions): Promise<void> {
  try {
    await db.insert(schema.diagnosticEvents).values({
      userId: opts.userId ?? null,
      subsystem: opts.subsystem,
      severity: opts.severity,
      message: opts.message.slice(0, 2000),
      metadata: opts.metadata ?? {},
    });
  } catch (err) {
    console.error("[Diagnostics] emit write failed:", err);
    return;
  }

  if (opts.severity === "error" || opts.severity === "critical") {
    await detectDegradation(opts.subsystem, opts.userId);
  } else if (opts.severity === "info") {
    await clearDegradation(opts.subsystem, opts.userId);
  }
}

// ─── Pattern detection ────────────────────────────────────────────────────────

async function detectDegradation(subsystem: DiagnosticSubsystem, userId?: string): Promise<void> {
  try {
    const windowStart = new Date(Date.now() - 15 * 60 * 1000);
    const rows = await db
      .select({ id: schema.diagnosticEvents.id })
      .from(schema.diagnosticEvents)
      .where(
        and(
          eq(schema.diagnosticEvents.subsystem, subsystem),
          sqlExpr`${schema.diagnosticEvents.severity} IN ('error', 'critical')`,
          gte(schema.diagnosticEvents.createdAt, windowStart),
          userId
            ? eq(schema.diagnosticEvents.userId, userId)
            : sqlExpr`${schema.diagnosticEvents.userId} IS NULL`,
        ),
      )
      .limit(5);

    if (rows.length < 3) return;

    const key = `${subsystem}:${userId ?? "global"}`;
    if (degradedSince.has(key)) return;

    degradedSince.set(key, new Date());
    console.warn(`[Diagnostics] subsystem DEGRADED: ${subsystem} (${rows.length} errors in 15m)`);

    if (!userId) return;
    const lastNotified = notifiedDegradedAt.get(key);
    if (lastNotified && Date.now() - lastNotified.getTime() < 30 * 60 * 1000) return;
    notifiedDegradedAt.set(key, new Date());

    try {
      const { notifyUser } = await import("../channels/registry");
      const label = SUBSYSTEM_LABELS[subsystem] ?? subsystem;
      await notifyUser(
        userId,
        "general",
        `⚠️ Jarvis subsystem issue: **${label}** has encountered ${rows.length} errors in the last 15 minutes. I'm looking into it — ask me "what's wrong?" for a detailed diagnosis.`,
      );
    } catch (notifyErr) {
      console.error("[Diagnostics] proactive notify failed:", notifyErr);
    }

    await attemptAutoRecovery(subsystem, userId);
  } catch (err) {
    console.error("[Diagnostics] detectDegradation failed:", err);
  }
}

async function clearDegradation(subsystem: DiagnosticSubsystem, userId?: string): Promise<void> {
  const key = `${subsystem}:${userId ?? "global"}`;
  if (degradedSince.has(key)) {
    degradedSince.delete(key);
    console.log(`[Diagnostics] subsystem RECOVERED: ${subsystem}`);
    await db
      .update(schema.diagnosticEvents)
      .set({ resolved: true })
      .where(
        and(
          eq(schema.diagnosticEvents.subsystem, subsystem),
          eq(schema.diagnosticEvents.resolved, false),
          userId
            ? eq(schema.diagnosticEvents.userId, userId)
            : sqlExpr`${schema.diagnosticEvents.userId} IS NULL`,
        ),
      )
      .catch(() => {});
  }
}

// ─── Auto-recovery ────────────────────────────────────────────────────────────

async function attemptAutoRecovery(subsystem: DiagnosticSubsystem, userId: string): Promise<void> {
  try {
    if (subsystem === "job_queue") {
      const staleThreshold = new Date(Date.now() - 10 * 60 * 1000);
      const staleJobs = await db
        .select({ id: schema.agentJobs.id })
        .from(schema.agentJobs)
        .where(
          and(
            eq(schema.agentJobs.userId, userId),
            eq(schema.agentJobs.status, "running"),
            sqlExpr`${schema.agentJobs.startedAt} < ${staleThreshold}`,
          ),
        )
        .limit(5);

      for (const job of staleJobs) {
        await db
          .update(schema.agentJobs)
          .set({ status: "failed", error: "Auto-recovered: exceeded watchdog timeout", completedAt: new Date() })
          .where(eq(schema.agentJobs.id, job.id))
          .catch(() => {});
        await emit({
          userId,
          subsystem: "job_queue",
          severity: "info",
          message: `Auto-recovered stale job ${job.id}`,
          metadata: { jobId: job.id, action: "watchdog_reset" },
        });
        console.log(`[Diagnostics] auto-recovered stale job ${job.id}`);
      }
    }
  } catch (err) {
    console.error("[Diagnostics] auto-recovery failed:", err);
  }
}

// ─── Query helpers ────────────────────────────────────────────────────────────

export async function getRecentEvents(opts: {
  userId?: string;
  subsystem?: DiagnosticSubsystem;
  severity?: DiagnosticSeverity;
  limit?: number;
  sinceMinutes?: number;
}): Promise<schema.DiagnosticEvent[]> {
  const { userId, subsystem, severity, limit = 50, sinceMinutes } = opts;
  try {
    const conditions = [];
    if (userId) conditions.push(eq(schema.diagnosticEvents.userId, userId));
    if (subsystem) conditions.push(eq(schema.diagnosticEvents.subsystem, subsystem));
    if (severity) conditions.push(eq(schema.diagnosticEvents.severity, severity));
    if (sinceMinutes) {
      const since = new Date(Date.now() - sinceMinutes * 60 * 1000);
      conditions.push(gte(schema.diagnosticEvents.createdAt, since));
    }

    return await db
      .select()
      .from(schema.diagnosticEvents)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(schema.diagnosticEvents.createdAt))
      .limit(limit);
  } catch {
    return [];
  }
}

// ─── Health check ─────────────────────────────────────────────────────────────

export async function runHealthCheck(userId?: string): Promise<HealthReport> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - 15 * 60 * 1000);

  let dbReachable = true;
  let jobQueueDepth = 0;
  let staleJobCount = 0;

  try {
    const depthRows = await db
      .select({ count: sqlExpr<number>`count(*)::int` })
      .from(schema.agentJobs)
      .where(eq(schema.agentJobs.status, "queued"));
    jobQueueDepth = depthRows[0]?.count ?? 0;

    const staleThreshold = new Date(now.getTime() - 10 * 60 * 1000);
    const staleRows = await db
      .select({ count: sqlExpr<number>`count(*)::int` })
      .from(schema.agentJobs)
      .where(
        and(
          eq(schema.agentJobs.status, "running"),
          sqlExpr`${schema.agentJobs.startedAt} < ${staleThreshold}`,
        ),
      );
    staleJobCount = staleRows[0]?.count ?? 0;
  } catch {
    dbReachable = false;
  }

  let openAiReachable = true;
  try {
    await openai.models.list();
  } catch {
    openAiReachable = false;
    await emit({
      userId,
      subsystem: "agent_harness",
      severity: "error",
      message: "OpenAI API unreachable during health check",
      metadata: { healthCheck: true },
    }).catch(() => {});
  }

  const subsystems: SubsystemStatus[] = await Promise.all(
    (schema.DIAGNOSTIC_SUBSYSTEMS as readonly DiagnosticSubsystem[]).map(async (sub) => {
      try {
        const conditions = [
          eq(schema.diagnosticEvents.subsystem, sub),
          gte(schema.diagnosticEvents.createdAt, windowStart),
        ];
        if (userId) conditions.push(eq(schema.diagnosticEvents.userId, userId));

        const recentErrors = await db
          .select({ count: sqlExpr<number>`count(*)::int` })
          .from(schema.diagnosticEvents)
          .where(
            and(
              ...conditions,
              sqlExpr`${schema.diagnosticEvents.severity} IN ('error', 'critical')`,
            ),
          );
        const errorCount = recentErrors[0]?.count ?? 0;

        const lastEventRows = await db
          .select({
            message: schema.diagnosticEvents.message,
            createdAt: schema.diagnosticEvents.createdAt,
          })
          .from(schema.diagnosticEvents)
          .where(
            userId
              ? and(eq(schema.diagnosticEvents.subsystem, sub), eq(schema.diagnosticEvents.userId, userId))
              : eq(schema.diagnosticEvents.subsystem, sub),
          )
          .orderBy(desc(schema.diagnosticEvents.createdAt))
          .limit(1);

        const key = `${sub}:${userId ?? "global"}`;
        const isDegraded = degradedSince.has(key);

        let status: SubsystemStatus["status"] = "healthy";
        if (errorCount >= 5) status = "down";
        else if (errorCount >= 3 || isDegraded) status = "degraded";

        return {
          name: sub,
          label: SUBSYSTEM_LABELS[sub],
          status,
          lastEvent: lastEventRows[0]?.message,
          lastEventAt: lastEventRows[0]?.createdAt,
          errorCount15m: errorCount,
        };
      } catch {
        return {
          name: sub,
          label: SUBSYSTEM_LABELS[sub],
          status: "unknown" as const,
          errorCount15m: 0,
        };
      }
    }),
  );

  if (!dbReachable) {
    const dbSub = subsystems.find((s) => s.name === "database");
    if (dbSub) dbSub.status = "down";
  }

  if (!openAiReachable) {
    const harnessSub = subsystems.find((s) => s.name === "agent_harness");
    if (harnessSub) harnessSub.status = "degraded";
  }

  if (staleJobCount > 0) {
    const jqSub = subsystems.find((s) => s.name === "job_queue");
    if (jqSub && jqSub.status === "healthy") jqSub.status = "degraded";
  }

  const recentErrors = await getRecentEvents({ userId, severity: "error", limit: 20, sinceMinutes: 60 });
  const degradedSubsystems = subsystems.filter((s) => s.status !== "healthy" && s.status !== "unknown").map((s) => s.name);

  let overallStatus: HealthReport["overallStatus"] = "healthy";
  if (subsystems.some((s) => s.status === "down")) overallStatus = "down";
  else if (degradedSubsystems.length > 0) overallStatus = "degraded";

  return {
    overallStatus,
    subsystems,
    recentErrors,
    degradedSubsystems,
    generatedAt: now,
    openAiReachable,
    dbReachable,
    jobQueueDepth,
    staleJobCount,
  };
}

// ─── AI-powered diagnosis ─────────────────────────────────────────────────────

export async function runAIDiagnosis(userId?: string): Promise<string> {
  const [healthReport, recentEvents] = await Promise.all([
    runHealthCheck(userId),
    getRecentEvents({ userId, limit: 30, sinceMinutes: 60 }),
  ]);

  const subsystemSummary = healthReport.subsystems
    .filter((s) => s.status !== "healthy")
    .map((s) => `- ${s.label}: ${s.status.toUpperCase()} (${s.errorCount15m} errors in 15m)`)
    .join("\n") || "All subsystems healthy.";

  const eventLog = recentEvents
    .slice(0, 20)
    .map((e) => `[${e.severity.toUpperCase()}] ${e.subsystem}: ${e.message}`)
    .join("\n") || "No recent errors.";

  const prompt = `You are Jarvis, performing a self-diagnosis. Analyze the system health data and write a clear, plain-English report for the user.

Overall status: ${healthReport.overallStatus.toUpperCase()}
OpenAI reachable: ${healthReport.openAiReachable}
Database reachable: ${healthReport.dbReachable}
Job queue depth: ${healthReport.jobQueueDepth} (${healthReport.staleJobCount} stale)

Subsystem issues:
${subsystemSummary}

Recent error log (last hour):
${eventLog}

Write a concise report:
1. Overall health (1 sentence)
2. What's broken or degraded and the likely root cause (if anything)
3. What I already tried to fix automatically
4. What the user should do (if anything) — e.g. reconnect an integration, or "nothing needed"

Plain text, no markdown headers, 4-6 sentences max. Be calm and informative, not alarmist.`;

  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_completion_tokens: 400,
    });
    return resp.choices[0]?.message?.content?.trim() || "Unable to generate diagnosis — OpenAI unavailable.";
  } catch {
    const lines = ["Diagnosis summary:"];
    lines.push(`Overall: ${healthReport.overallStatus}`);
    if (!healthReport.openAiReachable) lines.push("OpenAI API is unreachable — AI features are unavailable.");
    if (!healthReport.dbReachable) lines.push("Database is unreachable — all data operations are failing.");
    if (healthReport.staleJobCount > 0) lines.push(`${healthReport.staleJobCount} background job(s) appear stuck.`);
    if (healthReport.degradedSubsystems.length === 0) lines.push("No major subsystem issues detected.");
    return lines.join(" ");
  }
}
