/**
 * Jarvis Doctor API Routes
 *
 * GET /api/doctor  — trigger a full scan (system + per-user) and return results.
 * Results are cached per-user for 10 minutes so repeated taps don't hammer
 * external services.
 *
 * The startup scan runs system-only checks (no user data) to avoid leaking
 * per-user integration state across users. Failures are routed through the
 * existing DiagnosticsService emit pipeline so they appear in health checks
 * and contribute to subsystem degradation tracking.
 */

import type { Express, Request, Response } from "express";
import { authMiddleware } from "../auth";
import { runDoctorScan, runSystemScan, type DoctorReport, type DoctorResult } from "./doctorScan";
import { emit as diagEmit } from "../diagnostics/diagnosticsService";
import { notifyUser } from "../channels/registry";
import type { DiagnosticSubsystem } from "@shared/schema";

interface CacheEntry {
  report: DoctorReport;
  expiresAt: number;
}

const USER_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000;

const SCAN_IN_PROGRESS = new Set<string>();

export function registerDoctorRoutes(app: Express): void {
  app.get("/api/doctor", authMiddleware, async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });

    const cached = USER_CACHE.get(userId);
    if (cached && Date.now() < cached.expiresAt) {
      return res.json({ ...cached.report, cached: true });
    }

    if (SCAN_IN_PROGRESS.has(userId)) {
      return res.status(202).json({
        message: "Scan already in progress. Try again in a few seconds.",
      });
    }

    SCAN_IN_PROGRESS.add(userId);
    try {
      const report = await runDoctorScan(userId);
      USER_CACHE.set(userId, { report, expiresAt: Date.now() + CACHE_TTL_MS });
      return res.json({ ...report, cached: false });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ error: `Doctor scan failed: ${msg}` });
    } finally {
      SCAN_IN_PROGRESS.delete(userId);
    }
  });
}

// Maps Doctor check IDs to the appropriate DiagnosticsService subsystem.
const CHECK_SUBSYSTEM: Record<string, DiagnosticSubsystem> = {
  database_connectivity: "database",
  llm_key_validity: "integration",
  anthropic_key_presence: "integration",
  outbound_https: "channel_registry",
  env_vars_presence: "integration",
  telegram_webhook: "channel_registry",
  discord_bot_token: "channel_registry",
  whatsapp_channel: "channel_registry",
  mcp_endpoint_auth: "integration",
  integration_credentials: "integration",
  oauth_token_expiry: "integration",
};

/**
 * Run a system-only (no user data) Doctor scan at startup.
 * Failures and warnings are fed into the existing DiagnosticsService emit
 * pipeline so they appear in the health dashboard and contribute to subsystem
 * degradation tracking — no bespoke inbox insertion is needed.
 */
export async function runStartupDoctorScan(): Promise<void> {
  try {
    console.log("[Doctor] Running startup system health scan…");
    const report = await runSystemScan();

    const failures = report.results.filter((r) => r.status === "fail");
    const warnings = report.results.filter((r) => r.status === "warn");

    console.log(
      `[Doctor] System scan complete — ${report.summary.pass} passed, ${report.summary.warn} warned, ${report.summary.fail} failed`
    );

    if (failures.length === 0 && warnings.length === 0) return;

    failures.forEach((f) => console.error(`[Doctor] FAIL: ${f.label} — ${f.message}`));
    warnings.forEach((w) => console.warn(`[Doctor] WARN: ${w.label} — ${w.message}`));

    // Persist all abnormal results in diagnostic_events for health-check
    // visibility. These are written without userId so they appear as global
    // system events in runHealthCheck().
    const toEmit: Array<{ result: DoctorResult; severity: "error" | "warning" }> = [
      ...failures.map((r) => ({ result: r, severity: "error" as const })),
      ...warnings.map((r) => ({ result: r, severity: "warning" as const })),
    ];
    await Promise.allSettled(
      toEmit.map(({ result, severity }) =>
        diagEmit({
          subsystem: CHECK_SUBSYSTEM[result.id] ?? "integration",
          severity,
          message: `[Doctor] ${result.label}: ${result.message}`,
          metadata: { doctorCheckId: result.id, source: "startup_scan" },
        })
      )
    );

    // Immediately notify every user about failures via the existing notifyUser
    // path (same pipeline used by integrationValidator for broken-integration
    // alerts). This fires on the first failure — no threshold accumulation.
    //
    // Deduplication: skip notification if a startup-scan alert was already
    // emitted in the last 4 hours to prevent spam during restart churn.
    if (failures.length > 0) {
      const { db } = await import("../db");
      const { users, diagnosticEvents } = await import("@shared/schema");
      const { gte, and: andOp } = await import("drizzle-orm");
      const { sql: sqlExpr } = await import("drizzle-orm");

      const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
      const recentAlerts = await db
        .select({ id: diagnosticEvents.id })
        .from(diagnosticEvents)
        .where(
          andOp(
            gte(diagnosticEvents.createdAt, fourHoursAgo),
            sqlExpr`(${diagnosticEvents.metadata}->>'source') = 'startup_scan_notify'`
          )
        )
        .limit(1);

      if (recentAlerts.length > 0) {
        console.log("[Doctor] Startup alert already sent within 4 hours — skipping duplicate notification.");
      } else {
        // Stamp a sentinel so subsequent restarts within 4 hours are suppressed.
        await db.insert(diagnosticEvents).values({
          subsystem: "integration",
          severity: "info",
          message: `[Doctor] Startup scan alert sent — ${failures.length} failure(s)`,
          metadata: { source: "startup_scan_notify", failureCount: failures.length },
        });

        const allUsers = await db.select({ id: users.id }).from(users);
        const failLabels = failures.map((f) => f.label);
        const summary =
          failLabels.slice(0, 3).join(", ") +
          (failLabels.length > 3 ? ` and ${failLabels.length - 3} more` : "");
        const alertText = `⚠️ Jarvis found ${failures.length} system configuration issue(s) at startup: ${summary}. Open Settings → Diagnostics and tap **Run Diagnostics** to review.`;

        await Promise.allSettled(
          allUsers.map(({ id: userId }) =>
            notifyUser(userId, "general", alertText).catch((err) => {
              console.warn(`[Doctor] Could not notify user ${userId}:`, err);
            })
          )
        );
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Doctor] Startup scan threw: ${msg}`);
  }
}
