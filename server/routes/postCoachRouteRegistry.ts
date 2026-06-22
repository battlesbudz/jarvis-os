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

  registerCoachMorningBriefRoute(app);
  registerAuthenticatedCoachRuntimeRoutes(app);
  registerRuntimeDiagnosticsRoutes(app);
  registerInboxRoutes(app);

  registerCoachWeeklyReviewRoute(app, openai);

  registerProfileMemoryRoutes(app);
  registerPredictionRoutes(app);
  registerPreferenceRoutes(app);
  registerMorningVoiceNoteRoutes(app);
  registerScheduledTaskBasicRoutes(app);
  registerJarvisObservabilityRoutes(app);
  registerScheduledTaskAttentionRoutes(app);
  registerScheduledTaskRunRoutes(app);
  registerJarvisSystemStateRoutes(app);
  registerGoalTreeCoreRoutes(app);
  registerGoalPacingRoutes(app);
  registerGoalTaskHandoffRoutes(app);
  registerAgentJobMutationRoutes(app);
  registerAgentJobQueryRoutes(app);
  registerDeliverableRoutes(app);

  const { registerDeliverableReviewRoutes } = await import("../agent/deliverableReviewHttpRoutes");
  registerDeliverableReviewRoutes(app, { db });

  registerDocumentRoutes(app);
  registerWebsiteCrawlRoutes(app);
  registerChatGptImportRoutes(app, openai);
  registerNervousSystemWatchRoutes(app);
  registerGutRoutes(app);
  registerSettingsRoutes(app);

  registerOpenAIProviderAuthRoutes(app, {
    includeCallbackRoutes: false,
    resolveUserId: getUserIdFromRequest,
  });

  registerSkillStoreRoutes(app);
  registerUserSkillLibraryRoutes(app);
  registerUserSkillMutationRoutes(app);
  registerSkillCandidateRoutes(app);
  registerIntegrationsStatusRoutes(app);
  registerDiagnosticsRoutes(app);
  registerLocalWorkerRoutes(app);
  registerMcpRoutes(app, authMiddleware);
  registerVoiceRoutes(app, authMiddleware);
  registerWriteSafetyRoutes(app);
  registerButtonLocationRoutes(app);
  registerGitHubSettingsRoutes(app);
  registerGitHubDeviceRoutes(app);
  registerCapabilityGapRoutes(app, authMiddleware);
}
