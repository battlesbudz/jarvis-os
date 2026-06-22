import type { Express, RequestHandler } from "express";
import type OpenAI from "openai";
import { db } from "../db";
import { getUserIdFromRequest } from "../auth";
import { registerAgentJobMutationRoutes } from "./agentJobMutationRoutes";
import { registerAgentJobQueryRoutes } from "./agentJobQueryRoutes";
import { registerAuthenticatedCoachRuntimeRoutes } from "./coachRuntimeRoutes";
import { registerButtonLocationRoutes } from "./buttonLocationRoutes";
import { registerCapabilityGapRoutes } from "./capabilityGapRoutes";
import { registerChatGptImportRoutes } from "./chatgptImportRoutes";
import { registerCoachMorningBriefRoute, registerCoachWeeklyReviewRoute } from "./coachReviewRoutes";
import { registerCommitmentRoutes } from "./commitmentRoutes";
import { registerDeliverableRoutes } from "./deliverableRoutes";
import { registerDiagnosticsRoutes } from "./diagnosticsRoutes";
import { registerDocumentRoutes } from "./documentsRoutes";
import { registerGitHubDeviceRoutes } from "./githubDeviceRoutes";
import { registerGitHubSettingsRoutes } from "./githubSettingsRoutes";
import { registerGoalPacingRoutes } from "./goalPacingRoutes";
import { registerGoalTaskHandoffRoutes } from "./goalTaskHandoffRoutes";
import { registerGoalTreeCoreRoutes } from "./goalTreeCoreRoutes";
import { registerGutRoutes } from "./gutRoutes";
import { registerInboxRoutes } from "./inboxRoutes";
import { registerIntegrationsStatusRoutes } from "./integrationsStatusRoutes";
import { registerJarvisObservabilityRoutes } from "./jarvisObservabilityRoutes";
import { registerJarvisSystemStateRoutes } from "./jarvisSystemStateRoutes";
import { registerLocalWorkerRoutes } from "./localWorkerRoutes";
import { registerMcpRoutes } from "./mcpRoutes";
import { registerMorningVoiceNoteRoutes } from "./morningVoiceNoteRoutes";
import { registerNervousSystemWatchRoutes } from "./nervousSystemWatchRoutes";
import { registerOpenAIProviderAuthRoutes } from "./openaiProviderAuthRoutes";
import { registerPredictionRoutes } from "./predictionRoutes";
import { registerPreferenceRoutes } from "./preferenceRoutes";
import { registerProfileMemoryRoutes } from "./profileMemoryRoutes";
import { registerRuntimeDiagnosticsRoutes } from "./runtimeDiagnosticsRoutes";
import { registerScheduledTaskAttentionRoutes } from "./scheduledTaskAttentionRoutes";
import { registerScheduledTaskBasicRoutes } from "./scheduledTaskBasicRoutes";
import { registerScheduledTaskRunRoutes } from "./scheduledTaskRunRoutes";
import { registerSettingsRoutes } from "./settingsRoutes";
import { registerSkillCandidateRoutes } from "./skillCandidateRoutes";
import { registerSkillStoreRoutes } from "./skillStoreRoutes";
import { registerUserSkillLibraryRoutes } from "./userSkillLibraryRoutes";
import { registerUserSkillMutationRoutes } from "./userSkillMutationRoutes";
import { registerVoiceRoutes } from "./voiceRoutes";
import { registerWebsiteCrawlRoutes } from "./websiteCrawlRoutes";
import { registerWriteSafetyRoutes } from "./writeSafetyRoutes";

interface PostCoachRouteRegistryDeps { openai: OpenAI; authMiddleware: RequestHandler; }

export async function registerPostCoachRoutes(app: Express, { openai, authMiddleware }: PostCoachRouteRegistryDeps): Promise<void> {
  registerCommitmentRoutes(app, openai);
  for (const register of [
    registerCoachMorningBriefRoute, registerAuthenticatedCoachRuntimeRoutes, registerRuntimeDiagnosticsRoutes,
    registerInboxRoutes, registerProfileMemoryRoutes, registerPredictionRoutes, registerPreferenceRoutes,
    registerMorningVoiceNoteRoutes, registerScheduledTaskBasicRoutes, registerJarvisObservabilityRoutes,
    registerScheduledTaskAttentionRoutes, registerScheduledTaskRunRoutes, registerJarvisSystemStateRoutes,
    registerGoalTreeCoreRoutes, registerGoalPacingRoutes, registerGoalTaskHandoffRoutes, registerAgentJobMutationRoutes,
    registerAgentJobQueryRoutes, registerDeliverableRoutes,
  ]) register(app);
  registerCoachWeeklyReviewRoute(app, openai);

  const { registerDeliverableReviewRoutes } = await import("../agent/deliverableReviewHttpRoutes");
  registerDeliverableReviewRoutes(app, { db });

  registerChatGptImportRoutes(app, openai);
  for (const register of [
    registerDocumentRoutes, registerWebsiteCrawlRoutes, registerNervousSystemWatchRoutes, registerGutRoutes,
    registerSettingsRoutes, registerSkillStoreRoutes, registerUserSkillLibraryRoutes, registerUserSkillMutationRoutes,
    registerSkillCandidateRoutes, registerIntegrationsStatusRoutes, registerDiagnosticsRoutes, registerLocalWorkerRoutes,
  ]) register(app);
  registerOpenAIProviderAuthRoutes(app, {
    includeCallbackRoutes: false,
    resolveUserId: getUserIdFromRequest,
  });
  registerMcpRoutes(app, authMiddleware);
  registerVoiceRoutes(app, authMiddleware);
  for (const register of [
    registerWriteSafetyRoutes, registerButtonLocationRoutes, registerGitHubSettingsRoutes, registerGitHubDeviceRoutes,
  ]) register(app);
  registerCapabilityGapRoutes(app, authMiddleware);
}
