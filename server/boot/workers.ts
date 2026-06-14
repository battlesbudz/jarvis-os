import { startJobQueueWorker } from "../agent/jobQueue";
import { pruneAuditLogArchivesOnStartup } from "../agent/tools/applyCodeChangeTool";
import { startTriageRunner, runStartupTriagePass } from "../inboxTriage";
import { startScheduler } from "../scheduler";

export function startWorkerBoot(): void {
  pruneAuditLogArchivesOnStartup().catch(() => {});

  import("../agent/appDelivery").then(({ cleanupExpiredZips }) => cleanupExpiredZips()).catch(() => {});

  import("../agent/tools/projectShellTool").then(({ cleanupOrphanedDevServers }) => {
    try { cleanupOrphanedDevServers(); } catch { /* non-fatal */ }
  }).catch(() => {});

  startScheduler();
  startTriageRunner();

  import("../lib/transcriptJobTracker").then(({ runBackgroundPoller }) => {
    runBackgroundPoller();
  }).catch(err => {
    console.warn("[Startup] transcriptJobTracker poller failed to start (non-fatal):", err);
  });

  setTimeout(() => runStartupTriagePass().catch(() => {}), 5000);
  startJobQueueWorker();
}
