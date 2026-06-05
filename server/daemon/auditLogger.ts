/**
 * daemonAuditLogger.ts — Audit logging for all daemon actions.
 *
 * Provides structured logging for desktop and Android daemon operations,
 * enabling security review, compliance, and recovery tracing.
 *
 * Every daemon action should be logged via logDaemonAction() with:
 * - Result: "success" | "denied" | "failed" | "timeout"
 * - Reason: why denied/failed
 * - Duration: how long the operation took
 * - Whether approval was obtained
 */
import { db } from "../db";
import { daemonAuditLog } from "@shared/schema";
import type { DaemonOp } from "./bridge";

export type DaemonResult = "success" | "denied" | "failed" | "timeout";

export interface DaemonAuditEntry {
  userId: string;
  daemonType: "desktop" | "android";
  action: string;
  args: Record<string, unknown>;
  result: DaemonResult;
  reason?: string;
  ipAddress?: string;
  daemonHost?: string;
  approvalObtained?: boolean;
  gateId?: string;
  durationMs?: number;
  jobId?: string;
}

/**
 * Log a daemon action to the audit trail.
 * Non-blocking — failures are logged to console but don't block the operation.
 */
export async function logDaemonAction(entry: DaemonAuditEntry): Promise<void> {
  try {
    await db.insert(daemonAuditLog).values({
      userId: entry.userId,
      daemonType: entry.daemonType,
      action: entry.action,
      argsJson: entry.args,
      result: entry.result,
      reason: entry.reason ?? null,
      ipAddress: entry.ipAddress ?? null,
      daemonHost: entry.daemonHost ?? null,
      approvalObtained: entry.approvalObtained ?? false,
      gateId: entry.gateId ?? null,
      durationMs: entry.durationMs ?? null,
      jobId: entry.jobId ?? null,
    });
  } catch (err) {
    // Non-fatal: don't block the daemon operation
    console.error("[DaemonAudit] failed to write audit log:", err);
  }
}

/**
 * Extract the action name from a DaemonOp message.
 */
export function extractActionName(op: DaemonOp): string {
  if ("type" in op) {
    return op.type;
  }
  return "unknown";
}

/**
 * Extract sanitized args from a DaemonOp (removes sensitive data).
 * Sensitive fields are redacted for logging.
 */
export function sanitizeArgs(op: DaemonOp): Record<string, unknown> {
  const sensitive = ["password", "token", "secret", "apiKey", "api_key", "auth"];
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(op)) {
    if (key === "type") continue;
    
    const lowerKey = key.toLowerCase();
    const isSensitive = sensitive.some(s => lowerKey.includes(s));
    
    if (isSensitive) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "string" && value.length > 500) {
      result[key] = value.slice(0, 500) + "...[truncated]";
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Get recent audit entries for a user.
 * Useful for security review and debugging.
 */
export async function getRecentDaemonAudit(
  userId: string,
  limit = 50,
  daemonType?: "desktop" | "android"
) {
  const { desc, eq, and } = await import("drizzle-orm");
  const { daemonAuditLog: table } = await import("@shared/schema");

  const conditions = [eq(table.userId, userId)];
  if (daemonType) {
    conditions.push(eq(table.daemonType, daemonType));
  }

  return db
    .select()
    .from(daemonAuditLog)
    .where(and(...conditions))
    .orderBy(desc(daemonAuditLog.createdAt))
    .limit(limit);
}

/**
 * Get audit statistics for a user (for admin/security dashboards).
 */
export async function getDaemonAuditStats(userId: string, daysBack = 7) {
  const { desc, eq, and, gte, sql } = await import("drizzle-orm");
  const { daemonAuditLog: table } = await import("@shared/schema");

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);

  const stats = await db
    .select({
      daemonType: table.daemonType,
      action: table.action,
      result: table.result,
      count: sql<number>`count(*)`.as("count"),
    })
    .from(daemonAuditLog)
    .where(and(
      eq(table.userId, userId),
      gte(table.createdAt, cutoff)
    ))
    .groupBy(table.daemonType, table.action, table.result);

  return stats;
}