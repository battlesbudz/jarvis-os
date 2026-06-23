import "./agent/providers/envAliases";
import { createHash } from 'crypto';
import { activeCoachRuns } from "./runRegistry";
import { registerCoachRunLifecycle } from "./coachRunLifecycle";
import { buildGmailSourceId, gmailMessageIdExistsForUser } from "./utils/gmailSourceId";
import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import OpenAI from "openai";
import { getOpenAIClientConfig } from "./agent/providers/env";
import { db } from "./db";
import { eq, and, desc, sql, asc } from "drizzle-orm";
import * as schema from "@shared/schema";
import { userMemories, proactiveQuestionsSent, userDocuments } from "@shared/schema";
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
import { authMiddleware, getUserIdFromRequest } from "./auth";
import { registerDataRoutes } from "./dataRoutes";
import { registerTelegramRoutes } from "./telegramRoutes";
import { registerChannelRoutes } from "./channels/routes";
import { registerDiscordScheduleRoutes } from "./discord/schedulesRoutes";
import { registerAgentRoutes } from "./agent/agentRoutes";
import { registerCustomAgentRoutes } from "./agent/customAgentRoutes";
import { registerCodeProposalsRoutes } from "./agent/codeProposalsRoutes";
import { registerProjectRoutes } from "./projectRoutes";
import { registerDoctorRoutes } from "./doctor/doctorRoutes";
import { registerVaultRoutes } from "./vaultRoutes";
import { registerIntegrationRoutes } from "./routes/integrationRoutes";
import { registerPlanGenerationRoutes } from "./routes/planGenerationRoutes";
import { registerDailyCommandRoutes } from "./dailyCommand/routes";
import { registerMindTraceRoutes } from "./routes/mindTraceRoutes";
import { registerMissionControlQueueRoutes } from "./routes/missionControlQueueRoutes";
import { registerConnectionsRoutes } from "./routes/connectionsRoutes";
import { registerDesktopConnectorRoutes } from "./routes/desktopConnectorRoutes";
import { registerWebchatInviteRoutes } from "./routes/webchatInviteRoutes";
import { registerEgoRoutes } from "./routes/egoRoutes";
import { registerDiscordConnectionRoutes } from "./routes/discordConnectionRoutes";
import { registerGoalSummaryRoutes } from "./routes/goalSummaryRoutes";
import { registerBrainDumpRoutes } from "./routes/brainDumpRoutes";
import { registerCoachAudioRoutes } from "./routes/coachAudioRoutes";
import { registerCoachActionConfirmationRoutes } from "./routes/coachActionConfirmationRoutes";
import { registerCoachInsightRoutes } from "./routes/coachInsightRoutes";
import { registerCoachSessionRoutes } from "./routes/coachSessionRoutes";
import { registerWebchatEventsRoutes } from "./routes/webchatEventsRoutes";
import { formatRuntimeShadowPreviewSummary, previewRuntimeShadowForMessage } from "./core/runtime";
import { buildYoutubeTranscriptCoachTools } from "./youtubeTranscriptCoachTools";
import { registerPreAuthRoutes } from "./routes/preAuthRoutes";
import { registerPostCoachRoutes } from "./routes/postCoachRouteRegistry";
import { createJarvisScheduledTask } from "./jarvisScheduledTasks";
import { claimIntegrationOwnership } from "./integrationOwner";
import { oauthRouter } from "./oauthRoutes";
import { driveRouter } from "./driveRoutes";
import { getValidGoogleTokens, getValidGoogleToken, getValidMicrosoftToken, getUserTokens, getUserToken, getUserOAuthStatus } from "./userTokenStore";
import { tavilySearch, formatSearchResults } from "./integrations/search";
import { logInteraction, getRecentInteractions, formatInteractionTimeline } from "./interactionLog";
import { runCoachChatSideEffects } from "./coachChatSideEffects";
import { getSoul, getSoulPromptBlock, regenerateSoul, setManualOverride, setSoulContent } from "./memory/soul";
import { buildUntrustedSoulContext, BUDGET_PRESETS } from "./memory/contextBuilder";
import { listPeople, deletePerson } from "./memory/people";
import { isUserPaired, sendDaemonOp, pingDaemon, getOpAuditLog, isDaemonActionAllowed, isAndroidDaemonActive, isDesktopDaemonActive, isAndroidDaemonActionAllowed, getRecentPhoneNotifications, getDaemonDeviceMeta, type AndroidDaemonAction } from "./daemon/bridge";
import type { DaemonAction, DaemonOp } from "./daemon/bridge";
import { telegramLinks, channelLinks } from "@shared/schema";
import { connectChannelTool } from "./agent/tools/connectChannel";
import { filterToolsByGroups, getTool, type ToolGroup } from "./agent/tools/index";
import { ANDROID_PHONE_RUNTIME_TOOL_NAMES } from "./agent/tools/androidAppRuntime";
import { parseNaturalTime, parseRecurringExpr } from "./agent/tools/cronTools";
import { buildYouTubeContextBlock } from "./utils/youtubeAutoFetch";
import { getPromptData, setPromptData } from "./coachSessionPromptCache";
import { markSoulStale } from "./memory/soul";
import { getModel } from "./lib/modelPrefs";
import { getExplicitCoachRequestedModel } from "./services/coachModelSelection";
import { getPublicBaseUrl } from "./publicUrl";
import { estimateModelUsage, recordModelUsage } from "./agent/modelUsage";
import type { AgentTool, ToolContext } from "./agent/types";
import {
  isCodexDelegationEnabled,
} from "./agent/codexDelegation";
import { classifyToolAwareRoute } from "./agent/toolAwareRouting";
import { buildToolExecutionPolicy } from "./agent/toolExecutionPolicy";
import { routeAppCoachChatAutonomy } from "./agent/appCoachChatAutonomy";
import { getCoachAppAgentId } from "./agent/coreAgentIds";
import { classifyComposioActionPermission } from "./connectors/composio/connectionCenter";
import { savePendingCoachResponse, storeDaemonScreenshot } from "./services/coachRuntimeState";
import { createCoachChatProgressStream } from "./services/coachChatProgress";
import { executeCoachYoutubeSearch } from "./services/coachYoutubeSearch";
import { openCoachSse, writeCoachActionResults, writeCoachStreamError } from "./services/coachSse";
import { buildCoachPostTranscriptTools, coachFunctionTool } from "./services/coachToolDefinitions";
import { buildCoreCoachTools } from "./services/coreCoachTools";
import { buildConnectedServiceCoachTools } from "./services/connectedServiceCoachTools";
import {
  buildCoachSystemPrompt,
  getMorningNoteSummary,
  providerLabelForModel,
  runCoachModelTurn,
  streamCoachModelTurn,
} from "./services/aiCoachContextService";

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

