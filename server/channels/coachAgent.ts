import { db } from "../db";
import { eq, and, desc, sql, gte } from "drizzle-orm";
import * as schema from "@shared/schema";
import { runAgent } from "../agent/harness";
import { activationPlanner } from "../agent/activationPlanner";
import { parseChannelKey, resolveChannelTools } from "../agent/tools/channelTools";
import { getChannel } from "./registry";
import { getValidGoogleTokens } from "../userTokenStore";
import { getRecentEmailCommitments } from "../integrations/gmail";
import { getGoogleCalendarEvents } from "../integrations/googleCalendar";
import { getRecentInteractions, formatInteractionTimeline, logInteraction } from "../interactionLog";
import { getSoulPromptBlock } from "../memory/soul";
import { isUserPaired, isAndroidDaemonActive, isDesktopDaemonActive, isDaemonActionAllowed } from "../daemon/bridge";
import { buildYouTubeContextBlock } from "../utils/youtubeAutoFetch";
import type { ChannelAttachment } from "./types";
import { runOrchestrator } from "../agent/orchestrator";
import { preThink, postCheck } from "../agent/qualityLoop";
import { getModel, MODEL_DEFAULTS } from "../lib/modelPrefs";
import { contextRegistry } from "../agent/contextRegistry";
import { classifyBuildIntent } from "../agent/queryClassifier";
import { submitAgentJob } from "../agent/jobClient";
// Side-effect import: registers workspace topic context provider.
import "../agent/providers/topicContext";

export interface CoachReplyInput {
  userId: string;
  userText: string;
  channelName: string; // "Telegram" | "WhatsApp" | "Slack" | "Daemon" | "Discord"
  imageUrl?: string;
  /** Optional streaming callback — called with each ~25-char chunk of the final
   *  reply so callers can progressively update an external message (e.g. Discord
   *  message edits). Not called for intermediate tool-call turns. */
  onToken?: (chunk: string) => void;
  /** Discord guild (server) ID — set when the request originates from a Discord guild channel.
   *  Surfaced in ToolContext so Discord-specific tools (e.g. deleteDiscordChannel) can
   *  identify the server without requiring a pre-configured workspace. */
  discordGuildId?: string;
  /** Discord text channel ID — DM or guild channel. Used by the speak tool to deliver audio. */
  discordChannelId?: string;
  /**
   * SDK session ID for native session resumption (mirrors named-agent pattern).
   *
   * When provided the coach pipeline attempts to resume the cached conversation
   * state from the server-side session store (in-process cache → DB) and skips
   * the `chat_history` DB fetch for that turn. On the first message this field
   * is absent; a new session is initialised and the returned `sdkSessionId`
   * should be forwarded to the caller so it can resume on the next turn.
   */
  sdkSessionId?: string;
}

export interface CoachReplyResult {
  reply: string;
  /** Raw reply from the agent before channel-level fallback normalization.
   *  Empty string when the model produced no text (e.g. silent streaming failure).
   *  Use this to detect "no response" without string-matching the fallback message. */
  rawReply: string;
  attachments: ChannelAttachment[];
  /**
   * SDK session ID to be forwarded to the caller for the next turn.
   *
   * Always returned — either a newly created session ID (first turn) or the
   * existing session ID passed in (continuation turns). Callers should store
   * this and send it back on the next message so the coach can skip the
   * `chat_history` DB fetch and resume from the in-process / DB cache.
   */
  sdkSessionId?: string;
}

const FORMAT_HINTS: Record<string, string> = {
  Telegram: "You're responding via Telegram. Match response length to the request: short and direct for simple questions, but complete and thorough for research, analysis, planning, or anything that needs a full answer. Never truncate or redirect the user to the app — deliver the full response here. Plain text, no markdown headers.",
  WhatsApp: "You're responding via WhatsApp. Keep messages SHORT (2-4 sentences). Plain text. WhatsApp supports *bold*, _italic_, `code` only — no markdown headers.",
  Slack: "You're responding via Slack DM. Keep messages SHORT (2-4 sentences). Use Slack mrkdwn (*bold*, _italic_, `code`, > quote). No markdown headers.",
  Daemon: "You're responding to a desktop daemon. Plain text only. The user sees the reply as a desktop notification — keep it under 2 sentences when possible.",
  Discord: "You're responding via Discord. Keep responses SHORT — 2-4 sentences max. Your total response MUST be under 1800 characters. Discord renders **bold**, _italic_, `code`, ```blocks```. No headers. If a task needs many steps, pick the single most important next action and say it clearly.",
  Voice: "You're responding via voice / Talk Mode — your reply will be read aloud on a phone speaker. Plain text only. No markdown, bullet points, or special characters. Keep your answer to 1-3 short, natural spoken sentences. Be direct and conversational.",
};

function getMaxTokensForChannel(channelName: string): number {
  if (channelName.startsWith("Discord")) return 1200;
  if (channelName === "Daemon") return 200;
  if (channelName === "Voice") return 250;
  if (channelName === "Telegram") return 8000;
  return 2000;
}

// Channel-agnostic coach pipeline shared by Telegram / WhatsApp / Slack /
// daemon adapters. Returns { reply, attachments } — the caller is
// responsible for delivery and post-send bookkeeping.
/** Agent ID used as the namespace key in the claude session store for main coach turns. */
const COACH_AGENT_ID = "coach";

