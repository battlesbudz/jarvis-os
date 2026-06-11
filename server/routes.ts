import "./agent/providers/envAliases";
import { createHash } from 'crypto';
import fs from "fs";
import path from "path";
import { activeCoachRuns } from "./runRegistry";
import { registerCoachRunLifecycle } from "./coachRunLifecycle";
import { buildGmailSourceId, gmailMessageIdExistsForUser } from "./utils/gmailSourceId";
import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import OpenAI from "openai";
import { getOpenAIClientConfig } from "./agent/providers/env";
import { db } from "./db";
import { eq, and, desc, sql, gte, asc } from "drizzle-orm";
import * as schema from "@shared/schema";
import { userMemories, morningVoiceNotes, userPreferences, proactiveQuestionsSent, userDocuments, webchatInviteTokens } from "@shared/schema";
import { processDocument, getUserDocumentContext, SUPPORTED_MIME_TYPES, SUPPORTED_EXTENSIONS, MAX_DOCS_PER_USER } from "./documentProcessor";
import { resizeTask, generateSmartPlan, unblockTask } from "./ai";
import {
  getGoogleCalendarEvents,
  checkGoogleCalendarConnection,
  createGoogleCalendarEvent,
} from "./integrations/googleCalendar";
import {
  getOutlookCalendarEvents,
  checkOutlookConnection,
  createOutlookCalendarEvent,
  sendOutlookEmail,
  getRecentOutlookEmails,
} from "./integrations/outlook";
import {
  checkGmailConnection,
  getRecentEmailCommitments,
  createGmailDraft,
  sendGmailEmail,
} from "./integrations/gmail";
import { getSlackMessages } from "./integrations/slack";
import { authRouter, authMiddleware, getUserIdFromRequest } from "./auth";
import { mobileAuthRouter } from "./mobileAuthRoutes";
import { registerDataRoutes } from "./dataRoutes";
import { registerTelegramRoutes } from "./telegramRoutes";
import { registerChannelRoutes } from "./channels/routes";
import { registerDiscordScheduleRoutes } from "./discord/schedulesRoutes";
import { registerAgentRoutes } from "./agent/agentRoutes";
import { registerCustomAgentRoutes } from "./agent/customAgentRoutes";
import { registerCodeProposalsRoutes } from "./agent/codeProposalsRoutes";
import { registerProjectRoutes } from "./projectRoutes";
import { registerDoctorRoutes } from "./doctor/doctorRoutes";
import { registerDownloadRoutes } from "./downloadRoutes";
import { registerVaultRoutes } from "./vaultRoutes";
import { registerLocalWorkerRoutes } from "./routes/localWorkerRoutes";
import { registerMcpRoutes } from "./routes/mcpRoutes";
import { registerSettingsRoutes } from "./routes/settingsRoutes";
import { registerDocumentRoutes } from "./routes/documentsRoutes";
import { registerIntegrationRoutes } from "./routes/integrationRoutes";
import { registerProfileMemoryRoutes } from "./routes/profileMemoryRoutes";
import { registerPlanGenerationRoutes } from "./routes/planGenerationRoutes";
import { registerInboxRoutes } from "./routes/inboxRoutes";
import { registerDailyCommandRoutes } from "./dailyCommand/routes";
import { registerMindTraceRoutes } from "./routes/mindTraceRoutes";
import { registerMissionControlQueueRoutes } from "./routes/missionControlQueueRoutes";
import { registerConnectionsRoutes, registerPublicConnectionsCallbackRoutes } from "./routes/connectionsRoutes";
import { registerCodexGatewayRoutes } from "./routes/codexGatewayRoutes";
import { registerAppUpdateRoutes } from "./routes/appUpdateRoutes";
import { registerDesktopConnectorRoutes } from "./routes/desktopConnectorRoutes";
import { registerPublicWebchatInviteRoutes } from "./routes/webchatInviteRoutes";
import { registerAdminHealthRoutes } from "./routes/adminHealthRoutes";
import { registerAdminSearchRegistryRoutes } from "./routes/adminSearchRegistryRoutes";
import { registerPlatformRoutes, registerVoiceRedirectRoute } from "./routes/platformRoutes";
import { registerRuntimeDiagnosticsRoutes } from "./routes/runtimeDiagnosticsRoutes";
import { formatRuntimeShadowPreviewSummary, previewRuntimeShadowForMessage } from "./core/runtime";
import {
  registerOpenAIProviderAuthRoutes,
  registerPublicOpenAIProviderAuthCallbackRoutes,
} from "./routes/openaiProviderAuthRoutes";
import {
  registerAuthenticatedCoachRuntimeRoutes,
  registerPublicCoachRuntimeRoutes,
} from "./routes/coachRuntimeRoutes";
import { applyGoalTreeEdit, summarizeGoalTree, type GoalTreeEditAction } from "./goalTreeEditor";
import { mergeGoalTaskIntoPlan } from "./goalPlanHandoff";
import { markTasksInjected, type InjectableGoalTask } from "./goalScheduler";
import { normalizeGoalPacingMode } from "./goalPacing";
import { createJarvisScheduledTask } from "./jarvisScheduledTasks";
import { isIntegrationOwner, claimIntegrationOwnership } from "./integrationOwner";
import { oauthRouter, oauthCallbackRouter } from "./oauthRoutes";
import { driveRouter } from "./driveRoutes";
import { getValidGoogleTokens, getValidGoogleToken, getValidMicrosoftToken, getUserTokens, getUserToken, getUserOAuthStatus } from "./userTokenStore";
import { tavilySearch, formatSearchResults } from "./integrations/search";
import { logInteraction, getRecentInteractions, formatInteractionTimeline } from "./interactionLog";
import { extractAndStore } from "./memory/extractor";
import { processLivingContextUpdate } from "./workspace/livingContextRouter";
import { getSoul, getSoulPromptBlock, regenerateSoul, setManualOverride, setSoulContent } from "./memory/soul";
import { buildUntrustedSoulContext, BUDGET_PRESETS } from "./memory/contextBuilder";
import { listPeople, deletePerson } from "./memory/people";
import { isUserPaired, sendDaemonOp, pingDaemon, getOpAuditLog, isDaemonActionAllowed, isAndroidDaemonActive, isDesktopDaemonActive, isAndroidDaemonActionAllowed, getRecentPhoneNotifications, getDaemonDeviceMeta, type AndroidDaemonAction } from "./daemon/bridge";
import type { DaemonAction, DaemonOp } from "./daemon/bridge";
import { telegramLinks, channelLinks } from "@shared/schema";
import { connectChannelTool } from "./agent/tools/connectChannel";
import { filterToolsByGroups, getTool, type ToolGroup } from "./agent/tools/index";
import { parseNaturalTime, parseRecurringExpr } from "./agent/tools/cronTools";
import { registerSubscriber, removeSubscriberIfCurrent } from "./webchatSSE";
import ytSearch from "yt-search";
import { buildYouTubeContextBlock } from "./utils/youtubeAutoFetch";
import { getPromptData, setPromptData } from "./coachSessionPromptCache";
import { markSoulStale } from "./memory/soul";
import { getModel } from "./lib/modelPrefs";
import { getExplicitCoachRequestedModel } from "./services/coachModelSelection";
import { runCapabilityGapAnalysis } from "./agent/capabilityGapAnalyzer";
import { getModelRouteChain, routeModelTurn, type ModelExecutionTier } from "./agent/modelRouter";
import { isRetriableProviderError } from "./agent/providers/fallback";
import { getPublicBaseUrl } from "./publicUrl";
import { estimateModelUsage, getModelUsageSummary, recordModelUsage } from "./agent/modelUsage";
import type { AgentTool, ToolContext } from "./agent/types";
import {
  isCodexDelegationEnabled,
} from "./agent/codexDelegation";
import { classifyToolAwareRoute } from "./agent/toolAwareRouting";
import { buildToolExecutionPolicy } from "./agent/toolExecutionPolicy";
import { routeAppCoachChatAutonomy } from "./agent/appCoachChatAutonomy";
import { getCoachAppAgentId } from "./agent/coreAgentIds";
import {
  TELEGRAM_VISIBLE_PROGRESS_INTERVAL_MS,
  buildTurnProgressEvent,
  buildVisibleTurnProgressMessage,
  shouldEmitVisibleProgressUpdate,
} from "./agent/turnProgress";
import { classifyComposioActionPermission } from "./connectors/composio/connectionCenter";
import { savePendingCoachResponse, storeDaemonScreenshot } from "./services/coachRuntimeState";
import { writeCoachStreamError } from "./services/coachSse";
import {
  buildCoachSystemPrompt,
  clearMorningNoteSummary,
  getMorningNoteSummary,
  getPersonaBlock,
  getUserLocalDate,
  providerLabelForModel,
  runCoachModelTurn,
  streamCoachModelTurn,
} from "./services/aiCoachContextService";

async function applyLivingContextReviewToFile(relPath: string | null | undefined, oldBlock: string | null | undefined, newBlock?: string | null): Promise<void> {
  if (!relPath || !oldBlock) return;
  if (path.isAbsolute(relPath) || relPath.includes("..")) return;
  const rootDir = process.cwd();
  const abs = path.resolve(rootDir, relPath);
  const allowedRoot = path.resolve(rootDir, "workspaces", "battles");
  if (!(abs === allowedRoot || abs.startsWith(allowedRoot + path.sep))) return;
  if (path.extname(abs).toLowerCase() !== ".md") return;

  try {
    let content = await fs.promises.readFile(abs, "utf-8");
    const replacement = newBlock ? `${newBlock}\n` : "";
    if (content.includes(oldBlock)) {
      content = content.replace(oldBlock, replacement).replace(/\n{4,}/g, "\n\n\n");
      await fs.promises.writeFile(abs, content, "utf-8");
    } else if (newBlock && !content.includes(newBlock)) {
      await fs.promises.appendFile(abs, `\n${newBlock}\n`, "utf-8");
    }
  } catch {
    // The database row is the durable source of truth; runtime file sync is best effort.
  }
}

const _p = (v: string | string[]): string => Array.isArray(v) ? (v[0] ?? "") : v;

const openai = new OpenAI(getOpenAIClientConfig());

export { buildPlanForUser, buildPlanFromInputs } from './services/planGenerationService';

