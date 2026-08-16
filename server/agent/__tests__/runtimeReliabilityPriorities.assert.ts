import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

process.env.DATABASE_URL ||= "postgresql://jarvis_test:jarvis_test@localhost:5432/jarvis_test";

async function main(): Promise<void> {
  const { normalizeCalendarDateTimeForOutlook, resolveCalendarProvider, validateCalendarDateRange } = await import("../tools/calendarCreate");
  const { buildInAppNotificationSourceId } = await import("../../channels/inAppChannel");
  const { isPathAllowedForInspection } = await import("../tools/selfEditTools");

  assert.equal(resolveCalendarProvider(undefined, { googleConnected: true, microsoftConnected: true }), "google");
  assert.equal(resolveCalendarProvider(undefined, { googleConnected: false, microsoftConnected: true }), "microsoft");
  assert.equal(resolveCalendarProvider("microsoft", { googleConnected: true, microsoftConnected: false }), "microsoft");
  assert.equal(resolveCalendarProvider(undefined, { googleConnected: false, microsoftConnected: false }), null);

  assert.equal(validateCalendarDateRange("2026-08-16T14:00:00Z", "2026-08-16T15:00:00Z"), null);
  assert.equal(validateCalendarDateRange("2026-08-16T14:00:00+14:00", "2026-08-16T15:00:00+14:00"), null);
  assert.equal(validateCalendarDateRange("2026-08-16T14:00:00-14:00", "2026-08-16T15:00:00-14:00"), null);
  assert.match(validateCalendarDateRange("tomorrow", "2026-08-16T15:00:00Z") ?? "", /start must be a valid ISO 8601/i);
  assert.match(validateCalendarDateRange("2026-08-16T14:00:00+23:00", "2026-08-16T15:00:00Z") ?? "", /start must be a valid ISO 8601/i);
  assert.match(validateCalendarDateRange("2026-08-16T14:00:00+14:01", "2026-08-16T15:00:00Z") ?? "", /start must be a valid ISO 8601/i);
  assert.match(validateCalendarDateRange("2026-02-31T14:00:00Z", "2026-03-01T15:00:00Z") ?? "", /start must be a valid ISO 8601/i);
  assert.match(validateCalendarDateRange("2026-08-16T15:00:00Z", "2026-08-16T14:00:00Z") ?? "", /end must be later/i);
  assert.match(validateCalendarDateRange("2026-08-16T14:00:00", "2026-08-16T15:00:00") ?? "", /timezone/i);
  assert.equal(normalizeCalendarDateTimeForOutlook("2026-08-16T14:00:00-04:00"), "2026-08-16T18:00:00.000Z");

  const firstApprovalId = buildInAppNotificationSourceId("approval_request", "gate-123", 1, "first");
  const repeatedApprovalId = buildInAppNotificationSourceId("approval_request", "gate-123", 2, "second");
  assert.equal(firstApprovalId, "in_app:approval_request:gate-123");
  assert.equal(repeatedApprovalId, firstApprovalId);
  assert.notEqual(
    buildInAppNotificationSourceId("general", undefined, 1, "first"),
    buildInAppNotificationSourceId("general", undefined, 2, "second"),
  );

  assert.equal(isPathAllowedForInspection("JARVIS_ROADMAP.md"), true);
  assert.equal(isPathAllowedForInspection("docs/capability-verification-matrix.md"), true);
  assert.equal(isPathAllowedForInspection("../private.md"), false);

  const routesSource = readFileSync(resolve(__dirname, "../../routes.ts"), "utf8");
  assert.match(routesSource, /case 'create_calendar_event':[\s\S]{0,500}getTool\('create_calendar_event'\)/);
  assert.match(routesSource, /preview\.task = String\(args\.task \|\| ''\);/);
  assert.match(routesSource, /preview\.context = String\(args\.context\);/);
  assert.doesNotMatch(routesSource, /preview\.task = String\(args\.task \|\| ''\)\.slice/);
  assert.match(routesSource, /preview\.workingDirectory = normalizedWorkingDirectory;/);
  assert.match(routesSource, /normalizeCodexDelegationTimeoutMs\(args\.timeout_seconds\) \/ 1000/);

  console.log("OK: calendar validation/provider fallback and approval inbox idempotency are deterministic");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
