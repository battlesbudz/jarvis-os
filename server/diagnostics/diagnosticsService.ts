/**
 * DiagnosticsService — Jarvis system health monitoring.
 *
 * Central hub for emitting, detecting, and recovering from system-wide anomalies.
 * All subsystems call emit() for errors and key milestones.
 *
 * Pattern detection: 3+ errors in 15 min on the same subsystem persists a
 * "pattern_detected" critical event in the DB and notifies the user.
 * Degraded state is DB-backed (not in-memory) so it survives restarts.
 *
 * Degradation clears only when a caller explicitly emits with
 * `metadata.recovery = true`, preventing false clearance from incidental info events.
 *
 * runHealthCheck() actively probes: OpenAI, DB, job queue, channel registry,
 * workflow engine (stuck count), and integration statuses.
 *
 * Auto-recovery handles: stale queued jobs and stuck workflows.
 */

import { db } from "../db";
import { eq, and, desc, gte, sql as sqlExpr } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
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
  openAiLatencyMs: number | null;
  dbReachable: boolean;
  jobQueueDepth: number;
  staleJobCount: number;
  channelStatuses: Record<string, { configured: boolean; linked?: boolean }>;
  stuckWorkflowCount: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

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

// Notification cooldown — only affects notification rate, not degraded state.
const notifiedDegradedAt = new Map<string, Date>();
const NOTIFY_COOLDOWN_MS = 30 * 60 * 1000;

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
  } else if (opts.severity === "info" && opts.metadata?.recovery === true) {
    // Degradation clears only on an explicit recovery signal, not on every info event.
    await clearDegradation(opts.subsystem, opts.userId);
  }
}

// ─── Pattern detection ────────────────────────────────────────────────────────
// Degraded state is persisted in the DB as a critical "pattern_detected" event.
// This survives server restarts and allows historical visibility.

async function isDegradedInDB(subsystem: DiagnosticSubsystem, userId?: string): Promise<boolean> {
  try {
    const since = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const conditions: SQL<unknown>[] = [
      eq(schema.diagnosticEvents.subsystem, subsystem),
      eq(schema.diagnosticEvents.severity, "critical"),
      eq(schema.diagnosticEvents.resolved, false),
      gte(schema.diagnosticEvents.createdAt, since),
      sqlExpr`(${schema.diagnosticEvents.metadata}->>'type') = 'pattern_detected'`,
    ];
    if (userId) conditions.push(eq(schema.diagnosticEvents.userId, userId));

    const rows = await db
      .select({ id: schema.diagnosticEvents.id })
      .from(schema.diagnosticEvents)
      .where(and(...conditions))
      .limit(1);
    return rows.length > 0;
  } catch {
    return false;
  }
}