export async function runCoachAgent(input: CoachReplyInput): Promise<CoachReplyResult> {
  const { userId, userText, channelName, imageUrl, onToken, discordGuildId, discordChannelId } = input;
  const channelLower = channelName.toLowerCase();

  // ── Native session resumption (mirrors runNamedAgent pattern) ────────────────
  // When the caller provides a sdkSessionId, attempt to resume the cached
  // conversation from the server-side session store (in-process cache → DB).
  // On success the chat_history DB fetch is skipped and the cached message list
  // is used directly, saving a DB round-trip and accumulating history beyond
  // the 10-message rolling window that the DB-based path applies.
  let activeSessionId: string | undefined = input.sdkSessionId;
  let sessionResumed = false;
  let cachedSessionMessages: import("openai").default.Chat.Completions.ChatCompletionMessageParam[] = [];

  if (input.sdkSessionId) {
    try {
      const { resumeSession } = await import("../agent/providers/claude");
      const resumed = await resumeSession(input.sdkSessionId, COACH_AGENT_ID, userId);
      if (resumed) {
        cachedSessionMessages = resumed.messages;
        sessionResumed = true;
        console.log(
          `[coach] session resumed: sdkSessionId=${input.sdkSessionId} messages=${cachedSessionMessages.length}`,
        );
      } else {
        console.warn(
          `[coach] session not found, falling back to full history: sdkSessionId=${input.sdkSessionId}`,
        );
        activeSessionId = undefined;
      }
    } catch (err) {
      console.warn("[coach] session resume error, falling back:", err);
      activeSessionId = undefined;
    }
  }

  let userGoals: any[] = [];
  let userStats: any = {};
  let userLifeContext: any = null;
  let userCommitments: any[] = [];
  let chatMessages: any[] = [];
  let gmailItems: any[] = [];
  let calendarEvents: any[] = [];
  let gmailConnected = false;
  let googleAccessToken: string | null = null;
  let recentlySurfacedItems: any[] = [];

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const _quickDateStr = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  // Resolve the per-user orchestrator model once, then immediately chain preThink
  // so it fires with the correct model as soon as the DB row lands — still fully
  // parallel with the other DB queries below (zero net latency on the hot path).
  const _orchestratorModelPromise = getModel(userId, "orchestrator");
  const _preThinkPromise = _orchestratorModelPromise.then((m) =>
    preThink(userText || "", channelName + " " + _quickDateStr, m),
  );

  // ── Fire Google token lookup immediately so Gmail/Calendar API calls can
  // start in parallel with the main DB batch instead of waiting for it. ──
  const googleTokensPromise = getValidGoogleTokens(userId);
  // Tentative date key using UTC — close enough for most users to start
  // calendar fetches early; the real dateKey (timezone-adjusted) is
  // computed after prefs resolve and used for everything else.
  const _nowUtc = new Date();
  const tentativeDateKey = `${_nowUtc.getUTCFullYear()}-${String(_nowUtc.getUTCMonth() + 1).padStart(2, "0")}-${String(_nowUtc.getUTCDate()).padStart(2, "0")}`;
  // Non-throwing: any failure in token lookup or API calls degrades Gmail/Calendar
  // context gracefully instead of propagating up and failing the whole coach turn.
  const googleDataPromise = googleTokensPromise.then(async (tokens) => {
    if (!tokens || tokens.length === 0) return null;
    const [emailResult, ...calResults] = await Promise.allSettled([
      getRecentEmailCommitments(14, tokens[0]),
      ...tokens.map((t) => getGoogleCalendarEvents(tentativeDateKey, undefined, undefined, t)),
    ]);
    return { tokens, emailResult, calResults };
  }).catch((err) => {
    console.error("[coach] googleDataPromise error (non-fatal, degraded context):", err);
    return null;
  });

  const [goalsRow, statsRow, lcRow, chatRow, commitmentsRows, prefsRow, recentInteractionsResult, surfacedItemsResult, soulBlockResult, websiteCrawlResult, todayPlanRow, orchestratorModelResult, preThinkResult] = await Promise.allSettled([
    db.select().from(schema.goals).where(eq(schema.goals.userId, userId)).limit(1),
    db.select().from(schema.stats).where(eq(schema.stats.userId, userId)).limit(1),
    db.select().from(schema.lifeContext).where(eq(schema.lifeContext.userId, userId)).limit(1),
    // Skip chat_history fetch when the session cache is warm — the cached
    // message list replaces the rolling 10-message DB window.
    sessionResumed
      ? Promise.resolve([] as any[])
      : db.select().from(schema.chatHistory).where(eq(schema.chatHistory.userId, userId)).limit(1),
    db.select().from(schema.commitments)
      .where(and(eq(schema.commitments.userId, userId), eq(schema.commitments.status, "pending")))
      .orderBy(desc(schema.commitments.extractedAt)).limit(10),
    db.select().from(schema.userPreferences).where(eq(schema.userPreferences.userId, userId)).limit(1),
    getRecentInteractions(userId, 20),
    db.select({
      sourceType: schema.inboxItems.sourceType,
      subject: schema.inboxItems.subject,
      sender: schema.inboxItems.sender,
      snippet: schema.inboxItems.snippet,
      jarvisReason: schema.inboxItems.jarvisReason,
      surfacedAt: schema.inboxItems.surfacedAt,
    })
      .from(schema.inboxItems)
      .where(and(
        eq(schema.inboxItems.userId, userId),
        gte(schema.inboxItems.surfacedAt, twentyFourHoursAgo),
      ))
      .orderBy(desc(schema.inboxItems.surfacedAt))
      .limit(5),
    // Soul and website crawl blocks are independent of DB results — run them
    // concurrently with the rest of the batch instead of serially after it.
    getSoulPromptBlock(userId),
    (async () => {
      try {
        const { getWebsiteCrawlSummaryBlock } = await import("../websiteCrawler");
        return await getWebsiteCrawlSummaryBlock(userId);
      } catch { return ""; }
    })(),
    // todayPlan — fetched with tentative UTC date key so it runs in the
    // parallel batch; reconciled below if the user's timezone-adjusted date
    // differs from the UTC date (rare, only near day boundaries).
    db.select().from(schema.plans)
      .where(and(eq(schema.plans.userId, userId), eq(schema.plans.date, tentativeDateKey)))
      .limit(1),
    // Resolved per-user orchestrator model (already fired above).
    _orchestratorModelPromise,
    // Pre-think fires as soon as the model resolves (already chained above).
    _preThinkPromise,
  ]);

  logInteraction(userId, channelLower as any, "inbound", userText || "[image]").catch(() => {});

  let userTimezone = "America/New_York";
  if (goalsRow.status === "fulfilled") userGoals = (goalsRow.value[0]?.data as any[]) || [];
  if (statsRow.status === "fulfilled") userStats = statsRow.value[0]?.data || {};
  if (lcRow.status === "fulfilled") userLifeContext = lcRow.value[0]?.data || null;
  if (chatRow.status === "fulfilled") chatMessages = (chatRow.value[0]?.data as any[]) || [];
  if (commitmentsRows.status === "fulfilled") userCommitments = commitmentsRows.value;
  if (prefsRow.status === "fulfilled") {
    const prefs = (prefsRow.value[0]?.data as any) || {};
    if (prefs.timezone) userTimezone = prefs.timezone;
  }
  if (surfacedItemsResult.status === "fulfilled") {
    recentlySurfacedItems = surfacedItemsResult.value;
  }

  const orchestratorModel: string =
    orchestratorModelResult.status === "fulfilled"
      ? orchestratorModelResult.value
      : MODEL_DEFAULTS.orchestrator;

  const turnGuidance: string =
    preThinkResult.status === "fulfilled" ? (preThinkResult.value as string) : "";

  // Soul and website crawl blocks were fetched in the parallel batch above.
  const soulBlock = soulBlockResult.status === "fulfilled" ? soulBlockResult.value : "";
  let websiteCrawlBlock = websiteCrawlResult.status === "fulfilled" ? websiteCrawlResult.value : "";

  const localForDateKey = new Date(new Date().toLocaleString("en-US", { timeZone: userTimezone }));
  const dateKey = `${localForDateKey.getFullYear()}-${String(localForDateKey.getMonth() + 1).padStart(2, "0")}-${String(localForDateKey.getDate()).padStart(2, "0")}`;

  // todayPlan was fetched in the parallel batch with tentativeDateKey (UTC).
  // Use that result directly in the common case; re-fetch only when the user's
  // real timezone-adjusted date differs (rare — only near UTC day boundaries).
  let todayPlan: any = null;
  if (todayPlanRow.status === "fulfilled") {
    todayPlan = (todayPlanRow.value[0]?.data as any) || null;
  }
  if (dateKey !== tentativeDateKey) {
    try {
      const planRows = await db.select().from(schema.plans)
        .where(and(eq(schema.plans.userId, userId), eq(schema.plans.date, dateKey))).limit(1);
      todayPlan = (planRows[0]?.data as any) || null;
    } catch (err) {
      console.error("[coach] plan re-fetch (timezone reconcile) failed:", err);
    }
  }

  // Join the Google data promise that was fired in parallel with the DB batch.
  const googleRaw = await googleDataPromise;
  if (googleRaw) {
    gmailConnected = true;
    googleAccessToken = googleRaw.tokens[0];
    const { emailResult, calResults } = googleRaw;
    if (emailResult.status === "fulfilled") gmailItems = emailResult.value;
    const seenEventIds = new Set<string>();
    for (const calResult of calResults) {
      if (calResult.status === "fulfilled") {
        for (const ev of calResult.value) {
          if (!seenEventIds.has(ev.id)) {
            seenEventIds.add(ev.id);
            calendarEvents.push(ev);
          }
        }
      }
    }
    // If the user's real date differs from the UTC tentative key used to kick
    // off the early calendar fetch, re-fetch with the correct date so events
    // from the right day are shown (affects users near timezone day boundaries).
    if (dateKey !== tentativeDateKey) {
      try {
        const reCalResults = await Promise.allSettled(
          googleRaw.tokens.map((t) => getGoogleCalendarEvents(dateKey, undefined, undefined, t)),
        );
        calendarEvents = [];
        const seenIds2 = new Set<string>();
        for (const calResult of reCalResults) {
          if (calResult.status === "fulfilled") {
            for (const ev of calResult.value) {
              if (!seenIds2.has(ev.id)) {
                seenIds2.add(ev.id);
                calendarEvents.push(ev);
              }
            }
          }
        }
      } catch (err) {
        console.error("[coach] calendar re-fetch (timezone reconcile) failed:", err);
      }
    }
  }

  // When the session was resumed the cached messages replace the DB window;
  // otherwise fall back to the last 10 messages from the chat_history table.
  const recentMessages = sessionResumed
    ? cachedSessionMessages.filter((m) => m.role !== "system")
    : chatMessages.slice(0, 10).reverse();
  const now = new Date();
  const dayOfWeek = now.toLocaleDateString("en-US", { weekday: "long" });
  const dateStr = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const goalsText = userGoals.length > 0
    ? userGoals.map((g: any) => `- ${g.title} (${g.category}): ${g.current}/${g.target} ${g.unit}`).join("\n")
    : "No goals set";

  const commitmentsText = userCommitments.length > 0
    ? userCommitments.map((c: any) => `- [id:${c.id}] "${c.content}"${c.dueDate ? ` (due ${c.dueDate})` : ""}`).join("\n")
    : "";

  const calendarText = calendarEvents.length > 0
    ? calendarEvents.slice(0, 8).map((e: any) => `- ${e.time ? e.time + ": " : ""}${e.title}`).join("\n")
    : "";

  const gmailSection = gmailItems.length > 0
    ? `## Recent Emails (last 14 days)\n` +
      gmailItems.slice(0, 100).map((i: any) => `- [id:${i.id}] From: ${i.from || "unknown"} | "${i.subject}" — ${i.snippet}`).join("\n")
    : gmailConnected
      ? `## Recent Emails\nGmail is connected but no emails found.`
      : `## Recent Emails\nGmail not connected.`;

  const recentInteractions = recentInteractionsResult.status === "fulfilled" ? recentInteractionsResult.value : [];
  const crossChannelSection = formatInteractionTimeline(recentInteractions);

  const recentlySurfacedSection = recentlySurfacedItems.length > 0
    ? `## Items You Already Surfaced to the User (last 24h)\nThese were found and sent to the user earlier — you already have this data. Reference it directly when the user asks about it instead of claiming you don't have it or asking them to repeat it.\n` +
      recentlySurfacedItems.map((item: any) => {
        let timestamp = "";
        if (item.surfacedAt) {
          const d = new Date(item.surfacedAt);
          timestamp = d.toLocaleString("en-US", {
            timeZone: userTimezone,
            month: "short", day: "numeric",
            hour: "numeric", minute: "2-digit", hour12: true,
          });
        }
        const parts: string[] = [];
        if (item.subject) parts.push(`Subject: "${item.subject}"`);
        if (item.sender) parts.push(`From: ${item.sender}`);
        if (item.snippet) parts.push(`Content: ${item.snippet}`);
        if (item.jarvisReason) parts.push(`Why surfaced: ${item.jarvisReason}`);
        return `- [${item.sourceType || "item"}${timestamp ? ` @ ${timestamp}` : ""}] ${parts.join(" | ")}`;
      }).join("\n")
    : "";

  const formatHintKey = Object.keys(FORMAT_HINTS).find((k) => channelName.startsWith(k)) ?? "Telegram";
  const formatHint = FORMAT_HINTS[formatHintKey];

  const selfImprovementSection = `\n## Self-Improvement: Building New Jarvis Tools
You can extend yourself by building new tools directly. Generate the complete TypeScript code for the tool yourself and call \`build_feature\` to write it to disk, register it in the tool index, and run a smoke test — all in one step.

**When to build a new tool**: The user asks for a new Jarvis capability that doesn't exist yet (e.g. "add a tool to check stock prices", "build a Notion integration", "add a command to summarize my day").

**How to build**: Think through what the tool needs to do, write the full TypeScript code following the AgentTool pattern, then call \`build_feature\` with feature_name, description, and tool_code (the complete file content). The tool must export a const of type AgentTool.

**After building**: The tool is written to disk and smoke tested automatically. The server restarts automatically so the new tool is active in a few seconds. Report the outcome to the user — success means the tool is now active, failure means the code needs fixing (call \`build_feature\` again with corrected tool_code).

**Manual re-testing**: Use \`test_tool\` to re-run the smoke test on any built tool by name without rebuilding it.

**Build history**: All builds are logged and viewable in Settings → Build History.`;


  const androidActive = isAndroidDaemonActive(userId);
  const desktopActive = isDesktopDaemonActive(userId);
  const daemonPaired = isUserPaired(userId);
  const shellAllowed = desktopActive ? await isDaemonActionAllowed(userId, "shell").catch(() => false) : false;
  const daemonLines: string[] = [];
  if (desktopActive) {
    if (shellAllowed) {
      daemonLines.push("- Desktop daemon is ACTIVE with shell execution enabled. Use **daemon_shell** to run scripts, build apps, run tests, execute local automation, or do any computation on the user's machine. Prefer daemon_shell over daemon_action for shell commands — it surfaces stdout, stderr, and exit code cleanly. Use daemon_action for file reads, desktop notifications, and screenshots.");
    } else {
      daemonLines.push("- Desktop daemon is ACTIVE. You can send desktop notifications, read/write files in the workspace, and take screenshots. Shell execution is disabled — the user can enable it in Profile → Connected Channels → Desktop Daemon → Permissions.");
    }
  }
  if (androidActive) daemonLines.push("- Android device daemon is ACTIVE. You can open apps (android_open_app), take screenshots (android_screenshot), read the screen (android_read_screen), browse URLs (android_browse), list/read files on the device (android_file_list/android_file_read). Tap/type/swipe actions are available when user enables them. Proactively mention Android capabilities when relevant.");
  const daemonSection = daemonPaired
    ? `## Connected Devices\n${daemonLines.join("\n")}${shellAllowed ? "\n\n**daemon_shell usage**: Call daemon_shell proactively when the user asks to run a script, build an app, run tests, read a local log, execute a cron job, or do any local computation. Don't describe what you'd do — just run the command and show the result." : ""}`
    : "## Android Daemon Setup Guidance (no daemon paired)\nIf the user asks how to install or set up the Android daemon, give them these steps:\n1. In the Jarvis app → Profile → Connected Channels → Android Device → tap Pair to get an 8-character code.\n2. Build the APK: open android-daemon/ in Android Studio → Build → Generate Signed Bundle/APK → APK → debug. Or run `gradle wrapper --gradle-version 8.4` then `./gradlew assembleDebug` from the android-daemon/ directory.\n3. Transfer the APK to the Android phone and install it (Settings → Apps → Special app access → Install unknown apps → allow your file manager).\n4. Open the app → enter the server URL + the 8-character code → tap Connect.\n5. Grant the two permissions the app requests: Accessibility Service (Settings → Accessibility → Jarvis Daemon → enable) and All Files Access.\n6. The app stays connected in the background and reconnects automatically after reboots or Wi-Fi drops.";

  const systemPrompt = `You are GamePlan Coach Jarvis — a sharp, supportive personal productivity coach. ${formatHint}

Today is ${dayOfWeek}, ${dateStr}. User's timezone: ${userTimezone}.
${crossChannelSection}

${soulBlock}${websiteCrawlBlock}

## User Profile
- Streak: ${userStats.streak || 0} days
- Total completed: ${userStats.totalCompleted || 0}
- XP: ${userStats.xp || 0}

## Active Goals
${goalsText}
${commitmentsText ? `\n## Open Commitments\n${commitmentsText}` : ""}
${calendarText ? `\n## Today's Calendar\n${calendarText}` : ""}

${gmailSection}
${recentlySurfacedSection ? `\n${recentlySurfacedSection}` : ""}
${userLifeContext?.priorityGoal ? `\n## Context\n- Priority: ${userLifeContext.priorityGoal}` : ""}
${daemonSection ? `\n${daemonSection}` : ""}

You can manage tasks, commitments, and analyze patterns via the manage_tasks tool. You can act on emails via the gmail_action tool. You can run safe shell commands, send desktop notifications, or read/write files in the user's workspace via the daemon_action tool when a desktop daemon is paired. When an Android device daemon is paired, use android_* actions to control the phone — open apps, browse, screenshot, read the screen, and access files. Always confirm with the user before tap/type/swipe actions. Use these proactively when the user asks to do something — don't just describe what you'd do. Respond in the same language the user writes in.

## Media generation
- **image_generate** — generate an image and deliver it inline. Use model "dalle" (default, fast) for illustrations and concept art. Use model "flux" when the user asks for photorealistic, high-quality, or artistic images (FLUX requires INFSH_API_KEY).
- **generate_video** — generate a short AI video (2-6 min generation time; warn the user). Use for animated scenes, cinematic clips, or any explicit video request. Requires INFSH_API_KEY. Always tell the user it will take a few minutes before calling the tool.
- Never generate media unless the user explicitly requests it or a visual would meaningfully enhance the response.${selfImprovementSection}

## Self-Inspection & Code Proposals
You have three self-edit tools — list_source_files, read_source_file, and propose_code_change. Use them when: (a) the user asks you to "look at your own code", "inspect yourself", "improve your tools", or "fix a bug you noticed"; OR (b) you encounter a repeated failure and believe you can fix it with a targeted code change. Workflow: (1) call list_source_files to find the relevant file, (2) call read_source_file to read it fully, (3) call propose_code_change with the complete improved file content and a plain-English reason. The proposal is saved for user review — you NEVER write files directly. Keep proposals minimal and targeted: fix one specific issue per proposal. After proposing, tell the user a suggestion is waiting in the Code Proposals screen for their review.

## Autonomous background jobs
When a user's request involves multi-step research, drafting a document or plan, or composing an email — anything that would take more than a quick lookup — call the queue_background_job tool immediately instead of answering inline. This queues the work for a background sub-agent and lets you reply instantly. After calling the tool, tell the user: "I've queued that — you'll get a notification when it's done." Do not attempt to do the research or drafting yourself in the same turn. Examples of requests that MUST use queue_background_job:
- "research my competitors", "find me market data on X", "look into Y"
- "write a memo/proposal/blog post about X", "draft a document for Y"
- "make a plan for Z", "break down this project", "create an action plan"
- "write an email to X", "draft a message to Y", "compose an outreach to Z"

**Domain context in job descriptions**: When you formulate a background job prompt from a follow-up message, carry the full conversation domain into the prompt — not just the literal words of the latest message. The sub-agent has no access to conversation history. Example: if the conversation is about finding pets to adopt and the user says "find shelters in that area", the job prompt must say "find animal shelters in [city] — this is part of a search to adopt a cat" so the sub-agent returns the right kind of results. Always ask yourself: what is this conversation actually about? Include that topic explicitly in every job description.

**Capability note**: When a user asks you to research something, do NOT say "I can't browse websites" — that is misleading. You CAN search the web by queuing a research background job. Always tell the user: "I'll queue a research job that searches the web and delivers findings to your inbox."

**Strictly prohibited**: Never attempt to write research, competitive analysis, or fact-finding content inline. Even if you think you know the answer, you MUST queue a research background job for any request containing words like "research", "look into", "find out about", "what is X", "how does X work", or requests for facts about external products/people/companies. The research sub-agent uses real web search — you do not.

**EXCEPTION — YouTube transcript already in context**: If the user's message contains a YouTube link and the transcript appears above (marked "TRANSCRIPT AUTO-FETCHED"), the transcript is already available. Reply inline immediately with a full summary or answer. Do NOT call queue_background_job for YouTube video summaries when the transcript is already present in this message.

## Critical rules — no empty promises
**Act, don't announce**: If you say you will do something (create a document, save data, log an entry, send a message, post to a channel), you MUST call the relevant tool in that same response. Never say you will do something and then fail to do it. There is no "I'll do that now" without an immediate tool call.

**Discord channel creation and cross-channel posting are exceptions to 'Act, don't announce'**: For discord_create_channel and discord_post, you MUST use the following two-turn flow:
1. Call discord_request_confirm (with the appropriate action and question) — this registers a server-side token and returns the question to relay to the user.
2. Send the returned question to the user and wait for an explicit 'yes', 'confirm', 'go ahead', or equivalent.
3. Only then call discord_create_channel or discord_post in the next turn.
If you skip step 1 (calling discord_request_confirm), the action tool will be rejected even if the user said 'yes'. 'A', 'B', or a choice between options does NOT count as confirmation. If the user takes longer than 5 minutes to reply, call discord_request_confirm again before proceeding.

**If you can't act yet**: If you are genuinely missing required data to take the action, say exactly what one piece of information is missing and ask for only that. Do not say "I'll do it" and then ask five clarifying questions. One missing piece = one question, then act.

**No circular clarification**: Do not ask for data you already have. Before asking the user for an amount, date, vendor, or reference — check the "Items You Already Surfaced" section of your context. If the data is there, use it directly without asking.

**Fail explicitly**: If a tool call returns an error or fails, tell the user specifically what went wrong. Do not silently continue or pretend the action succeeded.`;

  const youtubeCtx = await buildYouTubeContextBlock(userText || "").catch(() => "");
  const enrichedUserText = userText + youtubeCtx;

  // When a transcript was auto-fetched, append a hard constraint to the system
  // context so the orchestrator's decompose/execute/synthesize steps all see it.
  const youtubeInlineConstraint = youtubeCtx
    ? "\n\n## MANDATORY: YouTube transcript inline reply\nA YouTube transcript has been pre-loaded in this request (marked TRANSCRIPT AUTO-FETCHED). You MUST summarise or answer the question inline in this single reply. NEVER call queue_background_job for this request."
    : "";
  const turnStrategyBlock = turnGuidance
    ? `\n\n## Turn Strategy\n${turnGuidance}`
    : "";
  const effectiveSystemPromptBase = systemPrompt + youtubeInlineConstraint + turnStrategyBlock;

  // ── Context registry: inject registered provider context ────────────────────
  // Derive a normalised platform string for providers that need it.
  const registryPlatform = channelName.toLowerCase().startsWith("discord")
    ? "discord"
    : channelName.toLowerCase();
  const registryCtx = await contextRegistry.build({
    userId,
    platform: registryPlatform,
    channelId: discordChannelId || undefined,
    userMessage: enrichedUserText,
  }).catch(() => ({ systemContext: "", prependContext: "", appendContext: "" }));
  const effectiveSystemPrompt = registryCtx.systemContext
    ? `${effectiveSystemPromptBase}\n\n${registryCtx.systemContext}`
    : effectiveSystemPromptBase;

  const userMessageContent = imageUrl
    ? [
        { type: "text" as const, text: enrichedUserText || "What do you see in this image?" },
        { type: "image_url" as const, image_url: { url: imageUrl } },
      ]
    : enrichedUserText;

  // Build the message list for the harness / fallback path.
  // On session resumption the cached messages already carry proper OpenAI
  // types (including tool_call turns); the fresh system prompt replaces the
  // stale one so real-time context (calendar, Gmail, …) stays current.
  const baseMessages: import("openai").default.Chat.Completions.ChatCompletionMessageParam[] = sessionResumed
    ? [
        { role: "system" as const, content: effectiveSystemPrompt },
        ...recentMessages as import("openai").default.Chat.Completions.ChatCompletionMessageParam[],
        { role: "user" as const, content: userMessageContent },
      ]
    : [
        { role: "system" as const, content: effectiveSystemPrompt },
        ...recentMessages.map((m: { role: string; content: string }) => ({
          role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
          content: m.content,
        })),
        { role: "user" as const, content: userMessageContent },
      ];

  const agentCtx: import("../agent/types").ToolContext = {
    userId,
    channel: channelName,
    googleAccessToken: googleAccessToken || undefined,
    discordGuildId: discordGuildId || undefined,
    discordChannelId: discordChannelId || undefined,
    state: {
      dateKey,
      todayPlan,
      gmailMessageIds: gmailItems.map((i: { id?: string }) => i.id).filter((id): id is string => !!id),
      pendingAttachments: [],
      // Forward MCP progress notifications as streaming tokens so channels show live progress
      onProgress: onToken ? (msg: string) => onToken(`[progress] ${msg}`) : undefined,
    },
  };

  // ── Resolve scoped tool list for this channel (caller-side pre-filter) ───────
  // parseChannelKey normalises display names like "Discord #research" → "discord"
  // without any `as any` cast.  resolveChannelTools uses the channel's declared
  // toolGroups to build the pre-filtered list that is passed to runAgent.
  // The harness applies the same filter again as the authoritative safety gate,
  // so the two reinforce each other without either being solely relied upon.
  const scopedTools = await resolveChannelTools(channelName, !!googleAccessToken);
  const canonicalKey = parseChannelKey(channelName);
  const registeredChannel = canonicalKey ? getChannel(canonicalKey) : undefined;
  console.log(
    `[${channelName}] tool scope: ${scopedTools.length} tools` +
    (registeredChannel ? ` (groups: ${registeredChannel.toolGroups.join(", ")})` : " (fallback groups)"),
  );

  // ── Activation planner — run before the model session ─────────────────────
  // Channel sessions always run (shouldRun is always true for explicit user
  // messages), but the planner injects session context (focus areas, urgent
  // signals, energy state, top predictions) into the system prompt so the
  // model is primed with what to focus on this turn.
  //
  // upcomingMeetingMinutes: compute from the already-fetched calendarEvents.
  // We look for the nearest event starting within the next 60 minutes so the
  // planner can activate calendar + email tools before the meeting starts.
  let upcomingMeetingMinutes: number | undefined;
  if (calendarEvents.length > 0) {
    const nowMs = Date.now();
    let minMinutes = Infinity;
    for (const ev of calendarEvents) {
      try {
        const startMs = new Date(ev.start).getTime();
        const diffMinutes = (startMs - nowMs) / 60000;
        if (diffMinutes >= 0 && diffMinutes < 60 && diffMinutes < minMinutes) {
          minMinutes = diffMinutes;
        }
      } catch {
        // non-fatal — skip malformed event
      }
    }
    if (minMinutes < Infinity) {
      upcomingMeetingMinutes = Math.round(minMinutes);
    }
  }

  let channelActivationPlan: import("../agent/activationPlanner").ActivationPlan | undefined;
  try {
    channelActivationPlan = await activationPlanner.plan(userId, {
      source: "channel",
      channel: channelName,
      queryText: userText,
      upcomingMeetingMinutes,
    });
    console.log(`[${channelName}] activation: shouldRun=${channelActivationPlan.shouldRun} — ${channelActivationPlan.reason}`);
  } catch (err) {
    // Best-effort — never block a channel session
    console.warn(`[${channelName}] activation planner failed (non-fatal):`, err);
  }

  // ── Build-intent short-circuit ────────────────────────────────────────────
  // Detect "build a tool / add a feature / write a script" requests and route
  // directly to the build_feature background job — same pattern as research.
  // This bypasses the orchestrator entirely and returns an immediate ack so
  // the user knows the build is queued.
  if (userText && classifyBuildIntent(userText)) {
    const buildTitle = `Build: ${userText.slice(0, 80)}${userText.length > 80 ? "…" : ""}`;
    const buildPrompt = userText;
    const buildInput: Record<string, unknown> = { originChannel: channelName };
    if (discordChannelId) buildInput.originDiscordChannelId = discordChannelId;
    // Carry the last 6 messages (stored newest-first) into the job so the build
    // agent can understand follow-up requests like "now add error handling".
    const recentForBuild = chatMessages
      .slice(0, 6)
      .reverse()
      .map((m: { role: string; content: string }) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`)
      .join("\n");
    if (recentForBuild) buildInput.conversationContext = recentForBuild;
    try {
      const jobId = await submitAgentJob({
        userId,
        agentType: "build_feature",
        title: buildTitle,
        prompt: buildPrompt,
        input: buildInput,
      });
      const ackReply =
        "Got it — I've queued that build job. I'll notify you when the new tool is ready (usually takes a minute or two).";
      console.log(
        `[${channelName}] build intent detected — queued build_feature job=${jobId} user=${userId}`,
      );
      // Minimal chat-history save so the next turn has context.
      const userMsgEntry = { id: Date.now().toString(), role: "user", content: userText };
      const asstMsgEntry = { id: (Date.now() + 1).toString(), role: "assistant", content: ackReply };
      const updatedChatBuild = [asstMsgEntry, userMsgEntry, ...chatMessages].slice(0, 100);
      db.insert(schema.chatHistory)
        .values({ userId, data: updatedChatBuild })
        .onConflictDoUpdate({
          target: schema.chatHistory.userId,
          set: { data: updatedChatBuild, updatedAt: new Date() },
        })
        .catch((err: unknown) => console.error("[coach] build-intent chat history persist failed:", err));
      logInteraction(userId, channelLower as any, "outbound", ackReply).catch(() => {});
      // Return the existing session ID (if any) so clients can resume on the next turn.
      // A new session is not initialised here because the build job runs asynchronously;
      // the next user message (checking on progress etc.) will start a fresh session then.
      return { reply: ackReply, rawReply: ackReply, attachments: [], sdkSessionId: activeSessionId };
    } catch (buildErr) {
      console.error(`[${channelName}] build intent job submission failed (falling through to orchestrator):`, buildErr);
      // Fall through to normal orchestrator path on submission error.
    }
  }

  // ── Orchestrator ──────────────────────────────────────────────────────────
  // Always route through the orchestrator — it is the foundational execution
  // architecture. Falls back to direct harness on any orchestrator error.
  let rawReply: string;
  console.log(`[${channelName}] routing through orchestrator`);
  try {
    const orchResult = await runOrchestrator({
      userId,
      userRequest: enrichedUserText,
      systemContext: effectiveSystemPrompt,
      tools: scopedTools,
      toolContext: agentCtx,
      maxCompletionTokens: getMaxTokensForChannel(channelName),
    });
    rawReply = orchResult.finalAnswer;
    console.log(
      `[${channelName}] orchestrator done — tasks=${orchResult.subtaskCount}, retries=${orchResult.retryCount}, traceId=${orchResult.traceId}`,
    );
  } catch (orchErr) {
    console.error(`[${channelName}] orchestrator failed, falling back to direct harness:`, orchErr);
    const fallback = await runAgent({
      model: "gpt-4o-mini",
      messages: baseMessages,
      tools: scopedTools,
      context: agentCtx,
      maxTurns: 6,
      maxCompletionTokens: getMaxTokensForChannel(channelName),
      onToken,
      activationPlan: channelActivationPlan,
    });
    rawReply = fallback.reply;
  }

  // ── Post-check quality gate ────────────────────────────────────────────────
  // Ask the orchestrator model whether the reply adequately addressed the user's
  // request.  On failure, fire a single corrective harness retry with the
  // failure reason injected.  Errors/timeouts are fail-open (never block reply).
  let postCheckPassed = true;
  let retried = false;
  if (rawReply) {
    const checkUserText = userText || "[image-only message]";
    try {
      const checkResult = await postCheck(checkUserText, rawReply, orchestratorModel);
      postCheckPassed = checkResult.passed;
      if (!checkResult.passed) {
        const correctionFeedback = checkResult.feedback ||
          "Answer did not fully address the request; provide a complete direct response.";
        const correctionPrompt =
          effectiveSystemPrompt +
          `\n\n## Quality correction: ${correctionFeedback}`;
        const correctionMessages: import("openai").default.Chat.Completions.ChatCompletionMessageParam[] = [
          { role: "system" as const, content: correctionPrompt },
          ...baseMessages.slice(1),
        ];
        retried = true;
        try {
          const correction = await runAgent({
            model: "gpt-4o-mini",
            messages: correctionMessages,
            tools: scopedTools,
            context: agentCtx,
            maxTurns: 4,
            maxCompletionTokens: getMaxTokensForChannel(channelName),
            activationPlan: channelActivationPlan,
          });
          if (correction.reply) {
            rawReply = correction.reply;
          }
        } catch (retryErr) {
          console.warn(`[${channelName}] quality correction retry failed (non-blocking):`, retryErr);
        }
      }
    } catch (checkErr) {
      console.warn(`[${channelName}] post-check failed (non-blocking):`, checkErr);
    }
  }

  console.log(
    `[qualityLoop] guidance="${turnGuidance.slice(0, 80)}" postCheck=${postCheckPassed ? "passed" : "failed"} retried=${retried}`,
  );

  const reply = rawReply || "Sorry, I couldn't generate a response right now.";
  const attachments = (agentCtx.state.pendingAttachments || []) as ChannelAttachment[];

  // ── Session management — update or initialise after successful run ────────────
  // Mirror the runNamedAgent pattern:
  //   • First turn (no sdkSessionId or expired fallback): init a new session
  //     from the complete message list so the next turn can resume cheaply.
  //   • Continuation turns (sessionResumed): append only the new exchange
  //     (user message + assistant reply) to keep the session up-to-date.
  const newUserMsg  = { role: "user"      as const, content: userText };
  const newAssistMsg = { role: "assistant" as const, content: reply   };

  let finalSessionId: string | undefined = activeSessionId;
  try {
    const { initSession, appendToSession } = await import("../agent/providers/claude");
    if (sessionResumed && activeSessionId) {
      appendToSession(activeSessionId, COACH_AGENT_ID, userId, [newUserMsg, newAssistMsg]).catch(() => {});
    } else {
      // Build the full message list for the new session:
      // system prompt + prior history (from DB or empty) + new exchange.
      const priorHistory: import("openai").default.Chat.Completions.ChatCompletionMessageParam[] = chatMessages
        .slice(0, 10)
        .reverse()
        .map((m: { role: string; content: string }) => ({
          role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
          content: m.content,
        }));

      finalSessionId = await initSession(COACH_AGENT_ID, userId, [
        { role: "system" as const, content: effectiveSystemPrompt },
        ...priorHistory,
        newUserMsg,
        newAssistMsg,
      ]);
      console.log(`[coach] session initialised: sdkSessionId=${finalSessionId}`);
    }
  } catch (err) {
    console.error("[coach] session update failed (non-blocking):", err);
  }

  // Save chat history (channel-agnostic — single conversation thread per user)
  const userMsg = { id: Date.now().toString(), role: "user", content: userText };
  const assistantMsg = { id: (Date.now() + 1).toString(), role: "assistant", content: reply };
  const updatedChat = [assistantMsg, userMsg, ...chatMessages].slice(0, 100);

  try {
    await db.insert(schema.chatHistory)
      .values({ userId, data: updatedChat })
      .onConflictDoUpdate({
        target: schema.chatHistory.userId,
        set: { data: updatedChat, updatedAt: new Date() },
      });
  } catch (err) {
    console.error("[coach] chat history persist failed:", err);
  }

  // ── Auto-TTS: speak the reply on channels where it's enabled ──────────────
  // Trigger conditions:
  //   1. Explicit request: user message contains a phrase like "say that as a
  //      voice message", "read it out", "speak that", "read that to me", etc.
  //   2. Auto-TTS: the user has enabled auto-TTS for the current channel in
  //      their preferences (ttsChannels contains the channel key).
  //
  // Fire-and-forget (non-blocking). Never throws / never blocks the reply.
  const channelKey = channelLower.startsWith("discord") ? "discord"
    : channelLower === "whatsapp" ? "whatsapp"
    : channelLower === "telegram" ? "telegram"
    : null;

  if (channelKey && (channelKey === "telegram" || channelKey === "whatsapp")) {
    const isExplicitTtsRequest = /\b(say\s+(that|it|this)|read\s+(that|it|this)\s*(out|aloud|to\s*me)?|speak\s+(that|it|this)|voice\s+message\s*(it|that|please)?|send\s+(as\s+)?(a\s+)?voice|read\s+out\s*(loud)?)\b/i.test(
      userText,
    );

    (async () => {
      try {
        const { getUserTtsPrefs, getUserTtsChannels, speakToUser } = await import("../agent/tools/tts");
        const enabledChannels = await getUserTtsChannels(userId);
        const shouldSpeak = isExplicitTtsRequest || enabledChannels.includes(channelKey);
        if (!shouldSpeak) return;

        const prefs = await getUserTtsPrefs(userId);
        const voice = prefs.voice || "nova";

        const result = await speakToUser(userId, reply, voice, {
          channel: channelName,
          serverBaseUrl: process.env.SERVER_BASE_URL,
        });

        if (!result.ok) {
          console.warn(`[${channelName}/auto-TTS] delivery failed: ${result.error}`);
        } else {
          console.log(`[${channelName}/auto-TTS] voice note delivered (voice=${voice}, chars=${reply.length})`);
        }
      } catch (err) {
        console.warn(`[${channelName}/auto-TTS] error (non-blocking):`, err);
      }
    })();
  }

  return { reply, rawReply, attachments, sdkSessionId: finalSessionId };
}
