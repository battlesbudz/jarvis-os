import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configureDatabaseEnvForTests, loadEnvFiles } from "./test-env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const tsxCli = path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");

loadEnvFiles(projectRoot);

const tests = [
  { file: "scripts/__tests__/testEnv.test.mjs" },
  { file: "scripts/__tests__/noReplitRuntimeDeps.test.mjs" },
  { file: "scripts/__tests__/dashboardProjectsNavigation.test.mjs" },
  { file: "scripts/__tests__/oauthGatewayDoctor.test.mjs" },
  { file: "scripts/__tests__/desktopDaemonWatchdog.test.mjs" },
  { file: "server/auth/__tests__/mobileAuthRedirectHtml.test.ts" },
  { file: "server/auth/__tests__/telegramWebAppAuth.test.ts", requiresDatabase: true },
  { file: "server/diagnostics/__tests__/osReadiness.test.ts" },
  { file: "server/diagnostics/__tests__/memoryEmbeddingHealthRouting.assert.ts" },
  { file: "server/agent/__tests__/autonomyPolicy.test.ts" },
  { file: "server/agent/__tests__/autonomyRuntime.test.ts" },
  { file: "server/agent/__tests__/appCoachChatAutonomy.test.ts" },
  { file: "server/agent/__tests__/jarvisCoreRuntime.assert.ts" },
  { file: "server/agent/__tests__/appProjectRunner.test.ts" },
  { file: "server/agent/__tests__/topLevelApprovalContinuation.test.ts" },
  { file: "server/agent/__tests__/reviewLoop.test.ts" },
  { file: "server/agent/__tests__/goalTreeEditor.test.ts" },
  { file: "server/agent/__tests__/goalTreeUi.test.ts" },
  { file: "server/agent/__tests__/goalPlanHandoff.test.ts" },
  { file: "server/agent/__tests__/dailyCommand.test.ts" },
  { file: "server/agent/__tests__/dailyCommandHttpRoutes.test.ts", requiresDatabase: true },
  { file: "server/agent/__tests__/missionControlQueuePanel.test.ts", requiresDatabase: true },
  { file: "server/agent/__tests__/goalPlanStatus.test.ts" },
  { file: "server/agent/__tests__/goalPacing.test.ts" },
  { file: "server/agent/__tests__/deliverableReviewActions.test.ts" },
  { file: "server/agent/__tests__/deliverableReviewHttpRoutes.test.ts" },
  { file: "server/agent/__tests__/localWorkerQueue.assert.ts" },
  { file: "server/agent/__tests__/localWorkerSetup.assert.ts" },
  { file: "server/agent/__tests__/telegramVoiceTranscription.assert.ts" },
  { file: "server/agent/__tests__/ephemeralAgents.test.ts" },
  { file: "server/agent/__tests__/queueBackgroundJob.test.ts" },
  { file: "server/agent/__tests__/ephemeralWorkerDeliverable.test.ts" },
  { file: "server/agent/__tests__/jobObservability.test.ts" },
  { file: "server/agent/__tests__/workerRuntime.test.ts" },
  { file: "server/agent/__tests__/osSmoke.test.ts" },
  { file: "server/agent/__tests__/manifestFilter.assert.ts" },
  { file: "server/time/__tests__/temporalContext.assert.ts" },
  { file: "server/agent/__tests__/cronTools.assert.ts" },
  { file: "server/agent/__tests__/actionOntology.assert.ts" },
  { file: "server/agent/__tests__/toolResolver.assert.ts" },
  { file: "server/agent/__tests__/webSearchFallback.assert.ts" },
  { file: "server/agent/__tests__/reminderDirectRoute.assert.ts" },
  { file: "server/agent/__tests__/scheduledTaskSemantics.assert.ts" },
  { file: "server/agent/__tests__/scheduledTaskSchemaRepair.assert.ts" },
  { file: "server/agent/__tests__/toolAwareRouting.assert.ts" },
  { file: "server/agent/__tests__/toolExecutionPolicy.assert.ts" },
  { file: "server/agent/__tests__/projectCreateRequest.assert.ts" },
  { file: "server/agent/__tests__/modelRouter.assert.ts" },
  { file: "server/agent/__tests__/codexOnlyOrchestrator.assert.ts" },
  { file: "server/agent/__tests__/qualityLoopCodexBypass.assert.ts" },
  { file: "server/agent/__tests__/orchestratorCodexVerifierBypass.assert.ts" },
  { file: "server/agent/__tests__/codexOAuth.assert.ts" },
  { file: "server/agent/__tests__/codexGatewayRecovery.assert.ts" },
  { file: "server/agent/__tests__/coachPromptClutter.assert.ts" },
  { file: "server/agent/__tests__/codexDelegation.assert.ts" },
  { file: "server/agent/__tests__/providerFallback.assert.ts" },
  { file: "server/agent/__tests__/routedChatCompletion.assert.ts" },
  { file: "server/agent/__tests__/providerEnv.assert.ts" },
  { file: "server/agent/__tests__/coachRunLifecycle.test.ts" },
  { file: "server/agent/__tests__/composioConnections.assert.ts" },
  { file: "server/agent/__tests__/composioConnectedAccounts.assert.ts" },
  { file: "server/agent/__tests__/composioRouteContract.assert.ts" },
  { file: "app/(tabs)/__tests__/connectionUx.assert.ts" },
  { file: "src/agent/__tests__/agentSdkHitl.assert.ts" },
  { file: "scripts/agent-sdk-golden-workflows.ts" },
  { file: "server/agent/__tests__/inboxTriageConfig.assert.ts" },
  { file: "server/agent/__tests__/contextRegistryRouting.assert.ts" },
  { file: "server/agent/__tests__/memoryOsFacadeRouting.assert.ts" },
  { file: "server/agent/__tests__/memorySearchMemoryOs.assert.ts" },
  { file: "server/agent/__tests__/memorySearchIdentityFallback.assert.ts" },
  { file: "server/agent/__tests__/memorySaveTool.assert.ts" },
  { file: "server/agent/__tests__/mindTraceContextPacks.test.ts" },
  { file: "server/core/protocol/__tests__/runtimeProtocol.test.ts" },
  { file: "server/core/protocol/__tests__/runtimeRedaction.test.ts" },
  { file: "server/core/runtime/__tests__/executeRuntimeEvent.test.ts" },
  { file: "server/core/runtime/__tests__/runtimeAgentToolPreflight.test.ts" },
  { file: "server/core/runtime/__tests__/runtimeAuditEvent.test.ts" },
  { file: "server/core/runtime/__tests__/runtimeApprovalPreview.test.ts" },
  { file: "server/core/runtime/__tests__/runtimeCapabilityPreview.test.ts" },
  { file: "server/core/runtime/__tests__/runtimeDiagnosticsRoutes.test.ts" },
  { file: "server/core/runtime/__tests__/runtimeDryRun.test.ts" },
  { file: "server/core/runtime/__tests__/runtimeEventAdapter.test.ts" },
  { file: "server/core/runtime/__tests__/runtimeFeatureFlags.test.ts" },
  { file: "server/core/runtime/__tests__/runtimeGoldenDryRun.test.ts" },
  { file: "server/core/runtime/__tests__/runtimeGuardedDryRun.test.ts" },
  { file: "server/core/runtime/__tests__/runtimePreviewFormatter.test.ts" },
  { file: "server/core/runtime/__tests__/runtimePreviewReport.test.ts" },
  { file: "server/core/runtime/__tests__/runtimeShadowPreview.test.ts" },
  { file: "server/core/runtime/__tests__/runtimeToolPreflight.test.ts" },
  { file: "server/core/runtime/__tests__/runRuntimeEvent.test.ts" },
  { file: "server/core/tools/__tests__/agentToolAdapter.test.ts" },
  { file: "server/core/tools/__tests__/toolCapabilitySummary.test.ts" },
  { file: "server/core/tools/__tests__/toolGateway.test.ts" },
  { file: "server/agent/__tests__/livingContextUpdateTool.assert.ts" },
  { file: "server/workspace/__tests__/livingContextRouter.assert.ts" },
  { file: "server/agent/__tests__/integrationError.assert.ts", requiresDatabase: true },
  { file: "server/agent/__tests__/selfHeal.assert.ts", requiresDatabase: true },
  { file: "server/agent/__tests__/writeBudget.assert.ts", requiresDatabase: true },
  { file: "server/agent/__tests__/mcp.assert.ts", requiresDatabase: true },
  { file: "server/agent/__tests__/browserTabTools.test.ts", requiresDatabase: true },
  { file: "server/agent/__tests__/toolCallHooks.test.ts" },
  { file: "server/agent/__tests__/outboundMiddleware.test.ts" },
  { file: "server/agent/__tests__/responseQuality.test.ts" },
  { file: "server/agent/__tests__/soulAuthority.assert.ts" },
  { file: "server/agent/__tests__/soulCuration.test.ts" },
  { file: "server/agent/__tests__/queryClassifier.test.ts" },
  { file: "server/agent/__tests__/telegramMiniAppUrl.test.ts" },
  { file: "server/agent/__tests__/telegramVoiceCallUrl.assert.ts" },
  { file: "server/agent/__tests__/codexVoiceTurn.assert.ts" },
  { file: "server/agent/__tests__/telegramRunGuard.assert.ts" },
  { file: "server/agent/__tests__/telegramMessageBatcher.assert.ts" },
  { file: "server/agent/__tests__/telegramNeedsAttention.test.ts" },
  { file: "server/agent/__tests__/weatherLookup.test.ts" },
  { file: "server/agent/__tests__/sessionCompaction.test.ts" },
  { file: "server/brain/__tests__/slug.test.ts" },
  { file: "server/brain/__tests__/chunk.test.ts" },
  { file: "server/brain/__tests__/links.test.ts" },
  { file: "server/brain/__tests__/adapter.test.ts", requiresDatabase: true },
  { file: "server/brain/__tests__/maintenance.test.ts" },
  { file: "server/brain/__tests__/vector.test.ts" },
  { file: "server/brain/__tests__/vectorDbVerification.test.ts" },
  { file: "server/brain/__tests__/vectorMigration.test.ts" },
  { file: "server/memory/__tests__/autoReview.test.ts" },
  { file: "server/memory/__tests__/brainRetrievalFallback.test.ts" },
  { file: "server/memory/__tests__/contextBuilder.test.ts" },
  { file: "server/memory/__tests__/embeddingHealth.test.ts" },
  { file: "server/memory/__tests__/memoryOs.test.ts" },
  { file: "server/memory/__tests__/retrieveVectorScoring.test.ts" },
  { file: "server/memory/__tests__/vectorDbVerification.test.ts" },
  { file: "server/memory/__tests__/vectorMigration.test.ts" },
  { file: "server/memory/__tests__/vectorStore.test.ts" },
];

const hasDatabase = configureDatabaseEnvForTests();
let skipped = 0;

for (const test of tests) {
  if (test.requiresDatabase && !hasDatabase) {
    skipped += 1;
    console.warn(`${test.file}: DATABASE_URL not set - skipped`);
    continue;
  }

  const result = spawnSync(process.execPath, [tsxCli, test.file], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (skipped > 0) {
  console.warn(`Skipped ${skipped} DB-backed test file(s).`);
}