const openai = new OpenAI(getOpenAIClientConfig());
const ANDROID_PHONE_RUNTIME_TOOL_NAME_SET = new Set<string>(ANDROID_PHONE_RUNTIME_TOOL_NAMES);
const SERVER_YOUTUBE_TOOL_NAMES = new Set([
  "search_youtube",
  "fetch_youtube_transcript",
  "youtube_search",
  "get_youtube_transcript",
]);

function isAndroidPhoneRuntimeToolName(name: string): boolean {
  return ANDROID_PHONE_RUNTIME_TOOL_NAME_SET.has(name);
}

function phoneRuntimeChatToolName(tool: OpenAI.Chat.Completions.ChatCompletionTool): string | null {
  return tool.type === "function" ? tool.function.name : null;
}

function filterPhoneRuntimeModelTools(
  tools: OpenAI.Chat.Completions.ChatCompletionTool[],
  options: { allowDaemonActionFallback?: boolean; allowServerYoutubeTools?: boolean } = {},
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.filter((tool) => {
    const name = phoneRuntimeChatToolName(tool);
    if (!name) return false;
    if (isAndroidPhoneRuntimeToolName(name)) return true;
    if (name === "daemon_action") return options.allowDaemonActionFallback === true;
    if (SERVER_YOUTUBE_TOOL_NAMES.has(name)) return options.allowServerYoutubeTools === true;
    return false;
  });
}

function uniqueToolNames(names: string[]): string[] {
  return Array.from(new Set(names));
}

function isYoutubePhoneRequest(text: string): boolean {
  return /\b(you\s*tube|youtube|yt)\b/i.test(text);
}

function isYoutubeServerResearchRequest(text: string): boolean {
  return isYoutubePhoneRequest(text) &&
    /\b(?:summari[sz]e|summary|research|transcript|captions?|analy[sz]e|report|compare|rank|recommend|recommendation|best videos?|top videos?|best result|pick (?:a|the) video|choose (?:a|the) video)\b/i.test(text);
}

