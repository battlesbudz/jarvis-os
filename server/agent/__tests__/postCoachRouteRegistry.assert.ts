import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../../..");
const registrySource = fs.readFileSync(path.join(repoRoot, "server/routes/postCoachRouteRegistry.ts"), "utf8");
const routesSource = fs.readFileSync(path.join(repoRoot, "server/routes.ts"), "utf8");

assert.ok(
  routesSource.includes('await registerPostCoachRoutes(app, { openai, authMiddleware });'),
  "server/routes.ts should delegate the late route block through the post-coach registry",
);
assert.ok(
  !registrySource.includes("for (const register of"),
  "post-coach route registration should stay explicit so route order remains reviewable",
);

const orderedCalls = [
  "registerCommitmentRoutes(app, openai);",
  "registerCoachMorningBriefRoute(app);",
  "registerAuthenticatedCoachRuntimeRoutes(app);",
  "registerRuntimeDiagnosticsRoutes(app);",
  "registerInboxRoutes(app);",
  "registerCoachWeeklyReviewRoute(app, openai);",
  "registerProfileMemoryRoutes(app);",
  "registerPredictionRoutes(app);",
  "registerPreferenceRoutes(app);",
  "registerMorningVoiceNoteRoutes(app);",
  "registerScheduledTaskBasicRoutes(app);",
  "registerJarvisObservabilityRoutes(app);",
  "registerScheduledTaskAttentionRoutes(app);",
  "registerScheduledTaskRunRoutes(app);",
  "registerJarvisSystemStateRoutes(app);",
  "registerGoalTreeCoreRoutes(app);",
  "registerGoalPacingRoutes(app);",
  "registerGoalTaskHandoffRoutes(app);",
  "registerAgentJobMutationRoutes(app);",
  "registerAgentJobQueryRoutes(app);",
  "registerDeliverableRoutes(app);",
  "registerDeliverableReviewRoutes(app, { db });",
  "registerDocumentRoutes(app);",
  "registerWebsiteCrawlRoutes(app);",
  "registerChatGptImportRoutes(app, openai);",
  "registerNervousSystemWatchRoutes(app);",
  "registerGutRoutes(app);",
  "registerSettingsRoutes(app);",
  "registerOpenAIProviderAuthRoutes(app,",
  "registerSkillStoreRoutes(app);",
  "registerUserSkillLibraryRoutes(app);",
  "registerUserSkillMutationRoutes(app);",
  "registerSkillCandidateRoutes(app);",
  "registerIntegrationsStatusRoutes(app);",
  "registerDiagnosticsRoutes(app);",
  "registerLocalWorkerRoutes(app);",
  "registerMcpRoutes(app, authMiddleware);",
  "registerVoiceRoutes(app, authMiddleware);",
  "registerWriteSafetyRoutes(app);",
  "registerButtonLocationRoutes(app);",
  "registerGitHubSettingsRoutes(app);",
  "registerGitHubDeviceRoutes(app);",
  "registerCapabilityGapRoutes(app, authMiddleware);",
];

let cursor = -1;
for (const call of orderedCalls) {
  const next = registrySource.indexOf(call, cursor + 1);
  assert.ok(next > cursor, `expected ${call} after previous post-coach route registration`);
  cursor = next;
}

console.log("OK: post-coach route registry remains explicit and order-preserving");
