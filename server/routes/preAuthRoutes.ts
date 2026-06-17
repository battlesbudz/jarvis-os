import type { Express, Request, Response } from "express";

import { authMiddleware, authRouter } from "../auth";
import { mobileAuthRouter } from "../mobileAuthRoutes";
import { oauthCallbackRouter } from "../oauthRoutes";
import { registerDownloadRoutes } from "../downloadRoutes";
import { registerAdminHealthRoutes } from "./adminHealthRoutes";
import { registerAdminSearchRegistryRoutes } from "./adminSearchRegistryRoutes";
import { registerAdminSkillsRoutes } from "./adminSkillsRoutes";
import { registerAppUpdateRoutes } from "./appUpdateRoutes";
import { registerCodexGatewayRoutes } from "./codexGatewayRoutes";
import { registerPublicConnectionsCallbackRoutes } from "./connectionsRoutes";
import { registerPublicCoachRuntimeRoutes } from "./coachRuntimeRoutes";
import { registerDiscordInteractionRoutes } from "./discordInteractionRoutes";
import { registerPublicOpenAIProviderAuthCallbackRoutes } from "./openaiProviderAuthRoutes";
import { registerPlatformRoutes, registerVoiceRedirectRoute } from "./platformRoutes";
import { registerTranscriptDiagnoseRoutes } from "./transcriptDiagnoseRoutes";
import { registerPublicWebchatInviteRoutes } from "./webchatInviteRoutes";

function requireAdminSecret(req: Request, res: Response): boolean {
  const secret = process.env.JARVIS_ADMIN_SECRET;
  if (!secret) {
    res.status(503).json({ error: "Admin secret not configured on this server." });
    return false;
  }
  if (req.headers["x-admin-secret"] !== secret) {
    res.status(401).json({ error: "Invalid admin secret." });
    return false;
  }
  return true;
}

export function registerPreAuthRoutes(app: Express): void {
  app.use("/api/auth", authRouter);
  app.use("/api/auth/mobile", mobileAuthRouter);
  app.use("/api/oauth", oauthCallbackRouter);
  registerDownloadRoutes(app);

  registerPlatformRoutes(app);
  registerPublicCoachRuntimeRoutes(app);
  registerVoiceRedirectRoute(app);

  registerDiscordInteractionRoutes(app);

  registerAdminSkillsRoutes(app, requireAdminSecret);
  registerAdminHealthRoutes(app, requireAdminSecret);

  registerTranscriptDiagnoseRoutes(app, authMiddleware);
  registerAdminSearchRegistryRoutes(app, requireAdminSecret);
  registerPublicWebchatInviteRoutes(app);
  registerCodexGatewayRoutes(app);
  registerAppUpdateRoutes(app);
  registerPublicConnectionsCallbackRoutes(app);
  registerPublicOpenAIProviderAuthCallbackRoutes(app);
}