function isPhoneRuntimeCoveredRequest(text: string): boolean {
  if (isYoutubePhoneRequest(text)) return !isYoutubeServerResearchRequest(text);
  return /\b(?:open|launch|start)\b/i.test(text) ||
    /\b(?:browse to|navigate to|open (?:a )?(?:url|link|website|site))\b/i.test(text) ||
    /\b(?:screenshot|screen shot|screen capture)\b/i.test(text) ||
    /\b(?:read|inspect|look at|what(?:'s| is))\b.{0,48}\b(?:screen|display|phone)\b/i.test(text) ||
    /\bnotifications?\b/i.test(text) ||
    /\b(?:tap|swipe|scroll|type|press|back|home|recents|enter)\b/i.test(text);
}

function buildPhoneRuntimeRequiredToolNames(
  lastUserContent: string,
  isDeviceControlRequest: boolean,
  phoneRuntimeCoveredRequest: boolean,
): string[] {
  if (!isDeviceControlRequest && !phoneRuntimeCoveredRequest && !isYoutubePhoneRequest(lastUserContent)) return [];
  const requiredToolNames = new Set<string>();

  if (phoneRuntimeCoveredRequest) {
    ANDROID_PHONE_RUNTIME_TOOL_NAMES.forEach((name) => requiredToolNames.add(name));
  }

  if (isYoutubePhoneRequest(lastUserContent)) {
    const youtubeResearchRequest = isYoutubeServerResearchRequest(lastUserContent);
    if (!youtubeResearchRequest) {
      requiredToolNames.add("android_youtube_search");
      requiredToolNames.add("android_open_phone_url");
    } else {
      requiredToolNames.add("search_youtube");
      requiredToolNames.add("fetch_youtube_transcript");
    }
  }

  return [...requiredToolNames];
}

export { buildPlanForUser, buildPlanFromInputs } from './services/planGenerationService';

export async function registerRoutes(app: Express): Promise<Server> {
  registerPreAuthRoutes(app);

  app.use(authMiddleware);

  // ── Webchat SSE push stream ─────────────────────────────────────────────────
  registerWebchatEventsRoutes(app);

  app.use("/api/oauth", oauthRouter);

  registerDataRoutes(app);
  registerDailyCommandRoutes(app);
  registerMindTraceRoutes(app);
  registerMissionControlQueueRoutes(app, { db });
  registerConnectionsRoutes(app);
  registerDesktopConnectorRoutes(app);

  registerGoalSummaryRoutes(app);

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

  registerEgoRoutes(app);
  registerDiscordConnectionRoutes(app);

  registerPlanGenerationRoutes(app);

  const coachTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    ...buildCoreCoachTools(),
    ...buildConnectedServiceCoachTools(),
    coachFunctionTool({
        name: "daemon_action",
        description: "Execute a sandboxed action on the user's paired daemon — either a desktop daemon or an Android device daemon. DESKTOP actions (when desktop daemon paired): shell, notify, file_read, file_write, file_list. ANDROID actions (when Android daemon paired): android_open_app (launch app by package name e.g. 'com.google.android.youtube'), android_browse (open URL in browser or app via deep link — for YouTube search use url='vnd.youtube://results?search_query=QUERY', for Google Maps use 'geo:0,0?q=QUERY', for Spotify use 'spotify:search:QUERY'), android_screenshot (capture screen), android_read_screen (read visible UI text), android_tap (tap at x/y), android_type (type text into focused field — set submit:true to also press Search/Go/Enter after typing), android_swipe (swipe gesture), android_press_key (back/home/recents/enter), android_file_list, android_file_read, android_notifications_list (read current phone notifications — checks server cache first; if cache is empty, AUTOMATICALLY swipes open the notification shade, reads the screen, then closes the shade; always returns real live data, never makes up notifications). CRITICAL RULES: (1) If this tool returns result:'error', STOP IMMEDIATELY and tell the user exactly what went wrong — do NOT proceed or pretend the action succeeded. (2) After android_open_app or android_browse succeeds, ALWAYS call android_read_screen next to confirm the screen state — NEVER describe app content or search results without first reading the screen. (3) For in-app searches (YouTube, Reddit, Maps, etc.) prefer android_browse with a deep link URL over open_app + navigate UI. Do NOT narrate what you plan to do before calling this tool — only confirm what actually happened after a successful result. Always call check_connections first to know which daemon type is paired.",
        parameters: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["shell", "notify", "file_read", "file_write", "file_list", "android_open_app", "android_browse", "android_screenshot", "android_read_screen", "android_screen_context", "android_operator_action", "android_tap", "android_type", "android_swipe", "android_press_key", "android_file_list", "android_file_read", "android_notifications_list", "android_wait", "android_return_to_jarvis"], description: "Action to perform. 'notify' works on BOTH desktop and Android daemons — sends a pop-up banner notification with title and body. 'android_wait' pauses for ms milliseconds (default 1500, max 10000) — use between steps when the phone UI needs time to settle (e.g. after tapping a video to let it load before read_screen). 'android_screen_context' returns structured accessibility context. 'android_operator_action' executes a narrow operatorAction payload. 'android_return_to_jarvis' returns the phone to the Jarvis app or existing chat surface — call this as the LAST step of every multi-step task after the notify banner, to return the user to the conversation." },
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
    }),
    coachFunctionTool({
        name: "daemon_diagnostic",
        description: "Ping the paired daemon to verify it is alive and retrieve the recent op audit log (last 20 ops with timestamps and durations). Use this when: (1) an android_* op timed out or failed unexpectedly, (2) the user reports the daemon isn't responding, or (3) you want to check if the accessibility service is enabled on the device. Returns device state (model, androidVersion, accessibilityEnabled, foregroundPackage) and a timestamped log of recent ops.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
    }),
    coachFunctionTool({
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
    }),
    ...buildYoutubeTranscriptCoachTools(),
    ...buildCoachPostTranscriptTools(),
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
          if (isAndroid) daemonParts.push(`Android Device Control: ✓ online — use the Phone Runtime tools: ${ANDROID_PHONE_RUNTIME_TOOL_NAMES.join(", ")}. Low-level daemon actions are internal implementation details. If a phone runtime tool returns result:error, stop and report the error immediately — do NOT fabricate success. After app navigation succeeds, read the screen before describing screen content.`);
          const daemonLabel = daemonOnline
            ? daemonParts.join(" | ")
            : `Android/Desktop Daemon: ✗ not connected — for Android device control, install/open the main Jarvis Android app, go to Profile → Android Device, then tap Enable Device Control. The app uses the configured server URL automatically.`;
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
                  detail: `The Notification Access permission is not granted to Jarvis (go to Settings > Notifications > Device & App Notifications > Jarvis and enable it). The shade-opening fallback also failed: ${swipeOp.error || 'swipe failed'}.`,
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
                detail: `Daemon ping failed before '${action}' (${preflightResult.error}). The Android device control connection is not responding — it may have been killed by Samsung battery optimisation, the accessibility service may have been disabled, or the phone may be locked. Tell the user: "Jarvis device control isn't responding. Please open the main Jarvis Android app on your phone to check the status dot and Recent Activity log — if the accessibility service is disabled, tap Fix to re-enable it."`,
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

          // Handle screenshot specially: store a temporary chat preview and give
          // the model a small accessibility snapshot it can reason over locally.
          if (action === 'android_screenshot' && daemonResult.data) {
            const data = daemonResult.data as Record<string, unknown>;
            const b64 = data.screenshot as string | undefined;
            if (b64 && b64.length > 0) {
              const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
              const buf = Buffer.from(b64, 'base64');
              storeDaemonScreenshot(id, buf);
              const detail: Record<string, unknown> = {
                screenshotUrl: `/api/daemon/screenshot/${id}`,
                attachmentKind: 'temporary_chat_screen_capture',
                galleryPersistence: 'not_intended_but_android_fallback_may_use_gallery_before_cleanup',
                expiresMinutes: 30,
                modelCanSeeImagePixels: false,
                screenContextAvailable: false,
                screenContextSource: 'android_read_screen_accessibility_tree',
                modelUseNote: 'The user sees the image preview inline in chat. Use screenContext to understand the current screen; the local model cannot inspect screenshot pixels from the URL directly. Android fallback capture paths may briefly use Gallery/MediaStore before cleanup, so do not promise Gallery persistence behavior unless the daemon reports it.',
              };

              try {
                if (await isAndroidDaemonActionAllowed(userId, 'android_read_screen')) {
                  const screenContextResult = await sendDaemonOp(userId, { type: 'android_read_screen' }, 8000);
                  if (screenContextResult.ok) {
                    const rawScreenContext = screenContextResult.data;
                    const serializedScreenContext = typeof rawScreenContext === 'string'
                      ? rawScreenContext
                      : JSON.stringify(rawScreenContext ?? {});
                    detail.screenContextAvailable = true;
                    detail.screenContext = serializedScreenContext.slice(0, 2500);
                  } else {
                    detail.screenContextError = screenContextResult.error || 'android_read_screen failed';
                  }
                } else {
                  detail.screenContextError = 'android_read_screen permission is not enabled.';
                }
              } catch (screenContextError) {
                detail.screenContextError = screenContextError instanceof Error
                  ? screenContextError.message
                  : String(screenContextError);
              }

              return { result: 'success', label: 'Temporary screen capture', detail: JSON.stringify(detail) };
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
          return executeCoachYoutubeSearch(args);
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
      const coachProgress = createCoachChatProgressStream({ res, startedAtMs: turnStartedAtMs, userId });
      const {
        ensureCoachSseOpen,
        emitMeaningfulProgress,
        startVisibleProgress,
        touchVisibleProgress,
      } = coachProgress;
      stopVisibleProgress = coachProgress.stopVisibleProgress;
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
        runCoachChatSideEffects(userId, messages, openai);
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
        ? `Android Device Control is ACTIVE and connected.\n${deviceHints}\nUse the deterministic Phone Runtime tools for supported phone work: ${ANDROID_PHONE_RUNTIME_TOOL_NAMES.join(", ")}. Low-level daemon actions are internal implementation details and should not be used as the normal phone-control interface unless daemon_action is the only exposed fallback for an unsupported phone action. When that fallback is exposed and succeeds, treat it as a valid phone action. DO NOT use desktop shell/file actions for phone work.\n\nPHONE RUNTIME WORKFLOW:\n  1. Use android_read_screen_context when you need to know what is visible before acting.\n  2. Use android_open_app_by_name for natural app names like YouTube, Facebook, LinkedIn, Maps, Camera, or Settings.\n  3. Use android_youtube_search for \"Search YouTube for X\" so the native app opens deterministically.\n  4. Use android_capture_screen when the user asks for a screenshot or screen capture. The screenshot appears as a temporary inline chat preview; direct capture is not intended as a Gallery photo, but Android fallback capture cleanup is best-effort.\n  5. Use android_tap_screen, android_type_text, android_swipe_screen, android_press_phone_key, and android_wait_for_ui for controlled UI navigation when a higher-level app runtime tool does not exist yet.\n  6. Use android_notify_user, then android_return_to_jarvis_chat at the end of multi-step phone tasks.\n\nYOUTUBE PHONE SEARCH WORKFLOW — when the user asks to search YouTube on the phone, call android_youtube_search. It opens native YouTube search results and reads visible screen context.\n\nYOUTUBE RESEARCH WORKFLOW — when the user asks to research something on YouTube and summarize a video:\n  1. Call search_youtube (server-side) with the query to pick a reputable/high-signal video without touching the phone.\n  2. Call fetch_youtube_transcript with the chosen video ID.\n  3. Call android_open_phone_url with url='vnd.youtube://watch?v=VIDEO_ID' only after the content choice is made.\n  4. Summarize the transcript content for the user.\n  5. Call android_notify_user and android_return_to_jarvis_chat as final phone steps when this was a phone task.\n\nFLAG_SECURE APPS — android_capture_screen may fail for Facebook, Instagram, WhatsApp, Snapchat, streaming, banking, and camera apps. Use android_read_screen_context instead; it reads visible text, labels, and UI element context from accessibility.\n\nACTION FLOW for multi-step tasks: Use as many Phone Runtime tool-call turns as needed. After acting, read the screen to confirm the result before describing it. If a tool returns result:error, tell the user what failed and what you tried.\n\nSCREENSHOT DISPLAY — screenshots ARE shown inline in the Jarvis chat as temporary images:\nWhen android_capture_screen succeeds, the screenshot is stored as a temporary chat preview. Use the returned screenContext for reasoning unless a vision/OCR path has explicitly provided visual details.`
          : 'Desktop Daemon is ACTIVE. Use shell, notify, file_read, file_write, file_list actions. ALWAYS report errors immediately if a tool returns result:error. Use daemon_diagnostic (no args) to check daemon health before multi-step sequences or when ops are failing.'
        : '⚠️ NO DAEMON CONNECTED. Do NOT call daemon_action — it will fail with "daemon not connected". If the user asks to control their phone or computer, tell them exactly this: "Your phone device control isn\'t connected. To fix it: (1) Install/open the main Jarvis Android app, (2) Go to Profile and scroll to Android Device, (3) Tap Enable Device Control. The app uses the configured server URL automatically. The status dot should turn green within a few seconds." Do not attempt daemon_action until they confirm it\'s connected.';
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
        'sms', 'send text', 'text message', 'send a text', 'send message',
        'location', 'where am i', 'take photo', 'take a photo', 'snap a photo',
        'record screen', 'screen record', 'record video', 'camera clip',
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
      const phoneRuntimeCoveredRequest = androidActive && isPhoneRuntimeCoveredRequest(lastUserContent);
      const youtubeServerResearchRequest = androidActive && isYoutubeServerResearchRequest(lastUserContent);
      const keepDaemonActionFallback = androidActive && isDeviceControlRequest && !phoneRuntimeCoveredRequest && !youtubeServerResearchRequest;

      // Absolute prohibition injected at the TOP of the system message so the model
      // reads it before any other context. Without this, the model pattern-matches
      // against prior hallucinated assistant messages in the chat history and repeats them.
      const daemonAbsoluteRuleBase = androidActive
        ? `\n⚠️ ABSOLUTE RULE — DEVICE CONTROL: You have ZERO physical ability to open apps, take screenshots, tap, swipe, type, or perform any action on the phone through text alone. The ONLY normal way ANY phone action can happen is by calling an available deterministic Phone Runtime tool such as ${ANDROID_PHONE_RUNTIME_TOOL_NAMES.join(", ")} and receiving result:'success'. If no Phone Runtime tool is called, NOTHING happened on the phone. Prior conversation messages where you (the assistant) described performing phone actions without a successful phone tool call were ERRORS — do not repeat that pattern. For EVERY phone action request, call a Phone Runtime tool. Never write "I opened X" or "I took a screenshot" unless a Phone Runtime tool returned result:'success' in this response.\n`
        : '';

      const daemonAbsoluteRule = keepDaemonActionFallback
        ? daemonAbsoluteRuleBase
            .replace(
              /an available deterministic Phone Runtime tool such as [^.]+ and receiving result:'success'/,
              "an available deterministic Phone Runtime tool, or the daemon_action fallback exposed for this unsupported phone action, and receiving result:'success'",
            )
            .replace(
              /If no Phone Runtime tool is called/,
              "If no phone action tool is called",
            )
            .replace(
              /call a Phone Runtime tool/g,
              "call the exposed phone action tool",
            )
            .replace(
              /a Phone Runtime tool returned result:'success'/,
              "a Phone Runtime tool or daemon_action fallback returned result:'success'",
            )
        : daemonAbsoluteRuleBase;

      const lastUserOrigText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
      const youtubeCtxBlock = lastUserOrigText
        ? await buildYouTubeContextBlock(lastUserOrigText).catch(() => "")
        : "";

      const codexDelegationEnabled = isCodexDelegationEnabled();
      const buildInstruction = codexDelegationEnabled
        ? "When the user asks you to build, create, edit, inspect, or test a local code project or website, use delegate_to_codex so Codex can do the implementation work. If the user explicitly asks for the change to be permanent, pushed, published, deployed, or on GitHub, delegate that commit/push/publish requirement to Codex too and set allow_external_side_effects=true only for that exact requested action. If the user did not explicitly ask for commit/push/deploy, keep the work local and say that it still needs approval to be pushed."
        : "When the user asks you to build a standalone app, website, or landing page, use queue_background_job with agentType='app_project' so Jarvis can build it persistently in the hosted workspace.";
      const toolAwareRoute = classifyToolAwareRoute(lastUserOrigText);
      const phoneRuntimeRequiredToolNames = buildPhoneRuntimeRequiredToolNames(
        lastUserContent,
        isDeviceControlRequest,
        phoneRuntimeCoveredRequest,
      );
      const routeRequiredToolNames = uniqueToolNames([
        ...phoneRuntimeRequiredToolNames,
        ...(keepDaemonActionFallback ? ["daemon_action"] : []),
      ]);
      const effectiveToolAwareRoute = routeRequiredToolNames.length > 0
        ? {
            ...toolAwareRoute,
            priorityToolNames: uniqueToolNames([
              ...toolAwareRoute.priorityToolNames,
              ...routeRequiredToolNames,
            ]),
          }
        : toolAwareRoute;
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
          ...ANDROID_PHONE_RUNTIME_TOOL_NAMES,
        ];
        if (codexDelegationEnabled) directAgentToolNames.push("delegate_to_codex");
        directAgentToolNames.forEach((name) => addAgentTool(getTool(name)));
        if (toolAwareRoute.toolGroups.length > 0) {
          filterToolsByGroups(toolAwareRoute.toolGroups as ToolGroup[], resolvedGmailConnected)
            .forEach((tool) => addAgentTool(tool));
        }
        effectiveToolAwareRoute.priorityToolNames.forEach((name) => addAgentTool(getTool(name)));
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
          effectiveToolAwareRoute.priorityToolNames.forEach((name) => focusedToolNames.add(name));
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
        if (phoneRuntimeCoveredRequest) {
          ANDROID_PHONE_RUNTIME_TOOL_NAMES.forEach((name) => focusedToolNames.add(name));
        }
        phoneRuntimeRequiredToolNames.forEach((name) => focusedToolNames.add(name));
        if (keepDaemonActionFallback) {
          focusedToolNames.add("daemon_action");
        }
        if (isDiagnosticsRequest) {
          focusedToolNames.add("jarvis_self_diagnose");
        }
        toolAwareRoute.blockedToolNames.forEach((name) => focusedToolNames.delete(name));
        const useFocusedRequestTools = toolAwareRoute.shouldPreferTool || routeRequiredToolNames.length > 0;
        const focusedRequestTools =
          useFocusedRequestTools
            ? requestTools.filter((tool) => {
                const name = chatToolName(tool);
                return name ? focusedToolNames.has(name) : false;
              })
            : requestTools;
        const firstTurnToolPolicy = buildToolExecutionPolicy({
          route: effectiveToolAwareRoute,
          tools: focusedRequestTools,
          maxTurns: MAX_TOOL_TURNS,
          getToolName: (tool) => chatToolName(tool) ?? "",
          forceRequired: isDeviceControlRequest || isDiagnosticsRequest || isResearchRequest,
        });
        const usePhoneRuntimeToolSurfaceOnly = androidActive && (
          phoneRuntimeCoveredRequest ||
          keepDaemonActionFallback
        );
        const modelRequestTools = usePhoneRuntimeToolSurfaceOnly
          ? filterPhoneRuntimeModelTools(firstTurnToolPolicy.tools, {
              allowDaemonActionFallback: keepDaemonActionFallback,
              allowServerYoutubeTools: youtubeServerResearchRequest,
            })
          : firstTurnToolPolicy.tools;

        // Shared MCP tool context (pendingAttachments accumulate across turns)
        const mcpToolCtx: import("./agent/types").ToolContext = {
          userId,
          channel: originChannel,
          signal,
          state: {
            pendingAttachments: [],
            onProgress: (msg: string) => {
              openCoachSse(res);
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
                ANDROID_PHONE_RUNTIME_TOOL_NAMES.some((name) => responseText.includes(name)) ||
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
                openCoachSse(res);
                res.write(`data: ${JSON.stringify({ content: correctedResponse })}\n\n`);
                res.write('data: [DONE]\n\n');
                res.end();
                cleanupRun();
                return;
              }
              // Normal conversational response with no tools needed — stream it directly
              openCoachSse(res);
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
              runCoachChatSideEffects(userId, messages, openai);
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
            openCoachSse(res);
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
              openCoachSse(res);
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
            if (tc.function.name === 'daemon_action' || isAndroidPhoneRuntimeToolName(tc.function.name)) {
              hasDaemonActions = true;
              openCoachSse(res);
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
              const highLevelActionLabel: Record<string, string> = {
                android_open_app_by_name: 'Launching app on your phone...',
                android_youtube_search: 'Searching YouTube on your phone...',
                android_open_phone_url: 'Opening link on your phone...',
                android_capture_screen: 'Capturing your phone screen...',
                android_read_screen_context: 'Reading your phone screen...',
                android_tap_screen: 'Tapping the screen...',
                android_type_text: 'Typing on your phone...',
                android_swipe_screen: 'Swiping on your phone...',
                android_press_phone_key: 'Pressing phone key...',
                android_wait_for_ui: 'Waiting for the phone UI...',
                android_read_notifications: 'Checking notifications...',
                android_notify_user: 'Sending you a notification...',
                android_return_to_jarvis_chat: 'Returning to Jarvis...',
              };
              const workingMsg = highLevelActionLabel[tc.function.name] || actionLabel[String(args.action || '')] || 'Working on your phone...';
              touchVisibleProgress(workingMsg);
              emitMeaningfulProgress({
                source: "tool",
                stage: "tool_call",
                message: workingMsg,
                detail: tc.function.name === "daemon_action" ? `daemon_action:${String(args.action || "")}` : tc.function.name,
              });
              res.write(`data: ${JSON.stringify({ type: 'working', message: workingMsg })}\n\n`);
              startKeepalive();
            }

            // Before android_return_to_jarvis fires, pre-save any screenshot captured
            // so far as a pending response. This handles the edge case where Chrome
            // reloads (instead of just coming to foreground): the reloaded page fetches
            // the pending response on mount and can display the screenshot immediately.
            if (
              userId &&
              (
                (tc.function.name === 'daemon_action' && String(args.action) === 'android_return_to_jarvis') ||
                tc.function.name === 'android_return_to_jarvis_chat'
              )
            ) {
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
              openCoachSse(res);
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
                  openCoachSse(res);
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
                      openCoachSse(res);
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
            if (tc.function.name === 'android_capture_screen' && execResult.result === 'success') {
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
            const isAndroidRuntimeTool = tc.function.name === 'daemon_action' ||
              isAndroidPhoneRuntimeToolName(tc.function.name);
            if (isAndroidRuntimeTool && execResult.result === 'error') {
              const attemptedAction = tc.function.name === 'daemon_action'
                ? String(args.action || 'unknown')
                : tc.function.name;
              toolResultContent = `⛔ ANDROID PHONE ACTION FAILED — THE PHONE DID NOT EXECUTE THIS COMMAND.\nAction attempted: ${attemptedAction}\nError: ${execResult.detail || execResult.label}\n\nYou MUST tell the user this specific action FAILED. Do NOT describe it as successful. Do NOT invent what the phone showed or did.`;
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
          openCoachSse(res);
          writeCoachActionResults(res, actionResults, allMcpAttachments);
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
          runCoachChatSideEffects(userId, messages, openai);
          const lastUserMsgLoop = [...messages].reverse().find((m: any) => m.role === 'user');
          if (lastUserMsgLoop?.content) logInteraction(userId, "app_chat", "inbound", typeof lastUserMsgLoop.content === 'string' ? lastUserMsgLoop.content : JSON.stringify(lastUserMsgLoop.content)).catch(() => {});
          logInteraction(userId, "app_chat", "outbound", loopFinalText).catch(() => {});
          cleanupRun();
          return;
        }
      }

      openCoachSse(res);
      writeCoachActionResults(res, actionResults, allMcpAttachments);

      // Inject a hard error summary before the final synthesis if any daemon actions failed.
      // This prevents the AI from hallucinating success when tool calls returned errors.
      const failedDaemonActions = actionResults.filter((a) => (
        a.tool === 'daemon_action' || isAndroidPhoneRuntimeToolName(a.tool)
      ) && a.result === 'error');
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
      if (!signal.aborted && fullStreamedReply.trim().length === 0) {
        const noReplyError = new Error("Jarvis did not return a final response. If Phone Gemma is selected, the phone-local model may be busy, low on memory, or interrupted; try once more or switch to a cloud model.");
        if (userId) {
          void recordModelUsage({
            userId,
            provider: finalTurn.providerName ?? providerLabelForModel(streamedModel),
            model: streamedModel,
            source: "app_chat",
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            durationMs: Date.now() - streamStartedAt,
            success: false,
            metadata: {
              phase: "final_stream",
              emptyReply: true,
              actionCount: actionResults.length,
              attachmentCount: allMcpAttachments.length,
            },
          });
        }
        cleanupRun();
        if (!clientDisconnected) {
          writeCoachStreamError(res, noReplyError);
        }
        return;
      }

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
        runCoachChatSideEffects(userId, messages, openai);
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
        openCoachSse(res);
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

  // ── Web-chat invite tokens ────────────────────────────────────────────────
  // GET /api/webchat/invite/active — returns the owner's current unexpired token (if any)
  registerWebchatInviteRoutes(app, authMiddleware);

  registerCoachSessionRoutes(app, openai);

  registerCoachActionConfirmationRoutes(app, { pendingConfirmations, executeCoachTool, openai });

  registerCoachInsightRoutes(app, openai);

  registerBrainDumpRoutes(app, openai);

  registerIntegrationRoutes(app);

  registerCoachAudioRoutes(app);

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

  await registerPostCoachRoutes(app, { openai, authMiddleware });
  const httpServer = createServer(app);
  return httpServer;
}