async function detectDegradation(subsystem: DiagnosticSubsystem, userId?: string): Promise<void> {
  try {
    const windowStart = new Date(Date.now() - 15 * 60 * 1000);
    const errorConditions: SQL<unknown>[] = [
      eq(schema.diagnosticEvents.subsystem, subsystem),
      sqlExpr`${schema.diagnosticEvents.severity} IN ('error', 'critical')`,
      gte(schema.diagnosticEvents.createdAt, windowStart),
    ];
    if (userId) errorConditions.push(eq(schema.diagnosticEvents.userId, userId));

    const rows = await db
      .select({ id: schema.diagnosticEvents.id })
      .from(schema.diagnosticEvents)
      .where(and(...errorConditions))
      .limit(5);

    if (rows.length < 3) return;

    const alreadyDegraded = await isDegradedInDB(subsystem, userId);
    if (alreadyDegraded) return;

    // Persist degradation state as a critical event in the DB.
    await db.insert(schema.diagnosticEvents).values({
      userId: userId ?? null,
      subsystem,
      severity: "critical",
      message: `Subsystem degraded: ${SUBSYSTEM_LABELS[subsystem]} — ${rows.length} errors in 15 minutes`,
      metadata: { type: "pattern_detected", errorCount: rows.length },
    });

    console.warn(`[Diagnostics] subsystem DEGRADED (persisted): ${subsystem} (${rows.length} errors in 15m)`);

    if (!userId) return;

    const key = `${subsystem}:${userId}`;
    const lastNotified = notifiedDegradedAt.get(key);
    if (lastNotified && Date.now() - lastNotified.getTime() < NOTIFY_COOLDOWN_MS) return;
    notifiedDegradedAt.set(key, new Date());

    try {
      const { notifyUser } = await import("../channels/registry");
      const label = SUBSYSTEM_LABELS[subsystem];
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
  try {
    const isDegraded = await isDegradedInDB(subsystem, userId);
    if (!isDegraded) return;

    const since = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const conditions: SQL<unknown>[] = [
      eq(schema.diagnosticEvents.subsystem, subsystem),
      eq(schema.diagnosticEvents.resolved, false),
      gte(schema.diagnosticEvents.createdAt, since),
    ];
    if (userId) conditions.push(eq(schema.diagnosticEvents.userId, userId));

    await db
      .update(schema.diagnosticEvents)
      .set({ resolved: true })
      .where(and(...conditions))
      .catch(() => {});

    console.log(`[Diagnostics] subsystem RECOVERED: ${subsystem}`);
  } catch (err) {
    console.error("[Diagnostics] clearDegradation failed:", err);
  }
}

// ─── Auto-recovery ────────────────────────────────────────────────────────────

async function attemptAutoRecovery(subsystem: DiagnosticSubsystem, userId: string): Promise<void> {
  try {
    if (subsystem === "job_queue") {
      const staleThreshold = new Date(Date.now() - 10 * 60 * 1000);
      const staleJobs = await db
        .select({ id: schema.agentJobs.id, agentType: schema.agentJobs.agentType })
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
        // Re-enqueue (not fail): reset to queued so the job gets another chance.
        await db
          .update(schema.agentJobs)
          .set({ status: "queued", startedAt: null, error: "Auto-re-enqueued: exceeded watchdog timeout" })
          .where(eq(schema.agentJobs.id, job.id))
          .catch(() => {});
        await emit({
          userId,
          subsystem: "job_queue",
          severity: "info",
          message: `Auto-re-enqueued stale job ${job.id} (${job.agentType})`,
          metadata: { jobId: job.id, action: "watchdog_reenqueue", recovery: true },
        });
        console.log(`[Diagnostics] auto-re-enqueued stale job ${job.id}`);
      }
    }

    if (subsystem === "workflow_engine") {
      const staleThreshold = new Date(Date.now() - 30 * 60 * 1000);
      const stuckWorkflows = await db
        .select({ id: schema.agentWorkflows.id, title: schema.agentWorkflows.title })
        .from(schema.agentWorkflows)
        .where(
          and(
            eq(schema.agentWorkflows.userId, userId),
            eq(schema.agentWorkflows.status, "running"),
            sqlExpr`${schema.agentWorkflows.updatedAt} < ${staleThreshold}`,
          ),
        )
        .limit(3);

      for (const wf of stuckWorkflows) {
        await db
          .update(schema.agentWorkflows)
          .set({ status: "failed", updatedAt: new Date() })
          .where(eq(schema.agentWorkflows.id, wf.id))
          .catch(() => {});
        await emit({
          userId,
          subsystem: "workflow_engine",
          severity: "info",
          message: `Auto-recovered stuck workflow "${wf.title}"`,
          metadata: { workflowId: wf.id, action: "stuck_reset", recovery: true },
        });
        console.log(`[Diagnostics] auto-recovered stuck workflow ${wf.id}`);
      }
    }

    if (subsystem === "channel_registry") {
      // Re-probe channels: if any are now reachable, emit recovery.
      try {
        const { listChannels } = await import("../channels/registry");
        const channels = listChannels();
        const anyConfigured = channels.some((ch) => ch.isConfigured());
        if (anyConfigured) {
          await emit({
            userId,
            subsystem: "channel_registry",
            severity: "info",
            message: "Channel registry auto-recovery: at least one channel is configured",
            metadata: { recovery: true },
          });
        }
      } catch {
        // Best-effort
      }
    }

    if (subsystem === "integration") {
      // Trigger a full validation cycle (includes token refresh via getValidGoogleTokens).
      // This is the proper re-auth path — not just reading existing DB statuses.
      try {
        const { validateUserIntegrations } = await import("../intelligence/integrationValidator");
        await validateUserIntegrations(userId);
        // After re-validation, check current statuses to see if we recovered.
        const { getUserIntegrationStatuses } = await import("../intelligence/integrationValidator");
        const statuses = await getUserIntegrationStatuses(userId);
        const anyBroken = Object.values(statuses).some((s) => s === "broken");
        if (!anyBroken) {
          await emit({
            userId,
            subsystem: "integration",
            severity: "info",
            message: "Integration auto-recovery: all integrations re-validated successfully",
            metadata: { recovery: true },
          });
          console.log(`[Diagnostics] integration auto-recovery successful for user ${userId}`);
        } else {
          console.warn(`[Diagnostics] integration auto-recovery incomplete for user ${userId} — some still broken`);
        }
      } catch {
        // Best-effort
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
  excludePatternDetected?: boolean;
}): Promise<schema.DiagnosticEvent[]> {
  const { userId, subsystem, severity, limit = 50, sinceMinutes, excludePatternDetected = false } = opts;
  try {
    const conditions: SQL<unknown>[] = [];
    if (userId) conditions.push(eq(schema.diagnosticEvents.userId, userId));
    if (subsystem) conditions.push(eq(schema.diagnosticEvents.subsystem, subsystem));
    if (severity) conditions.push(eq(schema.diagnosticEvents.severity, severity));
    if (sinceMinutes) {
      const since = new Date(Date.now() - sinceMinutes * 60 * 1000);
      conditions.push(gte(schema.diagnosticEvents.createdAt, since));
    }
    if (excludePatternDetected) {
      conditions.push(
        sqlExpr`(${schema.diagnosticEvents.metadata}->>'type') IS DISTINCT FROM 'pattern_detected'`,
      );
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
  let stuckWorkflowCount = 0;

  try {
    const [depthRows, staleRows, stuckWfRows] = await Promise.all([
      db.select({ count: sqlExpr<number>`count(*)::int` }).from(schema.agentJobs).where(eq(schema.agentJobs.status, "queued")),
      db.select({ count: sqlExpr<number>`count(*)::int` }).from(schema.agentJobs).where(
        and(
          eq(schema.agentJobs.status, "running"),
          sqlExpr`${schema.agentJobs.startedAt} < ${new Date(now.getTime() - 10 * 60 * 1000)}`,
        ),
      ),
      db.select({ count: sqlExpr<number>`count(*)::int` }).from(schema.agentWorkflows).where(
        and(
          eq(schema.agentWorkflows.status, "running"),
          sqlExpr`${schema.agentWorkflows.updatedAt} < ${new Date(now.getTime() - 30 * 60 * 1000)}`,
        ),
      ),
    ]);
    jobQueueDepth = depthRows[0]?.count ?? 0;
    staleJobCount = staleRows[0]?.count ?? 0;
    stuckWorkflowCount = stuckWfRows[0]?.count ?? 0;
  } catch {
    dbReachable = false;
  }

  // OpenAI probe — measure latency with a lightweight models.list() call.
  let openAiReachable = true;
  let openAiLatencyMs: number | null = null;
  const openAiProbeStart = Date.now();
  try {
    await openai.models.list();
    openAiLatencyMs = Date.now() - openAiProbeStart;
  } catch {
    openAiReachable = false;
    openAiLatencyMs = null;
    await emit({
      userId,
      subsystem: "agent_harness",
      severity: "error",
      message: "OpenAI API unreachable during health check",
      metadata: { healthCheck: true },
    }).catch(() => {});
  }

  // Channel registry probe — configured + linked-for-user checks.
  const channelStatuses: Record<string, { configured: boolean; linked?: boolean }> = {};
  try {
    const { listChannels } = await import("../channels/registry");
    const channels = listChannels();
    for (const ch of channels) {
      const configured = ch.isConfigured();
      let linked: boolean | undefined;
      if (userId && configured) {
        try {
          linked = await ch.isLinkedFor(userId);
        } catch {
          linked = false;
        }
      }
      channelStatuses[ch.name] = { configured, linked };
    }
  } catch {
    // Best-effort
  }

  // Integration health probe.
  let integrationHealth: Record<string, string> = {};
  if (userId) {
    try {
      const { getUserIntegrationStatuses } = await import("../intelligence/integrationValidator");
      integrationHealth = await getUserIntegrationStatuses(userId);
    } catch {
      // Best-effort
    }
  }
  const brokenIntegrations = Object.entries(integrationHealth).filter(([, s]) => s === "broken").map(([k]) => k);

  // Per-subsystem status (from diagnostic events DB).
  const subsystems: SubsystemStatus[] = await Promise.all(
    (schema.DIAGNOSTIC_SUBSYSTEMS as readonly DiagnosticSubsystem[]).map(async (sub) => {
      try {
        const errorConditions: SQL<unknown>[] = [
          eq(schema.diagnosticEvents.subsystem, sub),
          gte(schema.diagnosticEvents.createdAt, windowStart),
          sqlExpr`${schema.diagnosticEvents.severity} IN ('error', 'critical')`,
          sqlExpr`(${schema.diagnosticEvents.metadata}->>'type') IS DISTINCT FROM 'pattern_detected'`,
        ];
        if (userId) errorConditions.push(eq(schema.diagnosticEvents.userId, userId));

        const lastEventConditions: SQL<unknown>[] = [eq(schema.diagnosticEvents.subsystem, sub)];
        if (userId) lastEventConditions.push(eq(schema.diagnosticEvents.userId, userId));

        const [recentErrorRows, lastEventRows] = await Promise.all([
          db.select({ count: sqlExpr<number>`count(*)::int` })
            .from(schema.diagnosticEvents)
            .where(and(...errorConditions)),
          db.select({ message: schema.diagnosticEvents.message, createdAt: schema.diagnosticEvents.createdAt })
            .from(schema.diagnosticEvents)
            .where(and(...lastEventConditions))
            .orderBy(desc(schema.diagnosticEvents.createdAt))
            .limit(1),
        ]);

        const errorCount = recentErrorRows[0]?.count ?? 0;
        const isDegraded = await isDegradedInDB(sub, userId);

        let status: SubsystemStatus["status"] = "healthy";
        if (errorCount >= 5 || (sub === "database" && !dbReachable)) status = "down";
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
        return { name: sub, label: SUBSYSTEM_LABELS[sub], status: "unknown" as const, errorCount15m: 0 };
      }
    }),
  );

  // Apply known overrides from active probes.
  if (!dbReachable) {
    const s = subsystems.find((s) => s.name === "database");
    if (s) s.status = "down";
  }
  if (!openAiReachable) {
    const s = subsystems.find((s) => s.name === "agent_harness");
    if (s && s.status === "healthy") s.status = "degraded";
  }
  if (staleJobCount > 0) {
    const s = subsystems.find((s) => s.name === "job_queue");
    if (s && s.status === "healthy") s.status = "degraded";
  }
  if (stuckWorkflowCount > 0) {
    const s = subsystems.find((s) => s.name === "workflow_engine");
    if (s && s.status === "healthy") s.status = "degraded";
  }
  if (brokenIntegrations.length > 0) {
    const s = subsystems.find((s) => s.name === "integration");
    if (s && s.status === "healthy") s.status = "degraded";
  }
  const unconfiguredChannelCount = Object.values(channelStatuses).filter((c) => !c.configured).length;
  if (unconfiguredChannelCount > 0 && unconfiguredChannelCount === Object.keys(channelStatuses).length) {
    const s = subsystems.find((s) => s.name === "channel_registry");
    if (s) s.status = "degraded";
  }

  const recentErrors = await getRecentEvents({
    userId,
    severity: "error",
    limit: 20,
    sinceMinutes: 60,
    excludePatternDetected: true,
  });
  const degradedSubsystems = subsystems
    .filter((s) => s.status !== "healthy" && s.status !== "unknown")
    .map((s) => s.name);

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
    openAiLatencyMs,
    dbReachable,
    jobQueueDepth,
    staleJobCount,
    channelStatuses,
    stuckWorkflowCount,
  };
}

// ─── AI-powered diagnosis ─────────────────────────────────────────────────────

/**
 * Run an AI diagnosis against a pre-computed (or freshly computed) HealthReport.
 * Pass `existingReport` to avoid a duplicate health check when the caller already ran one.
 */
export async function runAIDiagnosis(
  userId?: string,
  existingReport?: HealthReport,
): Promise<{ diagnosis: string; report: HealthReport }> {
  const report = existingReport ?? (await runHealthCheck(userId));

  const recentEvents = await getRecentEvents({
    userId,
    limit: 30,
    sinceMinutes: 60,
    excludePatternDetected: true,
  });

  const subsystemSummary = report.subsystems
    .filter((s) => s.status !== "healthy")
    .map((s) => `- ${s.label}: ${s.status.toUpperCase()} (${s.errorCount15m} errors in 15m)`)
    .join("\n") || "All subsystems healthy.";

  const eventLog = recentEvents
    .slice(0, 20)
    .map((e) => `[${e.severity.toUpperCase()}] ${e.subsystem}: ${e.message}`)
    .join("\n") || "No recent errors.";

  const channelNote = Object.entries(report.channelStatuses)
    .map(([name, c]) => {
      if (!c.configured) return `${name}:unconfigured`;
      if (c.linked === false) return `${name}:not-linked`;
      return null;
    })
    .filter(Boolean)
    .join(", ");

  const latencyNote = report.openAiLatencyMs != null
    ? `${report.openAiLatencyMs}ms`
    : "unreachable";

  const prompt = `You are Jarvis, performing a self-diagnosis. Analyze the system health data and write a clear, plain-English report for the user.

Overall status: ${report.overallStatus.toUpperCase()}
OpenAI reachable: ${report.openAiReachable} (latency: ${latencyNote})
Database reachable: ${report.dbReachable}
Job queue depth: ${report.jobQueueDepth} (${report.staleJobCount} stale/re-enqueued)
Stuck workflows: ${report.stuckWorkflowCount}
Channel issues: ${channelNote || "none"}

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
    const diagnosis = resp.choices[0]?.message?.content?.trim() || "Unable to generate diagnosis — OpenAI unavailable.";
    return { diagnosis, report };
  } catch {
    const lines: string[] = ["Diagnosis summary:"];
    lines.push(`Overall: ${report.overallStatus}`);
    if (!report.openAiReachable) lines.push("OpenAI API is unreachable — AI features are unavailable.");
    if (!report.dbReachable) lines.push("Database is unreachable — all data operations are failing.");
    if (report.staleJobCount > 0) lines.push(`${report.staleJobCount} background job(s) appear stuck.`);
    if (report.stuckWorkflowCount > 0) lines.push(`${report.stuckWorkflowCount} workflow(s) appear stuck.`);
    if (report.degradedSubsystems.length === 0) lines.push("No major subsystem issues detected.");
    return { diagnosis: lines.join(" "), report };
  }
}