function operatorActionPermKey(operatorAction: Record<string, unknown>): AndroidDaemonAction | null {
  switch (operatorAction.type) {
    case 'open_app': return 'android_open_app';
    case 'tap_element':
    case 'tap_coordinates':
    case 'type_text':
    case 'swipe':
    case 'press_key': return 'android_tap_type';
    case 'wait':
    case 'done': return null;
    default: return 'android_tap_type';
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  app.use("/api/auth", authRouter);
  app.use("/api/auth/mobile", mobileAuthRouter);
  app.use("/api/oauth", oauthCallbackRouter);
  registerDownloadRoutes(app);

  registerPlatformRoutes(app);
  registerPublicCoachRuntimeRoutes(app);
  registerVoiceRedirectRoute(app);

  /**
   * POST /api/discord/interactions — public (Ed25519-verified, no JWT needed)
   *
   * Discord sends all slash-command interactions here. This must be registered
   * BEFORE authMiddleware because Discord requests do not carry a Bearer JWT.
   * Security is provided by Ed25519 signature verification instead.
   */
  app.post("/api/discord/interactions", async (req: Request, res: Response) => {
    try {
      const publicKey = process.env.DISCORD_PUBLIC_KEY;
      if (!publicKey) {
        console.warn("[DiscordInteractions] DISCORD_PUBLIC_KEY not set — rejecting request");
        return res.status(401).json({ error: "Interactions endpoint not configured" });
      }

      const signature = req.headers["x-signature-ed25519"] as string | undefined;
      const timestamp = req.headers["x-signature-timestamp"] as string | undefined;

      if (!signature || !timestamp) {
        return res.status(401).json({ error: "Missing Discord signature headers" });
      }

      const rawBody: Buffer = (req as any).rawBody;
      if (!rawBody) {
        return res.status(400).json({ error: "Missing raw body" });
      }

      // Replay-window check: reject interactions timestamped more than 5 minutes ago
      const tsSeconds = parseInt(timestamp, 10);
      if (isNaN(tsSeconds) || Math.abs(Date.now() / 1000 - tsSeconds) > 300) {
        return res.status(401).json({ error: "Request timestamp out of range" });
      }

      const { verifyDiscordSignature, handleInteraction } = await import("./discord/slashCommands");
      const valid = verifyDiscordSignature(publicKey, signature, timestamp, rawBody);
      if (!valid) {
        return res.status(401).json({ error: "Invalid request signature" });
      }

      const interaction = req.body;
      const response = await handleInteraction(interaction);
      return res.json(response);
    } catch (err) {
      console.error("[DiscordInteractions] Unhandled error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── Admin: Skill Pack management (operator publish path) ─────────────────────
  // Auth: x-admin-secret header must match JARVIS_ADMIN_SECRET env var.
  // Mounted BEFORE authMiddleware so no user JWT is required — these endpoints
  // are called by the Jarvis team via machine-to-machine tooling, not individual
  // users. The static shared secret provides sufficient access control for this
  // low-volume internal API.

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

  /**
   * POST /api/admin/skills/publish
   * Publish a new or updated skill pack.
   *
   * Body:
   *   packId?        — if provided and exists, update that pack; otherwise create new
   *   name           — pack display name (required)
   *   instructions   — base instruction text (required)
   *   changeNote     — changelog note for this version (required)
   *   description?   — user-facing description (defaults to "" on create)
   *   isStoreVisible? — whether to show in the Skill Store (defaults to true on create)
   *   heartbeatRules? — JSON heartbeat rule config { disableDuringFocusBlocks, ... }
   *   toolGroups?    — JSON tool group config { boost: [...], suppress: [...] }
   *
   * Active sessions pick up the new instructions at their next session start —
   * mid-session injection is intentionally not supported to avoid instability.
   */
  app.post("/api/admin/skills/publish", async (req: Request, res: Response) => {
    if (!requireAdminSecret(req, res)) return;
    try {
      const { publishSkillPack } = await import("./intelligence/behaviorStore");
      const body = req.body as {
        packId?: string;
        name?: string;
        instructions?: string;
        changeNote?: string;
        description?: string;
        isStoreVisible?: boolean;
        heartbeatRules?: schema.PackHeartbeatRules;
        toolGroups?: schema.PackToolGroups;
      };
      const { packId, name, instructions, changeNote, description, isStoreVisible, heartbeatRules, toolGroups } = body;
      if (!name || !instructions || !changeNote) {
        return res.status(400).json({ error: "name, instructions, and changeNote are required" });
      }
      const pack = await publishSkillPack({
        packId,
        name,
        instructions,
        changeNote,
        description,
        isStoreVisible,
        heartbeatRules,
        toolGroups,
      });
      console.log(`[Admin/Skills] published pack "${pack.name}" v${pack.version}`);
      res.json({ ok: true, pack });
    } catch (err) {
      console.error("[Admin/Skills] publish failed:", err);
      res.status(500).json({ error: "Failed to publish skill pack" });
    }
  });

  /**
   * GET /api/admin/skills
   * List all skill packs with their changelogs and per-user override counts.
   */
  app.get("/api/admin/skills", async (req: Request, res: Response) => {
    if (!requireAdminSecret(req, res)) return;
    try {
      const { getAdminPackViews } = await import("./intelligence/behaviorStore");
      const packs = await getAdminPackViews();
      res.json({ packs });
    } catch (err) {
      console.error("[Admin/Skills] list failed:", err);
      res.status(500).json({ error: "Failed to list skill packs" });
    }
  });

  registerAdminHealthRoutes(app, requireAdminSecret);

  /**
   * GET /api/transcript/diagnose?videoId=VIDEO_ID
   * Diagnoses the transcript pipeline for a specific video without spending quota.
   * Reports Gemini key status, Supadata key + native caption check, and yt-dlp availability.
   * Does NOT call Gemini (costs quota) — only checks key status and Supadata native captions.
   */
  app.get("/api/transcript/diagnose", authMiddleware, async (req: Request, res: Response) => {
    const videoId = String(req.query.videoId ?? "").trim();
    if (!videoId) {
      res.status(400).json({ error: "videoId query parameter is required" });
      return;
    }

    try {
      const { getYtdlpStatus, ensureYtdlpUpgraded } = await import("./lib/transcriptCache");

      // Check Gemini key status (do NOT call Gemini)
      const geminiKeyConfigured = !!process.env.GOOGLE_GEMINI_API_KEY;
      const geminiKeyType = geminiKeyConfigured ? "direct" : "none";
      const geminiResult = {
        keyConfigured: geminiKeyConfigured,
        keyType: geminiKeyType,
        note: geminiKeyConfigured
          ? "Will attempt transcription as Phase 0 (direct Google AI Studio key)"
          : "Phase 0 skipped - no Gemini key configured. Set GOOGLE_GEMINI_API_KEY at https://aistudio.google.com/apikey",
      };

      // Check Supadata key + native captions
      const supadataKey = process.env.SUPADATA_API_KEY;
      let supadataResult: Record<string, unknown>;
      if (!supadataKey) {
        supadataResult = {
          keyConfigured: false,
          nativeCaptions: null,
          note: "Phase 0.5 skipped — SUPADATA_API_KEY not set. Get a free key at https://dash.supadata.ai",
        };
      } else {
        let nativeCaptions: boolean | null = null;
        let supadataNote = "";
        try {
          const nativeUrl = `https://api.supadata.ai/v1/youtube/transcript?videoId=${encodeURIComponent(videoId)}&lang=en&mode=native`;
          const nativeRes = await fetch(nativeUrl, {
            headers: { "x-api-key": supadataKey, "Content-Type": "application/json" },
          });
          if (nativeRes.ok) {
            const data = await nativeRes.json() as { content?: unknown[] | string };
            const content = data.content;
            nativeCaptions = Array.isArray(content) ? content.length > 0 : typeof content === "string" ? content.trim().length > 0 : false;
            supadataNote = nativeCaptions
              ? "Native captions found — fast, no credits. Will return immediately."
              : "Native captions empty — will use AI generation (mode=auto).";
          } else if (nativeRes.status === 404 || nativeRes.status === 400) {
            nativeCaptions = false;
            supadataNote = "No native captions — will use AI generation (mode=auto). Takes 5-10 min for long videos.";
          } else {
            const body = await nativeRes.text().catch(() => "");
            supadataNote = `Native caption check returned ${nativeRes.status}: ${body.slice(0, 200)}`;
          }
        } catch (supadataCheckErr) {
          supadataNote = `Native caption check failed: ${supadataCheckErr instanceof Error ? supadataCheckErr.message : String(supadataCheckErr)}`;
        }
        supadataResult = {
          keyConfigured: true,
          nativeCaptions,
          note: supadataNote,
        };
      }

      // Check yt-dlp availability
      await ensureYtdlpUpgraded().catch(() => null);
      const ytdlpStatus = getYtdlpStatus();
      const ytdlpResult = {
        available: ytdlpStatus.available,
        cmd: ytdlpStatus.cmd,
        reason: ytdlpStatus.available
          ? "yt-dlp is installed and responding"
          : "yt-dlp is not available — audio transcription and caption download will fail. Note: cloud datacenter IPs are often blocked by YouTube, so yt-dlp success rates may be very low even when installed.",
      };

      // Build recommendation
      const nativeCaptions = (supadataResult.nativeCaptions as boolean | null);
      let recommendation: string;
      if (geminiKeyConfigured && nativeCaptions !== false) {
        recommendation = "Gemini (Phase 0) is the fastest option. Supadata native captions also available.";
      } else if (geminiKeyConfigured) {
        recommendation = "Gemini (Phase 0) is the primary option. Supadata will use AI generation (mode=auto) — takes 5-10 min for long videos.";
      } else if (supadataKey && nativeCaptions === true) {
        recommendation = "Supadata native captions available — fast retrieval.";
      } else if (supadataKey) {
        recommendation = "Only Supadata AI generation is viable. Takes 5-10 min for long videos. Recommend enabling Gemini with GOOGLE_GEMINI_API_KEY.";
      } else {
        recommendation = "No cloud transcript methods available. Only local yt-dlp/Whisper pipeline remains, and cloud IPs are often blocked. Enable Gemini or Supadata.";
      }

      res.json({
        videoId,
        gemini: geminiResult,
        supadata: supadataResult,
        ytdlp: ytdlpResult,
        recommendation,
      });
    } catch (err) {
      console.error("[transcript/diagnose] failed:", err);
      res.status(500).json({ error: "Diagnose failed", detail: err instanceof Error ? err.message : String(err) });
    }
  });

  registerAdminSearchRegistryRoutes(app, requireAdminSecret);
  registerPublicWebchatInviteRoutes(app);
  registerCodexGatewayRoutes(app);
  registerAppUpdateRoutes(app);
  registerPublicConnectionsCallbackRoutes(app);
  registerPublicOpenAIProviderAuthCallbackRoutes(app);

  app.use(authMiddleware);

  // ── Webchat SSE push stream ─────────────────────────────────────────────────
  // The /chat page connects here so background job results can be pushed in
  // real time instead of accumulating in the in_app inbox.
  app.get("/api/webchat/events", (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    res.write(": connected\n\n");

    const token = registerSubscriber(userId, res);

    req.on("close", () => {
      removeSubscriberIfCurrent(userId, token);
    });
  });

  app.use("/api/oauth", oauthRouter);

  registerDataRoutes(app);
  registerDailyCommandRoutes(app);
  registerMindTraceRoutes(app);
  registerMissionControlQueueRoutes(app, { db });
  registerConnectionsRoutes(app);
  registerDesktopConnectorRoutes(app);

  // ── GET /api/goals — return goals for the authenticated user ───────────────
  app.get("/api/goals", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const row = await db
        .select({ data: schema.goals.data })
        .from(schema.goals)
        .where(eq(schema.goals.userId, userId))
        .limit(1);
      const raw = (row[0]?.data as any[]) ?? [];
      const goals = raw
        .map((g: any) => {
          const current = Number(g.current ?? 0);
          const target = Number(g.target ?? 0);
          let status: string;
          if (target > 0 && current >= target) status = "complete";
          else if (current > 0) status = "in_progress";
          else status = "active";
          return {
            id: g.id ?? "",
            title: g.title ?? "",
            description: g.description ?? null,
            category: g.category ?? "personal",
            target,
            current,
            unit: g.unit ?? "",
            status,
            createdAt: g.createdAt ?? new Date().toISOString(),
            updatedAt: g.updatedAt ?? null,
          };
        })
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      res.json(goals);
    } catch (err) {
      console.error("[GET /api/goals] error:", err);
      res.status(500).json({ error: "Failed to fetch goals" });
    }
  });

  registerTelegramRoutes(app);
  registerChannelRoutes(app);
  registerDiscordScheduleRoutes(app);
  registerAgentRoutes(app);
  registerCustomAgentRoutes(app);
  registerCodeProposalsRoutes(app);
  registerProjectRoutes(app);
  registerDoctorRoutes(app);
  registerVaultRoutes(app);
  app.use("/api/drive", driveRouter);

  // ── Jarvis Ego — Dashboard API ─────────────────────────────────────────────

  app.get("/api/ego/dashboard", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { analyseEgo, getISOWeekMonday } = await import("./intelligence/ego");
      const weekOf = getISOWeekMonday(new Date());
      const analysis = await analyseEgo(userId, weekOf);

      const latestReport = await db
        .select()
        .from(schema.egoWeeklyReports)
        .where(eq(schema.egoWeeklyReports.userId, userId))
        .orderBy(desc(schema.egoWeeklyReports.createdAt))
        .limit(1);

      res.json({
        analysis,
        latestReport: latestReport[0] ?? null,
      });
    } catch (err) {
      console.error("[Ego] dashboard failed:", err);
      res.status(500).json({ error: "Failed to load ego dashboard" });
    }
  });

  app.get("/api/ego/reports", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const reports = await db
        .select()
        .from(schema.egoWeeklyReports)
        .where(eq(schema.egoWeeklyReports.userId, userId))
        .orderBy(desc(schema.egoWeeklyReports.createdAt))
        .limit(12);

      res.json({ reports });
    } catch (err) {
      console.error("[Ego] reports failed:", err);
      res.status(500).json({ error: "Failed to load reports" });
    }
  });

  app.post("/api/ego/trigger", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      // Guard: only allow manual trigger in development, or when ?force=true is
      // explicitly passed. This prevents partial-week reports being locked in
      // production via early triggering (the scheduler handles Sunday 18:00 UTC).
      const isDev = process.env.NODE_ENV !== "production";
      const forceOverride = req.query.force === "true";
      if (!isDev && !forceOverride) {
        return res.status(403).json({ error: "Manual trigger not available in production (pass ?force=true to override)" });
      }

      const { runEgoForUser, getISOWeekMonday } = await import("./intelligence/ego");
      const weekOf = getISOWeekMonday(new Date());
      const delivered = await runEgoForUser(userId, weekOf);
      res.json({ ok: true, delivered, weekOf });
    } catch (err) {
      console.error("[Ego] trigger failed:", err);
      res.status(500).json({ error: "Failed to trigger ego report" });
    }
  });

  app.get("/api/discord/status", async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const links = await db.select().from(channelLinks)
        .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, 'discord')));
      const link = links[0];
      const meta = link?.metadata as { discordUsername?: string } | undefined;
      res.json({
        connected: links.length > 0,
        discordUsername: meta?.discordUsername ?? null,
      });
    } catch (error) {
      console.error("Error getting Discord status:", error);
      res.status(500).json({ error: "Failed to get Discord status" });
    }
  });

  app.post("/api/discord/link", async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { code } = req.body as { code?: string };
      if (!code || code.trim().length === 0) {
        return res.status(400).json({ error: "Pairing code is required." });
      }
      const { completePairing } = await import("./discord/manager");
      const result = await completePairing(userId, code.trim().toUpperCase());
      if (!result.ok) {
        return res.status(400).json({ error: result.error ?? "Pairing failed." });
      }
      res.json({ ok: true, discordUsername: result.discordUsername });
    } catch (error) {
      console.error("Error completing Discord pairing:", error);
      res.status(500).json({ error: "Failed to complete Discord pairing." });
    }
  });

  registerPlanGenerationRoutes(app);

  const coachTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
      type: "function",
      function: {
        name: "add_task",
        description: "Add a new task to the user's plan for today",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Task title" },
            category: { type: "string", enum: ["health", "work", "personal", "learning", "finance", "social"], description: "Task category" },
            duration: { type: "number", description: "Estimated duration in minutes" },
          },
          required: ["title", "category"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "add_to_brain_dump",
        description: "Add an item to the user's brain dump inbox",
        parameters: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "log_goal_progress",
        description: "Log progress toward a goal",
        parameters: {
          type: "object",
          properties: {
            goalTitle: { type: "string", description: "Partial or full goal title to match" },
            amount: { type: "number", description: "Amount to add to current progress" },
          },
          required: ["goalTitle", "amount"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "update_life_context",
        description: "Update one or more life context fields for the user",
        parameters: {
          type: "object",
          properties: {
            priorityGoal: { type: "string" },
            currentBlocker: { type: "string" },
            improvementArea: { type: "string" },
            upcomingDeadline: { type: "string" },
            freeText: { type: "string" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "complete_task",
        description: "Mark a task as complete in today's plan",
        parameters: {
          type: "object",
          properties: {
            taskTitle: { type: "string", description: "Partial or full title of the task to complete" },
          },
          required: ["taskTitle"],
        },
      },
    },
    ...(process.env.TAVILY_API_KEY ? [{
      type: "function" as const,
      function: {
        name: "web_search",
        description: "Search the internet for real-time information such as current events, weather, stock prices, news, product reviews, or anything else that requires up-to-date data. Use this when the user asks about something you don't know or when current information is needed.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "The search query to look up" },
          },
          required: ["query"],
        },
      },
    }] : []),
    {
      type: "function" as const,
      function: {
        name: "check_connections",
        description: "Check which external accounts and channels the user has connected (Google/Gmail/Calendar, Microsoft/Outlook, Telegram, WhatsApp, Discord, Desktop Daemon). Always call this before claiming a service is or isn't available.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "generate_reconnect_link",
        description: "Generate a fresh OAuth authorization URL so the user can reconnect a disconnected Google or Microsoft account. Returns a tappable link button. Use after check_connections confirms the service is not connected.",
        parameters: {
          type: "object",
          properties: {
            provider: { type: "string", enum: ["google", "microsoft"], description: "Which provider to reconnect" },
          },
          required: ["provider"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "create_calendar_event",
        description: "Create a calendar event on the user's Google or Outlook calendar. Use when the user asks to schedule or block time. start and end must be ISO 8601 datetime strings.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Event title" },
            start: { type: "string", description: "Start datetime ISO 8601 (e.g. '2025-04-22T14:00:00Z')" },
            end: { type: "string", description: "End datetime ISO 8601 (e.g. '2025-04-22T15:00:00Z')" },
            description: { type: "string", description: "Optional event notes" },
            location: { type: "string", description: "Optional location or video link" },
            provider: { type: "string", enum: ["google", "microsoft"], description: "Calendar provider, default 'google'" },
          },
          required: ["title", "start", "end"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "fetch_calendar",
        description: "Fetch the user's Google Calendar events for a given day or date range. Use whenever the user asks about their schedule, meetings, availability, or what's coming up. Returns events with title, time, and location.",
        parameters: {
          type: "object",
          properties: {
            date: { type: "string", description: "ISO date YYYY-MM-DD. Defaults to today if omitted." },
            days: { type: "number", description: "Number of consecutive days to fetch starting from date. Default 1, max 14." },
          },
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "fetch_emails",
        description: "Fetch recent emails on demand. Use when the user asks about their inbox beyond what's already in the system context. provider: 'google' (Gmail) or 'microsoft' (Outlook). count: number of emails to fetch (default 10, max 25).",
        parameters: {
          type: "object",
          properties: {
            provider: { type: "string", enum: ["google", "microsoft"], description: "Email provider" },
            count: { type: "number", description: "Number of emails to fetch (max 25)" },
          },
          required: ["provider"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "send_email",
        description: "Send an email immediately via Gmail or Outlook. Only use after the user explicitly confirms they want to send. Requires Google or Microsoft to be connected. If the user has multiple Google accounts, pass accountHint with the sender email address to select the correct account.",
        parameters: {
          type: "object",
          properties: {
            to: { type: "string", description: "Recipient email address" },
            subject: { type: "string", description: "Email subject" },
            body: { type: "string", description: "Email body (plain text)" },
            provider: { type: "string", enum: ["google", "microsoft"], description: "Which provider to use, default 'google'" },
            accountHint: { type: "string", description: "Optional sender account email to disambiguate when multiple accounts are connected (e.g. 'alice@gmail.com')" },
          },
          required: ["to", "subject", "body"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "daemon_action",
        description: "Execute a sandboxed action on the user's paired daemon — either a desktop daemon or an Android device daemon. DESKTOP actions (when desktop daemon paired): shell, notify, file_read, file_write, file_list. ANDROID actions (when Android daemon paired): android_open_app (launch app by package name e.g. 'com.google.android.youtube'), android_browse (open URL in browser or app via deep link — for YouTube search use url='vnd.youtube://results?search_query=QUERY', for Google Maps use 'geo:0,0?q=QUERY', for Spotify use 'spotify:search:QUERY'), android_screenshot (capture screen), android_read_screen (read visible UI text), android_tap (tap at x/y), android_type (type text into focused field — set submit:true to also press Search/Go/Enter after typing), android_swipe (swipe gesture), android_press_key (back/home/recents/enter), android_file_list, android_file_read, android_notifications_list (read current phone notifications — checks server cache first; if cache is empty, AUTOMATICALLY swipes open the notification shade, reads the screen, then closes the shade; always returns real live data, never makes up notifications). CRITICAL RULES: (1) If this tool returns result:'error', STOP IMMEDIATELY and tell the user exactly what went wrong — do NOT proceed or pretend the action succeeded. (2) After android_open_app or android_browse succeeds, ALWAYS call android_read_screen next to confirm the screen state — NEVER describe app content or search results without first reading the screen. (3) For in-app searches (YouTube, Reddit, Maps, etc.) prefer android_browse with a deep link URL over open_app + navigate UI. Do NOT narrate what you plan to do before calling this tool — only confirm what actually happened after a successful result. Always call check_connections first to know which daemon type is paired.",
        parameters: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["shell", "notify", "file_read", "file_write", "file_list", "android_open_app", "android_browse", "android_screenshot", "android_read_screen", "android_screen_context", "android_operator_action", "android_tap", "android_type", "android_swipe", "android_press_key", "android_file_list", "android_file_read", "android_notifications_list", "android_wait", "android_return_to_jarvis"], description: "Action to perform. 'notify' works on BOTH desktop and Android daemons — sends a pop-up banner notification with title and body. 'android_wait' pauses for ms milliseconds (default 1500, max 10000) — use between steps when the phone UI needs time to settle (e.g. after tapping a video to let it load before read_screen). 'android_screen_context' returns structured accessibility context. 'android_operator_action' executes a narrow operatorAction payload. 'android_return_to_jarvis' navigates the phone back to the Jarvis chat in the browser — call this as the LAST step of every multi-step task after the notify banner, to return the user to the conversation." },
            cmd: { type: "string", description: "Shell command (for 'shell' action)" },
            title: { type: "string", description: "Notification title (for 'notify' action)" },
            body: { type: "string", description: "Notification body (for 'notify' action)" },
            path: { type: "string", description: "File/directory path (for file_read/file_write/file_list/android_file_list/android_file_read)" },
            content: { type: "string", description: "File content (for file_write)" },
            packageName: { type: "string", description: "Android app package name (for android_open_app, e.g. 'com.google.android.youtube')" },
            url: { type: "string", description: "URL to open (for android_browse)" },
            x: { type: "number", description: "X pixel coordinate (for android_tap)" },
            y: { type: "number", description: "Y pixel coordinate (for android_tap)" },
            text: { type: "string", description: "Text to type (for android_type)" },
            submit: { type: "boolean", description: "If true, press IME Search/Go/Enter after typing (for android_type only)" },
            x1: { type: "number", description: "Swipe start X (for android_swipe)" },
            y1: { type: "number", description: "Swipe start Y (for android_swipe)" },
            x2: { type: "number", description: "Swipe end X (for android_swipe)" },
            y2: { type: "number", description: "Swipe end Y (for android_swipe)" },
            key: { type: "string", enum: ["back", "home", "recents", "volume_up", "volume_down", "enter"], description: "System key (for android_press_key). Use 'enter' to press IME Search/Go/Done/Enter on the keyboard." },
            limit: { type: "number", description: "Max notifications to return (for android_notifications_list, default 20)" },
            ms: { type: "number", description: "Milliseconds to wait (for android_wait, default 1500, max 10000). Use 1500–3000ms after tapping a video to let YouTube load." },
            operatorAction: { type: "object", description: "Structured operator payload for android_operator_action. Example: { type: 'tap_element', elementId: 3 }" },
          },
          required: ["action"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "daemon_diagnostic",
        description: "Ping the paired daemon to verify it is alive and retrieve the recent op audit log (last 20 ops with timestamps and durations). Use this when: (1) an android_* op timed out or failed unexpectedly, (2) the user reports the daemon isn't responding, or (3) you want to check if the accessibility service is enabled on the device. Returns device state (model, androidVersion, accessibilityEnabled, foregroundPackage) and a timestamped log of recent ops.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "search_youtube",
        description: "Search YouTube server-side and return structured results with title, channel name, view count, published date, duration, and video ID — without touching the phone. Use this BEFORE opening a video so you can intelligently pick the best result (reputable channel, high views, recent date). Returns up to 10 results. Then use fetch_youtube_transcript to get the transcript of the chosen video, and android_browse to open it on the phone. Pass trending:true when the user asks for 'trending', 'viral', 'momentum', or 'views per hour' content — this sorts by views/hour instead of total views.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query, e.g. 'how to improve focus ADHD'" },
            maxResults: { type: "number", description: "Number of results to return (1-10, default 8)" },
            trending: { type: "boolean", description: "If true, sort by views-per-hour (velocity) instead of total views. Only use when user explicitly asks for trending/viral/momentum content." },
            daysBack: { type: "number", description: "Only include videos published within this many days (default 5). Used with trending:true." },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "fetch_youtube_transcript",
        description: "Fetch the COMPLETE transcript/captions of a YouTube video server-side — returns the full text with no truncation. Use this INSTEAD of navigating YouTube's transcript UI on the phone.\n\nINTERNAL PIPELINE — this tool automatically tries multiple methods in order:\n  Phase 0:   Gemini multimodal — feeds the video URL directly to Gemini AI\n  Phase 0.5: Supadata — a cloud transcript API (supadata.ai) that bypasses YouTube's IP blocks. Uses mode=auto: tries native captions first, then AI-generates a transcript if no captions exist. This costs Supadata credits for AI generation.\n  Phase 1-4: YouTube InnerTube API, yt-dlp subtitles, timedtext, youtube-transcript library\n  Phase 5:   Whisper audio transcription (downloads audio via yt-dlp, then transcribes)\n  Phase 6:   Tavily web search fallback (last resort — summaries, not a real transcript)\n\nThe 'via X' label in the result (e.g. 'via Supadata', 'via YouTube captions', 'via Whisper (audio)') tells you which phase succeeded.",
        parameters: {
          type: "object",
          properties: {
            videoId: { type: "string", description: "YouTube video ID (e.g. 'dQw4w9WgXcQ') or full YouTube URL (https://youtube.com/watch?v=dQw4w9WgXcQ). Extract the video ID from the URL visible on screen via android_read_screen." },
          },
          required: ["videoId"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "fetch_transcript_gemini",
        description: "Fetch a YouTube transcript by feeding the video URL directly to Gemini's multimodal API (gemini-2.5-flash/pro). No captions required — Gemini transcribes the audio from Google's own infrastructure. Use when the video has no captions, or when the user explicitly asks to use Gemini. Requires GOOGLE_GEMINI_API_KEY to be configured.",
        parameters: {
          type: "object",
          properties: {
            videoId: { type: "string", description: "YouTube video ID (11 characters, e.g. 'dQw4w9WgXcQ') or full YouTube URL." },
          },
          required: ["videoId"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "fetch_transcript_supadata",
        description: "Fetch a YouTube transcript via the Supadata API (supadata.ai) using mode=auto. Tries YouTube's native captions first; if none exist, AI-generates a transcript (uses Supadata credits). Use when the user explicitly asks for Supadata, or when native captions are unavailable. Requires SUPADATA_API_KEY.",
        parameters: {
          type: "object",
          properties: {
            videoId: { type: "string", description: "YouTube video ID (11 characters, e.g. 'dQw4w9WgXcQ') or full YouTube URL." },
          },
          required: ["videoId"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "fetch_transcript_audio",
        description: "Fetch a YouTube transcript by downloading the audio via yt-dlp and transcribing it with OpenAI Whisper. Works even when no captions exist and Gemini/Supadata are unavailable. Use when the user explicitly asks for audio/Whisper transcription. Note: slow for long videos (may take several minutes). Requires yt-dlp to be installed.",
        parameters: {
          type: "object",
          properties: {
            videoId: { type: "string", description: "YouTube video ID (11 characters, e.g. 'dQw4w9WgXcQ') or full YouTube URL." },
          },
          required: ["videoId"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "fetch_transcript_captions",
        description: "Fetch a YouTube transcript using only native YouTube captions — no AI, no credits charged. Tries InnerTube, yt-dlp subtitles, timedtext, and the youtube-transcript library. Fast, but only works if the video actually has captions. Use when the user explicitly wants captions-only (no AI generation).",
        parameters: {
          type: "object",
          properties: {
            videoId: { type: "string", description: "YouTube video ID (11 characters, e.g. 'dQw4w9WgXcQ') or full YouTube URL." },
          },
          required: ["videoId"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "connect_channel",
        description: "Generate a one-tap deep link so the user can connect a new messaging channel (Telegram, WhatsApp, Slack, or Discord) to Jarvis. Returns a tappable link button. Use proactively when the user asks to connect/link any of these services.",
        parameters: {
          type: "object",
          properties: {
            channel: {
              type: "string",
              enum: ["telegram", "whatsapp", "discord", "slack"],
              description: "Which channel to generate a connection link for.",
            },
          },
          required: ["channel"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "schedule_jarvis_task",
        description: "Schedule a future item for the user's own to-do list or reminder list. Use for human tasks, habits, errands, chores, and tasks Jarvis cannot physically do, such as DoorDash work or calls the user must personally make. These are non-executable user tasks by default. Do not use this for autonomous Jarvis work like checking inboxes, sending reports, running scripts, or operating connected apps later; use explicit cron/job tools for those.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short title for the scheduled task (e.g. 'Review inbox', 'Send weekly update')" },
            description: { type: "string", description: "Optional details for the user's task/reminder." },
            scheduledAt: { type: "string", description: "When the task should appear or remind the user. Accepts ISO 8601 or common natural language like 'in an hour', 'tomorrow at 9am', 'daily', or 'next Monday at 10am'." },
            recurrence: { type: "string", description: "Optional recurrence pattern: 'daily', 'weekly', 'weekdays', 'every Monday', 'every Sunday', etc. Omit for one-time tasks." },
            taskKind: { type: "string", enum: ["user_task", "jarvis_action"], description: "Defaults to user_task. Only use jarvis_action when Jarvis can actually perform the scheduled action with tools." },
          },
          required: ["title", "scheduledAt"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "image_generate",
        description:
          "Generate an image from a text prompt using GPT Image and display it inline in the chat. " +
          "Use for concept illustrations, motivational visuals, meal plan photos, mind maps, or any explicit image request. " +
          "Do NOT call this for text-only answers — only when the user explicitly asks for an image or a visual would meaningfully enhance the response.",
        parameters: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description: "A detailed description of the image to generate. Include style, content, mood, and any relevant details.",
            },
            size: {
              type: "string",
              enum: ["square", "landscape", "portrait"],
              description: "Image aspect ratio: square (1:1, default), landscape (16:9), portrait (9:16).",
            },
            caption: {
              type: "string",
              description: "Optional short caption displayed below the image in chat (1-2 sentences max).",
            },
          },
          required: ["prompt"],
        },
      },
    },
  ];

  function fuzzyMatch(needle: string, haystack: string): boolean {
    const n = needle.toLowerCase().trim();
    const h = haystack.toLowerCase().trim();
    return h.includes(n) || n.includes(h);
  }

  function toOpenAIChatTool(tool: AgentTool): OpenAI.Chat.Completions.ChatCompletionTool {
    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters as Record<string, unknown>,
      },
    };
  }

  function chatToolName(tool: OpenAI.Chat.Completions.ChatCompletionTool): string | null {
    return tool.type === "function" ? tool.function.name : null;
  }

  const pendingConfirmations = new Map<string, { userId: string; tool: string; args: any; expiresAt: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [token, entry] of pendingConfirmations.entries()) {
      if (entry.expiresAt < now) pendingConfirmations.delete(token);
    }
  }, 60_000);

  async function executeCoachTool(
    toolName: string,
    args: any,
    userId: string,
    signal?: AbortSignal
  ): Promise<{ result: 'success' | 'error' | 'pending'; label: string; detail: string }> {
    const todayKey = new Date().toISOString().slice(0, 10);
    try {
      switch (toolName) {
        case 'add_task': {
          const planResult = await db
            .select({ data: schema.plans.data })
            .from(schema.plans)
            .where(and(eq(schema.plans.userId, userId), eq(schema.plans.date, todayKey)));
          const plan: any = planResult.length > 0 ? planResult[0].data : { date: todayKey, tasks: [], greeting: '', insight: '' };
          const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
          const catMap: Record<string, string> = { health: 'fitness', work: 'career', learning: 'personal' };
          const category = catMap[args.category] || args.category || 'personal';
          const newTask = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            title: args.title,
            category,
            completed: false,
            priority: 'medium',
          };
          tasks.push(newTask);
          const updatedPlan = { ...plan, tasks };
          await db.insert(schema.plans)
            .values({ userId, date: todayKey, data: updatedPlan, updatedAt: new Date() })
            .onConflictDoUpdate({
              target: [schema.plans.userId, schema.plans.date],
              set: { data: updatedPlan, updatedAt: new Date() },
            });
          return { result: 'success', label: `Task added to today`, detail: `Added "${args.title}"` };
        }
        case 'add_to_brain_dump': {
          const bdResult = await db
            .select({ data: schema.brainDumpInbox.data })
            .from(schema.brainDumpInbox)
            .where(eq(schema.brainDumpInbox.userId, userId));
          const items: any[] = bdResult.length > 0 ? (Array.isArray(bdResult[0].data) ? bdResult[0].data : []) : [];
          items.unshift({
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            text: args.text,
            createdAt: new Date().toISOString(),
          });
          await db.insert(schema.brainDumpInbox)
            .values({ userId, data: items, updatedAt: new Date() })
            .onConflictDoUpdate({
              target: [schema.brainDumpInbox.userId],
              set: { data: items, updatedAt: new Date() },
            });
          return { result: 'success', label: `Added to brain dump`, detail: `Added "${args.text}"` };
        }
        case 'log_goal_progress': {
          const goalsResult = await db
            .select({ data: schema.goals.data })
            .from(schema.goals)
            .where(eq(schema.goals.userId, userId));
          if (goalsResult.length === 0) return { result: 'error', label: 'No goals found', detail: 'User has no goals set' };
          const goalsList: any[] = Array.isArray(goalsResult[0].data) ? goalsResult[0].data : [];
          const matched = goalsList.find((g: any) => fuzzyMatch(args.goalTitle, g.title));
          if (!matched) return { result: 'error', label: `Goal not found`, detail: `Could not find goal matching "${args.goalTitle}"` };
          matched.current = (matched.current || 0) + args.amount;
          matched.updatedAt = new Date().toISOString();
          await db.insert(schema.goals)
            .values({ userId, data: goalsList, updatedAt: new Date() })
            .onConflictDoUpdate({
              target: [schema.goals.userId],
              set: { data: goalsList, updatedAt: new Date() },
            });
          return { result: 'success', label: `Progress logged`, detail: `Added ${args.amount} to "${matched.title}"` };
        }
        case 'update_life_context': {
          const lcResult = await db
            .select({ data: schema.lifeContext.data })
            .from(schema.lifeContext)
            .where(eq(schema.lifeContext.userId, userId));
          const existing: any = lcResult.length > 0 ? lcResult[0].data : {};
          const merged = { ...existing };
          if (args.priorityGoal) merged.priorityGoal = args.priorityGoal;
          if (args.currentBlocker) merged.currentBlocker = args.currentBlocker;
          if (args.improvementArea) merged.improvementArea = args.improvementArea;
          if (args.upcomingDeadline) merged.upcomingDeadline = args.upcomingDeadline;
          if (args.freeText) merged.freeText = args.freeText;
          merged.lastUpdated = new Date().toISOString();
          await db.insert(schema.lifeContext)
            .values({ userId, data: merged, updatedAt: new Date() })
            .onConflictDoUpdate({
              target: [schema.lifeContext.userId],
              set: { data: merged, updatedAt: new Date() },
            });
          const updatedFields = Object.keys(args).filter(k => args[k]).join(', ');
          return { result: 'success', label: `Context updated`, detail: `Updated: ${updatedFields}` };
        }
        case 'complete_task': {
          const planResult = await db
            .select({ data: schema.plans.data })
            .from(schema.plans)
            .where(and(eq(schema.plans.userId, userId), eq(schema.plans.date, todayKey)));
          if (planResult.length === 0) return { result: 'error', label: 'No plan today', detail: 'No plan found for today' };
          const plan: any = planResult[0].data;
          const tasks = (Array.isArray(plan.tasks) ? plan.tasks : []) as Array<{ completed: boolean; title: string; notes?: string; id: string }>;
          const matched = tasks.find((t) => !t.completed && fuzzyMatch(args.taskTitle, t.title));
          if (!matched) return { result: 'error', label: `Task not found`, detail: `Could not find incomplete task matching "${args.taskTitle}"` };
          matched.completed = true;
          const updatedPlan = { ...plan, tasks };
          await db.insert(schema.plans)
            .values({ userId, date: todayKey, data: updatedPlan, updatedAt: new Date() })
            .onConflictDoUpdate({
              target: [schema.plans.userId, schema.plans.date],
              set: { data: updatedPlan, updatedAt: new Date() },
            });
          // Phase 4 — extract memories opportunistically when a task is
          // completed. The completion text is a high-signal proxy for what
          // the user is actually working on; SOUL is marked stale so the
          // next coach turn rebuilds with the new fact.
          (async () => {
            try {
              const { extractAndStore } = await import("./memory/extractor");
              const { markSoulStale } = await import("./memory/soul");
              await extractAndStore({
                userId,
                source: `User just completed task: "${matched.title}". Notes: ${matched.notes || "(none)"}.`,
                sourceType: "plan_completion",
                sourceRef: `${todayKey}:${matched.title}`,
              });
              await markSoulStale(userId);
            } catch (extractErr) {
              console.error("[Phase4] plan-completion extract failed:", extractErr);
            }
            // Close the ego action outcome loop: resolve the specific task_suggested
            // and prediction_made actions tied to this task so only the intended
            // action rows are updated (not all pending rows of that type).
            try {
              const { resolveActionByTaskId } = await import("./intelligence/actionLog");
              await resolveActionByTaskId(userId, "task_suggested", matched.id, "completed");
              await resolveActionByTaskId(userId, "prediction_made", matched.id, "completed");
            } catch {}
          })();
          return { result: 'success', label: `Task completed`, detail: `Marked "${matched.title}" as done` };
        }
        case 'web_search': {
          try {
            const results = await tavilySearch(args.query);
            const formatted = formatSearchResults(results);
            return { result: 'success', label: `Web search: ${args.query}`, detail: formatted };
          } catch (searchErr: any) {
            const msg = String(searchErr?.message || searchErr);
            if (msg.includes('401') || msg.includes('403') || msg.includes('api_key')) {
              return { result: 'error', label: 'Search unavailable', detail: 'Web search API key is invalid or expired. Tell the user web search is currently unavailable.' };
            }
            if (msg.includes('429') || msg.includes('rate limit')) {
              return { result: 'error', label: 'Search rate limited', detail: 'Web search rate limit reached. Tell the user to try again in a moment.' };
            }
            if (msg.includes('timeout') || msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT')) {
              return { result: 'error', label: 'Search timed out', detail: 'Web search timed out. Tell the user the search could not complete and suggest trying again.' };
            }
            return { result: 'error', label: 'Search failed', detail: `Web search failed: ${msg}. Tell the user you were unable to retrieve results.` };
          }
        }
        case 'check_connections': {
          const [googleToken, msToken, oauthStatus, tgRows, chRows] = await Promise.all([
            getValidGoogleToken(userId).catch(() => null),
            getValidMicrosoftToken(userId).catch(() => null),
            getUserOAuthStatus(userId).catch(() => ({} as Record<string, any>)),
            db.select({ chatId: telegramLinks.chatId }).from(telegramLinks).where(eq(telegramLinks.userId, userId)).limit(1),
            db.select().from(channelLinks).where(eq(channelLinks.userId, userId)),
          ]);
          const daemonOnline = isUserPaired(userId);
          const isAndroid = isAndroidDaemonActive(userId);
          const googleEmail = oauthStatus?.google?.email || (oauthStatus?.google?.accounts?.[0]?.email) || 'unknown';
          const msEmail = oauthStatus?.microsoft?.email || (oauthStatus?.microsoft?.accounts?.[0]?.email) || 'unknown';
          const slackConnectedCheck = (oauthStatus as any)?.slack?.connected ?? false;
          const isDesktop = isDesktopDaemonActive(userId);
          const daemonParts: string[] = [];
          if (isDesktop) daemonParts.push(`Desktop Daemon: ✓ online — use shell, notify, file_read, file_write, file_list actions.`);
          if (isAndroid) daemonParts.push(`Android Device Daemon: ✓ online — use android_open_app, android_browse, android_screenshot, android_read_screen, android_tap, android_type, android_swipe, android_press_key, android_file_list, android_file_read, android_notifications_list, notify, android_return_to_jarvis. After completing a multi-step phone task: (1) call notify (title:'Jarvis ✓', body: one-line summary), then (2) call android_return_to_jarvis to navigate the phone back to the Jarvis chat. If a tool returns result:error, stop and report the error immediately — do NOT fabricate success. After android_open_app or android_browse succeeds, ALWAYS call android_read_screen before describing screen content. For app searches use deep links: YouTube='vnd.youtube://results?search_query=QUERY', Maps='geo:0,0?q=QUERY', Spotify='spotify:search:QUERY'.`);
          const daemonLabel = daemonOnline
            ? daemonParts.join(" | ")
            : `Android/Desktop Daemon: ✗ not connected — user must open Jarvis app → Profile → Android Device → Get Pairing Code, then open the Jarvis Daemon APK, enter server URL https://gameplanjarvisai.up.railway.app and the 8-character code, tap Pair`;
          const lines = [
            `Google (Gmail + Calendar): ${googleToken ? `✓ token valid — ${googleEmail}` : '✗ not connected or token expired (reconnect needed)'}`,
            `Microsoft (Outlook + Calendar): ${msToken ? `✓ token valid — ${msEmail}` : '✗ not connected or token expired (reconnect needed)'}`,
            `Slack: ${slackConnectedCheck ? '✓ connected' : '✗ not connected'}`,
            `Telegram: ${tgRows.length > 0 ? '✓ linked' : '✗ not linked'}`,
            `WhatsApp: ${chRows.some((r: any) => r.channel === 'whatsapp') ? '✓ linked' : '✗ not linked'}`,
            `Discord: ${chRows.some((r: any) => r.channel === 'discord') ? '✓ linked' : '✗ not linked'}`,
            daemonLabel,
          ];
          return { result: 'success', label: 'Connection status checked', detail: lines.join('\n') };
        }
        case 'generate_reconnect_link': {
          const provider = String(args.provider || '').toLowerCase();
          const baseUrl = getPublicBaseUrl();
          if (provider === 'google') {
            const clientId = process.env.GOOGLE_WEB_CLIENT_ID;
            if (!clientId) return { result: 'error', label: 'Google not configured', detail: 'Google OAuth client ID not set on server.' };
            const params = new URLSearchParams({
              client_id: clientId,
              redirect_uri: `${baseUrl}/api/oauth/google/callback`,
              response_type: 'code',
              scope: 'openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/drive.file',
              access_type: 'offline',
              prompt: 'consent',
              state: userId,
            });
            const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
            return { result: 'success', label: 'Reconnect Google', detail: JSON.stringify({ url, buttonLabel: 'Reconnect Google', provider: 'google' }) };
          }
          if (provider === 'microsoft') {
            const clientId = process.env.MICROSOFT_CLIENT_ID;
            if (!clientId) return { result: 'error', label: 'Microsoft not configured', detail: 'Microsoft OAuth client ID not set on server.' };
            const params = new URLSearchParams({
              client_id: clientId,
              redirect_uri: `${baseUrl}/api/oauth/microsoft/callback`,
              response_type: 'code',
              scope: 'offline_access Calendars.ReadWrite Mail.ReadWrite Mail.Send User.Read',
              state: userId,
              response_mode: 'query',
            });
            const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
            return { result: 'success', label: 'Reconnect Outlook', detail: JSON.stringify({ url, buttonLabel: 'Reconnect Outlook', provider: 'microsoft' }) };
          }
          return { result: 'error', label: 'Unknown provider', detail: `Unknown provider: ${provider}` };
        }
        case 'create_calendar_event': {
          const title = String(args.title || '').trim();
          const start = String(args.start || '').trim();
          const end = String(args.end || '').trim();
          const description = args.description ? String(args.description).trim() : undefined;
          const location = args.location ? String(args.location).trim() : undefined;
          const provider = (String(args.provider || 'google')).toLowerCase();
          if (!title || !start || !end) return { result: 'error', label: 'Missing fields', detail: 'title, start, and end are required.' };
          if (provider === 'google') {
            const tokens = await getValidGoogleTokens(userId);
            if (!tokens.length) return { result: 'error', label: 'Google not connected', detail: 'Connect Google in Profile to create calendar events.' };
            const result = await createGoogleCalendarEvent(tokens[0], { title, start, end, description, location });
            return { result: 'success', label: `Event created: ${title}`, detail: result.htmlLink || `Created on ${start.slice(0, 10)}` };
          }
          if (provider === 'microsoft') {
            const msToken = await getValidMicrosoftToken(userId);
            if (!msToken) return { result: 'error', label: 'Microsoft not connected', detail: 'Connect Microsoft in Profile to create Outlook calendar events.' };
            await createOutlookCalendarEvent(msToken, { title, start, end, description, location });
            return { result: 'success', label: `Event created: ${title}`, detail: `Created on ${start.slice(0, 10)}` };
          }
          return { result: 'error', label: 'Unknown provider', detail: `Unknown provider: ${provider}` };
        }
        case 'fetch_calendar': {
          const tokens = await getValidGoogleTokens(userId);
          if (!tokens.length) return { result: 'error', label: 'Google not connected', detail: 'Connect Google in Profile to fetch calendar events.' };
          const startDate = String(args.date || new Date().toISOString().slice(0, 10));
          const days = Math.min(Math.max(Number(args.days) || 1, 1), 14);
          function addDaysLocal(dateStr: string, n: number): string {
            const d = new Date(dateStr + 'T12:00:00Z');
            d.setUTCDate(d.getUTCDate() + n);
            return d.toISOString().slice(0, 10);
          }
          const blocks: string[] = [];
          let totalEvents = 0;
          for (let i = 0; i < days; i++) {
            const d = addDaysLocal(startDate, i);
            const events = await getGoogleCalendarEvents(d, undefined, undefined, tokens[0]);
            totalEvents += events.length;
            if (events.length === 0) {
              blocks.push(`${d}: (no events)`);
              continue;
            }
            const lines = events.map((e: any) => {
              const loc = e.location ? ` @ ${e.location}` : '';
              return `  - ${e.time || e.start || ''}${e.end ? `–${e.end}` : ''}: ${e.title || '(no title)'}${loc}`;
            });
            blocks.push(`${d}:\n${lines.join('\n')}`);
          }
          return { result: 'success', label: `Calendar: ${totalEvents} event(s) over ${days} day(s)`, detail: blocks.join('\n\n') };
        }
        case 'fetch_emails': {
          const provider = (String(args.provider || 'google')).toLowerCase();
          const count = Math.min(Number(args.count) || 10, 25);
          if (provider === 'google') {
            const tokens = await getValidGoogleTokens(userId);
            if (!tokens.length) return { result: 'error', label: 'Gmail not connected', detail: 'Connect Google in Profile to fetch emails.' };
            const emails = await getRecentEmailCommitments(14, tokens[0]);
            const recent = emails.slice(0, count).map((e: any) => `- From: ${e.from || 'unknown'} | "${e.subject}" — ${e.snippet}`).join('\n');
            return { result: 'success', label: `Fetched ${Math.min(emails.length, count)} Gmail emails`, detail: recent || 'No emails found.' };
          }
          if (provider === 'microsoft') {
            const msToken = await getValidMicrosoftToken(userId);
            if (!msToken) return { result: 'error', label: 'Outlook not connected', detail: 'Connect Microsoft in Profile to fetch emails.' };
            const emails = await getRecentOutlookEmails(msToken, count);
            const text = emails.map((e: any) => `- From: ${e.from} | "${e.subject}" — ${e.snippet}`).join('\n');
            return { result: 'success', label: `Fetched ${emails.length} Outlook emails`, detail: text || 'No emails found.' };
          }
          return { result: 'error', label: 'Unknown provider', detail: `Unknown provider: ${provider}` };
        }
        case 'send_email': {
          const to = String(args.to || '').trim();
          const subject = String(args.subject || '').trim();
          const body = String(args.body || '');
          const provider = (String(args.provider || 'google')).toLowerCase();
          const accountHint = args.accountHint ? String(args.accountHint).trim().toLowerCase() : null;
          if (!to || !subject || !body.trim()) return { result: 'error', label: 'Missing fields', detail: 'to, subject, and body are all required.' };
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(to)) return { result: 'error', label: 'Invalid recipient', detail: `"${to}" is not a valid email address.` };
          if (provider === 'google') {
            let token: string | null = null;
            if (accountHint) {
              const allTokens = await getUserTokens(userId, 'google');
              const match = allTokens.find(t => (t.accountEmail || '').toLowerCase() === accountHint);
              if (match) {
                if (match.expiresAt && match.expiresAt.getTime() < Date.now() + 60_000) {
                  token = (await getValidGoogleToken(userId));
                } else {
                  token = match.accessToken;
                }
              }
            }
            if (!token) token = await getValidGoogleToken(userId);
            if (!token) return { result: 'error', label: 'Gmail not connected', detail: 'Connect Google in Profile to send emails.' };
            const result = await sendGmailEmail(token, to, subject, body);
            return { result: 'success', label: `Email sent to ${to}`, detail: `Gmail message ID: ${result.messageId}` };
          }
          if (provider === 'microsoft') {
            const msToken = await getValidMicrosoftToken(userId);
            if (!msToken) return { result: 'error', label: 'Outlook not connected', detail: 'Connect Microsoft in Profile to send emails.' };
            await sendOutlookEmail(msToken, to, subject, body);
            return { result: 'success', label: `Email sent to ${to}`, detail: `Sent via Outlook` };
          }
          return { result: 'error', label: 'Unknown provider', detail: `Unknown provider: ${provider}` };
        }
        case 'daemon_action': {
          const action = String(args.action || '');
          if (!isUserPaired(userId)) {
            return { result: 'error', label: 'Daemon not connected', detail: 'No daemon paired. Install and pair either the desktop daemon or the Android APK from Profile → Connected Channels.' };
          }
          const isAndroidDaemon = isAndroidDaemonActive(userId);
          const androidActions = ['android_open_app', 'android_browse', 'android_return_to_jarvis', 'android_screenshot', 'android_read_screen', 'android_screen_context', 'android_operator_action', 'android_tap', 'android_type', 'android_swipe', 'android_press_key', 'android_file_list', 'android_file_read', 'android_notifications_list', 'android_wait'];
          const desktopActions = ['shell', 'file_read', 'file_write', 'file_list'];

          let op: DaemonOp;
          if (action === 'notify') {
            // Platform-neutral: routes to desktop daemon if connected, else android fallback.
            // sendDaemonOp handles the routing — no daemon-type guard needed here.
            op = { type: 'notify', title: String(args.title || 'Jarvis'), body: String(args.body || '') };
          } else if (androidActions.includes(action)) {
            if (!isAndroidDaemon) return { result: 'error', label: 'Android daemon required', detail: 'This action requires an Android daemon. The paired daemon is a desktop daemon.' };
            // Check Android permissions
            const permMap: Record<string, AndroidDaemonAction | null> = {
              android_screenshot: 'android_screenshot', android_read_screen: 'android_read_screen',
              android_screen_context: 'android_read_screen',
              android_open_app: 'android_open_app', android_browse: 'android_browse',
              android_file_list: 'android_file_list', android_file_read: 'android_file_read',
              android_tap: 'android_tap_type', android_type: 'android_tap_type',
              android_swipe: 'android_tap_type', android_press_key: 'android_tap_type',
              android_notifications_list: null,  // served from server cache — no daemon permission needed
            };
            const permKey = permMap[action];
            if (permKey && !(await isAndroidDaemonActionAllowed(userId, permKey))) {
              return { result: 'error', label: `Permission denied`, detail: `Android action '${action}' is not permitted. Enable it in Profile → Connected Channels → Android Device → Permissions.` };
            }
            if (action === 'android_open_app') {
              if (!args.packageName) return { result: 'error', label: 'packageName required', detail: 'Provide packageName for android_open_app.' };
              op = { type: 'android_open_app', packageName: String(args.packageName) };
            } else if (action === 'android_browse') {
              if (!args.url) return { result: 'error', label: 'url required', detail: 'Provide url for android_browse.' };
              let browseUrl = String(args.url);
              // Normalize well-known URLs → native app deep links so the app (not the browser) opens
              const ytSearch = browseUrl.match(/(?:https?:\/\/)?(?:www\.)?youtube\.com\/results\?search_query=([^&]+)/);
              if (ytSearch) browseUrl = `vnd.youtube://results?search_query=${ytSearch[1]}`;
              const ytWatch = browseUrl.match(/(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([^&]+)/);
              if (ytWatch) browseUrl = `vnd.youtube://watch?v=${ytWatch[1]}`;
              op = { type: 'android_browse', url: browseUrl };
            } else if (action === 'android_return_to_jarvis') {
              op = { type: 'android_return_to_jarvis' };
            } else if (action === 'android_screenshot') {
              op = { type: 'android_screenshot' };
            } else if (action === 'android_read_screen') {
              op = { type: 'android_read_screen' };
            } else if (action === 'android_screen_context') {
              op = { type: 'android_screen_context' };
            } else if (action === 'android_operator_action') {
              const operatorAction = (args as { operatorAction?: unknown }).operatorAction;
              if (!operatorAction || typeof operatorAction !== 'object' || Array.isArray(operatorAction)) {
                return { result: 'error', label: 'operatorAction required', detail: 'Provide operatorAction for android_operator_action.' };
              }
              const typedOperatorAction = operatorAction as Record<string, unknown>;
              const nestedPermKey = operatorActionPermKey(typedOperatorAction);
              if (nestedPermKey && !(await isAndroidDaemonActionAllowed(userId, nestedPermKey))) {
                return { result: 'error', label: 'Permission denied', detail: `Android operator action '${String(typedOperatorAction.type || 'unknown')}' is not permitted. Enable it in Profile → Connected Channels → Android Device → Permissions.` };
              }
              op = { type: 'android_operator_action', action: typedOperatorAction };
            } else if (action === 'android_tap') {
              if (typeof args.x !== 'number' || typeof args.y !== 'number') return { result: 'error', label: 'x,y required', detail: 'Provide x and y for android_tap.' };
              op = { type: 'android_tap', x: args.x, y: args.y };
            } else if (action === 'android_type') {
              if (!args.text) return { result: 'error', label: 'text required', detail: 'Provide text for android_type.' };
              op = { type: 'android_type', text: String(args.text), submit: !!args.submit };
            } else if (action === 'android_notifications_list') {
              const limit = typeof args.limit === 'number' ? Math.min(args.limit, 60) : 20;

              // ── Path 1: Query the daemon's own on-device notification cache ──
              // The daemon's JarvisNotificationListener accumulates every notification
              // that arrives while the daemon app is running, stored in memory on the phone.
              // This persists across server restarts — unlike the server-side cache which
              // is empty after every server restart. Always go here first.
              const daemonNotifResult = await sendDaemonOp(userId, { type: 'android_notifications_list', limit } as DaemonOp, 10000);

              if (daemonNotifResult.ok) {
                const d = daemonNotifResult.data as Record<string, unknown> | null;
                const listenerEnabled = !!(d?.listenerEnabled);
                const rawNotifications = Array.isArray(d?.notifications) ? (d!.notifications as Record<string, unknown>[]) : [];
                const count = rawNotifications.length;

                if (listenerEnabled && count > 0) {
                  const relativeTime = (tsMs: number): string => {
                    const diffMs = Date.now() - tsMs;
                    const diffMins = Math.round(diffMs / 60000);
                    if (diffMins < 1) return 'just now';
                    if (diffMins < 60) return `${diffMins}m ago`;
                    const diffHours = Math.floor(diffMins / 60);
                    if (diffHours < 24) return `${diffHours}h ${diffMins % 60}m ago`;
                    return `${Math.floor(diffHours / 24)}d ago`;
                  };
                  const formatted = rawNotifications.map((n) => {
                    const ago = typeof n.ts === 'number' ? relativeTime(n.ts) : '?';
                    const app = String(n.app || n.pkg || 'Unknown');
                    const title = String(n.title || '');
                    const text = n.text ? `: ${String(n.text).slice(0, 120)}` : '';
                    return `• ${app} (${ago}) — ${title}${text}`;
                  }).join('\n');
                  return {
                    result: 'success',
                    label: `${count} notification${count !== 1 ? 's' : ''} from phone`,
                    detail: `PHONE NOTIFICATIONS (${count} total) — speak these back to the user exactly. The "(X ago)" values are relative ages; DO NOT convert them to clock times — you cannot know the user's timezone and any conversion will be wrong. Just say "X minutes ago" or "X hours ago" as shown.\n\n${formatted}`,
                  };
                }

                if (listenerEnabled && count === 0) {
                  // Listener is active but no notifications — this IS accurate data
                  return {
                    result: 'success',
                    label: 'No notifications',
                    detail: 'The notification listener is active on the phone and reports zero current notifications. The tray is clear.',
                  };
                }

                // listenerEnabled=false → Notification Access not granted on the phone
                console.warn(`[daemon] android_notifications_list: listenerEnabled=false for userId=${userId}, falling back to shade`);
              } else {
                console.warn(`[daemon] android_notifications_list direct op failed (${daemonNotifResult.error}), falling back to shade`);
              }

              // ── Path 2: Notification Access not granted OR daemon query failed ──
              // Physically open the notification shade, read the screen, then close it.
              const swipeOp = await sendDaemonOp(userId, {
                type: 'android_swipe',
                x1: 540, y1: 10,
                x2: 540, y2: 1200,
                durationMs: 400,
              }, 8000);

              if (!swipeOp.ok) {
                return {
                  result: 'error',
                  label: 'Cannot read notifications',
                  detail: `The Notification Access permission is not granted to Jarvis Daemon (go to Settings > Notifications > Device & App Notifications > Jarvis Daemon and enable it). The shade-opening fallback also failed: ${swipeOp.error || 'swipe failed'}.`,
                };
              }

              // Wait for the shade animation
              await new Promise(r => setTimeout(r, 700));

              const shadeReadOp = await sendDaemonOp(userId, { type: 'android_read_screen' }, 10000);

              // Close the shade in the background
              sendDaemonOp(userId, { type: 'android_press_key', key: 'back' }, 5000).catch(() => {});

              if (!shadeReadOp.ok) {
                return {
                  result: 'error',
                  label: 'Could not read notification shade',
                  detail: `Screen read failed: ${shadeReadOp.error || 'unknown'}. Ensure the Accessibility Service is enabled.`,
                };
              }

              // The read_screen result is a structured JSON object from the accessibility tree.
              // Extract the text fields and return them verbatim.
              const shadeData = shadeReadOp.data;
              const shadeText = typeof shadeData === 'string'
                ? shadeData
                : JSON.stringify(shadeData || '');

              if (!shadeText || shadeText === '{}' || shadeText === '""' || shadeText === 'null') {
                return {
                  result: 'success',
                  label: 'Notification shade appears empty',
                  detail: 'No text was detected in the notification shade. Your notification tray may be empty.',
                };
              }

              return {
                result: 'success',
                label: 'Notification shade content read from screen',
                detail: `SCREEN CONTENT (verbatim from phone — report ONLY what is shown here, do NOT add or infer any details):\n${shadeText}`,
              };
            } else if (action === 'android_wait') {
              // Server-side pause — no daemon op needed. Lets the phone UI settle between steps.
              const ms = Math.min(Math.max(typeof args.ms === 'number' ? args.ms : 1500, 200), 10000);
              await new Promise(resolve => setTimeout(resolve, ms));
              return { result: 'success', label: `Waited ${ms}ms`, detail: `Paused ${ms}ms to let the phone UI settle.` };
            } else if (action === 'android_swipe') {
              if (typeof args.x1 !== 'number' || typeof args.y1 !== 'number' || typeof args.x2 !== 'number' || typeof args.y2 !== 'number') return { result: 'error', label: 'coords required', detail: 'Provide x1,y1,x2,y2 for android_swipe.' };
              op = { type: 'android_swipe', x1: args.x1, y1: args.y1, x2: args.x2, y2: args.y2, durationMs: typeof args.durationMs === 'number' ? args.durationMs : 300 };
            } else if (action === 'android_press_key') {
              const validKeys = ['back', 'home', 'recents', 'volume_up', 'volume_down', 'enter'] as const;
              const key = String(args.key || 'back') as typeof validKeys[number];
              if (!validKeys.includes(key)) return { result: 'error', label: 'invalid key', detail: 'Key must be back, home, recents, volume_up, volume_down, or enter.' };
              op = { type: 'android_press_key', key };
            } else if (action === 'android_file_list') {
              if (!args.path) return { result: 'error', label: 'path required', detail: 'Provide path for android_file_list.' };
              op = { type: 'android_file_list', path: String(args.path) };
            } else if (action === 'notify') {
              op = { type: 'notify', title: String(args.title || 'Jarvis'), body: String(args.body || '') };
            } else {
              if (!args.path) return { result: 'error', label: 'path required', detail: 'Provide path for android_file_read.' };
              op = { type: 'android_file_read', path: String(args.path) };
            }
          } else if (desktopActions.includes(action)) {
            if (!isDesktopDaemonActive(userId)) return { result: 'error', label: 'Desktop daemon required', detail: `Action '${action}' requires the Desktop Daemon. Connect it from Profile → Connected Channels.` };
            if (!(await isDaemonActionAllowed(userId, action as DaemonAction))) {
              return { result: 'error', label: `Action '${action}' not permitted`, detail: `Enable '${action}' in Profile → Connected Channels → Desktop Daemon → Permissions.` };
            }
            if (action === 'shell') {
              if (!args.cmd) return { result: 'error', label: 'cmd required', detail: 'Provide cmd for shell action.' };
              op = { type: 'shell', cmd: String(args.cmd), cwd: args.cwd ? String(args.cwd) : undefined };
            } else if (action === 'file_read') {
              if (!args.path) return { result: 'error', label: 'path required', detail: 'Provide path for file_read.' };
              op = { type: 'file_read', path: String(args.path) };
            } else if (action === 'file_write') {
              if (!args.path || typeof args.content !== 'string') return { result: 'error', label: 'path+content required', detail: 'Provide path and content for file_write.' };
              op = { type: 'file_write', path: String(args.path), content: String(args.content) };
            } else {
              if (!args.path) return { result: 'error', label: 'path required', detail: 'Provide path for file_list.' };
              op = { type: 'file_list', path: String(args.path) };
            }
          } else {
            return { result: 'error', label: 'Unknown action', detail: `Unknown daemon action: ${action}` };
          }
          // Auto-preflight: for every android_* op (except android_notifications_list which
          // is served from the server cache), run a 5s ping first. This causes the op to
          // fail fast (<5s) if the daemon is stale or the accessibility service has crashed,
          // rather than waiting the full 30s op timeout on a silent failure.
          if (action.startsWith('android_') && action !== 'android_notifications_list') {
            const preflightResult = await pingDaemon(userId, 5000);
            if (!preflightResult.ok) {
              return {
                result: 'error',
                label: '⛔ Daemon is not responding',
                detail: `Daemon ping failed before '${action}' (${preflightResult.error}). The daemon is not responding — it may have been killed by Samsung battery optimisation, the accessibility service may have been disabled, or the phone may be locked. Tell the user: "The Jarvis Daemon isn't responding. Please open the Jarvis Daemon app on your phone to check the status dot and the Recent Activity log — if the accessibility service is disabled, tap Fix to re-enable it."`,
              };
            }
          }

          // Use tight per-action timeouts so a hung op fails fast
          // instead of blocking the 30s default (which pushes total chat time over 60s).
          const actionTimeouts: Record<string, number> = {
            android_read_screen: 8000,
            android_screen_context: 10000,
            android_operator_action: 10000,
            android_tap: 6000,
            android_swipe: 6000,
            android_press_key: 5000,
            android_type: 10000,
            android_browse: 8000,
            android_return_to_jarvis: 10000,
            android_open_app: 15000,
            android_screenshot: 20000,
            android_notifications_list: 12000,
            android_file_list: 8000,
            android_file_read: 10000,
            shell: 20000,
            notify: 5000,
            file_read: 10000,
            file_write: 10000,
            file_list: 8000,
          };
          const timeoutMs = actionTimeouts[action] ?? 12000;
          const daemonResult = await sendDaemonOp(userId, op, timeoutMs);
          if (!daemonResult.ok) return { result: 'error', label: 'Daemon action failed', detail: daemonResult.error || 'Unknown error' };

          // Handle screenshot specially: store the image and return a URL instead of raw base64
          if (action === 'android_screenshot' && daemonResult.data) {
            const data = daemonResult.data as Record<string, unknown>;
            const b64 = data.screenshot as string | undefined;
            if (b64 && b64.length > 0) {
              const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
              const buf = Buffer.from(b64, 'base64');
              storeDaemonScreenshot(id, buf);
              return { result: 'success', label: 'Screenshot captured', detail: JSON.stringify({ screenshotUrl: `/api/daemon/screenshot/${id}` }) };
            }
          }

          return { result: 'success', label: `Daemon: ${action}`, detail: JSON.stringify(daemonResult.data || {}).slice(0, 2000) };
        }
        case 'daemon_diagnostic': {
          if (!isUserPaired(userId)) {
            return { result: 'error', label: 'Daemon not connected', detail: 'No daemon paired — cannot run diagnostic.' };
          }
          const pingResult = await pingDaemon(userId, 5000);
          const auditEntries = getOpAuditLog(userId);
          const recent = auditEntries.slice(-20).reverse();
          const recentStr = recent.length === 0 ? 'No ops recorded yet.' : recent.map((e) => {
            const d = new Date(e.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            return `[${d}] ${e.type} → ${e.ok ? 'OK' : `FAIL: ${e.error}`} (${e.durationMs}ms)`;
          }).join('\n');
          const pingStr = pingResult.ok
            ? `ping OK — ${JSON.stringify(pingResult.data)}`
            : `ping FAILED — ${pingResult.error}`;
          return {
            result: pingResult.ok ? 'success' : 'error',
            label: pingResult.ok ? 'Daemon alive' : 'Daemon ping failed',
            detail: `${pingStr}\n\nRecent op log (newest first):\n${recentStr}`,
          };
        }
        case 'search_youtube': {
          const query = String(args.query || '').trim();
          if (!query) return { result: 'error', label: 'query required', detail: 'Provide a search query.' };
          const maxResults = Math.min(Math.max(typeof args.maxResults === 'number' ? args.maxResults : 8, 1), 10);
          const trendingMode = !!args.trending;
          const daysBack = typeof args.daysBack === 'number' ? args.daysBack : 5;
          try {
            const searchResult = await ytSearch({ query, pageStart: 1, pageEnd: 1 });
            let videos = (searchResult.videos || []) as any[];

            if (trendingMode) {
              // Compute views-per-hour for each video and sort by velocity
              const now = Date.now();
              const daysMs = daysBack * 24 * 60 * 60 * 1000;
              videos = videos
                .map((v: any) => {
                  const viewCount = typeof v.views === 'number' ? v.views : parseInt(String(v.views).replace(/[^0-9]/g, ''), 10) || 0;
                  // Parse "X days ago", "X hours ago", etc. from v.ago
                  let ageMs = daysBack * 24 * 60 * 60 * 1000; // fallback
                  if (v.ago) {
                    const agoMatch = v.ago.match(/(\d+)\s*(second|minute|hour|day|week|month|year)/i);
                    if (agoMatch) {
                      const n = parseInt(agoMatch[1], 10);
                      const unit = agoMatch[2].toLowerCase();
                      const unitMs: Record<string, number> = {
                        second: 1000, minute: 60000, hour: 3600000,
                        day: 86400000, week: 604800000, month: 2592000000, year: 31536000000,
                      };
                      ageMs = n * (unitMs[unit] || 86400000);
                    }
                  }
                  const ageHours = Math.max(ageMs / 3600000, 1);
                  const viewsPerHour = Math.round(viewCount / ageHours);
                  return { ...v, viewCount, ageMs, viewsPerHour };
                })
                .filter((v: any) => v.ageMs <= daysMs)
                .sort((a: any, b: any) => b.viewsPerHour - a.viewsPerHour)
                .slice(0, maxResults);

              if (videos.length === 0) return { result: 'error', label: 'No trending results', detail: `No videos found in the last ${daysBack} days for: "${query}"` };

              const formatted = videos.map((v: any, i: number) => {
                const views = v.viewCount.toLocaleString();
                const vph = v.viewsPerHour.toLocaleString();
                const ago = v.ago || 'unknown date';
                return `${i + 1}. "${v.title}"\n   Channel: ${v.author?.name || 'unknown'}\n   Views/hr: ${vph} | Total: ${views} | Posted: ${ago}\n   Video ID: ${v.videoId}\n   URL: ${v.url}`;
              }).join('\n\n');

              return {
                result: 'success',
                label: `YouTube trending: ${videos.length} results`,
                detail: `Trending search (views/hour): "${query}" — last ${daysBack} days\n\n${formatted}`,
              };
            }

            // Standard mode
            videos = videos.slice(0, maxResults);
            if (videos.length === 0) return { result: 'error', label: 'No results', detail: `No YouTube videos found for: "${query}"` };
            const formatted = videos.map((v: any, i: number) => {
              const views = typeof v.views === 'number' ? v.views.toLocaleString() : (v.views || 'unknown');
              const ago = v.ago || 'unknown date';
              const duration = v.duration?.timestamp || v.duration || 'unknown';
              return `${i + 1}. "${v.title}"\n   Channel: ${v.author?.name || 'unknown'}\n   Views: ${views} | Posted: ${ago} | Duration: ${duration}\n   Video ID: ${v.videoId}\n   URL: ${v.url}`;
            }).join('\n\n');
            return {
              result: 'success',
              label: `YouTube search: ${videos.length} results`,
              detail: `Search: "${query}"\n\n${formatted}\n\nTo open a video on the phone: android_browse with url='vnd.youtube://watch?v=VIDEO_ID'\nTo get its transcript: fetch_youtube_transcript with videoId='VIDEO_ID'`,
            };
          } catch (err: any) {
            return { result: 'error', label: 'YouTube search failed', detail: err?.message || String(err) };
          }
        }
        case 'fetch_youtube_transcript': {
          const rawInput = String(args.videoId || '').trim();
          if (!rawInput) return { result: 'error', label: 'videoId required', detail: 'Provide a YouTube video ID or URL.' };
          const { fetchTranscriptCached, extractVideoId, isPlaylistUrl } = await import('./lib/transcriptCache');
          if (isPlaylistUrl(rawInput)) {
            return { result: 'error', label: 'Playlist URL not supported', detail: 'This looks like a YouTube playlist URL. Provide a single video URL or video ID instead.' };
          }
          const resolvedId = extractVideoId(rawInput) ?? rawInput.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 11);
          try {
            const { segments, source, asyncJobPending, jobId, phaseErrors, supadataTimedOut } = await fetchTranscriptCached(resolvedId, { userId });

            if (asyncJobPending) {
              return {
                result: 'pending',
                label: 'Transcript generation started',
                detail: `Supadata started AI transcript generation for video '${resolvedId}' (job ${jobId}). This video has no native captions — AI generation takes 5-10 minutes for long videos. Try fetching this video again in a few minutes; the result will be ready then.`,
              };
            }

            // Success takes priority over any timeout/error flags — if segments arrived, use them
            if (segments && segments.length > 0) {
              const fullText = segments.map((t) => t.text).join(' ').replace(/\s+/g, ' ').trim();
              const sourceNote = source && source !== 'unknown' ? ` [source: ${source}]` : '';
              return {
                result: 'success',
                label: 'Transcript fetched',
                detail: `Video ID: ${resolvedId}${sourceNote}\nTranscript (${segments.length} segments, ${fullText.length} chars total):\n\n${fullText}`,
              };
            }

            if (supadataTimedOut) {
              return {
                result: 'error',
                label: 'Transcript generation timed out',
                detail: `Supadata started AI generation for video '${resolvedId}' but it took longer than 10 minutes. The credits have been used. Please try again — the transcript may now be cached on Supadata's servers.${phaseErrors?.supadata ? ` Error: ${phaseErrors.supadata}` : ''}`,
              };
            }

            if (!segments || segments.length === 0) {
              const errorParts: string[] = [];
              if (phaseErrors?.gemini) errorParts.push(`Gemini error: ${phaseErrors.gemini}`);
              if (phaseErrors?.supadata) errorParts.push(`Supadata error: ${phaseErrors.supadata}`);
              const geminiKey = process.env.GOOGLE_GEMINI_API_KEY;
              const supadataKey = process.env.SUPADATA_API_KEY;
              let detail = `Could not retrieve transcript for video '${resolvedId}'.`;
              if (errorParts.length > 0) {
                detail += ` ${errorParts.join('. ')}. This video likely has no native captions. Try again — Supadata may need more time for AI generation.`;
              } else if (!geminiKey && !supadataKey) {
                detail += ' No cloud transcript services are configured (GOOGLE_GEMINI_API_KEY and SUPADATA_API_KEY are both unset). This video likely has no native captions, and the server IP is blocked by YouTube for direct downloads.';
              } else {
                detail += ' This video likely has no native captions. Gemini and/or Supadata were attempted — check server logs for the exact error. If Supadata returned a job ID, try again in a few minutes.';
              }
              return { result: 'error', label: 'No transcript found', detail };
            }

            // Fallthrough safety — should not reach here (segments > 0 handled above)
            return { result: 'error', label: 'No transcript found', detail: `No transcript found for video '${resolvedId}'.` };
          } catch (err: any) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[fetch_youtube_transcript] Error for ${resolvedId}:`, msg);

            if (msg.startsWith('SUPADATA_JOB_PENDING:')) {
              const jobId = msg.replace('SUPADATA_JOB_PENDING:', '');
              return {
                result: 'pending',
                label: 'Transcript generation started',
                detail: `Supadata started AI transcript generation for video '${resolvedId}' (job ${jobId}). This video has no native captions — AI generation takes 5-10 minutes for long videos. Try fetching this video again in a few minutes.`,
              };
            }
            if (msg.toLowerCase().includes('timed out after') && msg.toLowerCase().includes('supadata')) {
              return {
                result: 'error',
                label: 'Transcript generation timed out',
                detail: `Supadata started AI generation for this video but it took longer than 10 minutes. The credits have been used. Please try again — the transcript may now be cached on Supadata's servers. Error: ${msg}`,
              };
            }
            if (msg.includes('LOGIN_REQUIRED') || msg.includes('private video')) {
              return { result: 'error', label: 'Video unavailable', detail: `This video is private or requires login. Cannot fetch transcript for '${resolvedId}'.` };
            }
            if (msg.includes('CONTENT_RESTRICTED') || msg.includes('age-restricted')) {
              return { result: 'error', label: 'Content restricted', detail: `This video is age-restricted or region-blocked. Cannot fetch transcript for '${resolvedId}'.` };
            }
            if (msg.includes('disabled') || msg.includes('Transcript is disabled')) {
              return { result: 'error', label: 'Transcript disabled', detail: `Transcripts are disabled for video '${resolvedId}'. Try a different video.` };
            }
            return {
              result: 'error',
              label: 'Transcript fetch failed',
              detail: `Could not retrieve transcript for '${resolvedId}'. Error: ${msg}. If this video has no native captions, try again in a few minutes — Supadata may need more time for AI generation.`,
            };
          }
        }
        case 'fetch_transcript_gemini': {
          const rawInput = String(args.videoId || '').trim();
          if (!rawInput) return { result: 'error', label: 'videoId required', detail: 'Provide a YouTube video ID or URL.' };
          const { fetchTranscriptViaGemini, isGeminiTranscriptAvailable, isTranscriptRefusal } = await import('./lib/geminiTranscript');
          if (!process.env.GOOGLE_GEMINI_API_KEY || !isGeminiTranscriptAvailable()) {
            return { result: 'error', label: 'Gemini unavailable', detail: 'GOOGLE_GEMINI_API_KEY is not configured — Gemini transcript unavailable. Add a direct Google AI Studio key (free at https://aistudio.google.com/apikey) to enable this tool.' };
          }
          const { extractVideoId } = await import('./lib/transcriptCache');
          const videoId = extractVideoId(rawInput) ?? rawInput;
          const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
          try {
            const text = await fetchTranscriptViaGemini(videoUrl);
            return {
              result: 'success',
              label: 'Gemini transcript fetched',
              detail: `[Gemini transcript for ${videoId} — ${text.length} chars]\n${text}`,
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (isTranscriptRefusal(msg) || msg.toLowerCase().includes('refusal') || msg.toLowerCase().includes('declined')) {
              return { result: 'error', label: 'Gemini refused', detail: `Gemini declined to transcribe this video (likely copyright-protected content). ${msg}` };
            }
            return { result: 'error', label: 'Gemini transcript failed', detail: msg };
          }
        }
        case 'fetch_transcript_supadata': {
          const rawInput = String(args.videoId || '').trim();
          if (!rawInput) return { result: 'error', label: 'videoId required', detail: 'Provide a YouTube video ID or URL.' };
          const { isSupadataAvailable, fetchTranscriptViaSupadata } = await import('./lib/supadataTranscript');
          if (!isSupadataAvailable()) {
            return { result: 'error', label: 'Supadata unavailable', detail: 'SUPADATA_API_KEY is not configured — Supadata transcript unavailable.' };
          }
          const { extractVideoId } = await import('./lib/transcriptCache');
          const videoId = extractVideoId(rawInput) ?? rawInput;
          try {
            const segs = await fetchTranscriptViaSupadata(videoId, { signal });
            if (!segs || segs.length === 0) {
              return { result: 'error', label: 'No transcript returned', detail: `Supadata returned an empty transcript for video '${videoId}'. The video may have no speech content, or AI generation produced no output.` };
            }
            const text = segs.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
            const creditsNote = '\n\nNote: Supadata uses mode=auto — if no native YouTube captions were found, AI generation was used (costs Supadata credits).';
            return {
              result: 'success',
              label: 'Supadata transcript fetched',
              detail: `[Supadata transcript for ${videoId} — ${text.length} chars]\n${text}${creditsNote}`,
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { result: 'error', label: 'Supadata transcript failed', detail: msg };
          }
        }
        case 'fetch_transcript_audio': {
          const rawInput = String(args.videoId || '').trim();
          if (!rawInput) return { result: 'error', label: 'videoId required', detail: 'Provide a YouTube video ID or URL.' };
          const { getYtdlpStatus, fetchTranscriptCached, extractVideoId, ensureYtdlpUpgraded } = await import('./lib/transcriptCache');
          await ensureYtdlpUpgraded();
          const ytdlp = getYtdlpStatus();
          if (!ytdlp.available) {
            return { result: 'error', label: 'yt-dlp unavailable', detail: 'yt-dlp is not installed on this server — audio transcription unavailable.' };
          }
          const videoId = extractVideoId(rawInput) ?? rawInput;
          try {
            const { segments, source } = await fetchTranscriptCached(videoId, { audioOnly: true, bypassCache: true, signal });
            if (segments.length === 0) {
              return { result: 'error', label: 'Audio transcription failed', detail: 'Audio transcription returned no segments — the video may be too long, blocked, or Whisper is unavailable.' };
            }
            const text = segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
            return {
              result: 'success',
              label: 'Audio transcript fetched',
              detail: `[Audio (Whisper) transcript for ${videoId} — ${text.length} chars]\n${text}`,
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { result: 'error', label: 'Audio transcript failed', detail: msg };
          }
        }
        case 'fetch_transcript_captions': {
          const rawInput = String(args.videoId || '').trim();
          if (!rawInput) return { result: 'error', label: 'videoId required', detail: 'Provide a YouTube video ID or URL.' };
          const { fetchTranscriptCached, extractVideoId } = await import('./lib/transcriptCache');
          const videoId = extractVideoId(rawInput) ?? rawInput;
          const CAPTION_SOURCES = ['innertube', 'yt-dlp', 'timedtext', 'youtube-transcript'];
          const isCaptionSource = (s: string) => CAPTION_SOURCES.some(cs => s.startsWith(cs));
          try {
            const { segments, source } = await fetchTranscriptCached(videoId, { captionsOnly: true, bypassCache: true, signal });
            if (segments.length === 0 || !isCaptionSource(source)) {
              return { result: 'error', label: 'No captions found', detail: 'No captions available for this video — try fetch_transcript_gemini or fetch_transcript_supadata for AI-generated transcript.' };
            }
            const text = segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
            return {
              result: 'success',
              label: 'Captions fetched',
              detail: `[Captions transcript for ${videoId} via ${source} — ${text.length} chars]\n${text}`,
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.toLowerCase().includes('no captions') || (msg.toLowerCase().includes('transcript') && msg.toLowerCase().includes('not available'))) {
              return { result: 'error', label: 'No captions found', detail: 'No captions available for this video — try fetch_transcript_gemini or fetch_transcript_supadata for AI-generated transcript.' };
            }
            return { result: 'error', label: 'Captions fetch failed', detail: msg };
          }
        }
        case 'connect_channel': {
          const toolResult = await connectChannelTool.execute(args, { userId, state: {} });
          if (!toolResult.ok) {
            return { result: 'error', label: toolResult.label || 'Connection failed', detail: toolResult.content };
          }
          return { result: 'success', label: toolResult.label || 'Connect channel', detail: toolResult.detail || toolResult.content };
        }
        case 'schedule_jarvis_task': {
          if (!args.title || !args.scheduledAt) {
            return { result: 'error', label: 'Missing required fields', detail: 'title and scheduledAt are required' };
          }
          const scheduledAtText = String(args.scheduledAt);
          const recurring = parseRecurringExpr(scheduledAtText);
          const scheduledDate = recurring?.scheduledAt ?? parseNaturalTime(scheduledAtText) ?? new Date(scheduledAtText);
          const recurrence = args.recurrence ? String(args.recurrence) : recurring?.recurrence ?? null;
          if (isNaN(scheduledDate.getTime())) {
            return { result: 'error', label: 'Invalid date', detail: `scheduledAt "${args.scheduledAt}" is not a valid date or natural time like "in an hour"` };
          }
          const { task, deduped } = await createJarvisScheduledTask({
            userId,
            title: String(args.title),
            description: args.description ? String(args.description) : null,
            scheduledAt: scheduledDate,
            recurrence,
            taskKind: args.taskKind ? String(args.taskKind) : "user_task",
          });
          const timeLabel = scheduledDate.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
          const recurrenceLabel = recurrence ? ` (${recurrence})` : '';
          return {
            result: 'success',
            label: deduped ? 'Already scheduled' : 'Task scheduled',
            detail: `"${task.title}" scheduled for ${timeLabel}${recurrenceLabel}`,
          };
        }
        case 'image_generate': {
          const prompt = String(args.prompt || '').trim();
          if (!prompt) return { result: 'error', label: 'prompt required', detail: 'Provide a prompt for image_generate.' };
          const caption = args.caption ? String(args.caption).trim() : undefined;
          // gpt-image-1 supported sizes (not DALL-E 3 sizes)
          const sizeMap: Record<string, '1024x1024' | '1536x1024' | '1024x1536'> = {
            square: '1024x1024',
            landscape: '1536x1024',
            portrait: '1024x1536',
          };
          const preferredSize = sizeMap[String(args.size || 'square')] ?? '1024x1024';
          try {
            const { default: OpenAI } = await import('openai');
            const imgClient = new OpenAI(getOpenAIClientConfig());
            let b64: string | undefined;
            try {
              const response = await imgClient.images.generate({
                model: 'gpt-image-1',
                prompt,
                n: 1,
                size: preferredSize,
              });
              b64 = response.data?.[0]?.b64_json;
            } catch (sizeErr) {
              // If the preferred size fails, fall back to square 1024x1024
              if (preferredSize !== '1024x1024') {
                console.warn('[image_generate] preferred size failed, retrying with 1024x1024:', sizeErr);
                const fallback = await imgClient.images.generate({
                  model: 'gpt-image-1',
                  prompt,
                  n: 1,
                  size: '1024x1024',
                });
                b64 = fallback.data?.[0]?.b64_json;
              } else {
                throw sizeErr;
              }
            }
            if (!b64) throw new Error('No image data returned from gpt-image-1');
            const imageUrl = `data:image/png;base64,${b64}`;
            return { result: 'success', label: 'Image generated', detail: JSON.stringify({ imageUrl, caption }) };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error('[image_generate] gpt-image-1 error in routes:', err);
            return { result: 'error', label: 'Image generation failed', detail: msg };
          }
        }
        default:
          return { result: 'error', label: 'Unknown action', detail: `Unknown tool: ${toolName}` };
      }
    } catch (error) {
      // Rethrow AbortError so the route-level abort handler can terminate the run cleanly
      if (error instanceof Error && (error.name === 'AbortError' || error.message?.includes('aborted'))) {
        throw error;
      }
      console.error(`Error executing tool ${toolName}:`, error);
      return { result: 'error', label: 'Action failed', detail: String(error) };
    }
  }

  function normalizeMemoryContent(content: string): string {
    return content.trim().toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ');
  }

  async function extractProfileInBackground(userId: string, messages: any[]) {
    const recentMessages = messages.slice(-6);
    if (recentMessages.length === 0) return;
    const conversationText = recentMessages
      .map((m: any) => `${m.role}: ${m.content}`)
      .join('\n');
    await extractAndStore({
      userId,
      source: conversationText,
      sourceType: "chat",
    });

    const lastUserMessage = [...messages].reverse().find((m: any) => m.role === "user" && typeof m.content === "string");
    if (lastUserMessage?.content) {
      await processLivingContextUpdate({
        userId,
        text: lastUserMessage.content,
        sourceType: "conversation",
        sourceRef: "app chat",
      }).catch((err) => console.error("[LivingContext/app_chat] update failed:", err));
    }
  }

  /**
   * Detect praise/correction/preference signals in the latest exchange and
   * feed them into the Behaviour-to-Skill pipeline (best-effort, never throws).
   */
  function detectAndRecordBehaviorSignals(userId: string | undefined, messages: any[]): void {
    if (!userId || messages.length === 0) return;
    try {
      const { detectBehaviorSignals } = require("./intelligence/pattern-analyser");
      const { recordSkillSignal } = require("./intelligence/skillWriter");
      const signals: Array<{ patternId: string; example: string }> = detectBehaviorSignals(messages);
      for (const sig of signals) {
        recordSkillSignal(userId, sig.patternId, sig.example).catch(() => {});
      }
    } catch {
      // best-effort — never block the response
    }
  }

  async function markProactiveQuestionsAnswered(userId: string, messages: any[]) {
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const unanswered = await db.select()
        .from(proactiveQuestionsSent)
        .where(
          and(
            eq(proactiveQuestionsSent.userId, userId),
            sql`${proactiveQuestionsSent.answeredAt} IS NULL`,
            sql`${proactiveQuestionsSent.sentAt} > ${twentyFourHoursAgo}`
          )
        )
        .orderBy(desc(proactiveQuestionsSent.sentAt))
        .limit(1);
      if (unanswered.length > 0) {
        const lastUserMessage = messages.filter((m: any) => m.role === 'user').pop();
        if (!lastUserMessage?.content) return;

        const checkResponse = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{
            role: "user",
            content: `Is the following user message a reply to (or related to) this question? Only answer "yes" or "no".

Question that was asked: "${unanswered[0].question}"
User's message: "${lastUserMessage.content}"

Answer (yes/no):`,
          }],
          max_completion_tokens: 10,
        });
        const answer = (checkResponse.choices[0]?.message?.content || '').trim().toLowerCase();
        if (answer.startsWith('yes')) {
          await db.update(proactiveQuestionsSent)
            .set({ answeredAt: new Date() })
            .where(eq(proactiveQuestionsSent.id, unanswered[0].id));
          console.log(`[Profile] Marked proactive question as answered via coach chat: ${unanswered[0].id}`);
        }
      }
    } catch (err) {
      console.error("[Profile] Error marking proactive question answered:", err);
    }
  }

  app.post("/api/coach/chat", async (req: Request, res: Response) => {
    let userId: string | null | undefined;
    let cleanupRun: () => void = () => {};
    let stopKeepalive: () => void = () => {};
    let stopVisibleProgress: () => void = () => {};
    try {
      const { messages, goals, stats, history, calendarEvents, lifeContext, gmailItems, gmailConnected, slackMessages, slackConnected, coachingMode, telegramMessages, telegramConnected, sdkSessionId: incomingAppSessionId, originChannel: rawOriginChannel } = req.body;
      const originChannel: string = (typeof rawOriginChannel === "string" && rawOriginChannel.trim()) ? rawOriginChannel.trim().toLowerCase() : "appchat";
      userId = req.userId ?? await getUserIdFromRequest(req);

      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: "messages array is required" });
      }
      const coachChatSelectedModel = await getExplicitCoachRequestedModel(userId);
      console.info(
        `[CoachChat] selected_model_seed userId=${userId ?? "anonymous"} authScope=${req.authScope ?? "none"} model=${coachChatSelectedModel ?? "none"}`,
      );
      const turnStartedAtMs = Date.now();
      let lastVisibleUpdateAtMs = turnStartedAtMs;
      let visibleProgressUpdateCount = 0;
      let latestVisibleProgressPhase = "";
      let visibleProgressInterval: ReturnType<typeof setInterval> | null = null;

      const ensureCoachSseOpen = () => {
        if (res.headersSent) return;
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('X-Accel-Buffering', 'no');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.flushHeaders();
      };

      const emitVisibleProgress = (phase?: string) => {
        if (phase) latestVisibleProgressPhase = phase;
        if (res.writableEnded || res.destroyed) return;
        const nowMs = Date.now();
        ensureCoachSseOpen();
        const message = buildVisibleTurnProgressMessage({
          startedAtMs: turnStartedAtMs,
          nowMs,
          updateCount: visibleProgressUpdateCount,
          latestPhase: latestVisibleProgressPhase,
        });
        const event = buildTurnProgressEvent({
          startedAtMs: turnStartedAtMs,
          nowMs,
          updateCount: visibleProgressUpdateCount,
          source: "server",
          stage: "idle_visible_update",
          message,
          detail: latestVisibleProgressPhase || undefined,
          meaningful: false,
        });
        visibleProgressUpdateCount += 1;
        lastVisibleUpdateAtMs = nowMs;
        try {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
          console.log(`[Coach/SSE] visible progress elapsedMs=${nowMs - turnStartedAtMs} userId=${userId ?? "unknown"} phase=${latestVisibleProgressPhase || "auto"}`);
        } catch {}
      };

      const emitMeaningfulProgress = (input: {
        source: string;
        stage: string;
        message: string;
        detail?: string;
      }) => {
        if (res.writableEnded || res.destroyed) return;
        const nowMs = Date.now();
        ensureCoachSseOpen();
        const event = buildTurnProgressEvent({
          startedAtMs: turnStartedAtMs,
          nowMs,
          updateCount: visibleProgressUpdateCount,
          source: input.source,
          stage: input.stage,
          message: input.message,
          detail: input.detail,
          meaningful: true,
        });
        visibleProgressUpdateCount += 1;
        latestVisibleProgressPhase = input.message;
        lastVisibleUpdateAtMs = nowMs;
        try {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
          console.log(`[Coach/SSE] meaningful progress source=${input.source} stage=${input.stage} elapsedMs=${nowMs - turnStartedAtMs} userId=${userId ?? "unknown"}`);
        } catch {}
      };

      const touchVisibleProgress = (phase?: string) => {
        if (phase) latestVisibleProgressPhase = phase;
        lastVisibleUpdateAtMs = Date.now();
      };

      const startVisibleProgress = () => {
        if (visibleProgressInterval) return;
        visibleProgressInterval = setInterval(() => {
          if (res.writableEnded || res.destroyed) return;
          const nowMs = Date.now();
          if (!shouldEmitVisibleProgressUpdate({ nowMs, lastVisibleUpdateAtMs })) return;
          emitVisibleProgress();
        }, TELEGRAM_VISIBLE_PROGRESS_INTERVAL_MS);
      };

      stopVisibleProgress = () => {
        if (visibleProgressInterval) {
          clearInterval(visibleProgressInterval);
          visibleProgressInterval = null;
        }
      };
      // Register the run before any expensive context loading so a visible
      // progress event can open SSE without preventing X-Run-Id from being set.
      const runId = `coach_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
      const abortController = new AbortController();
      const { signal } = abortController;
      let clientDisconnected = false;
      let hasDaemonActions = false;
      activeCoachRuns.set(runId, { controller: abortController, userId: userId ?? '' });
      cleanupRun = () => {
        abortController.abort();
        activeCoachRuns.delete(runId);
      };
      registerCoachRunLifecycle({
        req,
        res,
        cleanupRun,
        markClientDisconnected: () => {
          clientDisconnected = true;
        },
        stopVisibleProgress,
      });

      res.setHeader('X-Run-Id', runId);
      res.setHeader('Access-Control-Expose-Headers', 'X-Run-Id');
      startVisibleProgress();

      if (userId) {
        const latestUserMessage = [...messages].reverse().find((m: any) => m?.role === "user")?.content ?? "";
        previewRuntimeShadowForMessage({
          userId,
          message: String(latestUserMessage),
          channel: originChannel,
        }).then((shadow) => {
          if (shadow.enabled) {
            console.info(`[RuntimeShadow] ${formatRuntimeShadowPreviewSummary(shadow)}`);
          }
        }).catch((error) => {
          console.warn("[RuntimeShadow] preview failed:", error);
        });
        const { handlePrimeInput, isPrimeRuntimeEnabled } = await import("./agent/autonomyRuntime");
        const primeRuntimeEnabled = isPrimeRuntimeEnabled();
        const coreRuntimeResult = await handlePrimeInput({
          userId,
          channel: originChannel,
          message: String(latestUserMessage),
          metadata: {
            messages,
            originChannelId: incomingAppSessionId,
          },
        }, {
          appAutonomyDeps: {
            saveChatHistory: async ({ userId: historyUserId, data }: any) => {
              await db.insert(schema.chatHistory)
                .values({ userId: historyUserId, data })
                .onConflictDoUpdate({
                  target: schema.chatHistory.userId,
                  set: { data, updatedAt: new Date() },
                });
            },
            logInteraction: async ({ userId: interactionUserId, channel, direction, text }: any) => {
              await logInteraction(interactionUserId, channel, direction, text);
            },
          },
        });
        if (coreRuntimeResult.handled) {
          ensureCoachSseOpen();
          touchVisibleProgress("Returning response");
          res.write(`data: ${JSON.stringify({
            content: coreRuntimeResult.reply,
            agentSdkRunId: coreRuntimeResult.sdkRunId,
            status: coreRuntimeResult.status,
            route: coreRuntimeResult.decision.routeChosen,
          })}\n\n`);
          if (coreRuntimeResult.toolAction) {
            res.write(`data: ${JSON.stringify({
              type: "actions",
              executedActions: [{
                tool: coreRuntimeResult.toolAction.tool,
                result: coreRuntimeResult.toolAction.result,
                label: coreRuntimeResult.toolAction.label,
                code: coreRuntimeResult.toolAction.detail,
              }],
            })}\n\n`);
          }
          if (coreRuntimeResult.backgroundJob) {
            res.write(`data: ${JSON.stringify({
              type: "background_job",
              jobId: coreRuntimeResult.backgroundJob.jobId,
              agentType: coreRuntimeResult.backgroundJob.agentType,
            })}\n\n`);
          }
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        if (!primeRuntimeEnabled) {

        const { runAgentSdkEmailWorkflow, runAgentSdkReminderWorkflow } = await import("../src/agent/agentRunner");
        const recentConversationContext = messages
          .slice(-8)
          .map((m: any) => `${m?.role || "message"}: ${String(m?.content || "").slice(0, 2000)}`)
          .join("\n");
        const agentSdkReminderResult = await runAgentSdkReminderWorkflow({
          userId,
          userText: String(latestUserMessage),
          originChannel,
        });
        if (agentSdkReminderResult.handled) {
          ensureCoachSseOpen();
          touchVisibleProgress("Scheduling reminder");
          res.write(`data: ${JSON.stringify({
            content: agentSdkReminderResult.reply,
            agentSdkRunId: agentSdkReminderResult.runId,
            status: agentSdkReminderResult.status,
          })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        const agentSdkResult = await runAgentSdkEmailWorkflow({
          userId,
          userText: String(latestUserMessage),
          conversationContext: recentConversationContext,
          originChannel,
        });
        const agentSdkSetupFailure = agentSdkResult.handled
          && agentSdkResult.status === "failed"
          && /OPENROUTER_API_KEY|provider|configured/i.test(agentSdkResult.error || agentSdkResult.reply || "");
        if (agentSdkResult.handled && !agentSdkSetupFailure) {
          ensureCoachSseOpen();
          touchVisibleProgress("Preparing email workflow response");
          res.write(`data: ${JSON.stringify({
            content: agentSdkResult.reply,
            agentSdkRunId: agentSdkResult.runId,
            status: agentSdkResult.status,
          })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        const { handleDirectEmailApprovalRequest } = await import("./agent/directEmailApprovalRoute");
        const directEmailApprovalResult = await handleDirectEmailApprovalRequest({
          userId,
          text: String(latestUserMessage),
          channel: originChannel,
        });
        if (directEmailApprovalResult.handled) {
          ensureCoachSseOpen();
          touchVisibleProgress("Preparing approval request");
          res.write(`data: ${JSON.stringify({
            content: directEmailApprovalResult.reply,
            status: "awaiting_approval",
            approvalGateId: directEmailApprovalResult.gateId,
          })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        const { handleDirectReminderRequest } = await import("./agent/reminderDirectRoute");
        const directReminderResult = await handleDirectReminderRequest({
          userId,
          text: String(latestUserMessage),
          channel: originChannel,
        });
        if (directReminderResult.handled) {
          ensureCoachSseOpen();
          touchVisibleProgress("Scheduling reminder");
          res.write(`data: ${JSON.stringify({ content: directReminderResult.reply })}\n\n`);
          if (directReminderResult.toolResult) {
            res.write(`data: ${JSON.stringify({
              type: "actions",
              executedActions: [{
                tool: "schedule_jarvis_task",
                result: directReminderResult.toolResult.ok ? "success" : "error",
                label: directReminderResult.toolResult.label,
                code: directReminderResult.toolResult.detail,
              }],
            })}\n\n`);
          }
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        }
      }

      const autonomyResult = await routeAppCoachChatAutonomy(
        {
          userId,
          messages,
          originChannel,
        },
        {
          saveChatHistory: async ({ userId: historyUserId, data }) => {
            await db.insert(schema.chatHistory)
              .values({ userId: historyUserId, data })
              .onConflictDoUpdate({
                target: schema.chatHistory.userId,
                set: { data, updatedAt: new Date() },
              });
          },
          logInteraction: async ({ userId: interactionUserId, channel, direction, text }) => {
            await logInteraction(interactionUserId, channel, direction, text);
          },
        },
      );

      if (autonomyResult.handled && autonomyResult.reply) {
        ensureCoachSseOpen();
        touchVisibleProgress("Returning response");
        res.write(`data: ${JSON.stringify({ content: autonomyResult.reply })}\n\n`);
        if (autonomyResult.jobId) {
          res.write(`data: ${JSON.stringify({ type: "background_job", jobId: autonomyResult.jobId, agentType: autonomyResult.decision.agentType })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
        if (userId) {
          extractProfileInBackground(userId, messages);
          detectAndRecordBehaviorSignals(userId, messages);
          markProactiveQuestionsAnswered(userId, messages).catch(() => {});
        }
        return;
      }

      // ── Session-aware system-prompt data ──────────────────────────────────────
      // On warm (resumed) sessions skip the expensive per-turn DB/API fetches
      // and serve data from the in-process prompt cache instead.  On cold starts
      // (or cache misses) the data is fetched normally and stored in the cache
      // once the session ID is known (see the initSession block further below).
      const cachedPromptData = getPromptData(userId ?? undefined, incomingAppSessionId ?? undefined);
      if (incomingAppSessionId) {
        console.log(`[CoachPromptCache] userId=${userId} session=${incomingAppSessionId} ${cachedPromptData ? 'HIT' : 'MISS'}`);
      }

      let resolvedGmailConnected: boolean;
      let resolvedGmailItems: any[];
      let resolvedCalendarEvents: any[];
      let userCommitments: any[];
      let memories: { content: string; category: string }[];
      let morningNoteSummary: string;
      let documentsContext: string;
      let proactiveQuestionContext: string;
      let crossChannelContext: string;
      let soulBlock: string;
      let emotionalStateBlock: string;
      let websiteContext: string;

      if (cachedPromptData) {
        // Warm session — use cached values, skip all DB/API round-trips.
        ({ resolvedGmailConnected, resolvedGmailItems, calendarEvents: resolvedCalendarEvents,
           userCommitments, memories, morningNoteSummary, documentsContext,
           proactiveQuestionContext, crossChannelContext, soulBlock,
           emotionalStateBlock, websiteContext } = cachedPromptData);
      } else {
        // Cold start or cache miss — fetch everything fresh.
        resolvedGmailConnected = gmailConnected ?? false;
        resolvedGmailItems = gmailItems || [];
        resolvedCalendarEvents = calendarEvents || [];

        if (!resolvedGmailConnected && userId) {
          try {
            const userTokens = await getUserTokens(userId, 'google');
            if (userTokens.length > 0) {
              resolvedGmailConnected = true;
              const perAccountItems = await Promise.all(
                userTokens.map(async (t) => {
                  const emails = await getRecentEmailCommitments(7, t.accessToken).catch(() => []);
                  return emails.map((e: any) => ({ ...e, accountEmail: t.accountEmail }));
                })
              );
              resolvedGmailItems = perAccountItems.flat();
            }
          } catch {}
        }

        userCommitments = [];
        if (userId) {
          try {
            userCommitments = await db
              .select()
              .from(schema.commitments)
              .where(and(eq(schema.commitments.userId, userId), eq(schema.commitments.status, 'pending')))
              .orderBy(desc(schema.commitments.extractedAt))
              .limit(20);
          } catch {}
        }

        memories = [];
        morningNoteSummary = '';
        documentsContext = '';
        if (userId) {
          try {
            const [rows, noteSummary, docsCtx] = await Promise.all([
              db.select({ content: userMemories.content, category: userMemories.category })
                .from(userMemories)
                .where(eq(userMemories.userId, userId))
                .orderBy(desc(userMemories.extractedAt))
                .limit(50),
              getMorningNoteSummary(userId),
              getUserDocumentContext(userId),
            ]);
            memories = rows;
            morningNoteSummary = noteSummary;
            documentsContext = docsCtx;
          } catch {}
        }

        proactiveQuestionContext = '';
        if (userId) {
          try {
            const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const recentUnanswered = await db.select()
              .from(proactiveQuestionsSent)
              .where(
                and(
                  eq(proactiveQuestionsSent.userId, userId),
                  sql`${proactiveQuestionsSent.answeredAt} IS NULL`,
                  sql`${proactiveQuestionsSent.sentAt} > ${twentyFourHoursAgo}`
                )
              )
              .orderBy(desc(proactiveQuestionsSent.sentAt))
              .limit(3);
            if (recentUnanswered.length > 0) {
              proactiveQuestionContext = `\n## Recent Proactive Questions You Asked (unanswered)\nYou recently sent these curiosity-driven questions via Telegram. If the user's message seems to be answering one of them, acknowledge it warmly and ask a brief follow-up to learn more about them.\n` +
                recentUnanswered.map(q => `- "${q.question}"`).join('\n');
            }
          } catch {}
        }

        crossChannelContext = '';
        if (userId) {
          try {
            const recentInteractions = await getRecentInteractions(userId, 20);
            crossChannelContext = formatInteractionTimeline(recentInteractions);
          } catch {}
        }

        soulBlock = buildUntrustedSoulContext(
          await getSoulPromptBlock(userId ?? ""),
          "User context from JARVIS Soul",
          BUDGET_PRESETS.coachTurn.soul,
        );

        emotionalStateBlock = '';
        if (userId) {
          try {
            const { getEmotionalState, buildEmotionalStatePromptBlock } = await import("./intelligence/emotional-state");
            const emotionalState = await getEmotionalState(userId);
            if (emotionalState) emotionalStateBlock = buildEmotionalStatePromptBlock(emotionalState);
          } catch {}
        }

        websiteContext = '';
        if (userId) {
          try {
            const { getWebsiteCrawlSummaryBlock } = await import("./websiteCrawler");
            websiteContext = await getWebsiteCrawlSummaryBlock(userId);
          } catch {}
        }

        // Re-seed cache for resumed sessions that suffered a cache miss (e.g.
        // after a server restart) so subsequent turns skip the fetch cost.
        if (userId && incomingAppSessionId) {
          setPromptData(userId, incomingAppSessionId, {
            resolvedGmailConnected, resolvedGmailItems, calendarEvents: resolvedCalendarEvents,
            userCommitments, memories, morningNoteSummary, documentsContext,
            proactiveQuestionContext, crossChannelContext,
            soulBlock, emotionalStateBlock, websiteContext,
          });
        }
      }

      const daemonPaired = userId ? isUserPaired(userId) : false;
      const androidActive = userId ? isAndroidDaemonActive(userId) : false;
      const daemonDeviceMeta = daemonPaired && userId
        ? await getDaemonDeviceMeta(userId, androidActive ? "android" : "desktop")
        : { hostname: null, platform: null };

      // Build device-specific package hints for Samsung devices (hostname starts with SM-)
      const hostname = daemonDeviceMeta.hostname || '';
      const isSamsung = hostname.startsWith('SM-') || hostname.toLowerCase().includes('samsung');
      const deviceHints = androidActive ? [
        `Device: ${hostname || 'unknown'}`,
        isSamsung ? 'Samsung device — use these package names: Camera=com.sec.android.app.camera, Gallery=com.sec.android.apps.myfiles, Messages=com.samsung.android.messaging, Settings=com.android.settings, Chrome=com.android.chrome, Phone=com.samsung.android.dialer, Contacts=com.samsung.android.contacts, YouTube=com.google.android.youtube, Maps=com.google.android.apps.maps, Gmail=com.google.android.gm, Instagram=com.instagram.android, Spotify=com.spotify.music, Facebook=com.facebook.katana (fallback: com.facebook.lite), Messenger=com.facebook.orca, WhatsApp=com.whatsapp, Snapchat=com.snapchat.android, TikTok=com.ss.android.ugc.trill (fallback: com.zhiliaoapp.musically), Twitter/X=com.twitter.android, Reddit=com.reddit.frontpage, Discord=com.discord, LinkedIn=com.linkedin.android, Amazon=com.amazon.mShop.android.shopping, Netflix=com.netflix.mediaclient, Hulu=com.hulu.plus, Twitch=tv.twitch.android.app, Pinterest=com.pinterest, Uber=com.ubercab, DoorDash=com.dd.doordash, Venmo=com.venmo, Cash App=com.squareup.cash, PayPal=com.paypal.android.p2pmobile, Robinhood=com.robinhood.android, Slack=com.Slack, Zoom=us.zoom.videomeetings, Teams=com.microsoft.teams, Signal=org.thoughtcrime.securesms, Telegram=org.telegram.messenger, Calculator=com.sec.android.app.popupcalculator, Calendar=com.samsung.android.calendar, Clock=com.sec.android.app.clockpackage, Notes=com.samsung.android.app.notes. IMPORTANT: If android_open_app fails with "App not installed", the daemon automatically tries known fallback package names — but you can also try the alternate yourself if the first fails.' : '',
        'For android_press_key, valid keys are ONLY: back, home, recents, volume_up, volume_down, enter — no KEYCODE_ prefix, no camera key.',
        'For taking a photo: open the camera app with android_open_app, use android_screenshot to verify it opened, then ask the user to tap the shutter themselves (or use android_tap with the shutter button coordinates from android_read_screen).',
        'CRITICAL: If any tool returns result:error, you MUST report that failure immediately. NEVER describe a failed action as successful or invent file names, screenshots, or results that were not in the tool response.',
      ].filter(Boolean).join('\n') : '';

      const daemonSection = daemonPaired
        ? androidActive
          ? `Android Device Daemon is ACTIVE and connected.\n${deviceHints}\nAvailable daemon actions: android_open_app, android_browse, android_screenshot, android_read_screen, android_tap, android_type, android_swipe, android_press_key, android_wait, android_file_list, android_file_read, android_notifications_list, notify. DO NOT use desktop shell/file actions.\nSEARCH SHORTCUTS — use android_browse with these deep links (opens native app directly to results): YouTube search → url='vnd.youtube://results?search_query=YOUR_QUERY', Google Maps → url='geo:0,0?q=YOUR_QUERY', Spotify → url='spotify:search:YOUR_QUERY'.\nUI SETTLING — use android_wait (ms: 1500–3000) after tapping interactive elements that trigger loading (videos, pages, navigation) before calling android_read_screen. This prevents read_screen from seeing a blank or transitioning state.\n\nYOUTUBE RESEARCH WORKFLOW — when the user asks to research something on YouTube, find a good video and summarize it:\n  1. Call search_youtube (server-side) with the query. This returns results with channel name, views, date, and video ID — use this to pick a reputable, high-view-count, recent video without touching the phone at all.\n  2. Call fetch_youtube_transcript with the chosen video ID — this fetches the COMPLETE transcript server-side with no truncation.\n  3. Call android_browse with url='vnd.youtube://watch?v=VIDEO_ID' to open the video on the phone so the user can watch it.\n  4. Summarize the transcript content for the user.\n  5. Call notify as the final step (see NOTIFICATIONS below).\n  NEVER navigate YouTube's transcript UI (3-dot menu, Show Transcript, scroll) — always use fetch_youtube_transcript.\n\nNOTIFICATION → YOUTUBE VIDEO WORKFLOW — when the user asks you to open a specific video from their notifications:\n  1. android_notifications_list → find the notification the user mentioned (match by channel name or partial title).\n  2. Extract the YouTube URL from the notification if present. YouTube notification bodies often contain 'youtube.com/watch?v=VIDEO_ID' or the URL is in the intent data. Use android_browse url='vnd.youtube://watch?v=VIDEO_ID' with the exact extracted ID.\n  3. If no URL in notification: use the EXACT video title from the notification as the query for search_youtube, pick the result whose title matches most closely, then open with android_browse url='vnd.youtube://watch?v=VIDEO_ID'.\n  4. android_wait(3000) → android_screenshot → VISUALLY VERIFY the correct video title is on screen before proceeding. If the wrong video loaded, go back (android_press_key: back) and retry with a more specific search query or the exact title.\n  5. NEVER open a search results page and assume the first result is the correct video — always verify the video title matches what the user asked for.\n\nYOUTUBE APP SPATIAL LAYOUT (Galaxy Z Fold 6 cover screen, portrait) — use this as your mental map when navigating:\n  SCREEN ZONES (top to bottom):\n  • Video Player (top ~0–40% of screen): The video plays here. Tapping it toggles play/pause controls.\n  • Title Zone (~40–50%): Video title text + view count + date.\n  • Channel Zone (~50–57%): Channel name + subscriber count + Subscribe/bell button.\n  • Action Row (~57–65%): Like (with count) | Dislike | Share | Ask | Save — horizontally arranged.\n  • Comments Section (~65–78%): IMMEDIATELY VISIBLE below the action row — NO SCROLLING NEEDED. Shows 'Comments [count]' header on the left, then the first comment text directly below it as a preview. This entire block is the tap target to open the full comment list.\n  • Recommended / Store content (below 78%): Sponsored sections, other videos.\n\n  READING COMMENTS STEP-BY-STEP:\n  1. After video opens: android_wait(2500), then android_screenshot to confirm the video loaded.\n  2. The comments section is ALREADY VISIBLE on screen — no scrolling required.\n  3. android_read_screen — the output will contain 'Comments [number]' and the first comment text right there in the page. You can read that first comment immediately.\n  4. To open the full comment list: android_tap at the comments block (~x=450, y=1450 on the Z Fold 6 cover screen — roughly 65% down). This opens a bottom sheet with all comments.\n  5. android_wait(1500), android_screenshot — the comment sheet should now be open.\n  6. android_read_screen to extract the comment text you need.\n  7. If tapping opened the video fullscreen instead: android_press_key(back) to exit fullscreen, then retry tapping the comments block lower on the screen.\n\n  IMPORTANT COORDINATE NOTES:\n  • The Z Fold 6 cover screen is approx 904px wide × 2316px tall. Tap x-coordinates: use x=450 (center). y=1450 targets the comments section.\n  • After every tap, ALWAYS android_wait(1000–1500) then android_screenshot before the next action. This prevents mis-taps on transitioning screens.\n  • The first comment text is readable directly from android_read_screen without tapping anything — use this to answer 'what is the first comment?' type questions instantly.\n\nACTION FLOW for multi-step tasks: Use as many tool-call turns as the task requires — there is no turn limit. For each step: (1) If unsure what is on screen, call android_read_screen first. (2) Act — call android_browse, android_tap, android_swipe, android_type, etc. as needed. (3) After acting, call android_read_screen to confirm the result, then decide the next step. Complete the FULL task end-to-end before responding — do NOT stop mid-task and ask the user to finish. NEVER re-open an app that is already on screen. NEVER describe app content without calling android_read_screen first. If an op returns result:error, tell the user what failed and what you tried.\n\n\nFLAG_SECURE APPS — android_screenshot WILL ALWAYS FAIL for these apps (OS-level block, cannot be bypassed):\n  Facebook (com.facebook.katana / .lite), Instagram (com.instagram.android), WhatsApp (com.whatsapp), Snapchat (com.snapchat.android), Netflix (com.netflix.mediaclient), Disney+ (com.disney.disneyplus), most banking apps, and camera apps.\n  For ANY of these apps, NEVER call android_screenshot — it will always fail. Use android_read_screen instead. android_read_screen reads the accessibility tree and IS available even in FLAG_SECURE apps — it gives you all visible text, button labels, and UI element positions. This is actually MORE useful for understanding content than a screenshot since it returns structured data.\n\nCAMERA TASKS — android_screenshot WILL FAIL inside camera apps (FLAG_SECURE). For any photo task: (1) android_open_app the camera package, (2) android_wait 2000ms to let it load, (3) android_read_screen to see the viewfinder UI and find the shutter button coordinates, (4) android_tap the shutter button, (5) android_wait 1500ms, (6) send notify success banner — do NOT call android_screenshot inside the camera, it will always fail. Trust the shutter tap succeeded and move on.\n\nNOTIFICATIONS — ALWAYS send a notify banner at the end of every multi-step task, success OR failure:\n- SUCCESS: notify with title:'Jarvis ✓', body: one-line summary of what was done (e.g. "Playing Lo-Fi Hip Hop — 2.1M views, posted 3 days ago")\n- FAILURE: notify with title:'Jarvis ✗', body: one-line summary of what went wrong (e.g. "Couldn't get transcript — captions disabled on this video")\nThis ensures the user always gets a phone banner and never waits silently for a task that already ended.\n\nRETURN TO JARVIS — REQUIRED FINAL STEP after every multi-step task:\nAfter calling notify, ALWAYS call android_return_to_jarvis as the very last step. This navigates the phone back to the Jarvis chat in the browser so the user can continue the conversation without having to manually switch apps. The full task loop is always: complete task → notify banner → android_return_to_jarvis. Never skip android_return_to_jarvis on multi-step tasks.\n\nSCREENSHOT DISPLAY — screenshots ARE shown inline in the Jarvis chat as viewable images:\nWhen android_screenshot succeeds, the screenshot is automatically stored and a preview URL is returned. Include a brief description of what the screenshot shows (e.g. "Here's the current Facebook screen:") before the tool result is displayed — the image will appear inline in the chat for the user to see directly.`
          : 'Desktop Daemon is ACTIVE. Use shell, notify, file_read, file_write, file_list actions. ALWAYS report errors immediately if a tool returns result:error. Use daemon_diagnostic (no args) to check daemon health before multi-step sequences or when ops are failing.'
        : '⚠️ NO DAEMON CONNECTED. Do NOT call daemon_action — it will fail with "daemon not connected". If the user asks to control their phone or computer, tell them exactly this: "Your phone daemon isn\'t connected. To fix it: (1) Open the Jarvis app → Profile → scroll to \'Android Device\' → tap \'Get Pairing Code\', (2) Open the Jarvis Daemon APK on your phone, (3) Make sure the Server URL is https://gameplanjarvisai.up.railway.app, (4) Enter the 8-character pairing code, (5) Tap Pair. The status dot should turn green within a few seconds." Do not attempt daemon_action until they confirm it\'s connected.';
      const selfImprovementSection = `## Self-Improvement: Building New Jarvis Tools
You can extend yourself by building new tools directly. Generate the complete TypeScript code for the tool yourself and call \`build_feature\` to write it to disk, register it in the tool index, and run a smoke test — all in one step.

**When to build a new tool**: The user asks for a new Jarvis capability that doesn't exist yet (e.g. "add a tool to check stock prices", "build a Notion integration").

**How to build**: Think through what the tool needs to do, write the full TypeScript code following the AgentTool pattern, then call \`build_feature\` with feature_name, description, and tool_code (the complete file content). The tool must export a const of type AgentTool.

**After building**: The server restarts automatically so the new tool becomes active. Use \`test_tool\` to manually re-test any built tool. All builds are logged in Settings → Build History.`;

      const systemPrompt = buildCoachSystemPrompt(goals || [], stats || {}, history || [], resolvedCalendarEvents, lifeContext || null, resolvedGmailItems, resolvedGmailConnected, slackMessages || [], slackConnected ?? false, userCommitments, coachingMode, memories, telegramMessages || [], telegramConnected ?? false, morningNoteSummary, documentsContext, crossChannelContext, soulBlock, daemonSection, emotionalStateBlock, selfImprovementSection, websiteContext);

      // Detect if the user's current message is a device-control request so we can
      // force tool use rather than letting the model respond with plain text.
      const lastUserMsg = [...messages].reverse().find((m: any) => m.role === 'user');
      const lastUserContent = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content.toLowerCase() : '';
      const deviceControlKeywords = [
        'screenshot', 'screen shot', 'screen capture',
        'open youtube', 'open instagram', 'open spotify', 'open chrome', 'open camera',
        'open settings', 'open messages', 'open gmail', 'open maps', 'open the app',
        'launch', 'take a photo', 'tap on', 'tap the', 'swipe', 'read the screen',
        "what's on the screen", 'what is on the screen', 'what does the screen', 'browse to',
        'android_', 'navigate to', 'type into', 'open app',
        // notification keywords
        'notification', 'notifications', 'my notifications', 'read my notification',
        'check notification', 'show notification', 'what notification', 'any notification',
        'new notification', 'recent notification', 'latest notification',
        // general phone/device read actions
        'read my phone', 'check my phone', 'what is on my phone', "what's on my phone",
        'phone screen', 'my screen', 'my phone',
        // youtube / video intelligence
        'transcript', 'summarize the video', 'summarize that video', 'what is the video about',
        "what's the video about", 'give me a summary', 'summarize what', 'tell me what the video',
        'search youtube', 'find a youtube', 'look up on youtube', 'research on youtube',
        'look something up', 'look it up', 'find a video', 'find me a video',
      ];
      const isDeviceControlRequest = androidActive && deviceControlKeywords.some(k => lastUserContent.includes(k));

      // Absolute prohibition injected at the TOP of the system message so the model
      // reads it before any other context. Without this, the model pattern-matches
      // against prior hallucinated assistant messages in the chat history and repeats them.
      const daemonAbsoluteRule = androidActive
        ? `\n⚠️ ABSOLUTE RULE — DEVICE CONTROL: You have ZERO physical ability to open apps, take screenshots, tap, swipe, type, or perform any action on the phone through text alone. The ONLY way ANY phone action can happen is by calling the daemon_action tool and receiving result:'success'. If daemon_action is not called, NOTHING happened on the phone. Prior conversation messages where you (the assistant) described performing phone actions without a daemon_action tool call were ERRORS — do not repeat that pattern. For EVERY phone action request, call daemon_action. Never write "I opened X" or "I took a screenshot" unless daemon_action returned result:'success' in this response.\n`
        : '';

      const lastUserOrigText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
      const youtubeCtxBlock = lastUserOrigText
        ? await buildYouTubeContextBlock(lastUserOrigText).catch(() => "")
        : "";

      const codexDelegationEnabled = isCodexDelegationEnabled();
      const buildInstruction = codexDelegationEnabled
        ? "When the user asks you to build, create, edit, inspect, or test a local code project or website, use delegate_to_codex so Codex can do the implementation work. If the user explicitly asks for the change to be permanent, pushed, published, deployed, or on GitHub, delegate that commit/push/publish requirement to Codex too and set allow_external_side_effects=true only for that exact requested action. If the user did not explicitly ask for commit/push/deploy, keep the work local and say that it still needs approval to be pushed."
        : "When the user asks you to build a standalone app, website, or landing page, use queue_background_job with agentType='app_project' so Jarvis can build it persistently in the hosted workspace.";
      const toolAwareRoute = classifyToolAwareRoute(lastUserOrigText);
      if (toolAwareRoute.shouldPreferTool) {
        console.info("[Coach/ActionOntology]", {
          actionType: toolAwareRoute.actionType,
          actor: toolAwareRoute.actor,
          approvalRequired: toolAwareRoute.approvalRequired,
          reason: toolAwareRoute.actionReason,
        });
      }
      const toolAwareInstruction = toolAwareRoute.shouldPreferTool
        ? `\n\n## Tool-Aware Routing\n${toolAwareRoute.guidance}\nDo not give a capability disclaimer until you have tried the matching tool path or confirmed the required integration is not connected.`
        : "";
      const isDiagnosticsRequest = toolAwareRoute.intents.includes("diagnostics");
      const isResearchRequest = toolAwareRoute.intents.includes("research");
      const useToolFocusedLoop = toolAwareRoute.shouldPreferTool;

      const chatMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: "system", content: daemonAbsoluteRule + systemPrompt + proactiveQuestionContext + "\n\nYou can take actions on the user's behalf using the available tools. When a user asks you to add a task, log progress, update their context, etc., use the appropriate tool. " + buildInstruction + " Respond naturally — do not mention 'tool calls' or 'functions' to the user. Just confirm what you did conversationally.\n\nYou have a weather_lookup tool for weather and forecast questions. Use it when the user asks about the weather and a location is available; if no location is available, ask for the city/state." + (process.env.TAVILY_API_KEY ? "\n\nYou also have search_web and web_search tools. Use them whenever the user asks about current events, live data (stock prices, sports scores, news), or anything requiring real-time information you wouldn't know. Prefer search_web when it is available. Cite your sources naturally in your response." : "") + "\n\nYou have a jarvis_self_diagnose tool. Call it whenever: (a) the user asks about your health, why something isn't working, 'are you OK?', 'what's wrong?', 'why did that fail?', or any question about system reliability; OR (b) you notice a pattern of repeated tool failures in this conversation (2+ different tools returning errors in the same session — call this proactively before the user notices to surface the root cause). It runs a full subsystem check and returns a plain-English diagnosis. When you proactively diagnose yourself, briefly tell the user you noticed something was off and present the diagnosis without being asked." + "\n\nSELF-INSPECTION & CODE PROPOSALS: You have three self-edit tools — list_source_files, read_source_file, and propose_code_change. Use them when: (a) the user asks you to 'look at your own code', 'inspect yourself', 'improve your tools', or 'fix a bug you noticed'; OR (b) you encounter a repeated failure and believe you can fix it with a targeted code change. Workflow: (1) call list_source_files to find the relevant file, (2) call read_source_file to read it fully, (3) call propose_code_change with the complete improved file content and a plain-English reason. The proposal is saved for user review — you NEVER write files directly. Keep proposals minimal and targeted: fix one specific issue per proposal. Never propose changes to the approval gate itself (codeProposalsRoutes.ts). After proposing, tell the user a suggestion is waiting in the Code Proposals screen for their review." },
        ...(toolAwareInstruction ? [{ role: "system" as const, content: toolAwareInstruction }] : []),
        ...messages.map((m: { role: string; content: string }, idx: number) => {
          const isLast = idx === messages.length - 1;
          const content = (isLast && m.role === 'user' && youtubeCtxBlock)
            ? m.content + youtubeCtxBlock
            : m.content;
          return { role: m.role as 'user' | 'assistant', content };
        }),
      ];
      const toolFocusedMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = useToolFocusedLoop
        ? [
            {
              role: "system",
              content: [
                "You are GamePlan Coach, Jarvis's chat persona.",
                `Current date: ${new Date().toISOString().slice(0, 10)}.`,
                "This turn has a concrete tool route. Call the matching tool before answering, then summarize the tool result plainly.",
                toolAwareRoute.guidance,
                isResearchRequest
                  ? "For current news, recent events, source-finding, or live facts, call search_web first. If search is unavailable, say exactly that instead of inventing a news answer."
                  : "",
                isDiagnosticsRequest
                  ? "For health or failure questions, call jarvis_self_diagnose first and base the answer on that result."
                  : "",
              ].filter(Boolean).join("\n\n"),
            },
            ...messages.slice(-6).map((m: { role: string; content: string }, idx: number, recent: Array<{ role: string; content: string }>) => {
              const isLast = idx === recent.length - 1;
              const content = (isLast && m.role === 'user' && youtubeCtxBlock)
                ? m.content + youtubeCtxBlock
                : m.content;
              return { role: m.role as 'user' | 'assistant', content };
            }),
          ]
        : chatMessages;

      const actionResults: { tool: string; result: 'success' | 'error' | 'pending'; label: string; actionType?: string; actor?: string; approvalRequired?: boolean; actionReason?: string; url?: string; buttonLabel?: string; code?: string; channel?: string; screenshotUrl?: string; imageUrl?: string; imageCaption?: string; videoUrl?: string; videoCaption?: string; mcpServerName?: string }[] = [];
      // Accumulates MCP rich attachments across all tool calls in this request.
      // Emitted alongside executedActions in the type:'actions' SSE event to
      // mirror the CoachReplyResult { executedActions, attachments } contract.
      type McpAttachmentSse = { kind: 'image'|'markdown'|'file'|'document'; filename?: string; caption?: string; mimeType?: string; data?: string; text?: string; size?: number; mcpServerName?: string };
      const allMcpAttachments: McpAttachmentSse[] = [];
      let toolMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

      // Track whether the client disconnected mid-stream (e.g. switched to camera app).
      // If so, the full streamed response is saved to DB so it survives the disconnect.
      // SSE keepalive: once the SSE stream is open, send a comment every 10s so
      // the connection isn't killed by proxies or the Android OS while daemon ops run.
      // Declared here (outer scope) so stopKeepalive() is reachable in the catch block
      // and in the final streaming section that lives outside the if(userId) block.
      let keepaliveInterval: ReturnType<typeof setInterval> | null = null;
      const startKeepalive = () => {
        if (keepaliveInterval) return;
        keepaliveInterval = setInterval(() => {
          if (!res.writableEnded && !res.destroyed) {
            try { res.write(': keepalive\n\n'); } catch {}
          }
        }, 10000);
      };
      stopKeepalive = () => {
        if (keepaliveInterval) { clearInterval(keepaliveInterval); keepaliveInterval = null; }
      };
      // Clean up if the client disconnects mid-stream
      req.on('close', stopKeepalive);

      if (userId) {
        // Multi-turn tool loop: allows the AI to chain sequential daemon ops
        // (e.g. android_browse → android_read_screen → respond) without each
        // needing its own user message. Without this loop the AI was forced to
        // spend its only tool-call turn on daemon_diagnostic, leaving no turn
        // for the actual action it needed to perform.
        const MAX_TOOL_TURNS = 20;
        let loopFinalText: string | null = null; // text returned by model mid-loop

        // Build per-request tool list including MCP tools for this user
        let requestTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [...coachTools];
        const agentToolMap = new Map<string, AgentTool>();
        const addAgentTool = (tool: AgentTool | undefined) => {
          if (!tool) return;
          if (agentToolMap.has(tool.name)) return;
          agentToolMap.set(tool.name, tool);
          if (!requestTools.some((candidate) => chatToolName(candidate) === tool.name)) {
            requestTools.push(toOpenAIChatTool(tool));
          }
        };
        const directAgentToolNames = [
          "search_web",
          "research_topic",
          "weather_lookup",
          "build_feature",
          "test_tool",
          "queue_background_job",
          "start_project",
          "spawn_subagent",
          "jarvis_self_diagnose",
          "list_source_files",
          "read_source_file",
          "propose_code_change",
        ];
        if (codexDelegationEnabled) directAgentToolNames.push("delegate_to_codex");
        directAgentToolNames.forEach((name) => addAgentTool(getTool(name)));
        if (toolAwareRoute.toolGroups.length > 0) {
          filterToolsByGroups(toolAwareRoute.toolGroups as ToolGroup[], resolvedGmailConnected)
            .forEach((tool) => addAgentTool(tool));
        }
        toolAwareRoute.priorityToolNames.forEach((name) => addAgentTool(getTool(name)));
        const mcpAgentToolsMap = new Map<string, import("./agent/types").AgentTool>();
        try {
          const { mcpServerRegistry } = await import("./agent/mcp/mcpServerRegistry");
          const mcpAgentTools = mcpServerRegistry.getToolsForUser(userId);
          for (const agentTool of mcpAgentTools) {
            mcpAgentToolsMap.set(agentTool.name, agentTool);
            requestTools.push({
              type: "function",
              function: {
                name: agentTool.name,
                description: agentTool.description,
                parameters: agentTool.parameters as Record<string, unknown>,
              },
            });
          }
        } catch (err) {
          console.warn("[Coach/MCP] failed to load MCP tools:", (err as Error).message);
        }
        const focusedToolNames = new Set<string>();
        if (toolAwareRoute.shouldPreferTool) {
          toolAwareRoute.priorityToolNames.forEach((name) => focusedToolNames.add(name));
          filterToolsByGroups(toolAwareRoute.toolGroups as ToolGroup[], resolvedGmailConnected)
            .forEach((tool) => focusedToolNames.add(tool.name));
        }
        if (toolAwareRoute.intents.includes("email") || toolAwareRoute.intents.includes("calendar")) {
          [
            "fetch_emails",
            "gmail_action",
            "create_gmail_draft",
            "send_email",
            "fetch_calendar",
            "create_calendar_event",
          ].forEach((name) => focusedToolNames.delete(name));
        }
        if (isResearchRequest) {
          [
            "search_web",
            "research_topic",
            "web_fetch",
            "web_search",
            "browser_navigate",
            "browser_extract",
            "browser_snapshot",
          ].forEach((name) => focusedToolNames.add(name));
        }
        if (isDiagnosticsRequest) {
          focusedToolNames.add("jarvis_self_diagnose");
        }
        toolAwareRoute.blockedToolNames.forEach((name) => focusedToolNames.delete(name));
        const focusedRequestTools =
          toolAwareRoute.shouldPreferTool
            ? requestTools.filter((tool) => {
                const name = chatToolName(tool);
                return name ? focusedToolNames.has(name) : false;
              })
            : requestTools;
        const firstTurnToolPolicy = buildToolExecutionPolicy({
          route: toolAwareRoute,
          tools: focusedRequestTools,
          maxTurns: MAX_TOOL_TURNS,
          getToolName: (tool) => chatToolName(tool) ?? "",
          forceRequired: isDeviceControlRequest || isDiagnosticsRequest || isResearchRequest,
        });
        const modelRequestTools = firstTurnToolPolicy.tools;

        // Shared MCP tool context (pendingAttachments accumulate across turns)
        const mcpToolCtx: import("./agent/types").ToolContext = {
          userId,
          channel: originChannel,
          signal,
          state: {
            pendingAttachments: [],
            onProgress: (msg: string) => {
              if (!res.headersSent) {
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache, no-transform');
                res.setHeader('X-Accel-Buffering', 'no');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.flushHeaders();
              }
              touchVisibleProgress(msg);
              emitMeaningfulProgress({
                source: "tool",
                stage: "tool_progress",
                message: msg,
              });
              try { res.write(`data: ${JSON.stringify({ type: 'mcp_progress', message: msg })}\n\n`); } catch {}
            },
          },
          allowedToolNames: new Set(modelRequestTools.map((tool) => chatToolName(tool)).filter((name): name is string => Boolean(name))),
        };

        for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
          if (signal.aborted) break;
          const baseMessages = useToolFocusedLoop ? toolFocusedMessages : chatMessages;
          const currentMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            ...baseMessages,
            ...toolMessages,
          ];
          emitMeaningfulProgress({
            source: "model",
            stage: turn === 0 ? "model_route" : "model_continue",
            message: turn === 0 ? "Choosing the response path" : "Continuing after tool results",
            detail: useToolFocusedLoop ? "Tool-focused route selected" : "Full coach context route selected",
          });
          const phase1StartedAt = Date.now();
          const phase1 = await runCoachModelTurn({
            messages: currentMessages,
            tools: modelRequestTools,
            // Router-selected tool routes are enforced outside the model:
            // turn 0 must call one of the narrowed tools, later turns may stop.
            toolChoice: turn === 0 ? firstTurnToolPolicy.toolChoice : "auto",
            maxCompletionTokens: 2048,
            requestedModel: coachChatSelectedModel,
            preferRequestedModel: Boolean(coachChatSelectedModel),
            signal,
            userId: userId ?? undefined,
            logPrefix: "[CoachChat]",
          });

          const choice = {
            finish_reason: phase1.finishReason,
            message: {
              role: "assistant" as const,
              content: phase1.textContent || null,
              tool_calls: phase1.toolCallList,
            },
          };
          const phase1ToolCalls = (choice.message.tool_calls ?? []).filter(
            (tc): tc is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall => tc.type === "function",
          );
          if (phase1ToolCalls.length > 0) {
            emitMeaningfulProgress({
              source: "model",
              stage: "tool_selection",
              message: `Model selected ${phase1ToolCalls.length} tool${phase1ToolCalls.length === 1 ? "" : "s"}`,
              detail: phase1ToolCalls.map((tc) => tc.function.name).join(", "),
            });
          } else if (choice.message.content) {
            emitMeaningfulProgress({
              source: "model",
              stage: "model_answer",
              message: "Model produced a response",
              detail: `finish_reason=${choice.finish_reason ?? "unknown"}`,
            });
          }
          const phase1Usage = estimateModelUsage({
            messages: currentMessages,
            tools: modelRequestTools,
            textContent: choice.message.content ?? "",
            toolCallList: phase1ToolCalls,
          });
          void recordModelUsage({
            userId,
            provider: phase1.providerName || providerLabelForModel(phase1.model || "gpt-4o-mini"),
            model: phase1.model || "gpt-4o-mini",
            source: "app_chat",
            ...phase1Usage,
            durationMs: Date.now() - phase1StartedAt,
            success: true,
            metadata: {
              phase: "tool_loop",
              turn,
              finishReason: choice.finish_reason,
              toolCalls: phase1ToolCalls.length,
              fallbackUsed: Boolean(phase1.fallbackUsed),
            },
          });

          // Model finished with text (no more tool calls this turn)
          if (choice.finish_reason !== 'tool_calls' || !choice.message.tool_calls?.length) {
            if (turn === 0 && choice.message.content) {
              // Phase-1-only response (no tools called at all) — run hallucination check
              const responseText = choice.message.content;
              const hallucIndicators = [
                "i've opened", "i opened", "i launched", "i took a screenshot", "i captured",
                "screenshot has been taken", "screenshot taken", "i've taken", "i tapped",
                "i swiped", "i typed", "here is the screenshot", "here's the screenshot",
                "here are your current android notifications",
                "here are your android notifications",
                "here are your notifications",
                "got it — here are your",
                "got it, here are your",
                "your current notifications",
                "your android notifications",
                "fetching your notifications",
                "i'll fetch your android",
                "i will fetch your android",
                "fetched your notifications",
              ];
              const hasRawToolCallBlob = androidActive && (
                responseText.includes('"name":"daemon_action"') ||
                responseText.includes('"name": "daemon_action"') ||
                responseText.includes('android_notifications_list') ||
                responseText.includes('android_open_app') ||
                responseText.includes('android_screenshot') ||
                responseText.includes('android_tap') ||
                responseText.includes('android_read_screen')
              );
              const looksHallucinated = androidActive && (hasRawToolCallBlob || hallucIndicators.some(h => responseText.toLowerCase().includes(h)));
              if (looksHallucinated) {
                console.warn(`[daemon] HALLUCINATION DETECTED userId=${userId} — model claimed device action without tool call. Intercepting.`);
                const correctedResponse = "I wasn't able to perform that action on your phone — I need to call the phone tool to do that, and it didn't get called this time. Please try again and I'll make sure to actually execute the command.";
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache, no-transform');
                res.setHeader('X-Accel-Buffering', 'no');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.flushHeaders();
                res.write(`data: ${JSON.stringify({ content: correctedResponse })}\n\n`);
                res.write('data: [DONE]\n\n');
                res.end();
                cleanupRun();
                return;
              }
              // Normal conversational response with no tools needed — stream it directly
              res.setHeader('Content-Type', 'text/event-stream');
              res.setHeader('Cache-Control', 'no-cache, no-transform');
              res.setHeader('X-Accel-Buffering', 'no');
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.flushHeaders();
              res.write(`data: ${JSON.stringify({ content: responseText })}\n\n`);
              const lastUserMsg0 = [...messages].reverse().find((m: any) => m.role === 'user');
              // Session management — save/extend session and emit sdkSessionId.
              if (userId) {
                try {
                  const { initSession, appendToSession } = await import("./agent/providers/sessionStore");
                  const COACH_APP_AGENT_ID = getCoachAppAgentId(userId);
                  let appSessionId: string | undefined;
                  if (incomingAppSessionId) {
                    const exchangeMsgs = [
                      { role: "user" as const, content: typeof lastUserMsg0?.content === "string" ? lastUserMsg0.content : "" },
                      { role: "assistant" as const, content: responseText },
                    ];
                    await appendToSession(incomingAppSessionId, COACH_APP_AGENT_ID, userId, exchangeMsgs).catch(() => {});
                    appSessionId = incomingAppSessionId;
                  } else {
                    appSessionId = await initSession(COACH_APP_AGENT_ID, userId, [...chatMessages, { role: "assistant" as const, content: responseText }]);
                    // Seed the prompt cache so subsequent turns skip DB/API lookups.
                    if (appSessionId && !cachedPromptData) {
                      setPromptData(userId, appSessionId, {
                        resolvedGmailConnected, resolvedGmailItems, calendarEvents: resolvedCalendarEvents,
                        userCommitments, memories, morningNoteSummary, documentsContext,
                        proactiveQuestionContext, crossChannelContext,
                        soulBlock, emotionalStateBlock, websiteContext,
                      });
                    }
                  }
                  if (appSessionId) {
                    res.write(`data: ${JSON.stringify({ type: "session_init", sdkSessionId: appSessionId })}\n\n`);
                  }
                } catch { /* non-blocking — never break the response */ }
              }
              res.write('data: [DONE]\n\n');
              res.end();
              extractProfileInBackground(userId, messages);
              detectAndRecordBehaviorSignals(userId, messages);
              markProactiveQuestionsAnswered(userId, messages).catch(() => {});
              if (lastUserMsg0?.content) logInteraction(userId, "app_chat", "inbound", typeof lastUserMsg0.content === 'string' ? lastUserMsg0.content : JSON.stringify(lastUserMsg0.content)).catch(() => {});
              logInteraction(userId, "app_chat", "outbound", responseText).catch(() => {});
              cleanupRun();
              return;
            }
            // turn > 0: model has finished tool calls and returned its final text.
            // Capture it so we can stream it without calling the model again.
            if (choice.message.content) loopFinalText = choice.message.content;
            break;
          }

          // Model returned tool calls — execute them all, then loop for next turn
          toolMessages.push(choice.message);

          const hasWebSearch = choice.message.tool_calls.some(tc => tc.type === 'function' && (tc.function.name === 'web_search' || tc.function.name === 'search_web'));
          if (hasWebSearch && !res.headersSent) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('X-Accel-Buffering', 'no');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.flushHeaders();
            touchVisibleProgress("Searching the web");
            emitMeaningfulProgress({
              source: "tool",
              stage: "tool_call",
              message: "Searching the web",
              detail: choice.message.tool_calls.map((tc) => tc.type === "function" ? tc.function.name : tc.type).join(", "),
            });
            res.write(`data: ${JSON.stringify({ type: 'searching' })}\n\n`);
          }

          for (const tc of choice.message.tool_calls) {
            if (tc.type !== 'function') continue;
            let args: any = {};
            try { args = JSON.parse(tc.function.arguments); } catch {}

            const connectedAccountPermission = tc.function.name === 'connected_accounts_execute'
              ? classifyComposioActionPermission(
                  String(args.platform || ''),
                  String(args.tool_slug || args.toolSlug || ''),
                  JSON.stringify(args.arguments || args.input || {}).slice(0, 1000),
                )
              : null;
            const isHighStakes = tc.function.name === 'send_email' ||
              (tc.function.name === 'connected_accounts_execute' && connectedAccountPermission?.approvalRequired === true && args.dry_run !== true) ||
              (tc.function.name === 'daemon_action' && ['shell', 'file_write'].includes(String(args.action || '')));

            if (isHighStakes) {
              if (!res.headersSent) {
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache, no-transform');
                res.setHeader('X-Accel-Buffering', 'no');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.flushHeaders();
              }
              const preview: Record<string, string> = {};
              if (tc.function.name === 'send_email') {
                preview.to = String(args.to || '');
                preview.subject = String(args.subject || '');
                preview.body = String(args.body || '');
                preview.provider = String(args.provider || 'google');
              } else if (tc.function.name === 'connected_accounts_execute') {
                preview.platform = String(args.platform || '');
                preview.action = String(args.tool_slug || args.toolSlug || '');
                preview.connection = String(args.account || args.connected_account_id || args.connectedAccountId || '');
                preview.reason = connectedAccountPermission?.reason || 'This Composio action can change an external account.';
                if (args.arguments) preview.data = typeof args.arguments === 'string' ? args.arguments : JSON.stringify(args.arguments).slice(0, 500);
              } else {
                preview.action = String(args.action || '');
                if (args.cmd) preview.cmd = String(args.cmd);
                if (args.path) preview.path = String(args.path);
                if (args.content) preview.content = String(args.content).slice(0, 200);
              }
              const confirmToken = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
              pendingConfirmations.set(confirmToken, {
                userId,
                tool: tc.function.name,
                args,
                expiresAt: Date.now() + 5 * 60 * 1000,
              });
              res.write(`data: ${JSON.stringify({ type: 'confirm_required', token: confirmToken, tool: tc.function.name, preview })}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            }

            // For daemon_action: open the SSE stream immediately and emit a
            // "working" event before the op runs. This keeps the HTTP connection
            // alive during multi-turn loops (prevents 60s gateway timeout) and
            // gives the user real-time progress instead of a blank loading state.
            if (tc.function.name === 'daemon_action') {
              hasDaemonActions = true;
              if (!res.headersSent) {
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache, no-transform');
                res.setHeader('X-Accel-Buffering', 'no');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.flushHeaders();
              }
              const actionLabel: Record<string, string> = {
                android_browse: 'Opening app on your phone...',
                android_open_app: 'Launching app on your phone...',
                android_read_screen: 'Reading your phone screen...',
                android_tap: 'Tapping the screen...',
                android_swipe: 'Scrolling...',
                android_type: 'Typing on your phone...',
                android_screenshot: 'Taking screenshot...',
                android_press_key: 'Pressing key...',
                android_notifications_list: 'Checking notifications...',
                notify: 'Sending you a notification...',
              };
              const workingMsg = actionLabel[String(args.action || '')] || 'Working on your phone...';
              touchVisibleProgress(workingMsg);
              emitMeaningfulProgress({
                source: "tool",
                stage: "tool_call",
                message: workingMsg,
                detail: `daemon_action:${String(args.action || "")}`,
              });
              res.write(`data: ${JSON.stringify({ type: 'working', message: workingMsg })}\n\n`);
              startKeepalive();
            }

            // Before android_return_to_jarvis fires, pre-save any screenshot captured
            // so far as a pending response. This handles the edge case where Chrome
            // reloads (instead of just coming to foreground): the reloaded page fetches
            // the pending response on mount and can display the screenshot immediately.
            if (tc.function.name === 'daemon_action' && String(args.action) === 'android_return_to_jarvis' && userId) {
              const earlyScreenshotUrl = actionResults.find(a => a.screenshotUrl)?.screenshotUrl;
              if (earlyScreenshotUrl) {
                savePendingCoachResponse(userId, loopFinalText || '', earlyScreenshotUrl).catch(() => {});
              }
            }

            // MCP tools are executed via the agent tool registry (not executeCoachTool)
            let execResult: { result: 'success' | 'error' | 'pending'; label: string; detail: string };
            let plainMcpServerName: string | undefined;
            if (tc.function.name.startsWith('mcp__') && mcpAgentToolsMap.has(tc.function.name)) {
              const mcpAgentTool = mcpAgentToolsMap.get(tc.function.name)!;
              // Clear pending attachments from previous turns on this context
              mcpToolCtx.state.pendingAttachments = [];
              if (!res.headersSent) {
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache, no-transform');
                res.setHeader('X-Accel-Buffering', 'no');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.flushHeaders();
              }
              // Emit a "working" indicator for MCP tools
              const mcpServerDisplayName = (() => {
                const parts = tc.function.name.split('__');
                return parts.length >= 2 ? parts[1].replace(/_/g, ' ') : 'MCP';
              })();
              plainMcpServerName = mcpServerDisplayName;
              touchVisibleProgress(`Calling ${mcpServerDisplayName}...`);
              emitMeaningfulProgress({
                source: "tool",
                stage: "tool_call",
                message: `Calling ${mcpServerDisplayName}...`,
                detail: tc.function.name,
              });
              res.write(`data: ${JSON.stringify({ type: 'working', message: `Calling ${mcpServerDisplayName}...` })}\n\n`);
              try {
                const toolResult = await mcpAgentTool.execute(args, mcpToolCtx);
                execResult = {
                  result: toolResult.ok ? 'success' : 'error',
                  label: toolResult.ok
                    ? (toolResult.label ?? `Done via ${mcpServerDisplayName}`)
                    : (toolResult.label ?? 'MCP tool error'),
                  detail: toolResult.content ?? toolResult.detail ?? '',
                };
                // Map pendingAttachments to ChannelAttachment-compatible JSON shape.
                // McpAttachmentSse (declared above) mirrors lib/storage.ts McpAttachment.
                const sseAttachments: McpAttachmentSse[] = mcpToolCtx.state.pendingAttachments.map(att => {
                  const serverName = att.mcpServerName ?? mcpServerDisplayName;
                  const approxSize = (data: string | undefined, text: string | undefined): number | undefined => {
                    if (data) return Math.round(data.length * 0.75);
                    if (text) return Buffer.byteLength(text, 'utf8');
                    return undefined;
                  };
                  if (att.kind === 'image') {
                    return { kind: 'image' as const, data: att.data, mimeType: att.mimeType ?? 'image/png', caption: att.caption, size: approxSize(att.data, undefined), mcpServerName: serverName };
                  } else if (att.kind === 'markdown') {
                    return { kind: 'markdown' as const, text: att.text, size: approxSize(undefined, att.text), mcpServerName: serverName };
                  } else {
                    const textContent = typeof att.content === 'string' ? att.content : undefined;
                    return {
                      kind: (att.kind === 'document' ? 'document' : 'file') as 'document' | 'file',
                      filename: att.filename,
                      text: textContent,
                      data: att.data,
                      mimeType: att.mimeType,
                      size: approxSize(att.data, textContent),
                      mcpServerName: serverName,
                    };
                  }
                });
                if (sseAttachments.length > 0) {
                  // Accumulate into allMcpAttachments — emitted with type:'actions' at the end
                  // to mirror CoachReplyResult { executedActions, attachments } in one event.
                  allMcpAttachments.push(...sseAttachments);
                  // Clear plainMcpServerName so we don't also emit a plain attribution action.
                  plainMcpServerName = undefined;
                }
              } catch (err) {
                execResult = {
                  result: 'error',
                  label: 'MCP tool error',
                  detail: err instanceof Error ? err.message : String(err),
                };
              }
            } else if (agentToolMap.has(tc.function.name)) {
              const agentTool = agentToolMap.get(tc.function.name)!;
              mcpToolCtx.state.pendingAttachments = [];
              try {
                if (agentTool.name === "delegate_to_codex") {
                  if (!res.headersSent) {
                    res.setHeader('Content-Type', 'text/event-stream');
                    res.setHeader('Cache-Control', 'no-cache, no-transform');
                    res.setHeader('X-Accel-Buffering', 'no');
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    res.flushHeaders();
                  }
                  startKeepalive();
                  try {
                    res.write(`data: ${JSON.stringify({ type: 'mcp_progress', message: 'Handing this off to Codex...' })}\n\n`);
                  } catch {}
                }
                const toolResult = await agentTool.execute(args, mcpToolCtx as ToolContext);
                execResult = {
                  result: toolResult.ok ? 'success' : 'error',
                  label: toolResult.label ?? agentTool.name,
                  detail: toolResult.content ?? toolResult.detail ?? '',
                };
                if (mcpToolCtx.state.pendingAttachments?.length) {
                  allMcpAttachments.push(...mcpToolCtx.state.pendingAttachments.map((att) => {
                    const textContent = typeof att.content === 'string' ? att.content : undefined;
                    const dataContent = typeof att.content === 'string' || Buffer.isBuffer(att.content)
                      ? Buffer.from(att.content).toString('base64')
                      : att.data;
                    if (att.kind === 'image') {
                      return {
                        kind: 'image' as const,
                        data: att.data ?? dataContent,
                        mimeType: att.mimeType ?? 'image/png',
                        caption: att.caption,
                        mcpServerName: att.mcpServerName,
                      };
                    }
                    if (att.kind === 'markdown') {
                      return {
                        kind: 'markdown' as const,
                        text: att.text ?? textContent,
                        mcpServerName: att.mcpServerName,
                      };
                    }
                    return {
                      kind: att.kind === 'document' ? 'document' as const : 'file' as const,
                      filename: att.filename,
                      text: textContent,
                      data: att.data ?? dataContent,
                      mimeType: att.mimeType,
                      mcpServerName: att.mcpServerName,
                    };
                  }));
                }
              } catch (err) {
                execResult = {
                  result: 'error',
                  label: `${agentTool.name} error`,
                  detail: err instanceof Error ? err.message : String(err),
                };
              }
            } else {
              execResult = await executeCoachTool(tc.function.name, args, userId, signal);
            }

            // Detect integration connectivity errors in the primary chat and emit
            // a structured integration_error SSE event so the UI can show an
            // actionable "Reconnect <integration>" prompt inline.
            // Uses the capability registry to determine which integrations a
            // failed tool depends on, then validates against the live integration
            // status — works for any integration without brittle label matching.
            if (execResult.result === 'error' && userId) {
              try {
                const { capabilityRegistry } = await import('./capabilities/index');
                const integrationDeps = capabilityRegistry.getIntegrationDeps();
                // Build reverse map: toolName → integration IDs that require it
                const toolToIntegrations = new Map<string, string[]>();
                for (const [integId, { toolNames }] of Object.entries(integrationDeps)) {
                  for (const toolName of toolNames) {
                    const existing = toolToIntegrations.get(toolName) ?? [];
                    if (!existing.includes(integId)) existing.push(integId);
                    toolToIntegrations.set(toolName, existing);
                  }
                }
                const candidateIntegrations = toolToIntegrations.get(tc.function.name) ?? [];
                if (candidateIntegrations.length > 0) {
                  const { getUserIntegrationStatuses } = await import('./intelligence/integrationValidator');
                  const liveStatuses = await getUserIntegrationStatuses(userId);
                  // Auth signals used to gate expiring_soon (still functional) cases —
                  // avoids misclassifying generic tool failures as reconnect events.
                  const detail = (execResult.detail ?? '').toLowerCase();
                  const authSignals = ['401', '403', 'unauthorized', 'forbidden', 'expired',
                    'invalid_grant', 'revoked', 'token', 'authentication', 'oauth',
                    'permission denied', 'scope', 'credentials', 'unauthenticated', 'access denied'];
                  const hasAuthSignal = authSignals.some((s) => detail.includes(s));
                  // For multi-provider tools that fail with auth signals but no provider
                  // is definitively broken (stale validator), attempt to disambiguate
                  // by provider hint in the error text to avoid misattribution.
                  const providerHint = /microsoft|outlook|office365/i.test(detail)
                    ? 'outlook'
                    : /google|gmail/i.test(detail)
                      ? 'google'
                      : null;
                  const isMultiProvider = candidateIntegrations.length > 1;
                  for (const integKey of candidateIntegrations) {
                    const integStatus = liveStatuses[integKey as keyof typeof liveStatuses];
                    // Primary: emit when validator confirms broken (authoritative, no ambiguity).
                    // Fallback: hasAuthSignal covers mid-run expiry with stale cached status.
                    //   For multi-provider tools, only fall back if provider hint matches
                    //   this integKey — otherwise suppress to avoid wrong reconnect flow.
                    const canFallback = !isMultiProvider || (providerHint === integKey);
                    const shouldEmit = integStatus === 'broken' || (hasAuthSignal && canFallback);
                    if (shouldEmit) {
                      if (!res.headersSent) {
                        res.setHeader('Content-Type', 'text/event-stream');
                        res.setHeader('Cache-Control', 'no-cache, no-transform');
                        res.setHeader('X-Accel-Buffering', 'no');
                        res.setHeader('Access-Control-Allow-Origin', '*');
                        res.flushHeaders();
                      }
                      const coachIntegrationLabels: Record<string, string> = {
                        google: 'Google', outlook: 'Outlook', slack: 'Slack',
                        telegram: 'Telegram', discord: 'Discord', whatsapp: 'WhatsApp',
                      };
                      const coachLabel = coachIntegrationLabels[integKey] ?? integKey;
                      const safeMsg = `Your ${coachLabel} connection has expired and needs to be reconnected.`;
                      console.debug(`[Coach/SSE] integration_error detail: ${(execResult.detail ?? '').slice(0, 300)}`);
                      res.write(`data: ${JSON.stringify({ type: 'integration_error', integration: integKey, message: safeMsg })}\n\n`);
                      break; // emit for the first broken integration found
                    }
                  }
                }
              } catch { /* best-effort — never block the chat loop */ }
            }

            let linkData: { url?: string; buttonLabel?: string; code?: string; channel?: string; screenshotUrl?: string; imageUrl?: string; imageCaption?: string; videoUrl?: string; videoCaption?: string } = {};
            if ((tc.function.name === 'generate_reconnect_link' || tc.function.name === 'connect_channel') && execResult.result === 'success') {
              try { linkData = JSON.parse(execResult.detail); } catch {}
            }
            if (tc.function.name === 'daemon_action' && String(args.action) === 'android_screenshot' && execResult.result === 'success') {
              try { const parsed = JSON.parse(execResult.detail); if (parsed.screenshotUrl) linkData.screenshotUrl = parsed.screenshotUrl; } catch {}
            }
            if (tc.function.name === 'image_generate' && execResult.result === 'success') {
              try {
                const parsed = JSON.parse(execResult.detail);
                if (parsed.imageUrl) linkData.imageUrl = parsed.imageUrl;
                if (parsed.caption) linkData.imageCaption = parsed.caption;
              } catch {}
            }
            if (tc.function.name === 'generate_video' && execResult.result === 'success') {
              try {
                const parsed = JSON.parse(execResult.detail);
                if (parsed.videoUrl) linkData.videoUrl = parsed.videoUrl;
                if (parsed.caption) linkData.videoCaption = parsed.caption;
              } catch {}
            }
            actionResults.push({
              tool: tc.function.name,
              result: execResult.result,
              label: execResult.label,
              actionType: toolAwareRoute.actionType,
              actor: toolAwareRoute.actor,
              approvalRequired: toolAwareRoute.approvalRequired,
              actionReason: toolAwareRoute.actionReason,
              ...linkData,
              ...(plainMcpServerName ? { mcpServerName: plainMcpServerName } : {}),
            });
            let toolResultContent: string;
            if (tc.function.name === 'daemon_action' && execResult.result === 'error') {
              toolResultContent = `⛔ DAEMON ACTION FAILED — THE PHONE DID NOT EXECUTE THIS COMMAND.\nAction attempted: ${String(args.action || 'unknown')}\nError: ${execResult.detail || execResult.label}\n\nYou MUST tell the user this specific action FAILED. Do NOT describe it as successful. Do NOT invent what the phone showed or did.`;
            } else {
              toolResultContent = JSON.stringify({ result: execResult.result, detail: execResult.detail });
            }
            toolMessages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: toolResultContent,
            });
          }
          // Continue to next turn — model will see tool results and decide what to do next
        }

        // If the model returned its final text during the loop (turn > 0), stream it
        // directly here without re-calling the model (saves one LLM round-trip).
        if (loopFinalText) {
          if (!res.headersSent) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('X-Accel-Buffering', 'no');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.flushHeaders();
          }
          if (actionResults.length > 0 || allMcpAttachments.length > 0) {
            const nonSearchActions = actionResults.filter(a => a.tool !== 'web_search' && a.tool !== 'search_web');
            if (nonSearchActions.length > 0 || allMcpAttachments.length > 0) {
              const actionsPayload: Record<string, unknown> = { type: 'actions', actions: nonSearchActions };
              if (allMcpAttachments.length > 0) actionsPayload.attachments = allMcpAttachments;
              res.write(`data: ${JSON.stringify(actionsPayload)}\n\n`);
            }
          }
          stopKeepalive();
          // Persist the response if daemon actions were involved — survives client disconnect
          if (hasDaemonActions && userId) {
            const screenshotUrl = actionResults.find(a => a.screenshotUrl)?.screenshotUrl;
            savePendingCoachResponse(userId, loopFinalText, screenshotUrl).catch(() => {});
          }
          touchVisibleProgress("Returning response");
          res.write(`data: ${JSON.stringify({ content: loopFinalText })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          extractProfileInBackground(userId, messages);
          detectAndRecordBehaviorSignals(userId, messages);
          markProactiveQuestionsAnswered(userId, messages).catch(() => {});
          const lastUserMsgLoop = [...messages].reverse().find((m: any) => m.role === 'user');
          if (lastUserMsgLoop?.content) logInteraction(userId, "app_chat", "inbound", typeof lastUserMsgLoop.content === 'string' ? lastUserMsgLoop.content : JSON.stringify(lastUserMsgLoop.content)).catch(() => {});
          logInteraction(userId, "app_chat", "outbound", loopFinalText).catch(() => {});
          cleanupRun();
          return;
        }
      }

      if (!res.headersSent) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('X-Accel-Buffering', 'no');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.flushHeaders();
      }

      if (actionResults.length > 0 || allMcpAttachments.length > 0) {
        const nonSearchActions = actionResults.filter(a => a.tool !== 'web_search' && a.tool !== 'search_web');
        if (nonSearchActions.length > 0 || allMcpAttachments.length > 0) {
          const actionsPayload: Record<string, unknown> = { type: 'actions', actions: nonSearchActions };
          if (allMcpAttachments.length > 0) actionsPayload.attachments = allMcpAttachments;
          res.write(`data: ${JSON.stringify(actionsPayload)}\n\n`);
        }
      }

      // Inject a hard error summary before the final synthesis if any daemon actions failed.
      // This prevents the AI from hallucinating success when tool calls returned errors.
      const failedDaemonActions = actionResults.filter(a => a.tool === 'daemon_action' && a.result === 'error');
      if (failedDaemonActions.length > 0) {
        // Must be "user" role — "system" injected after tool messages is silently ignored by the API.
        toolMessages.push({
          role: "user" as const,
          content: `⛔ CORRECTION REQUIRED: ${failedDaemonActions.length} phone action(s) just FAILED (see the ⛔ DAEMON ACTION FAILED messages above). Do NOT claim any of those actions succeeded. Do NOT invent search results, app content, or what the phone showed. Report exactly which action failed and why, then offer to retry or suggest an alternative. Failed actions:\n${failedDaemonActions.map(a => `- ${a.label}: ${a.result}`).join('\n')}`,
        });
      }

      const streamMessages = toolMessages.length > 0
        ? [...chatMessages, ...toolMessages]
        : chatMessages;

      const streamStartedAt = Date.now();
      let fullStreamedReply = "";
      const finalTurn = await streamCoachModelTurn({
        requestedModel: coachChatSelectedModel,
        preferRequestedModel: Boolean(coachChatSelectedModel),
        messages: streamMessages,
        toolChoice: "none",
        maxCompletionTokens: 8192,
        userId: userId ?? undefined,
        signal,
        logPrefix: "[CoachChat:final]",
      }, (chunk) => {
        if (signal.aborted || chunk.type !== "text") return;
        const content = chunk.delta;
        if (!content) return;
        fullStreamedReply += content;
        if (!clientDisconnected) {
          touchVisibleProgress("Streaming response");
          try { res.write(`data: ${JSON.stringify({ content })}\n\n`); } catch {}
        }
      });

      stopKeepalive();
      if (!fullStreamedReply && finalTurn.textContent) fullStreamedReply = finalTurn.textContent;
      let streamedModel = finalTurn.model ?? coachChatSelectedModel ?? "gpt-4o-mini";

      // Persist if daemon actions ran — response survives connection drops
      const streamUsage = estimateModelUsage({
        messages: streamMessages,
        textContent: fullStreamedReply,
      });
      if (userId) {
        void recordModelUsage({
          userId,
          provider: finalTurn.providerName ?? providerLabelForModel(streamedModel),
          model: streamedModel,
          source: "app_chat",
          ...streamUsage,
          durationMs: Date.now() - streamStartedAt,
          success: !signal.aborted,
          metadata: {
            phase: "final_stream",
            actionCount: actionResults.length,
            attachmentCount: allMcpAttachments.length,
          },
        });
      }

      if (hasDaemonActions && userId && fullStreamedReply) {
        const screenshotUrl = actionResults.find((a: any) => a.screenshotUrl)?.screenshotUrl;
        savePendingCoachResponse(userId, fullStreamedReply, screenshotUrl).catch(() => {});
      }

      // Session management — save/extend session and emit sdkSessionId.
      if (userId && fullStreamedReply && !clientDisconnected) {
        try {
          const { initSession, appendToSession } = await import("./agent/providers/sessionStore");
          const COACH_APP_AGENT_ID = getCoachAppAgentId(userId);
          const lastUserMsgForSession = [...messages].reverse().find((m: any) => m.role === 'user');
          let appSessionId: string | undefined;
          if (incomingAppSessionId) {
            const exchangeMsgs = [
              { role: "user" as const, content: typeof lastUserMsgForSession?.content === "string" ? lastUserMsgForSession.content : "" },
              { role: "assistant" as const, content: fullStreamedReply },
            ];
            await appendToSession(incomingAppSessionId, COACH_APP_AGENT_ID, userId, exchangeMsgs).catch(() => {});
            appSessionId = incomingAppSessionId;
          } else {
            appSessionId = await initSession(COACH_APP_AGENT_ID, userId, [...chatMessages, { role: "assistant" as const, content: fullStreamedReply }]);
            // Seed the prompt cache so subsequent turns skip DB/API lookups.
            if (appSessionId && !cachedPromptData) {
              setPromptData(userId, appSessionId, {
                resolvedGmailConnected, resolvedGmailItems, calendarEvents: resolvedCalendarEvents,
                userCommitments, memories, morningNoteSummary, documentsContext,
                proactiveQuestionContext, crossChannelContext,
                soulBlock, emotionalStateBlock, websiteContext,
              });
            }
          }
          if (appSessionId) {
            try { res.write(`data: ${JSON.stringify({ type: "session_init", sdkSessionId: appSessionId })}\n\n`); } catch {}
          }
        } catch { /* non-blocking — never break the response */ }
      }
      cleanupRun();
      if (!clientDisconnected) {
        if (signal.aborted) {
          res.write(`data: ${JSON.stringify({ type: 'aborted' })}\n\n`);
        } else {
          res.write('data: [DONE]\n\n');
        }
        res.end();
      }
      if (userId) {
        extractProfileInBackground(userId, messages);
        detectAndRecordBehaviorSignals(userId, messages);
        markProactiveQuestionsAnswered(userId, messages).catch(() => {});
        const lastUserMsg = [...messages].reverse().find((m: any) => m.role === 'user');
        if (lastUserMsg?.content) logInteraction(userId, "app_chat", "inbound", typeof lastUserMsg.content === 'string' ? lastUserMsg.content : JSON.stringify(lastUserMsg.content)).catch(() => {});
        if (fullStreamedReply) logInteraction(userId, "app_chat", "outbound", fullStreamedReply).catch(() => {});
      }
    } catch (error) {
      stopKeepalive();
      stopVisibleProgress();
      cleanupRun();
      // Graceful abort — user pressed Stop
      if (error instanceof Error && (error.name === 'AbortError' || error.message?.includes('aborted'))) {
        if (!res.headersSent) {
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache, no-transform');
          res.setHeader('X-Accel-Buffering', 'no');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.flushHeaders();
        }
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type: 'aborted' })}\n\n`);
          res.end();
        }
        return;
      }
      console.error("Error in coach chat:", error);
      // Push a failure banner to the phone so the user isn't left waiting silently
      if (userId && isUserPaired(userId)) {
        sendDaemonOp(userId, {
          type: 'notify',
          title: 'Jarvis ✗ Task failed',
          body: 'Something went wrong — check the app for details and try again.',
        }, 5000).catch(() => {});
      }
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to get coach response" });
      } else {
        writeCoachStreamError(res, error);
      }
    }
  });

  app.post("/api/chat/abort", async (req: Request, res: Response) => {
    const callerId = req.userId;
    if (!callerId) return res.status(401).json({ error: "Unauthorized" });
    const { runId } = req.body;
    if (!runId) return res.status(400).json({ error: "runId required" });
    const run = activeCoachRuns.get(runId);
    if (!run) return res.json({ ok: true });
    if (run.userId !== callerId) return res.status(403).json({ error: "Forbidden" });
    run.controller.abort();
    activeCoachRuns.delete(runId);

    // Cancel any pending transcript jobs for this user so the background
    // poller does not complete and notify them after they pressed Stop.
    try {
      const { cancelUserTranscriptJobs } = await import('./lib/transcriptJobTracker');
      const cancelled = await cancelUserTranscriptJobs(run.userId);
      if (cancelled > 0) {
        console.log(`[abort] Cancelled ${cancelled} pending transcript job(s) for user ${run.userId}`);
      }
    } catch (err) {
      console.warn(`[abort] Failed to cancel transcript jobs: ${err instanceof Error ? err.message : String(err)}`);
    }

    return res.json({ ok: true });
  });

  // ── Web-chat invite tokens ────────────────────────────────────────────────
  // GET /api/webchat/invite/active — returns the owner's current unexpired token (if any)
  app.get("/api/webchat/invite/active", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const [row] = await db
        .select()
        .from(webchatInviteTokens)
        .where(and(eq(webchatInviteTokens.userId, userId), gte(webchatInviteTokens.expiresAt, new Date())))
        .limit(1);

      if (!row) return res.json({ active: false });

      const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
      const protocol = req.headers["x-forwarded-proto"] || (req.secure ? "https" : "http");
      const url = `${protocol}://${host}/chat?invite=${row.token}`;

      return res.json({ active: true, token: row.token, url, expiresAt: row.expiresAt });
    } catch (error) {
      console.error("Error fetching active webchat invite token:", error);
      return res.status(500).json({ error: "Failed to fetch active invite token" });
    }
  });

  // POST /api/webchat/invite — owner generates (or retrieves) a 24-hour shareable link token
  app.post("/api/webchat/invite", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;

      const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
      const protocol = req.headers["x-forwarded-proto"] || (req.secure ? "https" : "http");

      // Return existing unexpired token if one already exists
      const [existing] = await db
        .select()
        .from(webchatInviteTokens)
        .where(and(eq(webchatInviteTokens.userId, userId), gte(webchatInviteTokens.expiresAt, new Date())))
        .limit(1);

      if (existing) {
        const url = `${protocol}://${host}/chat?invite=${existing.token}`;
        return res.json({ token: existing.token, url, expiresAt: existing.expiresAt });
      }

      const { randomBytes } = await import("crypto");
      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 h

      await db.insert(webchatInviteTokens).values({ token, userId, expiresAt });

      const url = `${protocol}://${host}/chat?invite=${token}`;
      return res.json({ token, url, expiresAt });
    } catch (error) {
      console.error("Error creating webchat invite token:", error);
      return res.status(500).json({ error: "Failed to create invite token" });
    }
  });

  // DELETE /api/webchat/invite/:token — owner revokes an active invite link
  app.delete("/api/webchat/invite/:token", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const token = _p(req.params.token);

      const [row] = await db
        .select()
        .from(webchatInviteTokens)
        .where(eq(webchatInviteTokens.token, token))
        .limit(1);

      if (!row) return res.status(404).json({ error: "Token not found" });
      if (row.userId !== userId) return res.status(403).json({ error: "Forbidden" });

      await db.delete(webchatInviteTokens).where(eq(webchatInviteTokens.token, token));

      return res.json({ ok: true });
    } catch (error) {
      console.error("Error revoking webchat invite token:", error);
      return res.status(500).json({ error: "Failed to revoke invite token" });
    }
  });

  app.post("/api/coach/execute-confirmed", async (req: Request, res: Response) => {
    try {
      const { token } = req.body;
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      if (!token) return res.status(400).json({ error: 'token is required' });
      const pending = pendingConfirmations.get(token);
      if (!pending) return res.status(400).json({ error: 'Confirmation token not found or expired' });
      if (pending.userId !== userId) return res.status(403).json({ error: 'Token does not belong to this user' });
      if (pending.expiresAt < Date.now()) {
        pendingConfirmations.delete(token);
        return res.status(400).json({ error: 'Confirmation token has expired' });
      }
      pendingConfirmations.delete(token);
      let execResult: { result: 'success' | 'error' | 'pending'; label: string; detail: string };
      if (pending.tool === 'connected_accounts_execute') {
        const connectedAccountsTool = getTool('connected_accounts_execute');
        if (!connectedAccountsTool) {
          execResult = { result: 'error', label: 'Connected account action unavailable', detail: 'The connected account action tool is not registered.' };
        } else {
          const toolResult = await connectedAccountsTool.execute(
            { ...pending.args, approved: true, confirmed: true },
            { userId, channel: 'appchat', state: { pendingAttachments: [] } } as ToolContext,
          );
          execResult = {
            result: toolResult.ok ? 'success' : 'error',
            label: toolResult.label ?? 'Connected account action',
            detail: toolResult.content ?? toolResult.detail ?? '',
          };
        }
      } else {
        execResult = await executeCoachTool(pending.tool, pending.args, userId);
      }
      return res.json({ result: execResult.result, label: execResult.label, detail: execResult.detail });
    } catch (error) {
      console.error('Error in execute-confirmed:', error);
      return res.status(500).json({ error: 'Failed to execute confirmed action' });
    }
  });

  app.post("/api/coach/decline-action", async (req: Request, res: Response) => {
    try {
      const { token } = req.body;
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      let tool = 'unknown';
      let preview: Record<string, string> = {};
      if (token) {
        const pending = pendingConfirmations.get(token);
        if (pending && pending.userId === userId) {
          tool = pending.tool;
          const a = pending.args;
          if (tool === 'send_email') preview = { to: a.to || '', subject: a.subject || '' };
          else if (tool === 'connected_accounts_execute') preview = { action: a.tool_slug || a.toolSlug || '', platform: a.platform || '' };
          else preview = { action: a.action || '', cmd: a.cmd || '', path: a.path || '' };
          pendingConfirmations.delete(token);
        }
      }
      const toolLabel = tool === 'send_email'
        ? `sending an email to ${preview.to || 'the recipient'}`
        : tool === 'connected_accounts_execute'
          ? `running the Composio ${preview.platform || 'connected account'} action ${preview.action || ''}`.trim()
        : `running a terminal command (${preview.cmd || preview.action || 'shell'})`;
      const prompt = `The user has just declined an action you proposed. You were about to ${toolLabel} but they cancelled. Acknowledge briefly and naturally in one sentence — do not re-propose the action. Stay in your coaching persona.`;
      const resp = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_completion_tokens: 80,
      });
      const content = resp.choices[0]?.message?.content || 'Got it — I won\'t proceed with that action.';
      return res.json({ content });
    } catch (error) {
      console.error('Error in decline-action:', error);
      return res.json({ content: 'Got it — I\'ll leave that for now.' });
    }
  });

  function titleCaseAction(raw: string): string {
    const trimmed = raw
      .replace(/[?.!]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : "Follow up";
  }

  function extractReminderSuggestion(text: unknown): {
    type: "reminder";
    title: string;
    category: string;
    priority: "medium";
    description: string;
    scheduledAt: string;
  } | null {
    if (typeof text !== "string") return null;
    const source = text.trim();
    if (!/\b(remind\s+me|set\s+(a\s+)?reminder|reminder)\b/i.test(source)) return null;

    const timeMatch = source.match(/\bin\s+(\d+(?:\.\d+)?|an?|one)\s+(minute|minutes|hour|hours|day|days|week|weeks)\b/i)
      ?? source.match(/\btomorrow(?:\s+at\s+[^?.!,]+)?\b/i)
      ?? source.match(/\btoday\s+at\s+[^?.!,]+\b/i)
      ?? source.match(/\bnext\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?:\s+at\s+[^?.!,]+)?\b/i)
      ?? source.match(/\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/i);
    if (!timeMatch) return null;

    const afterTo = source.match(/\b(?:remind\s+me|set\s+(?:a\s+)?reminder)\b[\s\S]*?\bto\s+(.+)$/i)?.[1];
    const taskText = (afterTo || source)
      .replace(timeMatch[0], "")
      .replace(/\b(can you|could you|please|set\s+(?:a\s+)?reminder|remind\s+me|reminder)\b/ig, "")
      .replace(/\b(to|for)\b\s*$/i, "")
      .trim();
    const title = titleCaseAction(taskText || "Follow up");

    return {
      type: "reminder",
      title,
      category: "personal",
      priority: "medium",
      description: `Reminder requested from coach chat: ${source}`,
      scheduledAt: timeMatch[0].trim(),
    };
  }

  app.post("/api/coach/suggestions", async (req: Request, res: Response) => {
    let deterministicReminder: ReturnType<typeof extractReminderSuggestion> = null;
    try {
      const { lastAssistantMessage, lastUserMessage, goals, coachingMode } = req.body;
      if (!lastAssistantMessage) {
        return res.json({ actions: [], followups: [] });
      }
      deterministicReminder = extractReminderSuggestion(lastUserMessage);

      const prompt = `Analyze this coaching message and extract structured suggestions.

User's latest message:
"${typeof lastUserMessage === "string" ? lastUserMessage : ""}"

Coaching message:
"${lastAssistantMessage}"

User's active goals:
${(goals || []).map((g: any) => `- ${g.title} (${g.category})`).join('\n') || 'None set'}

Return a JSON object with:
1. "actions": array of 0-2 actionable suggestions. Four action types are supported:
   - { "type": "task", "title": string (verb phrase), "category": "fitness"/"finance"/"career"/"personal"/"social", "priority": "high"/"medium"/"low", "description": one-line context }
   - { "type": "goal", "title": string, "category": "fitness"/"finance"/"career"/"personal"/"social", "description": one-line context }
   - { "type": "reminder", "title": string, "category": "personal", "priority": "medium", "description": one-line context, "scheduledAt": string, "recurrence": optional string } - Use when the user asked for a reminder or future follow-up. scheduledAt may be natural language like "in an hour", "tomorrow at 9am", or "next Monday at 10am" if that is exactly what the user said.
   - { "type": "link", "title": string, "buttonLabel": string (short CTA ≤4 words), "url": string (use "profile://connections" to open connection settings, or a full https:// URL), "category": "personal" } — Use ONLY when the message explicitly suggests connecting/reconnecting Google, Microsoft, Outlook, or Gmail.
   Only include actions that are specific and actionable. Return empty array for purely conversational messages.
2. "followups": array of exactly 3 short follow-up questions (max 7 words each) the user would naturally ask next.

Return ONLY the JSON object.`;

      const response = await routeModelTurn({
        tier: "cheap",
        messages: [{ role: "user", content: prompt }],
        maxCompletionTokens: 600,
        userId: req.userId ?? undefined,
        logPrefix: "[CoachSuggestions]",
      });

      const content = response.textContent || '{"actions":[],"followups":[]}';
      try {
        const parsed = JSON.parse(content);
        const parsedActions = Array.isArray(parsed.actions) ? parsed.actions.slice(0, 2) : [];
        const actions = deterministicReminder
          ? [
              deterministicReminder,
              ...parsedActions.filter((action: any) => action?.type !== "reminder").slice(0, 1),
            ]
          : parsedActions;
        res.json({
          actions,
          followups: Array.isArray(parsed.followups) ? parsed.followups.slice(0, 3) : [],
        });
      } catch {
        res.json({ actions: deterministicReminder ? [deterministicReminder] : [], followups: [] });
      }
    } catch (error) {
      if (isRetriableProviderError(error)) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[CoachSuggestions] optional suggestions skipped: provider backpressure (${msg.slice(0, 180)})`);
      } else {
        console.error("Error generating suggestions:", error);
      }
      res.json({ actions: deterministicReminder ? [deterministicReminder] : [], followups: [] });
    }
  });

  app.post("/api/ai/parse-brain-dump", async (req: Request, res: Response) => {
    try {
      const { text } = req.body;
      if (!text?.trim()) {
        return res.json({ tasks: [] });
      }

      const prompt = `You are a productivity assistant helping organize a brain dump into actionable tasks.

Brain dump text: "${text.trim()}"

Read the text above and identify each distinct action item or topic. Different subjects become different tasks. If one task has multiple steps, list them as subtasks.

For each task provide:
- title: concise action phrase starting with a verb
- description: one sentence of context (or null if title is self-explanatory)
- priority: "high", "medium", or "low"
- category: one of "personal", "career", "finance", "fitness", "social"
- subtasks: array of short action strings (empty array if not needed)

Return ONLY a JSON object with a "tasks" array. No other text.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_completion_tokens: 8192,
      });

      const content = response.choices[0]?.message?.content || '{"tasks":[]}';
      try {
        const parsed = JSON.parse(content);
        const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
        res.json({ tasks });
      } catch {
        res.json({ tasks: [] });
      }
    } catch (error) {
      console.error("Error parsing brain dump:", error);
      res.json({ tasks: [] });
    }
  });

  app.post("/api/coach/checkin", async (req: Request, res: Response) => {
    try {
      const { goals, stats, history, lifeContext, coachingMode } = req.body;
      const userId = req.userId;

      const completedHistory = (history || []).filter((h: any) => h.completed);
      const skippedHistory = (history || []).filter((h: any) => !h.completed);
      const completionRate = history?.length > 0
        ? Math.round((completedHistory.length / history.length) * 100)
        : 0;
      const goalsText = (goals || []).length > 0
        ? (goals as any[]).map((g: any) => `${g.title}: ${g.current}/${g.target} ${g.unit}`).join(', ')
        : 'no goals set';

      const lifeCtxText = lifeContext
        ? `\n- Priority: ${lifeContext.priorityGoal || 'not set'}` +
          (lifeContext.currentBlocker ? `\n- Known blocker: ${lifeContext.currentBlocker}` : '') +
          (lifeContext.improvementArea ? `\n- Wants to improve: ${lifeContext.improvementArea}` : '')
        : '';

      const persona = getPersonaBlock(coachingMode);

      const prompt = `You are a personal productivity coach. Write a 1-2 sentence daily coaching note for this person.

${persona}

Their profile:
- Streak: ${stats?.streak || 0} days, ${completionRate}% task completion this week
- Goals: ${goalsText}
- Recently completed: ${completedHistory.slice(0, 4).map((h: any) => h.title).join(', ') || 'nothing yet'}
- Recently skipped: ${skippedHistory.slice(0, 3).map((h: any) => h.title).join(', ') || 'nothing'}${lifeCtxText}

Write ONE short, specific coaching observation. Be direct — name what's working or what to fix. If they have a clear priority or blocker, reference it specifically. No greeting, no sign-off.

Return JSON: { "note": "your 1-2 sentence note here" }`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_completion_tokens: 200,
      });

      const content = response.choices[0]?.message?.content || '{"note":""}';
      try {
        const parsed = JSON.parse(content);
        res.json({ note: parsed.note || '' });
      } catch {
        res.json({ note: '' });
      }
    } catch (error) {
      console.error("Error generating check-in:", error);
      res.json({ note: '' });
    }
  });

  registerIntegrationRoutes(app);

  app.post("/api/coach/transcribe", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { audio } = req.body;
      if (!audio || typeof audio !== 'string') {
        return res.status(400).json({ error: "audio (base64) is required" });
      }

      const { speechToText, detectAudioFormat } = await import('./integrations/audioClient');
      const rawBuffer = Buffer.from(audio, 'base64');

      // Size guards: skip silent/empty clips, reject huge files
      if (rawBuffer.length < 1024) {
        return res.json({ text: "" });
      }
      if (rawBuffer.length > 20 * 1024 * 1024) {
        return res.status(400).json({ error: "Audio file is too large (max 20 MB). Please send a shorter recording." });
      }

      const format = detectAudioFormat(rawBuffer);
      const text = await speechToText(rawBuffer, format);
      res.json({ text });
    } catch (error) {
      console.error("Error transcribing audio:", error);
      res.status(500).json({ error: "Failed to transcribe audio" });
    }
  });

  app.post("/api/coach/speak", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { text, voice: voiceParam } = req.body;
      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: "text is required" });
      }

      let trimmedText = text.slice(0, 4000);
      if (text.length > 4000) {
        const lastSentence = trimmedText.lastIndexOf('.');
        if (lastSentence > 0) {
          trimmedText = trimmedText.slice(0, lastSentence + 1);
        }
      }

      // Resolve voice: explicit param → user's saved preference → default 'nova'
      let resolvedVoice = voiceParam && typeof voiceParam === 'string' ? voiceParam : null;
      if (!resolvedVoice) {
        const { getUserTtsPrefs } = await import('./agent/tools/tts');
        const prefs = await getUserTtsPrefs(userId);
        // Fallback only supports OpenAI MP3; map ElevenLabs voices to closest OpenAI voice
        const OPENAI_VOICES = new Set(["alloy", "echo", "fable", "onyx", "nova", "shimmer"]);
        resolvedVoice = OPENAI_VOICES.has(prefs.voice) ? prefs.voice : 'nova';
      }

      const { textToSpeech } = await import('./integrations/audioClient');
      const audioBuffer = await textToSpeech(trimmedText, (resolvedVoice ?? "nova") as "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer", 'mp3');
      res.json({ audio: audioBuffer.toString('base64') });
    } catch (error) {
      console.error("Error generating speech:", error);
      res.status(500).json({ error: "Failed to generate speech" });
    }
  });

  /**
   * Streaming TTS endpoint — streams PCM16 chunks (24 kHz, mono, 16-bit LE) as
   * newline-delimited JSON so the mobile client can begin playback before the
   * entire audio is generated.
   *
   * Response format (one JSON object per line):
   *   {"type":"chunk","data":"<base64-pcm16>","sampleRate":24000}\n  ← audio chunk
   *   {"type":"done"}\n                                               ← end of stream
   *   {"type":"error","message":"..."}\n                              ← on failure
   *
   * ElevenLabs voices (non-OpenAI IDs) use the ElevenLabs /stream endpoint with
   * optimize_streaming_latency=2 and pcm_24000 output format.
   * OpenAI voices use the gpt-audio streaming path (textToSpeechStream).
   */
  app.post("/api/tts/stream", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });

    const { text, voice: voiceOverride, latencyTier } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: "text is required" });
    }

    let trimmedText = text.slice(0, 4000);
    if (text.length > 4000) {
      const lastSentence = trimmedText.lastIndexOf('.');
      if (lastSentence > 0) trimmedText = trimmedText.slice(0, lastSentence + 1);
    }

    const OPENAI_VOICES = new Set(["alloy", "echo", "fable", "onyx", "nova", "shimmer"]);

    // Resolve voice: explicit override → user's saved preference → default "nova"
    const { getUserTtsPrefs } = await import('./agent/tools/tts');
    const prefs = await getUserTtsPrefs(userId);
    const resolvedVoice = (voiceOverride && typeof voiceOverride === "string")
      ? voiceOverride.toLowerCase()
      : (prefs.voice || "nova");

    const isElevenLabs = !OPENAI_VOICES.has(resolvedVoice);

    // ElevenLabs latency tier: 0=best quality, 4=lowest latency; default from user prefs (fallback 2)
    const elLatency = (typeof latencyTier === "number" && latencyTier >= 0 && latencyTier <= 4)
      ? latencyTier : (prefs.latencyTier ?? 2);

    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");

    const writeLine = (obj: object) => {
      if (!res.destroyed) {
        try { res.write(JSON.stringify(obj) + "\n"); } catch { /* connection closed */ }
      }
    };

    // Abort provider stream when client disconnects early
    const streamAbort = new AbortController();
    req.on('close', () => streamAbort.abort());

    try {
      const { textToSpeechStream, elevenlabsTtsStream } = await import('./integrations/audioClient');

      const openaiVoice = OPENAI_VOICES.has(resolvedVoice)
        ? resolvedVoice as "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer"
        : "nova";

      const stream = isElevenLabs && process.env.ELEVENLABS_API_KEY
        ? await elevenlabsTtsStream(trimmedText, resolvedVoice, "eleven_turbo_v2_5", elLatency as 0 | 1 | 2 | 3 | 4, streamAbort.signal)
        : await textToSpeechStream(trimmedText, openaiVoice, streamAbort.signal);

      for await (const base64Chunk of stream) {
        if (res.destroyed || streamAbort.signal.aborted) break;
        writeLine({ type: "chunk", data: base64Chunk, sampleRate: 24000 });
      }
      if (!streamAbort.signal.aborted) {
        writeLine({ type: "done" });
        res.end();
      }
    } catch (error) {
      console.error("[/api/tts/stream] error:", error);
      writeLine({ type: "error", message: error instanceof Error ? error.message : "TTS stream failed" });
      res.end();
    }
  });

  app.get("/api/commitments", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const rows = await db
        .select()
        .from(schema.commitments)
        .where(and(eq(schema.commitments.userId, userId), eq(schema.commitments.status, 'pending')))
        .orderBy(desc(schema.commitments.extractedAt));
      res.json({ commitments: rows });
    } catch (error) {
      console.error("Error fetching commitments:", error);
      res.status(500).json({ error: "Failed to fetch commitments" });
    }
  });

  app.put("/api/commitments/:id", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = _p(req.params.id);
      const { status } = req.body;
      if (!status || !['done', 'skipped', 'pending'].includes(status)) {
        return res.status(400).json({ error: "status must be 'done', 'skipped', or 'pending'" });
      }
      await db
        .update(schema.commitments)
        .set({ status, resolvedAt: status !== 'pending' ? new Date() : null })
        .where(and(eq(schema.commitments.id, id), eq(schema.commitments.userId, userId)));
      res.json({ ok: true });
    } catch (error) {
      console.error("Error updating commitment:", error);
      res.status(500).json({ error: "Failed to update commitment" });
    }
  });

  app.delete("/api/commitments/:id", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = _p(req.params.id);
      await db
        .delete(schema.commitments)
        .where(and(eq(schema.commitments.id, id), eq(schema.commitments.userId, userId)));
      res.json({ ok: true });
    } catch (error) {
      console.error("Error deleting commitment:", error);
      res.status(500).json({ error: "Failed to delete commitment" });
    }
  });

  app.post("/api/commitments/extract", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { message } = req.body;
      if (!message || typeof message !== 'string') {
        return res.json({ hasCommitment: false });
      }

      const prompt = `Did this message from the user contain any explicit commitment ('I will', 'I'll', 'by tomorrow', 'I need to', 'I'm going to', 'I promise', 'I plan to', 'I'm committing to')? If yes, extract the commitment. Today's date is ${new Date().toISOString().split('T')[0]}.

User message: "${message}"

Return ONLY JSON: { "hasCommitment": boolean, "commitment": "the thing they committed to" or null, "dueDate": "YYYY-MM-DD" or null }`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_completion_tokens: 200,
      });

      const content = response.choices[0]?.message?.content || '{"hasCommitment":false}';
      const parsed = JSON.parse(content);

      if (parsed.hasCommitment && parsed.commitment) {
        await db.insert(schema.commitments).values({
          userId,
          content: parsed.commitment,
          dueDate: parsed.dueDate || null,
          sourceMessage: message,
        });
        res.json({ hasCommitment: true, commitment: parsed.commitment, dueDate: parsed.dueDate || null });
      } else {
        res.json({ hasCommitment: false });
      }
    } catch (error) {
      console.error("Error extracting commitment:", error);
      res.json({ hasCommitment: false });
    }
  });

  app.post("/api/coach/proactive", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { context, goals, stats, history, lifeContext } = req.body;
      if (!context) return res.status(400).json({ error: "context is required" });

      let userCommitments: any[] = [];
      try {
        userCommitments = await db
          .select()
          .from(schema.commitments)
          .where(and(eq(schema.commitments.userId, userId), eq(schema.commitments.status, 'pending')))
          .orderBy(desc(schema.commitments.extractedAt))
          .limit(10);
      } catch {}

      const soulBlock = buildUntrustedSoulContext(
        await getSoulPromptBlock(userId ?? ""),
        "User context from JARVIS Soul",
        BUDGET_PRESETS.coachTurn.soul,
      );
      const systemPrompt = buildCoachSystemPrompt(goals || [], stats || {}, history || [], [], lifeContext || null, [], false, [], false, userCommitments, undefined, [], [], false, undefined, undefined, undefined, soulBlock);

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Accel-Buffering', 'no');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.flushHeaders();

      const stream = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt + `\n\nIMPORTANT: You are initiating the conversation proactively — the user hasn't said anything yet. Address the following accountability context directly. Be brief (2-3 sentences max). Don't greet — get right to the point.\n\nAccountability context:\n${context}` },
          { role: "user", content: "[Jarvis is checking in proactively — no user message. Address the accountability context above.]" },
        ],
        stream: true,
        max_completion_tokens: 300,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }

      res.write('data: [DONE]\n\n');
      res.end();
    } catch (error) {
      console.error("Error in proactive coach:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to generate proactive message" });
      } else {
        res.end();
      }
    }
  });

  // Returns today's morning brief if one was generated and stored by the
  // proactive scheduler. The frontend uses this to show the exact same text
  // in the Insights chat that was already sent to Telegram/daemon — no re-generation.
  app.get("/api/coach/morning-brief", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const today = new Date().toISOString().slice(0, 10);
      const rows = await db
        .select({ data: userPreferences.data })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId));
      const prefs = (rows[0]?.data as any) || {};
      const brief = prefs.morningBrief;
      if (brief && brief.date === today && brief.text) {
        return res.json({ text: brief.text, date: brief.date });
      }
      return res.json({ text: null });
    } catch (err) {
      console.error('Error fetching morning brief:', err);
      return res.json({ text: null });
    }
  });

  registerAuthenticatedCoachRuntimeRoutes(app);
  registerRuntimeDiagnosticsRoutes(app);
  registerInboxRoutes(app);

  app.post("/api/coach/weekly-review", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { goals, stats, history } = req.body;

      let weekCommitments: any[] = [];
      try {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        weekCommitments = await db
          .select()
          .from(schema.commitments)
          .where(eq(schema.commitments.userId, userId))
          .orderBy(desc(schema.commitments.extractedAt))
          .limit(30);
        weekCommitments = weekCommitments.filter((c: any) =>
          new Date(c.extractedAt).getTime() >= sevenDaysAgo.getTime()
        );
      } catch {}

      const completedHistory = (history || []).filter((h: any) => h.completed);
      const skippedHistory = (history || []).filter((h: any) => !h.completed);
      const doneCommitments = weekCommitments.filter((c: any) => c.status === 'done');
      const pendingCommitments = weekCommitments.filter((c: any) => c.status === 'pending');

      const prompt = `Generate a weekly productivity review. Be specific and direct.

This week's data:
- Tasks completed: ${completedHistory.length} (${completedHistory.slice(0, 10).map((h: any) => h.title).join(', ') || 'none'})
- Tasks skipped/incomplete: ${skippedHistory.length} (${skippedHistory.slice(0, 10).map((h: any) => h.title).join(', ') || 'none'})
- Commitments made: ${weekCommitments.length}
- Commitments fulfilled: ${doneCommitments.length} (${doneCommitments.map((c: any) => c.content).join(', ') || 'none'})
- Commitments still pending: ${pendingCommitments.length} (${pendingCommitments.map((c: any) => c.content).join(', ') || 'none'})
- Goals: ${(goals || []).map((g: any) => `${g.title} (${g.current}/${g.target} ${g.unit})`).join(', ') || 'none'}
- Current streak: ${stats?.streak || 0} days

Return JSON:
{
  "headline": "One punchy sentence summarizing the week (max 10 words)",
  "wins": ["specific win 1", "specific win 2"],
  "patterns": ["pattern or observation 1", "pattern 2"],
  "avoided": ["thing they avoided or skipped consistently"],
  "nextWeekFocus": "One specific thing to focus on next week"
}

Return ONLY the JSON object.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_completion_tokens: 500,
      });

      const content = response.choices[0]?.message?.content || '{}';
      try {
        const parsed = JSON.parse(content);
        res.json({
          headline: parsed.headline || 'Week in review',
          wins: Array.isArray(parsed.wins) ? parsed.wins : [],
          patterns: Array.isArray(parsed.patterns) ? parsed.patterns : [],
          avoided: Array.isArray(parsed.avoided) ? parsed.avoided : [],
          nextWeekFocus: parsed.nextWeekFocus || '',
        });
      } catch {
        res.json({ headline: 'Week in review', wins: [], patterns: [], avoided: [], nextWeekFocus: '' });
      }
    } catch (error) {
      console.error("Error generating weekly review:", error);
      res.status(500).json({ error: "Failed to generate weekly review" });
    }
  });

  registerProfileMemoryRoutes(app);

  // ── Prediction Engine ─────────────────────────────────────────────────────

  app.get("/api/predictions", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
      const { getTodayPredictions } = await import("./intelligence/predictor");
      const predictions = await getTodayPredictions(userId, date, 0);
      return res.json({ predictions });
    } catch (error) {
      console.error("Error getting predictions:", error);
      return res.status(500).json({ error: "Failed to get predictions" });
    }
  });

  app.get("/api/predictions/week", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const startDate = (req.query.startDate as string) || new Date().toISOString().slice(0, 10);
      const { getWeekPredictions } = await import("./intelligence/predictor");
      const predictions = await getWeekPredictions(userId, startDate, 0);
      return res.json({ predictions });
    } catch (error) {
      console.error("Error getting week predictions:", error);
      return res.status(500).json({ error: "Failed to get week predictions" });
    }
  });

  app.get("/api/predictions/accuracy", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { getPredictionAccuracy } = await import("./intelligence/predictor");
      const accuracy = await getPredictionAccuracy(userId);
      return res.json(accuracy);
    } catch (error) {
      console.error("Error getting prediction accuracy:", error);
      return res.status(500).json({ error: "Failed to get accuracy" });
    }
  });

  const _predRunLastAt = new Map<string, number>();
  const PRED_RUN_COOLDOWN_MS = 30 * 60 * 1000;

  app.post("/api/predictions/run", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const lastRun = _predRunLastAt.get(userId) ?? 0;
      const msSinceLast = Date.now() - lastRun;
      if (msSinceLast < PRED_RUN_COOLDOWN_MS) {
        const retryAfterSec = Math.ceil((PRED_RUN_COOLDOWN_MS - msSinceLast) / 1000);
        res.setHeader("Retry-After", String(retryAfterSec));
        return res.status(429).json({ error: "Rate limit — predictions were just generated", retryAfterSec });
      }
      _predRunLastAt.set(userId, Date.now());

      const targetDate = (req.body?.date as string) || new Date().toISOString().slice(0, 10);
      const { analysePatterns } = await import("./intelligence/pattern-analyser");
      const { generateAndStorePredictions } = await import("./intelligence/predictor");
      const analysis = await analysePatterns(userId, 60);
      const count = await generateAndStorePredictions(userId, targetDate, analysis);
      return res.json({ generated: count, date: targetDate });
    } catch (error) {
      console.error("Error running prediction engine:", error);
      return res.status(500).json({ error: "Failed to run predictions" });
    }
  });

  app.get("/api/preferences", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const row = await db.select({ data: schema.userPreferences.data })
        .from(schema.userPreferences)
        .where(eq(schema.userPreferences.userId, userId))
        .limit(1);
      return res.json(row[0]?.data || {});
    } catch (error) {
      console.error("Error getting preferences:", error);
      return res.status(500).json({ error: "Failed to get preferences" });
    }
  });

  app.patch("/api/preferences", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const updates = req.body;
      const existing = await db.select({ data: schema.userPreferences.data })
        .from(schema.userPreferences)
        .where(eq(schema.userPreferences.userId, userId))
        .limit(1);
      const current = (existing[0]?.data as any) || {};
      const merged = { ...current, ...updates };
      await db.insert(schema.userPreferences)
        .values({ userId, data: merged })
        .onConflictDoUpdate({
          target: schema.userPreferences.userId,
          set: { data: merged, updatedAt: new Date() },
        });
      return res.json(merged);
    } catch (error) {
      console.error("Error saving preferences:", error);
      return res.status(500).json({ error: "Failed to save preferences" });
    }
  });

  app.patch("/api/life-context", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const updates = req.body;
      const existing = await db
        .select({ data: schema.lifeContext.data })
        .from(schema.lifeContext)
        .where(eq(schema.lifeContext.userId, userId))
        .limit(1);
      const current = (existing[0]?.data as any) || {};
      const merged = { ...current, ...updates };
      await db.insert(schema.lifeContext)
        .values({ userId, data: merged, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [schema.lifeContext.userId],
          set: { data: merged, updatedAt: new Date() },
        });
      return res.json(merged);
    } catch (error) {
      console.error("Error patching life-context:", error);
      return res.status(500).json({ error: "Failed to update life context" });
    }
  });

  app.get("/api/morning-voice-notes", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const limit = parseInt(req.query.limit as string) || 30;
      const notes = await db.select()
        .from(morningVoiceNotes)
        .where(eq(morningVoiceNotes.userId, userId))
        .orderBy(desc(morningVoiceNotes.recordedAt))
        .limit(limit);
      res.json({ notes });
    } catch (error) {
      console.error("Error fetching morning voice notes:", error);
      res.status(500).json({ error: "Failed to fetch morning voice notes" });
    }
  });

  app.get("/api/morning-voice-notes/today", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const today = await getUserLocalDate(userId);
      const notes = await db.select()
        .from(morningVoiceNotes)
        .where(and(eq(morningVoiceNotes.userId, userId), eq(morningVoiceNotes.recordedAt, today)))
        .limit(1);
      res.json({ note: notes[0] || null });
    } catch (error) {
      console.error("Error fetching today's morning voice note:", error);
      res.status(500).json({ error: "Failed to fetch today's morning voice note" });
    }
  });

  async function extractMorningNoteSignals(transcript: string) {
    const extractionPrompt = `Analyze this morning voice note transcript and extract structured data.

Transcript: "${transcript}"

Extract:
1. moodSignal: one of "calm", "energized", "stressed", "overwhelmed", "uncertain" — infer from tone and content
2. themes: up to 5 short topic phrases mentioned (e.g. "client presentation", "exercise", "sleep quality")
3. blockers: up to 3 things preventing progress (e.g. "waiting on feedback", "too many meetings")
4. wins: up to 3 positive things mentioned (e.g. "finished report", "good workout")
5. intention: one sentence capturing what they want to accomplish or focus on today

Return JSON: { "moodSignal": "...", "themes": [...], "blockers": [...], "wins": [...], "intention": "..." }
Return ONLY the JSON object.`;

    const extraction = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: extractionPrompt }],
      response_format: { type: "json_object" },
      max_completion_tokens: 400,
    });

    const extractionContent = extraction.choices[0]?.message?.content || '{}';
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(extractionContent); } catch {}

    const validMoods = ['calm', 'energized', 'stressed', 'overwhelmed', 'uncertain'];
    const moodSignal = validMoods.includes(parsed.moodSignal as string) ? (parsed.moodSignal as string) : 'calm';
    const themes = Array.isArray(parsed.themes) ? parsed.themes.slice(0, 5).map(String) : [];
    const blockers = Array.isArray(parsed.blockers) ? parsed.blockers.slice(0, 3).map(String) : [];
    const wins = Array.isArray(parsed.wins) ? parsed.wins.slice(0, 3).map(String) : [];
    const intention = typeof parsed.intention === 'string' ? parsed.intention : null;

    return { moodSignal, themes, blockers, wins, intention };
  }

  app.post("/api/morning-voice-notes/extract", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { transcript } = req.body;
      if (!transcript || typeof transcript !== 'string' || !transcript.trim()) {
        return res.status(400).json({ error: "transcript is required" });
      }

      const extracted = await extractMorningNoteSignals(transcript.trim());
      res.json({ extracted });
    } catch (error) {
      console.error("Error extracting morning note signals:", error);
      res.status(500).json({ error: "Failed to extract signals" });
    }
  });

  app.post("/api/morning-voice-notes", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { transcript, extracted: preExtracted } = req.body;
      if (!transcript || typeof transcript !== 'string' || !transcript.trim()) {
        return res.status(400).json({ error: "transcript is required" });
      }

      const today = await getUserLocalDate(userId);

      const existing = await db.select({ id: morningVoiceNotes.id })
        .from(morningVoiceNotes)
        .where(and(eq(morningVoiceNotes.userId, userId), eq(morningVoiceNotes.recordedAt, today)))
        .limit(1);
      if (existing.length > 0) {
        return res.status(409).json({ error: "Morning note already recorded today" });
      }

      const extracted = preExtracted && preExtracted.moodSignal
        ? preExtracted
        : await extractMorningNoteSignals(transcript.trim());

      const validMoods = ['calm', 'energized', 'stressed', 'overwhelmed', 'uncertain'];
      const moodSignal = validMoods.includes(extracted.moodSignal) ? extracted.moodSignal : 'calm';
      const themes = Array.isArray(extracted.themes) ? extracted.themes.slice(0, 5).map(String) : [];
      const blockers = Array.isArray(extracted.blockers) ? extracted.blockers.slice(0, 3).map(String) : [];
      const wins = Array.isArray(extracted.wins) ? extracted.wins.slice(0, 3).map(String) : [];
      const intention = typeof extracted.intention === 'string' ? extracted.intention : null;

      const [inserted] = await db.insert(morningVoiceNotes).values({
        userId,
        recordedAt: today,
        transcript: transcript.trim(),
        moodSignal,
        themes,
        blockers,
        wins,
        intention,
      }).returning();

      const memorySummary = `Morning note (${today}): Mood=${moodSignal}. Themes: ${themes.join(', ') || 'none'}. ${intention ? `Intention: ${intention}` : ''}`;
      try {
        await db.insert(userMemories).values({
          userId,
          content: memorySummary,
          category: 'pattern',
        });
      } catch {}

      clearMorningNoteSummary(userId);

      res.json({
        note: inserted,
        extracted: { moodSignal, themes, blockers, wins, intention },
      });
    } catch (error) {
      console.error("Error creating morning voice note:", error);
      res.status(500).json({ error: "Failed to create morning voice note" });
    }
  });

  app.post("/api/morning-voice-notes/transcribe", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { audioBase64, mimeType } = req.body;
      if (!audioBase64) {
        return res.status(400).json({ error: "audioBase64 is required" });
      }

      const buffer = Buffer.from(audioBase64, 'base64');
      const ext = (mimeType || 'audio/webm').includes('mp4') ? 'mp4' : 'webm';
      const file = new File([buffer], `recording.${ext}`, { type: mimeType || 'audio/webm' });

      const transcription = await openai.audio.transcriptions.create({
        model: "whisper-1",
        file,
      });

      res.json({ transcript: transcription.text || '' });
    } catch (error) {
      console.error("Error transcribing audio:", error);
      res.status(500).json({ error: "Failed to transcribe audio" });
    }
  });

  // ── Jarvis Scheduled Tasks (Mission Control calendar) ──────────────────
  app.get("/api/jarvis/scheduled-tasks", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const tasks = await db
        .select()
        .from(schema.jarvisScheduledTasks)
        .where(eq(schema.jarvisScheduledTasks.userId, userId))
        .orderBy(schema.jarvisScheduledTasks.scheduledAt);
      res.json(tasks);
    } catch (err) {
      console.error("Error fetching jarvis scheduled tasks:", err);
      res.status(500).json({ error: "Failed to fetch scheduled tasks" });
    }
  });

  app.get("/api/jarvis/model-usage", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const rawDays = Number(req.query.days ?? 7);
      const days = Number.isFinite(rawDays) ? Math.floor(rawDays) : 7;
      const usage = await getModelUsageSummary(userId, days);
      res.json(usage);
    } catch (err) {
      console.error("Error fetching model usage:", err);
      res.status(500).json({ error: "Failed to fetch model usage" });
    }
  });

  app.get("/api/jarvis/provider-health", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { runProviderHealthChecks } = await import("./agent/providers/healthCheck");
      const report = await runProviderHealthChecks();
      const tiers: ModelExecutionTier[] = ["cheap", "balanced", "smart"];
      const routeChains = Object.fromEntries(
        tiers.map((tier) => [
          tier,
          getModelRouteChain(tier).map((entry) => ({
            provider: entry.providerName,
            model: entry.model,
          })),
        ]),
      );

      res.status(report.allOk ? 200 : 207).json({
        ...report,
        routeChains,
        codexGateway: {
          enabled: process.env.JARVIS_CODEX_OAUTH_ENABLED === "true" || !!process.env.JARVIS_CODEX_GATEWAY_URL,
          gatewayUrlConfigured: !!process.env.JARVIS_CODEX_GATEWAY_URL,
          gatewayTokenConfigured: !!process.env.JARVIS_CODEX_GATEWAY_TOKEN,
          localCommandConfigured: !!(process.env.JARVIS_CODEX_COMMAND || process.env.CODEX_COMMAND),
        },
      });
    } catch (err) {
      console.error("Error fetching provider health:", err);
      res.status(500).json({ error: "Failed to fetch provider health" });
    }
  });

  app.post("/api/jarvis/scheduled-tasks", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { title, description, scheduledAt, recurrence, taskKind } = req.body;
      if (!title || !scheduledAt) return res.status(400).json({ error: "title and scheduledAt are required" });
      const scheduledAtText = String(scheduledAt);
      const recurring = parseRecurringExpr(scheduledAtText);
      const scheduledDate = recurring?.scheduledAt ?? parseNaturalTime(scheduledAtText) ?? new Date(scheduledAtText);
      if (isNaN(scheduledDate.getTime())) {
        return res.status(400).json({ error: 'scheduledAt must be a valid date or natural time like "in an hour"' });
      }
      const { task, deduped } = await createJarvisScheduledTask({
        userId,
        title: String(title),
        description: description ? String(description) : null,
        scheduledAt: scheduledDate,
        recurrence: recurrence ? String(recurrence) : recurring?.recurrence ?? null,
        taskKind: taskKind ? String(taskKind) : "user_task",
      });
      res.json({ ...task, deduped });
    } catch (err) {
      console.error("Error creating jarvis scheduled task:", err);
      res.status(500).json({ error: "Failed to create scheduled task" });
    }
  });

  app.patch("/api/jarvis/scheduled-tasks/:id/complete", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = _p(req.params.id);
      await db
        .update(schema.jarvisScheduledTasks)
        .set({ completedAt: new Date() })
        .where(and(eq(schema.jarvisScheduledTasks.id, id), eq(schema.jarvisScheduledTasks.userId, userId)));
      res.json({ ok: true });
    } catch (err) {
      console.error("Error completing jarvis scheduled task:", err);
      res.status(500).json({ error: "Failed to complete task" });
    }
  });

  app.patch("/api/jarvis/scheduled-tasks/:id", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = _p(req.params.id);
      const updates: Record<string, unknown> = {};
      if (typeof req.body.active === "boolean") updates.active = req.body.active;
      if (req.body.title) updates.title = req.body.title;
      if (req.body.description !== undefined) updates.description = req.body.description || null;
      if (req.body.scheduledAt) updates.scheduledAt = new Date(req.body.scheduledAt);
      if (req.body.recurrence !== undefined) updates.recurrence = req.body.recurrence || null;
      if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No updatable fields provided" });
      const [task] = await db
        .update(schema.jarvisScheduledTasks)
        .set(updates)
        .where(and(eq(schema.jarvisScheduledTasks.id, id), eq(schema.jarvisScheduledTasks.userId, userId)))
        .returning();
      if (!task) return res.status(404).json({ error: "Task not found" });
      res.json(task);
    } catch (err) {
      console.error("Error updating jarvis scheduled task:", err);
      res.status(500).json({ error: "Failed to update task" });
    }
  });

  app.post("/api/jarvis/scheduled-tasks/:id/attention", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = _p(req.params.id);
      const { attentionQuestion } = req.body;
      if (!attentionQuestion) return res.status(400).json({ error: "attentionQuestion is required" });

      const [task] = await db
        .select()
        .from(schema.jarvisScheduledTasks)
        .where(and(eq(schema.jarvisScheduledTasks.id, id), eq(schema.jarvisScheduledTasks.userId, userId)))
        .limit(1);
      if (!task) return res.status(404).json({ error: "Task not found" });

      await db
        .update(schema.jarvisScheduledTasks)
        .set({ needsAttention: true, attentionQuestion })
        .where(and(eq(schema.jarvisScheduledTasks.id, id), eq(schema.jarvisScheduledTasks.userId, userId)));

      try {
        const [link] = await db.select().from(schema.telegramLinks).where(eq(schema.telegramLinks.userId, userId));
        if (link?.chatId) {
          const { sendLongMessage } = await import("./integrations/telegram");
          await sendLongMessage(
            link.chatId,
            `⚠️ Your task *"${task.title}"* needs your guidance:\n\n${attentionQuestion}\n\nReply directly to this message with your answer and I'll take it from there.\n\n[task:${id}]`
          );
        }
      } catch (err) {
        console.error("[Routes] attention telegram notify failed:", err);
      }

      res.json({ ok: true });
    } catch (err) {
      console.error("Error setting task attention:", err);
      res.status(500).json({ error: "Failed to set attention" });
    }
  });

  app.post("/api/jarvis/scheduled-tasks/:id/resolve", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = _p(req.params.id);
      const { userAnswer } = req.body;
      if (!userAnswer) return res.status(400).json({ error: "userAnswer is required" });

      const { resolveScheduledTaskAttention } = await import("./lib/taskResolver");
      const result = await resolveScheduledTaskAttention(userId, id, userAnswer);
      if (!result.ok) {
        return res.status(404).json({ error: result.reason === "not_found" ? "Task not found" : "Task does not need attention" });
      }

      try {
        const [link] = await db.select().from(schema.telegramLinks).where(eq(schema.telegramLinks.userId, userId));
        if (link?.chatId) {
          const { sendLongMessage } = await import("./integrations/telegram");
          await sendLongMessage(
            link.chatId,
            `✅ Got it. I've saved your guidance for *"${result.taskTitle}"* and will apply it next time.`
          );
        }
      } catch (err) {
        console.error("[Routes] resolve telegram ack failed:", err);
      }

      res.json({ ok: true });
    } catch (err) {
      console.error("Error resolving task attention:", err);
      res.status(500).json({ error: "Failed to resolve attention" });
    }
  });

  app.delete("/api/jarvis/scheduled-tasks/:id", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = _p(req.params.id);
      await db
        .delete(schema.jarvisScheduledTasks)
        .where(and(eq(schema.jarvisScheduledTasks.id, id), eq(schema.jarvisScheduledTasks.userId, userId)));
      res.json({ ok: true });
    } catch (err) {
      console.error("Error deleting jarvis scheduled task:", err);
      res.status(500).json({ error: "Failed to delete task" });
    }
  });

  app.post("/api/jarvis/scheduled-tasks/:id/run", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = _p(req.params.id);

      const [task] = await db
        .select()
        .from(schema.jarvisScheduledTasks)
        .where(and(eq(schema.jarvisScheduledTasks.id, id), eq(schema.jarvisScheduledTasks.userId, userId)))
        .limit(1);

      if (!task) return res.status(404).json({ error: "Task not found" });
      if (!task.shellCommand) return res.status(400).json({ error: "Task has no shell command" });

      const { sendDaemonOp, isDesktopDaemonActive, isDaemonActionAllowed } = await import("./daemon/bridge");

      if (!isDesktopDaemonActive(userId)) {
        return res.status(503).json({ error: "Desktop daemon is not connected." });
      }
      const shellAllowed = await isDaemonActionAllowed(userId, "shell");
      if (!shellAllowed) {
        return res.status(403).json({ error: "Shell execution is not permitted on this daemon." });
      }
      const allowOutsideRoot = await isDaemonActionAllowed(userId, "allow_outside_root");
      const timeoutMs = 120_000;
      const startedAt = Date.now();

      let runResult: { ok: boolean; exitCode: number; stdout: string; stderr: string; durationMs: number; error?: string };
      try {
        const daemonResult = await sendDaemonOp(
          userId,
          { type: "shell", cmd: task.shellCommand, timeoutMs, allowOutsideRoot },
          timeoutMs + 5_000,
        );
        const durationMs = Date.now() - startedAt;
        const data = (daemonResult.data || {}) as Record<string, unknown>;
        runResult = {
          ok: daemonResult.ok,
          exitCode: typeof data.code === "number" ? data.code : (daemonResult.ok ? 0 : 1),
          stdout: typeof data.stdout === "string" ? data.stdout : "",
          stderr: typeof data.stderr === "string" ? data.stderr : "",
          durationMs,
        };
      } catch (err) {
        runResult = {
          ok: false,
          exitCode: -1,
          stdout: "",
          stderr: "",
          durationMs: Date.now() - startedAt,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      const ranAt = new Date().toISOString();
      const shellResult = {
        exitCode: runResult.exitCode,
        stdout: runResult.stdout.slice(0, 8000),
        stderr: runResult.stderr.slice(0, 2000),
        durationMs: runResult.durationMs,
        ranAt,
      };

      await db
        .update(schema.jarvisScheduledTasks)
        .set({ lastShellResult: shellResult })
        .where(and(eq(schema.jarvisScheduledTasks.id, id), eq(schema.jarvisScheduledTasks.userId, userId)));

      console.log(`[Routes] Manual run: task id=${id} exit=${runResult.exitCode} dur=${runResult.durationMs}ms`);

      res.json({ ok: true, result: shellResult, error: runResult.error });
    } catch (err) {
      console.error("Error running scheduled task:", err);
      res.status(500).json({ error: "Failed to run task" });
    }
  });

  // ── System schedule: recurring Jarvis CRON tasks (read-only, no auth scope needed) ──
  app.get("/api/jarvis/system-schedule", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const DAYS: Record<number, string> = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };
    const LABELS: Record<string, string> = {
      morning: 'Morning Brief → Telegram',
      commitment_check: 'Commitment Check → Telegram',
      followup_check: 'Follow-Up Check → Telegram',
      momentum_nudge: 'Momentum Nudge → Telegram',
      weekly_planning: 'Weekly Planning Brief → Telegram',
      morning_plan_build: 'Build Today\'s Task Plan',
      email_scan: 'Email Alert Scan',
      weekly_pattern: 'Weekly Pattern Analysis',
    };
    const ICONS: Record<string, string> = {
      morning: 'sunny-outline',
      commitment_check: 'checkmark-circle-outline',
      followup_check: 'refresh-circle-outline',
      momentum_nudge: 'flash-outline',
      weekly_planning: 'calendar-outline',
      morning_plan_build: 'construct-outline',
      email_scan: 'mail-outline',
      weekly_pattern: 'analytics-outline',
    };
    const recurring = [
      { id: 'sys_morning_plan', type: 'morning_plan_build', hour: 7, minute: 0, recurrence: 'daily', dayOfWeek: null },
      { id: 'sys_morning',      type: 'morning',            hour: 8, minute: 0, recurrence: 'daily', dayOfWeek: null },
      { id: 'sys_commit',       type: 'commitment_check',   hour: 10, minute: 0, recurrence: 'daily', dayOfWeek: null },
      { id: 'sys_followup',     type: 'followup_check',     hour: 12, minute: 0, recurrence: 'daily', dayOfWeek: null },
      { id: 'sys_nudge',        type: 'momentum_nudge',     hour: 14, minute: 0, recurrence: 'daily', dayOfWeek: null },
      { id: 'sys_email_scan',   type: 'email_scan',         hour: -1, minute: -1, recurrence: 'every 30 min', dayOfWeek: null },
      { id: 'sys_weekly_plan',  type: 'weekly_planning',    hour: 19, minute: 0, recurrence: 'weekly', dayOfWeek: 0 },
      { id: 'sys_weekly_pat',   type: 'weekly_pattern',     hour: 3,  minute: 0, recurrence: 'weekly', dayOfWeek: 0 },
    ].map(t => ({
      ...t,
      label: LABELS[t.type] ?? t.type,
      icon: ICONS[t.type] ?? 'time-outline',
      timeLabel: t.hour < 0 ? 'Continuous' : `${t.hour === 0 ? 12 : t.hour > 12 ? t.hour - 12 : t.hour}:${String(t.minute).padStart(2, '0')} ${t.hour < 12 ? 'AM' : 'PM'}`,
      dayLabel: t.recurrence === 'weekly' && t.dayOfWeek !== null ? DAYS[t.dayOfWeek] : 'Every day',
      isSystem: true,
    }));
    res.json(recurring);
  });

  // ── Emotional State Engine ────────────────────────────────────────────────────

  app.get("/api/jarvis/emotional-state", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    try {
      const { getEmotionalState } = await import("./intelligence/emotional-state");
      const state = await getEmotionalState(userId);
      res.json(state ?? null);
    } catch (err) {
      console.error("[emotional-state] GET failed:", err);
      res.status(500).json({ error: "Failed to load emotional state" });
    }
  });

  app.post("/api/jarvis/emotional-state/override", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const { override } = req.body;
    const validOverrides = ["calm", "focused", "in flow", "stressed", "overwhelmed"];
    if (!override || !validOverrides.includes(override)) {
      return res.status(400).json({ error: `override must be one of: ${validOverrides.join(", ")}` });
    }
    try {
      const { setManualStateOverride } = await import("./intelligence/emotional-state");
      await setManualStateOverride(userId, override, new Date());
      res.json({ ok: true, override });
    } catch (err) {
      console.error("[emotional-state] override failed:", err);
      res.status(500).json({ error: "Failed to set override" });
    }
  });

  // ── Phase 3: Sub-agent goals API ──────────────────────────────
  app.get("/api/goals", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const [row] = await db
        .select({ data: schema.goals.data })
        .from(schema.goals)
        .where(eq(schema.goals.userId, userId))
        .limit(1);
      res.json({ goals: row?.data ?? [] });
    } catch (err) {
      console.error("Error fetching goals:", err);
      res.status(500).json({ error: "Failed to fetch goals" });
    }
  });

  app.get("/api/goals/pacing", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const dateKey =
        typeof req.query.date === "string" && req.query.date.trim()
          ? req.query.date.trim()
          : new Date().toISOString().slice(0, 10);
      const { getGoalPacingDecision } = await import("./goalScheduler");
      const pacing = await getGoalPacingDecision(userId, dateKey);
      res.json({ ...pacing, date: dateKey });
    } catch (err) {
      console.error("Error fetching goal pacing:", err);
      res.status(500).json({ error: "Failed to fetch goal pacing" });
    }
  });

  app.patch("/api/goals/pacing", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const rawMode = req.body?.mode;
      const mode = normalizeGoalPacingMode(rawMode);
      if (rawMode !== mode) return res.status(400).json({ error: "Invalid goal pacing mode" });

      const [existing] = await db
        .select({ data: schema.userPreferences.data })
        .from(schema.userPreferences)
        .where(eq(schema.userPreferences.userId, userId))
        .limit(1);
      const current = (existing?.data as Record<string, unknown> | undefined) || {};
      const data = { ...current, goalPacingMode: mode };
      await db.insert(schema.userPreferences)
        .values({ userId, data, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: schema.userPreferences.userId,
          set: { data, updatedAt: new Date() },
        });

      const { getGoalPacingDecision } = await import("./goalScheduler");
      const dateKey = new Date().toISOString().slice(0, 10);
      const pacing = await getGoalPacingDecision(userId, dateKey);
      res.json({ ...pacing, date: dateKey });
    } catch (err) {
      console.error("Error updating goal pacing:", err);
      res.status(500).json({ error: "Failed to update goal pacing" });
    }
  });

  app.post("/api/goals/:id/decompose", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const goalId = _p(req.params.id);

      const [goalsRow] = await db
        .select({ data: schema.goals.data })
        .from(schema.goals)
        .where(eq(schema.goals.userId, userId))
        .limit(1);
      const goalsList = (goalsRow?.data as Array<{ id: string; title: string }>) || [];
      const goal = goalsList.find((g) => g.id === goalId);
      if (!goal) return res.status(404).json({ error: "Goal not found" });

      const { enqueueGoalDecomposition } = await import("./agent/goalDecomposer");
      const jobId = await enqueueGoalDecomposition(userId, { id: goal.id, title: goal.title });
      res.json({ ok: true, jobId, status: "queued" });
    } catch (err) {
      console.error("Error queuing goal decompose:", err);
      res.status(500).json({ error: "Failed to queue decomposition" });
    }
  });

  app.get("/api/goals/:id/tree", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const goalId = _p(req.params.id);
      const [tree] = await db
        .select()
        .from(schema.goalTrees)
        .where(and(eq(schema.goalTrees.userId, userId), eq(schema.goalTrees.goalId, goalId)))
        .limit(1);
      if (!tree) return res.status(200).json({ hasTree: false });
      res.json({ hasTree: true, ...tree });
    } catch (err) {
      console.error("Error fetching goal tree:", err);
      res.status(500).json({ error: "Failed to fetch tree" });
    }
  });

  app.patch("/api/goals/:id/tree", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const goalId = _p(req.params.id);
      const action = req.body?.action as GoalTreeEditAction | undefined;
      if (!action || typeof action !== "object" || !("type" in action)) {
        return res.status(400).json({ error: "action is required" });
      }

      const [treeRow] = await db
        .select()
        .from(schema.goalTrees)
        .where(and(eq(schema.goalTrees.userId, userId), eq(schema.goalTrees.goalId, goalId)))
        .limit(1);
      if (!treeRow) return res.status(404).json({ error: "Goal tree not found" });

      const tree = applyGoalTreeEdit(treeRow.tree, action);
      const [updated] = await db
        .update(schema.goalTrees)
        .set({ tree, updatedAt: new Date() })
        .where(and(eq(schema.goalTrees.id, treeRow.id), eq(schema.goalTrees.userId, userId)))
        .returning();

      res.json({
        ok: true,
        hasTree: true,
        ...updated,
        summary: summarizeGoalTree(tree),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update goal tree";
      const status = /not found/i.test(message) ? 404 : /required|invalid/i.test(message) ? 400 : 500;
      if (status === 500) console.error("Error updating goal tree:", err);
      res.status(status).json({ error: message });
    }
  });

  app.post("/api/goals/:id/tree/tasks/:taskId/add-to-today", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const goalId = _p(req.params.id);
      const taskId = _p(req.params.taskId);
      const todayKey = new Date().toISOString().slice(0, 10);

      const [treeRow] = await db
        .select()
        .from(schema.goalTrees)
        .where(and(eq(schema.goalTrees.userId, userId), eq(schema.goalTrees.goalId, goalId)))
        .limit(1);
      if (!treeRow) return res.status(404).json({ error: "Goal tree not found" });

      const tree = treeRow.tree || { phases: [] };
      let pick: InjectableGoalTask | null = null;
      for (const phase of tree.phases || []) {
        for (const milestone of phase.milestones || []) {
          const task = (milestone.tasks || []).find((t) => t.id === taskId);
          if (!task) continue;
          if (task.status === "complete") {
            return res.status(409).json({ error: "Goal task is already complete" });
          }
          if (task.status === "blocked") {
            return res.status(400).json({ error: "Goal task is blocked" });
          }
          pick = {
            goalTreeId: treeRow.id,
            goalTitle: treeRow.title,
            phaseId: phase.id,
            milestoneId: milestone.id,
            taskId: task.id,
            title: task.title,
            description: task.description,
            estimateHours: task.estimateHours,
          };
          break;
        }
        if (pick) break;
      }
      if (!pick) return res.status(404).json({ error: "Goal task not found" });

      const [planRow] = await db
        .select({ data: schema.plans.data })
        .from(schema.plans)
        .where(and(eq(schema.plans.userId, userId), eq(schema.plans.date, todayKey)))
        .limit(1);
      const currentPlan = (planRow?.data as { date?: string; tasks?: Record<string, unknown>[] } | undefined) || {
        date: todayKey,
        tasks: [],
        greeting: "",
        insight: "",
      };
      const merged = mergeGoalTaskIntoPlan(currentPlan, pick, todayKey);

      await db.insert(schema.plans)
        .values({ userId, date: todayKey, data: merged.plan, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [schema.plans.userId, schema.plans.date],
          set: { data: merged.plan, updatedAt: new Date() },
        });
      await markTasksInjected(userId, [pick], todayKey);

      res.json({
        ok: true,
        inserted: merged.inserted,
        date: todayKey,
        task: merged.task,
      });
    } catch (err) {
      console.error("Error adding goal task to today:", err);
      res.status(500).json({ error: "Failed to add goal task to today" });
    }
  });

  app.post("/api/agent-jobs", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { agentType, title, prompt, input } = req.body as {
        agentType?: string;
        title?: string;
        prompt?: string;
        input?: Record<string, unknown>;
      };
      const allowed = ["research", "writing", "planning", "email", "goal_decompose"] as const;
      if (!agentType || !allowed.includes(agentType as (typeof allowed)[number])) {
        return res.status(400).json({ error: `agentType must be one of ${allowed.join(", ")}` });
      }
      if (!title || !prompt) {
        return res.status(400).json({ error: "title and prompt are required" });
      }
      const { submitAgentJob } = await import("./agent/jobQueue");
      const { id: jobId } = await submitAgentJob({
        userId,
        agentType: agentType as (typeof allowed)[number],
        title,
        prompt,
        input: input || {},
      });
      res.json({ ok: true, jobId, status: "queued" });
    } catch (err) {
      console.error("Error submitting agent job:", err);
      res.status(500).json({ error: "Failed to submit job" });
    }
  });

  app.get("/api/agent-jobs", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
      const status = typeof req.query.status === "string" ? req.query.status : null;
      const where = status
        ? and(eq(schema.agentJobs.userId, userId), eq(schema.agentJobs.status, status))
        : eq(schema.agentJobs.userId, userId);
      const jobs = await db
        .select()
        .from(schema.agentJobs)
        .where(where)
        .orderBy(desc(schema.agentJobs.createdAt))
        .limit(limit);
      const { attachJobReviewState } = await import("./agent/reviewLoop");
      res.json(jobs.map(attachJobReviewState));
    } catch (err) {
      console.error("Error listing agent jobs:", err);
      res.status(500).json({ error: "Failed to list jobs" });
    }
  });

  app.get("/api/agent-jobs/active", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const jobs = await db
        .select()
        .from(schema.agentJobs)
        .where(
          and(
            eq(schema.agentJobs.userId, userId),
            sql`${schema.agentJobs.status} IN ('queued', 'running', 'cancelling')`,
          ),
        )
        .orderBy(asc(schema.agentJobs.createdAt))
        .limit(20);
      const { attachJobReviewState } = await import("./agent/reviewLoop");
      res.json(jobs.map(attachJobReviewState));
    } catch (err) {
      console.error("Error listing active agent jobs:", err);
      res.status(500).json({ error: "Failed to list active jobs" });
    }
  });

  app.get("/api/agent-jobs/observability", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const jobs = await db
        .select()
        .from(schema.agentJobs)
        .where(eq(schema.agentJobs.userId, userId))
        .orderBy(desc(schema.agentJobs.createdAt))
        .limit(80);
      const { getRecentEvents } = await import("./diagnostics/diagnosticsService");
      const { buildJobRunnerObservability } = await import("./agent/jobObservability");
      const diagnosticEvents = await getRecentEvents({
        userId,
        subsystem: "job_queue",
        limit: 20,
        sinceMinutes: 60,
        excludePatternDetected: true,
      });
      res.json(buildJobRunnerObservability({ jobs, diagnosticEvents }));
    } catch (err) {
      console.error("Error building agent job observability report:", err);
      res.status(500).json({ error: "Failed to build job observability report" });
    }
  });

  app.post("/api/agent-jobs/:id/cancel", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = _p(req.params.id);
      const [job] = await db
        .select()
        .from(schema.agentJobs)
        .where(and(eq(schema.agentJobs.id, id), eq(schema.agentJobs.userId, userId)))
        .limit(1);
      if (!job) return res.status(404).json({ error: "Job not found" });
      if (job.status === "complete" || job.status === "failed") {
        return res.status(400).json({ error: "Job is already finished" });
      }
      if (job.status === "cancelled" || job.status === "cancelling") {
        return res.json({ ok: true, status: job.status });
      }
      const newStatus = job.status === "queued" ? "cancelled" : "cancelling";
      await db
        .update(schema.agentJobs)
        .set({ status: newStatus, completedAt: newStatus === "cancelled" ? new Date() : undefined })
        .where(eq(schema.agentJobs.id, id));
      res.json({ ok: true, status: newStatus });
    } catch (err) {
      console.error("Error cancelling agent job:", err);
      res.status(500).json({ error: "Failed to cancel job" });
    }
  });

  app.post("/api/agent-jobs/:id/retry", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = _p(req.params.id);
      const [job] = await db
        .select()
        .from(schema.agentJobs)
        .where(and(eq(schema.agentJobs.id, id), eq(schema.agentJobs.userId, userId)))
        .limit(1);
      if (!job) return res.status(404).json({ error: "Job not found" });
      if (!["failed", "cancelled"].includes(job.status)) {
        return res.status(400).json({ error: "Only failed or cancelled jobs can be retried" });
      }

      const { submitAgentJob } = await import("./agent/jobQueue");
      const input = job.input && typeof job.input === "object" && !Array.isArray(job.input)
        ? { ...(job.input as Record<string, unknown>) }
        : {};
      delete input.retryCount;
      const retry = await submitAgentJob({
        userId,
        agentType: job.agentType as any,
        title: job.title,
        prompt: job.prompt,
        input: {
          ...input,
          retryOfJobId: job.id,
          retriedAt: new Date().toISOString(),
        },
      });

      res.json({ ok: true, jobId: retry.id, isDuplicate: retry.isDuplicate, status: "queued" });
    } catch (err) {
      console.error("Error retrying agent job:", err);
      res.status(500).json({ error: "Failed to retry job" });
    }
  });

  app.get("/api/deliverables", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const triageSection = typeof req.query.triageSection === "string" ? req.query.triageSection : null;

      if (triageSection === "auto_handled") {
        // Return recently auto-handled / promoted-to-memory items (last 48 h)
        const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
        const items = await db
          .select()
          .from(schema.deliverables)
          .where(
            and(
              eq(schema.deliverables.userId, userId),
              eq(schema.deliverables.status, "approved"),
              gte(schema.deliverables.actedAt, since),
              sql`${schema.deliverables.triageStatus} IN ('auto_handled', 'promoted_memory')`
            )
          )
          .orderBy(desc(schema.deliverables.createdAt))
          .limit(20);
        const { attachDeliverableReviewState } = await import("./agent/reviewLoop");
        return res.json(items.map(attachDeliverableReviewState));
      }

      const status = typeof req.query.status === "string" ? req.query.status : "pending_approval";
      const items = await db
        .select()
        .from(schema.deliverables)
        .where(and(eq(schema.deliverables.userId, userId), eq(schema.deliverables.status, status)))
        .orderBy(desc(schema.deliverables.createdAt))
        .limit(50);
      const { attachDeliverableReviewState } = await import("./agent/reviewLoop");
      res.json(items.map(attachDeliverableReviewState));
    } catch (err) {
      console.error("Error listing deliverables:", err);
      res.status(500).json({ error: "Failed to list deliverables" });
    }
  });

  const { registerDeliverableReviewRoutes } = await import("./agent/deliverableReviewHttpRoutes");
  registerDeliverableReviewRoutes(app, { db });

  registerDocumentRoutes(app);

  app.post("/api/website-crawl", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { url } = req.body;
      if (!url || typeof url !== "string") return res.status(400).json({ error: "url is required" });
      let normalized = url.trim();
      if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
        normalized = "https://" + normalized;
      }
      const { startWebsiteCrawl } = await import("./websiteCrawler");
      const crawledAt = new Date();
      await db
        .insert(schema.websiteCrawls)
        .values({ userId, url: normalized, status: "crawling", pageCount: 0, summary: null, crawledAt })
        .onConflictDoUpdate({
          target: schema.websiteCrawls.userId,
          set: { url: normalized, status: "crawling", pageCount: 0, summary: null, crawledAt },
        });
      startWebsiteCrawl(userId, normalized).catch((err) => console.error("[website-crawl] background error:", err));
      res.json({ status: "crawling", url: normalized, pageCount: 0, summary: null, crawledAt });
    } catch (error) {
      console.error("Error starting website crawl:", error);
      res.status(500).json({ error: "Failed to start crawl" });
    }
  });

  app.get("/api/website-crawl", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const rows = await db.select().from(schema.websiteCrawls).where(eq(schema.websiteCrawls.userId, userId)).limit(1);
      if (rows.length === 0) return res.json({ status: "idle" });
      const row = rows[0];
      res.json({
        status: row.status,
        url: row.url,
        pageCount: row.pageCount,
        summary: row.summary,
        crawledAt: row.crawledAt,
      });
    } catch (error) {
      console.error("Error fetching website crawl:", error);
      res.status(500).json({ error: "Failed to fetch crawl status" });
    }
  });

  app.delete("/api/website-crawl", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      await db.delete(schema.websiteCrawls).where(eq(schema.websiteCrawls.userId, userId));
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting website crawl:", error);
      res.status(500).json({ error: "Failed to delete crawl" });
    }
  });

  app.get("/api/chatgpt-import/status", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const rows = await db.select().from(schema.chatgptImports).where(eq(schema.chatgptImports.userId, userId));
      if (rows.length === 0) {
        return res.json({ imported: false });
      }
      const row = rows[0];
      res.json({ imported: true, importedAt: row.importedAt, memoriesAdded: row.memoriesAdded });
    } catch (error) {
      console.error("Error getting ChatGPT import status:", error);
      res.status(500).json({ error: "Failed to get import status" });
    }
  });

  app.post("/api/chatgpt-import", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { conversations } = req.body;
      if (!conversations || !Array.isArray(conversations) || conversations.length === 0) {
        return res.status(400).json({ error: "No conversations found. Please upload a valid ChatGPT export file." });
      }

      const recentConversations = conversations.slice(-150);

      const allTexts: string[] = [];
      for (const convo of recentConversations) {
        const lines: string[] = [];
        if (convo.title) lines.push(`[Conversation: ${convo.title}]`);

        if (convo.messages && Array.isArray(convo.messages)) {
          for (const msg of convo.messages) {
            if (msg.role && msg.text && typeof msg.text === 'string') {
              lines.push(`${msg.role}: ${msg.text.slice(0, 500)}`);
            }
          }
        } else if (convo.mapping && typeof convo.mapping === 'object') {
          const nodes = (Object.values(convo.mapping) as any[])
            .filter((n: any) => n?.message?.create_time)
            .sort((a: any, b: any) => (a.message.create_time || 0) - (b.message.create_time || 0));
          const unsortedNodes = (Object.values(convo.mapping) as any[])
            .filter((n: any) => !n?.message?.create_time);
          for (const node of [...nodes, ...unsortedNodes]) {
            const msg = node?.message;
            if (!msg || !msg.content?.parts) continue;
            const role = msg.author?.role;
            if (role !== 'user' && role !== 'assistant') continue;
            const text = msg.content.parts
              .filter((p: any) => typeof p === 'string')
              .join(' ')
              .trim();
            if (text.length > 0) {
              lines.push(`${role}: ${text.slice(0, 500)}`);
            }
          }
        }

        if (lines.length > 1) {
          allTexts.push(lines.join('\n'));
        }
      }

      if (allTexts.length === 0) {
        return res.status(400).json({ error: "No readable conversations found in the file." });
      }

      const existingRows = await db.select({ content: userMemories.content })
        .from(userMemories)
        .where(eq(userMemories.userId, userId));
      const existingMemories = existingRows.map(r => r.content);
      const normalizedExisting = new Set(existingMemories.map(normalizeMemoryContent));

      const batchSize = 10;
      let totalAdded = 0;
      const validCategories = ['personality', 'values', 'work_style', 'accomplishment', 'goal_discovered', 'relationship', 'pattern', 'preference', 'fact', 'goal', 'achievement'];

      for (let i = 0; i < allTexts.length; i += batchSize) {
        const batch = allTexts.slice(i, i + batchSize);
        const batchText = batch.join('\n\n---\n\n').slice(0, 12000);

        const currentMemories = [...existingMemories];
        const existingList = currentMemories.length > 0
          ? `\nExisting memories (DO NOT duplicate these):\n${currentMemories.map(m => `- ${m}`).join('\n')}`
          : '';

        const prompt = `You are extracting profile facts about a user from their ChatGPT conversation history.
Output a JSON array of { category, content } objects. Only extract facts that are specific, meaningful, and not already captured.
Focus on discovering: personality traits, values, work patterns, goals, relationships, preferences, and recurring behaviors.

Categories:
- personality — how they communicate, humor, energy, decision style
- values — what they care about deeply, what motivates them
- work_style — when/how they focus, work patterns, tools they use
- accomplishment — wins, achievements, proud moments mentioned
- goal_discovered — goals inferred from behavior (not just stated)
- relationship — key people in their life (family, teammates, boss)
- pattern — recurring behaviors, habits, tendencies
- preference — explicit preferences (meeting times, communication style, etc.)
- fact — general facts about the user
- goal — explicitly stated goals
- achievement — specific achievements mentioned
${existingList}

Conversations:
${batchText}

Return JSON: { "memories": [{"content": "string describing the fact", "category": "one of the categories above"}] }
Return { "memories": [] } if nothing new was learned. Do NOT repeat or rephrase existing memories.
Extract up to 8 memories per batch.`;

        try {
          const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
            max_completion_tokens: 800,
          });

          const content = response.choices[0]?.message?.content || '{"memories":[]}';
          const parsed = JSON.parse(content);
          const rawMemories = Array.isArray(parsed.memories) ? parsed.memories : (Array.isArray(parsed) ? parsed : []);
          const newMemories = rawMemories.slice(0, 8);

          for (const mem of newMemories) {
            if (!mem.content || typeof mem.content !== 'string' || mem.content.trim().length === 0) continue;
            const normalized = normalizeMemoryContent(mem.content);
            if (normalizedExisting.has(normalized)) continue;
            const category = validCategories.includes(mem.category) ? mem.category : 'fact';
            await db.insert(userMemories).values({
              userId,
              content: mem.content.trim(),
              category,
            });
            normalizedExisting.add(normalized);
            existingMemories.push(mem.content.trim());
            totalAdded++;
            console.log(`[ChatGPT Import] Extracted: [${category}] ${mem.content.trim().slice(0, 60)}...`);
          }
        } catch (err) {
          console.error("[ChatGPT Import] Batch extraction error:", err);
        }
      }

      await db.insert(schema.chatgptImports)
        .values({ userId, importedAt: new Date(), memoriesAdded: totalAdded })
        .onConflictDoUpdate({
          target: [schema.chatgptImports.userId],
          set: { importedAt: new Date(), memoriesAdded: totalAdded },
        });

      console.log(`[ChatGPT Import] User ${userId}: imported ${totalAdded} memories from ${allTexts.length} conversations`);
      res.json({ imported: totalAdded, importedAt: new Date().toISOString() });
    } catch (error) {
      console.error("Error importing ChatGPT history:", error);
      res.status(500).json({ error: "Failed to import ChatGPT history" });
    }
  });

  // ── Jarvis Build History — Config ────────────────────────────────────────

  app.get("/api/jarvis/builds", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    try {
      const rows = await db
        .select()
        .from(schema.agentBuildLog)
        .where(eq(schema.agentBuildLog.userId, userId))
        .orderBy(desc(schema.agentBuildLog.createdAt))
        .limit(50);
      res.json({ builds: rows });
    } catch (err) {
      console.error("[jarvis] GET builds failed:", err);
      res.status(500).json({ error: "Failed to load build log" });
    }
  });

  // ── Nervous System — Watch Topics ────────────────────────────────────────

  app.get("/api/nervous-system/watches", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    try {
      const watches = await db
        .select()
        .from(schema.nervousSystemWatches)
        .where(eq(schema.nervousSystemWatches.userId, userId))
        .orderBy(schema.nervousSystemWatches.createdAt);
      res.json(watches);
    } catch (err) {
      console.error("[NervousSystem] watches fetch failed:", err);
      res.status(500).json({ error: "Failed to fetch watches" });
    }
  });

  const VALID_NS_CATEGORIES = new Set(["keyword", "company", "person", "industry"]);

  app.post("/api/nervous-system/watches", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const { label, category } = req.body as { label?: string; category?: string };
    if (!label?.trim()) return res.status(400).json({ error: "label is required" });
    const cat = category && VALID_NS_CATEGORIES.has(category) ? category : "keyword";
    try {
      const [watch] = await db
        .insert(schema.nervousSystemWatches)
        .values({ userId, label: label.trim(), category: cat })
        .returning();
      res.json(watch);
    } catch (err) {
      console.error("[NervousSystem] watch create failed:", err);
      res.status(500).json({ error: "Failed to create watch" });
    }
  });

  app.patch("/api/nervous-system/watches/:id", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const id = _p(req.params.id);
    const { active, label, category } = req.body as { active?: boolean; label?: string; category?: string };
    try {
      const updates: Partial<typeof schema.nervousSystemWatches.$inferInsert> = {};
      if (typeof active === "boolean") updates.active = active;
      if (label?.trim()) updates.label = label.trim();
      if (category !== undefined) {
        updates.category = VALID_NS_CATEGORIES.has(category) ? category : "keyword";
      }
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }
      const [updated] = await db
        .update(schema.nervousSystemWatches)
        .set(updates)
        .where(and(eq(schema.nervousSystemWatches.id, id), eq(schema.nervousSystemWatches.userId, userId)))
        .returning();
      if (!updated) return res.status(404).json({ error: "Watch not found" });
      res.json(updated);
    } catch (err) {
      console.error("[NervousSystem] watch update failed:", err);
      res.status(500).json({ error: "Failed to update watch" });
    }
  });

  app.delete("/api/nervous-system/watches/:id", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const id = _p(req.params.id);
    try {
      await db
        .delete(schema.nervousSystemWatches)
        .where(and(eq(schema.nervousSystemWatches.id, id), eq(schema.nervousSystemWatches.userId, userId)));
      res.json({ ok: true });
    } catch (err) {
      console.error("[NervousSystem] watch delete failed:", err);
      res.status(500).json({ error: "Failed to delete watch" });
    }
  });

  app.get("/api/nervous-system/signals", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const parsedLimit = parseInt((req.query.limit as string) || "20", 10);
    const limit = Math.min(50, Number.isNaN(parsedLimit) || parsedLimit < 1 ? 20 : parsedLimit);
    try {
      const signals = await db
        .select()
        .from(schema.nervousSystemSignals)
        .where(eq(schema.nervousSystemSignals.userId, userId))
        .orderBy(sql`${schema.nervousSystemSignals.createdAt} DESC`)
        .limit(limit);
      res.json(signals);
    } catch (err) {
      console.error("[NervousSystem] signals fetch failed:", err);
      res.status(500).json({ error: "Failed to fetch signals" });
    }
  });

  // ── Jarvis Gut — Reflexive Anomaly Detection ────────────────────────────────

  app.get("/api/gut/signals", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const includeResponded = req.query.includeResponded === "true";
    const parsedLimit = parseInt((req.query.limit as string) || "50", 10);
    const limit = Math.min(100, Number.isNaN(parsedLimit) || parsedLimit < 1 ? 50 : parsedLimit);
    try {
      const { getGutSignalsForUser } = await import("./intelligence/gut");
      const signals = await getGutSignalsForUser(userId, { limit, includeResponded });
      res.json(signals);
    } catch (err) {
      console.error("[Gut] signals fetch failed:", err);
      res.status(500).json({ error: "Failed to fetch gut signals" });
    }
  });

  app.get("/api/gut/signals/item/:itemRef", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const itemRef = _p(req.params.itemRef);
    try {
      const { getGutSignalsForUser } = await import("./intelligence/gut");
      const signals = await getGutSignalsForUser(userId, { itemRef, includeResponded: false });
      res.json(signals);
    } catch (err) {
      console.error("[Gut] item signals fetch failed:", err);
      res.status(500).json({ error: "Failed to fetch gut signals for item" });
    }
  });

  app.post("/api/gut/signals/:id/respond", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const id = _p(req.params.id);
    const { response } = req.body as { response?: string };
    const VALID_RESPONSES = ["confirmed", "dismissed", "ignored"];
    if (!response || !VALID_RESPONSES.includes(response)) {
      return res.status(400).json({ error: "response must be confirmed, dismissed, or ignored" });
    }
    try {
      const { respondToGutSignal } = await import("./intelligence/gut");
      await respondToGutSignal(userId, id, response as schema.GutUserResponse);
      res.json({ ok: true });
    } catch (err) {
      console.error("[Gut] respond failed:", err);
      res.status(500).json({ error: "Failed to store response" });
    }
  });

  app.get("/api/gut/threat-log", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const parsedLimit = parseInt((req.query.limit as string) || "30", 10);
    const limit = Math.min(100, Number.isNaN(parsedLimit) || parsedLimit < 1 ? 30 : parsedLimit);
    try {
      const rows = await db
        .select()
        .from(schema.gutSignals)
        .where(eq(schema.gutSignals.userId, userId))
        .orderBy(desc(schema.gutSignals.createdAt))
        .limit(limit);
      res.json(rows);
    } catch (err) {
      console.error("[Gut] threat-log fetch failed:", err);
      res.status(500).json({ error: "Failed to fetch threat log" });
    }
  });

  registerSettingsRoutes(app);
  // The provider endpoints keep the /api/auth contract but authMiddleware skips
  // that prefix, so authenticate them explicitly with the bearer-token helper.
  registerOpenAIProviderAuthRoutes(app, {
    includeCallbackRoutes: false,
    resolveUserId: getUserIdFromRequest,
  });

  // ── Skill endpoints ──────────────────────────────────────────────────────
  app.get("/api/skills", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { listUserSkills, getUserSkillSignals } = await import("./intelligence/skillWriter");
      const [skills, signals] = await Promise.all([
        listUserSkills(userId),
        Promise.resolve(getUserSkillSignals(userId)),
      ]);
      res.json({ skills, signals });
    } catch (err) {
      console.error("[Skills] GET /api/skills failed:", err);
      res.status(500).json({ error: "Failed to list skills" });
    }
  });

  // ── Skill Store — user-facing pack endpoints ─────────────────────────────
  /**
   * GET /api/skill-packs
   * List all store-visible packs with the current user's activation status.
   */
  app.get("/api/skill-packs", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { listStorePacksForUser } = await import("./intelligence/behaviorStore");
      const packs = await listStorePacksForUser(userId);
      res.json({ packs });
    } catch (err) {
      console.error("[SkillStore] list failed:", err);
      res.status(500).json({ error: "Failed to list skill packs" });
    }
  });

  /**
   * GET /api/skill-packs/:packId
   * Fetch a single store-visible pack with the current user's activation status.
   */
  app.get("/api/skill-packs/:packId", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const packId = _p(req.params.packId);
    try {
      const { getStorePackById } = await import("./intelligence/behaviorStore");
      const pack = await getStorePackById(packId, userId);
      if (!pack) return res.status(404).json({ error: "Pack not found" });
      res.json(pack);
    } catch (err) {
      console.error("[Routes] GET /api/skill-packs/:packId error:", err);
      res.status(500).json({ error: "Failed to fetch skill pack" });
    }
  });

  /**
   * POST /api/skill-packs/:packId/activate
   * Activate a pack for the current user.
   */
  app.post("/api/skill-packs/:packId/activate", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const packId = _p(req.params.packId);
    try {
      const { setUserPackActive } = await import("./intelligence/behaviorStore");
      await setUserPackActive(userId, packId, true);
      res.json({ ok: true });
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      if (msg.includes("not found")) return res.status(404).json({ error: msg });
      if (msg.includes("not a store-visible")) return res.status(400).json({ error: msg });
      console.error("[SkillStore] activate failed:", err);
      res.status(500).json({ error: "Failed to activate pack" });
    }
  });

  /**
   * DELETE /api/skill-packs/:packId/activate
   * Deactivate a pack for the current user.
   */
  app.delete("/api/skill-packs/:packId/activate", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const packId = _p(req.params.packId);
    try {
      const { setUserPackActive } = await import("./intelligence/behaviorStore");
      await setUserPackActive(userId, packId, false);
      res.json({ ok: true });
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      if (msg.includes("not found")) return res.status(404).json({ error: msg });
      if (msg.includes("not a store-visible")) return res.status(400).json({ error: msg });
      console.error("[SkillStore] deactivate failed:", err);
      res.status(500).json({ error: "Failed to deactivate pack" });
    }
  });

  app.delete("/api/skills/:skillId", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const skillId = _p(req.params.skillId);
    try {
      const { deleteSkill } = await import("./intelligence/skillWriter");
      const deleted = await deleteSkill(userId, skillId);
      if (!deleted) return res.status(404).json({ error: "Skill not found" });
      res.json({ ok: true });
    } catch (err) {
      console.error("[Skills] DELETE /api/skills/:skillId failed:", err);
      res.status(500).json({ error: "Failed to delete skill" });
    }
  });

  // ── User Skills (Task #502) — DB-backed personalisation skills ───────────
  // Built-in library of curated skills + user-authored custom skills.
  // Active skills are injected into Jarvis's system prompt at session start.

  const BUILT_IN_SKILLS = [
    {
      name: "Morning Ritual",
      emoji: "🌅",
      description: "Start each morning with a grounding check-in before diving into tasks.",
      instructions: "When the user first messages you in the morning (before 10 AM local time, or when context suggests it's the start of their day), open with a brief energy check: ask how they're feeling and what their top 1-3 intentions are for the day. Keep it to 2 sentences max. Only do this once per day — if they've already mentioned their day is underway, skip it. Use their answer to frame your subsequent suggestions.",
    },
    {
      name: "Finance Awareness",
      emoji: "💰",
      description: "Factor budget and financial goals into every recommendation.",
      instructions: "Before recommending any action that involves spending money, time, or resources, briefly consider whether it aligns with sensible financial habits. If the user mentions a purchase, subscription, or expense, acknowledge it and (where natural) ask if it fits their current priorities. Never lecture — one gentle nudge is enough. If the user has shared financial goals in their memory, use them as context.",
    },
    {
      name: "Stoic Coach",
      emoji: "🏛️",
      description: "Offer stoic reframes when the user is stressed or frustrated.",
      instructions: "When the user expresses frustration, anxiety, or worry, offer a brief stoic reframe: focus on what is within their control, acknowledge what is not, and suggest one concrete next action. Keep it short — two to three sentences. Do not be preachy. The goal is to help them regain agency, not to lecture. Use stoic language naturally, not as a performance.",
    },
    {
      name: "Deadline Hawk",
      emoji: "🦅",
      description: "Proactively surface deadlines and flag tasks that are running late.",
      instructions: "Always be alert to deadlines. When a task, commitment, or deliverable is mentioned, ask if it has a due date if one hasn't been provided. When you are aware of upcoming deadlines in the user's calendar or commitments, proactively surface them — especially if they are within 48 hours. Flag tasks that are approaching or past their deadline with a clear, calm heads-up, not an alarm.",
    },
    {
      name: "Deep Work Mode",
      emoji: "🎯",
      description: "Protect focus blocks and minimise interruptions during deep work.",
      instructions: "During focus blocks or when the user indicates they are in deep work mode, minimise suggestions that would break their flow. Batch non-urgent items for later review. Keep your replies short and action-oriented. If the user asks a question mid-flow, answer it concisely and return them to their task. Do not proactively surface new items or distractions during a focus session.",
    },
    {
      name: "Weekly Review",
      emoji: "📊",
      description: "Prompt a structured weekly reflection on Fridays or Sundays.",
      instructions: "On Fridays or Sundays (or when the user mentions end-of-week), prompt a brief structured review: wins from the week, open loops to close, and one key intention for the coming week. Keep the review to three questions max — do not make it feel like a chore. Help the user close out their week with clarity, not more to-dos.",
    },
    {
      name: "Gratitude Practice",
      emoji: "🙏",
      description: "Gently invite the user to note one thing they're grateful for each day.",
      instructions: "Once per day, find a natural moment to briefly invite the user to name one thing they are grateful for. Keep the prompt to a single sentence and make it feel light, not mandatory. Warmly acknowledge their response with a single sentence. Never push if they seem busy or decline — skip it and try again another time.",
    },
    {
      name: "Fitness Check-in",
      emoji: "💪",
      description: "Suggest movement and breaks when energy or wellbeing seems low.",
      instructions: "When the user mentions feeling tired, drained, or stuck, gently ask if they have moved their body today. Suggest short movement breaks (a 5-minute walk, stretching) when patterns suggest they have been sitting for a long time. Keep suggestions brief — one sentence. Do not nag. If they have already exercised or decline, acknowledge it and move on.",
    },
    {
      name: "Communication Filter",
      emoji: "🔍",
      description: "Help the user communicate clearly and with the right tone.",
      instructions: "When reviewing or helping draft emails, messages, or important communications, pay attention to tone, clarity, and potential for misinterpretation. If you notice something that might land poorly or be unclear, note it briefly before sending — one sentence is enough. Suggest one concrete improvement if needed. The goal is thoughtful communication, not perfection.",
    },
    {
      name: "Energy Management",
      emoji: "⚡",
      description: "Protect the user's peak hours and help them manage energy across the day.",
      instructions: "Pay attention to mentions of the user's energy levels across conversations. When they seem depleted, suggest tackling their most important work during peak hours (usually morning for most people) and protecting those times from meetings and reactive tasks. Gently remind them that rest is productive. When they mention being overwhelmed, suggest doing one thing at a time rather than multitasking.",
    },
  ];

  /**
   * GET /api/user-skills
   * Returns all skills for this user (built-in seeded + custom). Seeds the
   * built-in library on first call for new users.
   */
  app.get("/api/user-skills", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { userSkills } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");

      const existing = await db.select().from(userSkills).where(eq(userSkills.userId, userId));

      // Seed built-in skills on first visit (idempotent: onConflictDoNothing guards
      // the partial unique index user_skills_builtin_name_uniq so concurrent
      // first-time requests cannot create duplicate built-ins).
      const existingBuiltInNames = new Set(
        existing.filter((s) => s.isBuiltIn).map((s) => s.name),
      );
      const toSeed = BUILT_IN_SKILLS.filter((s) => !existingBuiltInNames.has(s.name));
      if (toSeed.length > 0) {
        await db
          .insert(userSkills)
          .values(
            toSeed.map((s) => ({
              userId,
              name: s.name,
              emoji: s.emoji,
              description: s.description,
              instructions: s.instructions,
              isBuiltIn: true,
              isActive: false,
            })),
          )
          .onConflictDoNothing();
        const fresh = await db.select().from(userSkills).where(eq(userSkills.userId, userId));
        return res.json({ skills: fresh });
      }

      res.json({ skills: existing });
    } catch (err) {
      console.error("[UserSkills] GET failed:", err);
      res.status(500).json({ error: "Failed to list skills" });
    }
  });

  /**
   * POST /api/user-skills
   * Create a new custom skill.
   */
  app.post("/api/user-skills", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const { name, emoji, description, instructions } = req.body as {
      name?: string;
      emoji?: string;
      description?: string;
      instructions?: string;
    };
    if (!name || !instructions) {
      return res.status(400).json({ error: "name and instructions are required" });
    }
    try {
      const { userSkills } = await import("@shared/schema");
      const [skill] = await db
        .insert(userSkills)
        .values({
          userId,
          name: name.trim().slice(0, 80),
          emoji: (emoji ?? "⚡").slice(0, 8),
          description: (description ?? "").trim().slice(0, 200),
          instructions: instructions.trim().slice(0, 3000),
          isBuiltIn: false,
          isActive: true,
        })
        .returning();
      res.status(201).json({ skill });
    } catch (err) {
      console.error("[UserSkills] POST failed:", err);
      res.status(500).json({ error: "Failed to create skill" });
    }
  });

  /**
   * PATCH /api/user-skills/:id/toggle
   * Toggle a skill's isActive state.
   */
  app.patch("/api/user-skills/:id/toggle", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const id = _p(req.params.id);
    try {
      const { userSkills } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const [existing] = await db
        .select()
        .from(userSkills)
        .where(and(eq(userSkills.id, id), eq(userSkills.userId, userId)))
        .limit(1);
      if (!existing) return res.status(404).json({ error: "Skill not found" });
      const [updated] = await db
        .update(userSkills)
        .set({ isActive: !existing.isActive, updatedAt: new Date() })
        .where(and(eq(userSkills.id, id), eq(userSkills.userId, userId)))
        .returning();
      res.json({ skill: updated });
    } catch (err) {
      console.error("[UserSkills] PATCH toggle failed:", err);
      res.status(500).json({ error: "Failed to toggle skill" });
    }
  });

  /**
   * PATCH /api/user-skills/:id
   * Update name, description, instructions, and/or emoji for a custom skill.
   * Built-in skills cannot be modified via this endpoint.
   */
  app.patch("/api/user-skills/:id", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const id = _p(req.params.id);
    const { name, description, instructions, emoji } = req.body as {
      name?: string; description?: string; instructions?: string; emoji?: string;
    };
    try {
      const { userSkills } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const [existing] = await db
        .select()
        .from(userSkills)
        .where(and(eq(userSkills.id, id), eq(userSkills.userId, userId)))
        .limit(1);
      if (!existing) return res.status(404).json({ error: "Skill not found" });
      if (existing.isBuiltIn) return res.status(400).json({ error: "Built-in skills cannot be modified" });
      const updates: Partial<typeof existing> = {};
      if (name?.trim()) updates.name = name.trim().slice(0, 80);
      if (description !== undefined) updates.description = description.trim().slice(0, 200);
      if (instructions?.trim()) updates.instructions = instructions.trim().slice(0, 3000);
      if (emoji?.trim()) updates.emoji = emoji.trim().slice(0, 8);
      if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No fields to update" });
      const [updated] = await db
        .update(userSkills)
        .set(updates)
        .where(and(eq(userSkills.id, id), eq(userSkills.userId, userId)))
        .returning();
      res.json({ skill: updated });
    } catch (err) {
      console.error("[UserSkills] PATCH update failed:", err);
      res.status(500).json({ error: "Failed to update skill" });
    }
  });

  /**
   * DELETE /api/user-skills/:id
   * Delete a custom skill (built-in skills cannot be deleted).
   */
  app.delete("/api/user-skills/:id", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const id = _p(req.params.id);
    try {
      const { userSkills } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const [existing] = await db
        .select()
        .from(userSkills)
        .where(and(eq(userSkills.id, id), eq(userSkills.userId, userId)))
        .limit(1);
      if (!existing) return res.status(404).json({ error: "Skill not found" });
      if (existing.isBuiltIn) return res.status(400).json({ error: "Built-in skills cannot be deleted" });
      await db
        .delete(userSkills)
        .where(and(eq(userSkills.id, id), eq(userSkills.userId, userId)));
      res.json({ ok: true });
    } catch (err) {
      console.error("[UserSkills] DELETE failed:", err);
      res.status(500).json({ error: "Failed to delete skill" });
    }
  });

  // ── Skill Candidates (Task #872) ────────────────────────────────────────
  // Routes are registered at both the canonical path (/api/skills/candidates)
  // and the legacy path (/api/skill-candidates) for backward compatibility.
  /**
   * GET /api/skills/candidates   (canonical)
   * GET /api/skill-candidates    (legacy alias)
   * Returns all pending skill candidates for the authenticated user.
   */
  const skillCandidatesGetHandler = async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { skillCandidates } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const rows = await db
        .select()
        .from(skillCandidates)
        .where(and(eq(skillCandidates.userId, userId), eq(skillCandidates.status, "pending")))
        .orderBy(skillCandidates.createdAt);
      res.json({ candidates: rows });
    } catch (err) {
      console.error("[SkillCandidates] GET failed:", err);
      res.status(500).json({ error: "Failed to list skill candidates" });
    }
  };
  app.get("/api/skills/candidates", skillCandidatesGetHandler);
  app.get("/api/skill-candidates", skillCandidatesGetHandler);

  /**
   * PATCH /api/skills/candidates/:id/review  (canonical)
   * PATCH /api/skill-candidates/:id/review   (legacy alias)
   * Accept, edit, or dismiss a skill candidate.
   * Body: { action: "accept" | "edit" | "dismiss", name?, instructionText? }
   * On accept/edit, a user_skills row is inserted (isActive=true).
   */
  const skillCandidatesReviewHandler = async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const id = _p(req.params.id);
    const { action, name, instructionText } = req.body as {
      action?: string;
      name?: string;
      instructionText?: string;
    };
    if (!action || !["accept", "edit", "dismiss"].includes(action)) {
      return res.status(400).json({ error: "action must be accept, edit, or dismiss" });
    }
    try {
      const { skillCandidates, userSkills } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const [candidate] = await db
        .select()
        .from(skillCandidates)
        .where(and(eq(skillCandidates.id, id), eq(skillCandidates.userId, userId)))
        .limit(1);
      if (!candidate) return res.status(404).json({ error: "Candidate not found" });
      if (candidate.status !== "pending") {
        return res.status(409).json({ error: "Candidate has already been reviewed" });
      }

      const newStatus = action === "accept" ? "accepted" : action === "edit" ? "edited" : "dismissed";

      // Perform status update and optional skill insertion atomically so a
      // partial failure never leaves a candidate marked reviewed without a
      // corresponding user_skills row.
      await db.transaction(async (tx) => {
        await tx
          .update(skillCandidates)
          .set({ status: newStatus })
          .where(eq(skillCandidates.id, id));

        if (action === "accept" || action === "edit") {
          const finalName = name?.trim() ? name.trim().slice(0, 80) : candidate.name;
          const finalInstructions = instructionText?.trim()
            ? instructionText.trim().slice(0, 3000)
            : candidate.instructionText;
          await tx.insert(userSkills).values({
            userId,
            name: finalName,
            emoji: "⚡",
            description: candidate.triggerDescription.slice(0, 200),
            instructions: finalInstructions,
            isBuiltIn: false,
            isActive: true,
          });
        }
      });

      res.json({ ok: true });
    } catch (err) {
      console.error("[SkillCandidates] PATCH review failed:", err);
      res.status(500).json({ error: "Failed to review candidate" });
    }
  };
  app.patch("/api/skills/candidates/:id/review", skillCandidatesReviewHandler);
  app.patch("/api/skill-candidates/:id/review", skillCandidatesReviewHandler);

  // ── Integration pre-flight status ────────────────────────────────────────
  // Returns a map of { integration → { status, errorMessage, expiresAt, lastCheckedAt } }
  // for the authenticated user. Used by the Settings screen to show health badges.
  app.get("/api/integrations/status", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { db } = await import("./db");
      const { integrationStatus } = await import("@shared/schema");
      const { eq, sql } = await import("drizzle-orm");
      const rows = await db
        .select()
        .from(integrationStatus)
        .where(eq(integrationStatus.userId, userId));
      const linkedRaw = await db.execute(sql`
        SELECT DISTINCT integration FROM (
          SELECT 'telegram' AS integration FROM telegram_links WHERE user_id = ${userId}
          UNION ALL
          SELECT channel AS integration FROM channel_links WHERE user_id = ${userId}
            AND channel IN ('discord', 'slack', 'whatsapp')
          UNION ALL
          SELECT CASE WHEN provider = 'microsoft' THEN 'outlook' ELSE provider END AS integration
          FROM user_oauth_tokens
          WHERE user_id = ${userId}
            AND provider IN ('google', 'microsoft', 'slack')
        ) linked
      `);
      const linkedRows = ((linkedRaw as any).rows ?? (Array.isArray(linkedRaw) ? linkedRaw : [])) as Array<{ integration: string }>;
      const linkedIntegrations = new Set(linkedRows.map((row) => row.integration));

      // All integrations the app supports — returned as unconfigured by default
      // so the UI always has a complete picture even before the first validator pass.
      const KNOWN_INTEGRATIONS = [
        "google", "outlook", "telegram", "discord", "slack", "whatsapp",
      ] as const;

      const now = new Date().toISOString();
      const healthyStatuses = new Set(["healthy", "expiring_soon", "degraded"]);
      const hasServerCredential = (integration: string) => {
        switch (integration) {
          case "google":
            return Boolean((process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_WEB_CLIENT_ID) && process.env.GOOGLE_CLIENT_SECRET);
          case "outlook":
            return Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
          case "telegram":
            return Boolean(process.env.TELEGRAM_BOT_TOKEN);
          case "discord":
            return Boolean(process.env.DISCORD_BOT_TOKEN);
          case "slack":
            return Boolean(process.env.SLACK_BOT_TOKEN) || linkedIntegrations.has("slack");
          case "whatsapp":
            return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
          default:
            return false;
        }
      };
      const decorateStatus = (integration: string, base: {
        status: string;
        errorMessage: string | null;
        expiresAt: string | null;
        lastCheckedAt: string;
      }) => {
        const accountLinked = linkedIntegrations.has(integration) || base.status !== "unconfigured";
        const serverConfigured = hasServerCredential(integration);
        const capabilityRunnable = healthyStatuses.has(base.status);
        const blockedReason = capabilityRunnable
          ? null
          : base.errorMessage
            ?? (!accountLinked ? "Account is not linked" : null)
            ?? (!serverConfigured ? "Server credential is missing" : "Capability is not runnable");
        return {
          ...base,
          accountLinked,
          serverConfigured,
          capabilityRunnable,
          blockedReason,
          readiness: capabilityRunnable ? "runnable" : accountLinked ? "linked_blocked" : "not_linked",
        };
      };
      const result: Record<string, {
        status: string;
        errorMessage: string | null;
        expiresAt: string | null;
        lastCheckedAt: string;
        accountLinked: boolean;
        serverConfigured: boolean;
        capabilityRunnable: boolean;
        blockedReason: string | null;
        readiness: string;
      }> = {};
      for (const key of KNOWN_INTEGRATIONS) {
        result[key] = decorateStatus(key, { status: "unconfigured", errorMessage: null, expiresAt: null, lastCheckedAt: now });
      }
      for (const row of rows) {
        result[row.integration] = decorateStatus(row.integration, {
          status: row.status,
          errorMessage: row.errorMessage ?? null,
          expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
          lastCheckedAt: row.lastCheckedAt.toISOString(),
        });
      }
      res.json(result);
    } catch (err) {
      console.error("[Integrations] GET /api/integrations/status failed:", err);
      res.status(500).json({ error: "Failed to fetch integration statuses" });
    }
  });

  // Trigger an immediate re-check for the current user (called after reconnect).
  app.post("/api/integrations/refresh", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { validateUserIntegrations } = await import("./intelligence/integrationValidator");
      await validateUserIntegrations(userId);
      res.json({ ok: true });
    } catch (err) {
      console.error("[Integrations] POST /api/integrations/refresh failed:", err);
      res.status(500).json({ error: "Failed to refresh integration statuses" });
    }
  });

  // ── Diagnostics ──────────────────────────────────────────────────────────────

  app.get("/api/diagnostics/health", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { runHealthCheck } = await import("./diagnostics/diagnosticsService");
      const report = await runHealthCheck(userId);
      res.json(report);
    } catch (err) {
      console.error("[Diagnostics] GET /api/diagnostics/health failed:", err);
      res.status(500).json({ error: "Failed to run health check" });
    }
  });

  app.post("/api/diagnostics/run", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { runAIDiagnosis } = await import("./diagnostics/diagnosticsService");
      const { diagnosis, report } = await runAIDiagnosis(userId);
      res.json({ diagnosis, report });
    } catch (err) {
      console.error("[Diagnostics] POST /api/diagnostics/run failed:", err);
      res.status(500).json({ error: "Failed to run diagnosis" });
    }
  });

  app.get("/api/diagnostics/memory-events", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { getRecentEvents } = await import("./diagnostics/diagnosticsService");
      const events = await getRecentEvents({
        userId,
        subsystem: "memory",
        limit: 20,
        sinceMinutes: 60,
        excludePatternDetected: true,
      });
      res.json(events);
    } catch (err) {
      console.error("[Diagnostics] GET /api/diagnostics/memory-events failed:", err);
      res.status(500).json({ error: "Failed to fetch memory events" });
    }
  });

  app.get("/api/diagnostics/events", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const subsystem = typeof req.query.subsystem === "string" ? req.query.subsystem : undefined;
    if (!subsystem) return res.status(400).json({ error: "subsystem query param required" });
    const validSubsystems: readonly string[] = schema.DIAGNOSTIC_SUBSYSTEMS;
    if (!validSubsystems.includes(subsystem)) {
      return res.status(400).json({ error: `Invalid subsystem. Must be one of: ${schema.DIAGNOSTIC_SUBSYSTEMS.join(", ")}` });
    }
    try {
      const { getRecentEvents } = await import("./diagnostics/diagnosticsService");
      const events = await getRecentEvents({
        userId,
        subsystem: subsystem as import("@shared/schema").DiagnosticSubsystem,
        limit: 20,
        sinceMinutes: 60,
        excludePatternDetected: true,
      });
      res.json(events);
    } catch (err) {
      console.error("[Diagnostics] GET /api/diagnostics/events failed:", err);
      res.status(500).json({ error: "Failed to fetch subsystem events" });
    }
  });

  registerLocalWorkerRoutes(app);

  registerMcpRoutes(app, authMiddleware);

  // ── Voice Realtime API ────────────────────────────────────────────────────

  /**
   * POST /api/voice/codex-turn
   * Turn-based voice path: local audio transcription, Codex OAuth coach turn,
   * then device/browser speech output. This avoids direct OpenAI Realtime usage.
   */
  app.post("/api/voice/codex-turn", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId as string;
    try {
      const { runCodexVoiceTurn, CodexVoiceTurnError } = await import("./voiceCodexTurn");
      const body = (req.body || {}) as Record<string, unknown>;
      const result = await runCodexVoiceTurn({
        userId,
        text: body.text,
        audioBase64: body.audioBase64,
        mimeType: body.mimeType,
        sdkSessionId: body.sdkSessionId,
      });
      res.json(result);
    } catch (err) {
      const { CodexVoiceTurnError } = await import("./voiceCodexTurn");
      if (err instanceof CodexVoiceTurnError) {
        return res.status(err.status).json({ error: err.message, code: err.code });
      }
      console.error("[voice/codex-turn] Error:", err);
      res.status(500).json({ error: "Failed to complete Codex voice turn" });
    }
  });

  /**
   * GET /api/voice/realtime-session
   * Returns relay availability status. Lets the mobile client check whether the
   * server-side WebSocket relay is configured before attempting a connection.
   */
  app.get("/api/voice/realtime-session", authMiddleware, (_req: Request, res: Response) => {
    res.json({
      mode: "codex-turn",
      realtime_available: false,
      relay_available: false,
      turn_endpoint: "/api/voice/codex-turn",
      model: "chatgpt-codex-oauth/auto",
      audio_output: "device",
    });
  });

  /**
   * POST /api/voice/relay-ticket
   * Issues a short-lived (30 s), single-use relay ticket for the authenticated user.
   * The native client uses this ticket to open the relay WebSocket without embedding
   * the long-lived JWT in the WebSocket URL (which would appear in server logs/proxies).
   */
  app.post("/api/voice/relay-ticket", authMiddleware, (_req: Request, res: Response) => {
    res.status(410).json({
      error: "OpenAI Realtime voice relay is disabled. Use /api/voice/codex-turn.",
      code: "CODEX_VOICE_TURN_REQUIRED",
    });
  });

  /**
   * POST /api/voice/realtime-session
   * Mints a short-lived OpenAI Realtime API ephemeral client secret for WebRTC/WebSocket.
   * The secret expires in ~60 seconds and is scoped to a single session.
   */
  app.post("/api/voice/realtime-session", authMiddleware, async (_req: Request, res: Response) => {
    res.status(410).json({
      error: "OpenAI Realtime sessions are disabled. Use /api/voice/codex-turn.",
      code: "CODEX_VOICE_TURN_REQUIRED",
    });
  });

  /**
   * POST /api/voice/tool-call
   * Executes a named tool from a Realtime voice session and returns the result.
   * The Realtime API sends function_call events; the client POSTs here and relays
   * the result back to the session data channel.
   */
  app.post("/api/voice/tool-call", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId as string;
    const { tool_name, arguments: toolArgs } = req.body || {};
    try {
      if (tool_name === 'get_today_summary') {
        const today = new Date().toISOString().slice(0, 10);
        const tasks = await db
          .select({
            id: schema.jarvisScheduledTasks.id,
            title: schema.jarvisScheduledTasks.title,
            scheduledAt: schema.jarvisScheduledTasks.scheduledAt,
            completedAt: schema.jarvisScheduledTasks.completedAt,
          })
          .from(schema.jarvisScheduledTasks)
          .where(
            and(
              eq(schema.jarvisScheduledTasks.userId, userId),
              sql`DATE(${schema.jarvisScheduledTasks.scheduledAt}) = ${today}`,
            )
          )
          .limit(10);
        return res.json({
          result: JSON.stringify({
            date: today,
            tasks: tasks.map(t => ({
              title: t.title,
              scheduledAt: t.scheduledAt,
              done: !!t.completedAt,
            })),
          }),
        });
      }

      if (tool_name === 'search_memories') {
        const query = String((toolArgs as Record<string, unknown>)?.query || '').trim();
        const { retrieveRelevantMemories } = await import('./memory/retrieve');
        const memories = await retrieveRelevantMemories(userId, query, 5);
        return res.json({
          result: JSON.stringify({
            memories: memories.map((m: { content: string; category: string }) => ({
              content: m.content,
              category: m.category,
            })),
          }),
        });
      }

      return res.json({ result: JSON.stringify({ error: `Unknown tool: ${tool_name}` }) });
    } catch (err) {
      console.error('[voice/tool-call] Error:', err);
      res.status(500).json({ error: 'Tool execution failed' });
    }
  });

  /**
   * POST /api/conversations
   * Create a new voice/audio conversation thread.
   */
  app.post("/api/conversations", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { chatStorage } = await import('./integrations/chatStorage');
      const { title } = req.body || {};
      const conversation = await chatStorage.createConversation(title || 'Voice Session');
      res.status(201).json(conversation);
    } catch (err) {
      console.error('[conversations] create error:', err);
      res.status(500).json({ error: 'Failed to create conversation' });
    }
  });

  /**
   * POST /api/conversations/:id/voice-transcript
   * Save an array of voice transcript entries to a conversation.
   * Body: { entries: Array<{ role: 'user' | 'assistant'; text: string }> }
   */
  app.post("/api/conversations/:id/voice-transcript", authMiddleware, async (req: Request, res: Response) => {
    try {
      const conversationId = parseInt(_p(req.params.id), 10);
      const entries: Array<{ role: string; text: string }> = req.body?.entries || [];
      if (!Array.isArray(entries) || entries.length === 0) {
        return res.status(400).json({ error: 'entries array is required' });
      }
      const { chatStorage } = await import('./integrations/chatStorage');
      for (const entry of entries) {
        if (entry.role && entry.text) {
          await chatStorage.createMessage(conversationId, entry.role, entry.text);
        }
      }
      res.json({ ok: true, saved: entries.length });
    } catch (err) {
      console.error('[conversations/voice-transcript] error:', err);
      res.status(500).json({ error: 'Failed to save transcript' });
    }
  });

  // ── Write-budget endpoints ──────────────────────────────────────────────────
  // GET  /api/write-budget        — returns current count, max, and tripped state.
  // POST /api/write-budget/reset  — owner-only; clears the circuit-breaker counter.

  app.get("/api/write-budget", authMiddleware, async (req: Request, res: Response) => {
    try {
      const {
        checkCircuitBreaker,
        CIRCUIT_MAX_WRITES,
        writeBudgetSummary,
      } = await import("./agent/safeWritePolicy");
      const [status, summary] = await Promise.all([checkCircuitBreaker(), writeBudgetSummary()]);
      res.json({
        count:   status.count,
        max:     CIRCUIT_MAX_WRITES,
        tripped: status.tripped,
        resetAt: status.resetAt?.toISOString() ?? null,
        summary,
      });
    } catch (err) {
      console.error("[write-budget] GET error:", err);
      res.status(500).json({ error: "Failed to fetch write budget" });
    }
  });

  app.post("/api/write-budget/reset", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      if (!(await isIntegrationOwner(userId))) {
        return res.status(403).json({ error: "Only the account owner can reset the write budget" });
      }
      const { resetCircuitBreaker } = await import("./agent/safeWritePolicy");
      await resetCircuitBreaker();
      res.json({ ok: true });
    } catch (err) {
      console.error("[write-budget] POST /reset error:", err);
      res.status(500).json({ error: "Failed to reset write budget" });
    }
  });

  // ── Self-heal audit log API ───────────────────────────────────────────────
  app.get("/api/self-heal-audit", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      if (!(await isIntegrationOwner(userId))) {
        return res.status(403).json({ error: "Only the account owner can view the self-heal audit log" });
      }
      const parsedLimit = parseInt(String(req.query.limit ?? ""), 10);
      const limit = Number.isNaN(parsedLimit) ? 50 : Math.max(1, Math.min(parsedLimit, 200));
      const entries = await db
        .select()
        .from(schema.selfHealAuditLog)
        .orderBy(desc(schema.selfHealAuditLog.createdAt))
        .limit(limit);
      res.json({ entries });
    } catch (err) {
      console.error("[self-heal-audit] GET error:", err);
      res.status(500).json({ error: "Failed to fetch self-heal audit log" });
    }
  });

  // ── Button locations — trained button memory ────────────────────────────
  app.get("/api/button-locations", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const rows = await db.select().from(schema.buttonLocations)
        .where(eq(schema.buttonLocations.userId, userId))
        .orderBy(desc(schema.buttonLocations.updatedAt));
      res.json({ entries: rows });
    } catch (err) {
      console.error("[button-locations] GET error:", err);
      res.status(500).json({ error: "Failed to fetch button locations" });
    }
  });

  app.post("/api/button-locations", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const { appPackage, screenContext, elementLabel, coordinatesX, coordinatesY, screenshotHash, screenshotPath } = req.body;
      if (!appPackage || !elementLabel || coordinatesX == null || coordinatesY == null) {
        return res.status(400).json({ error: "appPackage, elementLabel, coordinatesX, coordinatesY are required" });
      }
      const [row] = await db.insert(schema.buttonLocations).values({
        userId,
        appPackage: String(appPackage),
        screenContext: String(screenContext || ""),
        elementLabel: String(elementLabel),
        coordinatesX: Number(coordinatesX),
        coordinatesY: Number(coordinatesY),
        screenshotHash: screenshotHash ? String(screenshotHash) : null,
        screenshotPath: screenshotPath ? String(screenshotPath) : null,
        confidence: 0.5,
      }).returning();
      res.json({ entry: row });
    } catch (err) {
      console.error("[button-locations] POST error:", err);
      res.status(500).json({ error: "Failed to create button location" });
    }
  });

  app.delete("/api/button-locations/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const id = parseInt(_p(req.params.id), 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const rows = await db.select({ id: schema.buttonLocations.id, userId: schema.buttonLocations.userId })
        .from(schema.buttonLocations).where(eq(schema.buttonLocations.id, id)).limit(1);
      if (!rows.length || rows[0].userId !== userId) return res.status(404).json({ error: "Not found" });
      await db.delete(schema.buttonLocations).where(eq(schema.buttonLocations.id, id));
      res.json({ deleted: true });
    } catch (err) {
      console.error("[button-locations] DELETE error:", err);
      res.status(500).json({ error: "Failed to delete button location" });
    }
  });

  app.patch("/api/button-locations/:id/confirm", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const id = parseInt(_p(req.params.id), 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const rows = await db.select().from(schema.buttonLocations).where(and(eq(schema.buttonLocations.id, id), eq(schema.buttonLocations.userId, userId))).limit(1);
      if (!rows.length) return res.status(404).json({ error: "Not found" });
      const current = rows[0];
      const newConfidence = Math.min(1.0, current.confidence + 0.15);
      const [updated] = await db.update(schema.buttonLocations).set({
        confidence: newConfidence,
        stale: false,
        failCount: 0,
        lastConfirmedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(schema.buttonLocations.id, id)).returning();
      res.json({ entry: updated });
    } catch (err) {
      console.error("[button-locations] PATCH confirm error:", err);
      res.status(500).json({ error: "Failed to confirm button location" });
    }
  });

  app.patch("/api/button-locations/:id/deny", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const id = parseInt(_p(req.params.id), 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const rows = await db.select().from(schema.buttonLocations).where(and(eq(schema.buttonLocations.id, id), eq(schema.buttonLocations.userId, userId))).limit(1);
      if (!rows.length) return res.status(404).json({ error: "Not found" });
      const current = rows[0];
      const newConfidence = Math.max(0, current.confidence - 0.2);
      const newFailCount = (current.failCount ?? 0) + 1;
      const nowStale = newConfidence < 0.3 || newFailCount >= 3;
      const [updated] = await db.update(schema.buttonLocations).set({
        confidence: newConfidence,
        stale: nowStale,
        failCount: newFailCount,
        updatedAt: new Date(),
      }).where(eq(schema.buttonLocations.id, id)).returning();
      res.json({ entry: updated });
    } catch (err) {
      console.error("[button-locations] PATCH deny error:", err);
      res.status(500).json({ error: "Failed to deny button location" });
    }
  });

  // ── GitHub Settings ─────────────────────────────────────────────────────────
  app.get("/api/github/settings", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const { getGitHubSettings, getGitHubUser, saveGitHubSettings } = await import("./integrations/github");
      const settings = await getGitHubSettings(userId);
      let username = settings.username ?? null;
      if (settings.pat && !username) {
        username = await getGitHubUser(settings.pat);
        if (username) {
          await saveGitHubSettings(userId, { username });
        }
      }
      res.json({ connected: !!settings.pat, repos: settings.repos, tokenType: settings.tokenType ?? null, username });
    } catch (err) {
      console.error("[GitHub] GET settings error:", err);
      res.status(500).json({ error: "Failed to load GitHub settings" });
    }
  });

  app.patch("/api/github/settings", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const { pat, repos } = req.body as { pat?: string; repos?: string[] };
      const { saveGitHubSettings, getGitHubUser } = await import("./integrations/github");
      const patch: Parameters<typeof saveGitHubSettings>[1] = {
        ...(pat !== undefined ? { pat: pat || null } : {}),
        ...(repos !== undefined ? { repos } : {}),
      };
      if (pat) {
        const username = await getGitHubUser(pat);
        patch.username = username;
      } else if (pat !== undefined && !pat) {
        patch.username = null;
      }
      await saveGitHubSettings(userId, patch);
      res.json({ ok: true });
    } catch (err) {
      console.error("[GitHub] PATCH settings error:", err);
      res.status(500).json({ error: "Failed to save GitHub settings" });
    }
  });

  app.delete("/api/github/pat", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const { saveGitHubSettings } = await import("./integrations/github");
      await saveGitHubSettings(userId, { pat: null, username: null });
      res.json({ ok: true });
    } catch (err) {
      console.error("[GitHub] DELETE pat error:", err);
      res.status(500).json({ error: "Failed to remove GitHub PAT" });
    }
  });

  // ── GitHub OAuth (Device Flow) ────────────────────────────────────────────────
  app.get("/api/github/oauth-available", async (_req: Request, res: Response) => {
    res.json({ available: !!process.env.GITHUB_CLIENT_ID });
  });

  app.post("/api/github/device/start", authMiddleware, async (req: Request, res: Response) => {
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) {
      return res.status(503).json({ error: "GitHub OAuth not configured on this server" });
    }
    try {
      const response = await fetch("https://github.com/login/device/code", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: clientId, scope: "repo read:user" }).toString(),
      });
      if (!response.ok) {
        return res.status(502).json({ error: "GitHub API returned an error" });
      }
      const data = (await response.json()) as {
        device_code: string;
        user_code: string;
        verification_uri: string;
        expires_in: number;
        interval: number;
      };
      res.json(data);
    } catch (err) {
      console.error("[GitHub Device Flow] start error:", err);
      res.status(500).json({ error: "Failed to initiate device flow" });
    }
  });

  app.post("/api/github/device/poll", authMiddleware, async (req: Request, res: Response) => {
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) {
      return res.status(503).json({ error: "GitHub OAuth not configured on this server" });
    }
    const userId = (req as any).userId as string;
    const { device_code } = req.body as { device_code?: string };
    if (!device_code) {
      return res.status(400).json({ error: "device_code is required" });
    }
    try {
      const response = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          device_code,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }).toString(),
      });
      const data = (await response.json()) as {
        access_token?: string;
        error?: string;
        error_description?: string;
      };
      if (data.access_token) {
        const { saveGitHubSettings, getGitHubUser } = await import("./integrations/github");
        const username = await getGitHubUser(data.access_token);
        await saveGitHubSettings(userId, { pat: data.access_token, tokenType: "oauth", username });
        return res.json({ status: "authorized" });
      }
      if (data.error === "authorization_pending" || data.error === "slow_down") {
        return res.json({ status: "pending", error: data.error });
      }
      return res.json({ status: "error", error: data.error, message: data.error_description });
    } catch (err) {
      console.error("[GitHub Device Flow] poll error:", err);
      res.status(500).json({ error: "Failed to poll device flow" });
    }
  });

  // ── Capability gaps ───────────────────────────────────────────────────────
  // Returns all gaps from the past 7 days grouped by (userMessage, detectedReason)
  // with occurrence count and addressed status, so users can see frequency and
  // track what has already been dismissed before Sunday's analysis runs.
  app.get("/api/capability-gaps", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const rows = await db
        .select({
          userMessage: schema.capabilityGaps.userMessage,
          agentReplySnippet: sql<string | null>`MAX(${schema.capabilityGaps.agentReplySnippet})`,
          detectedReason: schema.capabilityGaps.detectedReason,
          channel: sql<string | null>`MAX(${schema.capabilityGaps.channel})`,
          occurrenceCount: sql<number>`COUNT(*)::int`,
          addressed: sql<boolean>`BOOL_AND(${schema.capabilityGaps.addressed})`,
          latestCreatedAt: sql<string>`MAX(${schema.capabilityGaps.createdAt})::text`,
        })
        .from(schema.capabilityGaps)
        .where(
          and(
            eq(schema.capabilityGaps.userId, userId),
            gte(schema.capabilityGaps.createdAt, sevenDaysAgo),
          ),
        )
        .groupBy(
          schema.capabilityGaps.userMessage,
          schema.capabilityGaps.detectedReason,
        )
        .orderBy(desc(sql`MAX(${schema.capabilityGaps.createdAt})`))
        .limit(50);
      res.json({ gaps: rows });
    } catch (err) {
      console.error("[capability-gaps] GET error:", err);
      res.status(500).json({ error: "Failed to fetch capability gaps" });
    }
  });

  // Dismiss a capability gap group (all rows matching userMessage + detectedReason).
  app.delete("/api/capability-gaps", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const { userMessage, detectedReason } = (req.body ?? {}) as { userMessage?: string; detectedReason?: string };
      if (!userMessage || !detectedReason) {
        return res.status(400).json({ error: "userMessage and detectedReason are required" });
      }
      await db
        .update(schema.capabilityGaps)
        .set({ addressed: true })
        .where(
          and(
            eq(schema.capabilityGaps.userId, userId),
            eq(schema.capabilityGaps.userMessage, userMessage),
            eq(schema.capabilityGaps.detectedReason, detectedReason),
          ),
        );
      res.json({ ok: true });
    } catch (err) {
      console.error("[capability-gaps] DELETE error:", err);
      res.status(500).json({ error: "Failed to dismiss capability gap" });
    }
  });

  // ── On-demand capability gap analysis ────────────────────────────────────
  app.post("/api/gap-analysis/run", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const { submitted, queued, failed } = await runCapabilityGapAnalysis(userId);
      if (failed) {
        return res.status(500).json({ error: "Gap analysis failed — LLM clustering or DB error. Check server logs." });
      }
      res.json({ ok: true, submitted, queued, total: submitted + queued });
    } catch (err) {
      console.error("[gap-analysis] POST /run error:", err);
      res.status(500).json({ error: "Failed to run gap analysis" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
