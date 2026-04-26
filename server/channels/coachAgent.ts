import { db } from "../db";
import { eq, and, desc, sql, gte } from "drizzle-orm";
import * as schema from "@shared/schema";
import { runAgent } from "../agent/harness";
import { telegramCoachTools } from "../agent/tools";
import { getValidGoogleTokens } from "../userTokenStore";
import { getRecentEmailCommitments } from "../integrations/gmail";
import { getGoogleCalendarEvents } from "../integrations/googleCalendar";
import { getRecentInteractions, formatInteractionTimeline, logInteraction } from "../interactionLog";
import { getSoulPromptBlock } from "../memory/soul";
import { isUserPaired, isAndroidDaemonActive, isDesktopDaemonActive } from "../daemon/bridge";
import type { ChannelAttachment } from "./types";

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
}

export interface CoachReplyResult {
  reply: string;
  /** Raw reply from the agent before channel-level fallback normalization.
   *  Empty string when the model produced no text (e.g. silent streaming failure).
   *  Use this to detect "no response" without string-matching the fallback message. */
  rawReply: string;
  attachments: ChannelAttachment[];
}

const FORMAT_HINTS: Record<string, string> = {
  Telegram: "You're responding via Telegram. Keep messages SHORT (2-4 sentences). Plain text, no markdown headers.",
  WhatsApp: "You're responding via WhatsApp. Keep messages SHORT (2-4 sentences). Plain text. WhatsApp supports *bold*, _italic_, `code` only — no markdown headers.",
  Slack: "You're responding via Slack DM. Keep messages SHORT (2-4 sentences). Use Slack mrkdwn (*bold*, _italic_, `code`, > quote). No markdown headers.",
  Daemon: "You're responding to a desktop daemon. Plain text only. The user sees the reply as a desktop notification — keep it under 2 sentences when possible.",
  Discord: "You're responding via Discord. Keep responses SHORT — 2-4 sentences max. Your total response MUST be under 1800 characters. Discord renders **bold**, _italic_, `code`, ```blocks```. No headers. If a task needs many steps, pick the single most important next action and say it clearly.",
};

function getMaxTokensForChannel(channelName: string): number {
  if (channelName.startsWith("Discord")) return 1200;
  if (channelName === "Daemon") return 200;
  return 2000;
}

// Channel-agnostic coach pipeline shared by Telegram / WhatsApp / Slack /
// daemon adapters. Returns { reply, attachments } — the caller is
// responsible for delivery and post-send bookkeeping.
export async function runCoachAgent(input: CoachReplyInput): Promise<CoachReplyResult> {
  const { userId, userText, channelName, imageUrl, onToken, discordGuildId } = input;
  const channelLower = channelName.toLowerCase();

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

  const [goalsRow, statsRow, lcRow, chatRow, commitmentsRows, googleTokens, prefsRow, recentInteractionsResult, surfacedItemsResult] = await Promise.allSettled([
    db.select().from(schema.goals).where(eq(schema.goals.userId, userId)).limit(1),
    db.select().from(schema.stats).where(eq(schema.stats.userId, userId)).limit(1),
    db.select().from(schema.lifeContext).where(eq(schema.lifeContext.userId, userId)).limit(1),
    db.select().from(schema.chatHistory).where(eq(schema.chatHistory.userId, userId)).limit(1),
    db.select().from(schema.commitments)
      .where(and(eq(schema.commitments.userId, userId), eq(schema.commitments.status, "pending")))
      .orderBy(desc(schema.commitments.extractedAt)).limit(10),
    getValidGoogleTokens(userId),
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

  const localForDateKey = new Date(new Date().toLocaleString("en-US", { timeZone: userTimezone }));
  const dateKey = `${localForDateKey.getFullYear()}-${String(localForDateKey.getMonth() + 1).padStart(2, "0")}-${String(localForDateKey.getDate()).padStart(2, "0")}`;

  let todayPlan: any = null;
  try {
    const planRows = await db.select().from(schema.plans)
      .where(and(eq(schema.plans.userId, userId), eq(schema.plans.date, dateKey))).limit(1);
    todayPlan = planRows[0]?.data as any || null;
  } catch (err) {
    console.error("[coach] plan fetch failed:", err);
  }

  if (googleTokens.status === "fulfilled" && googleTokens.value.length > 0) {
    gmailConnected = true;
    const tokens = googleTokens.value;
    googleAccessToken = tokens[0];
    const [emailResult, ...calResults] = await Promise.allSettled([
      getRecentEmailCommitments(14, tokens[0]),
      ...tokens.map(t => getGoogleCalendarEvents(dateKey, undefined, undefined, t)),
    ]);
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
  }

  const recentMessages = chatMessages.slice(0, 10).reverse();
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

  const soulBlock = await getSoulPromptBlock(userId);
  const formatHintKey = Object.keys(FORMAT_HINTS).find((k) => channelName.startsWith(k)) ?? "Telegram";
  const formatHint = FORMAT_HINTS[formatHintKey];

  // OpenClaw bridge config
  let openclawSection = "";
  try {
    const openclawPrefs = (prefsRow.status === "fulfilled" ? (prefsRow.value[0]?.data as any) : null) ?? {};
    const ocCfg = openclawPrefs.openclawBridge;
    if (ocCfg?.enabled) {
      openclawSection = `\n## OpenClaw Compute Bridge (ACTIVE — mode: ${ocCfg.mode})
OpenClaw is a locally-running AI agent on the user's machine with FULL computer-use capabilities. You have access to it right now via the \`openclaw_delegate\` tool.

What OpenClaw can do (you cannot do these without it):
- Execute shell commands and run scripts locally
- Control the user's browser (click, type, navigate, extract content)
- Read and write files on the user's computer
- Run and test code in any language
- Build complete apps using vibe coding (Claude-based sub-agents that write entire Replit projects)
- Spawn and coordinate multiple sub-agents for complex multi-step builds
- Access the user's local file system and installed applications
- Self-improvement: build new Jarvis features and push them to the codebase

**When to delegate to OpenClaw** (use \`openclaw_delegate\` immediately, don't describe what you'd do):
- User asks to "build", "create", "code", or "write" an app or script
- User asks to "run", "execute", or "test" code
- User asks to control their browser or computer
- User asks to "open" or interact with local apps/files
- Any task requiring local compute, shell access, or code execution

**How to delegate**: Call \`openclaw_delegate\` with a complete, specific task description. For Telegram mode, the result will arrive in the user's Telegram chat. For Gateway mode, the result is returned immediately in this conversation.

**Self-improvement**: Use \`openclaw_build_feature\` when the user wants to add a new capability to Jarvis itself. Provide the tool name and a detailed description — OpenClaw will write the TypeScript tool file, register it in the codebase, and return the code. This is how Jarvis builds himself.

**Testing newly built tools**: \`openclaw_build_feature\` runs a smoke test automatically after every build and retries the fix up to 2 times if the test fails — you do not need to call \`openclaw_test_tool\` or \`openclaw_build_feature\` again manually. When the tool returns, report the final outcome to the user: success (tool is live) or give-up (smoke test still failing after retries, user should refine the description and try again). Only call \`openclaw_test_tool\` manually if the user explicitly asks to re-test a previously built tool.

Check status first if unsure: use \`openclaw_status\` to verify the bridge is reachable.`;
    }
  } catch {}


  const androidActive = isAndroidDaemonActive(userId);
  const desktopActive = isDesktopDaemonActive(userId);
  const daemonPaired = isUserPaired(userId);
  const daemonLines: string[] = [];
  if (desktopActive) daemonLines.push("- Desktop daemon is ACTIVE. You can run shell commands, send desktop notifications, and read/write files in the user's workspace.");
  if (androidActive) daemonLines.push("- Android device daemon is ACTIVE. You can open apps (android_open_app), take screenshots (android_screenshot), read the screen (android_read_screen), browse URLs (android_browse), list/read files on the device (android_file_list/android_file_read). Tap/type/swipe actions are available when user enables them. Proactively mention Android capabilities when relevant.");
  const daemonSection = daemonPaired
    ? `## Connected Devices\n${daemonLines.join("\n")}`
    : "## Android Daemon Setup Guidance (no daemon paired)\nIf the user asks how to install or set up the Android daemon, give them these steps:\n1. In the Jarvis app → Profile → Connected Channels → Android Device → tap Pair to get an 8-character code.\n2. Build the APK: open android-daemon/ in Android Studio → Build → Generate Signed Bundle/APK → APK → debug. Or run `gradle wrapper --gradle-version 8.4` then `./gradlew assembleDebug` from the android-daemon/ directory.\n3. Transfer the APK to the Android phone and install it (Settings → Apps → Special app access → Install unknown apps → allow your file manager).\n4. Open the app → enter the server URL + the 8-character code → tap Connect.\n5. Grant the two permissions the app requests: Accessibility Service (Settings → Accessibility → Jarvis Daemon → enable) and All Files Access.\n6. The app stays connected in the background and reconnects automatically after reboots or Wi-Fi drops.";

  const systemPrompt = `You are GamePlan Coach Jarvis — a sharp, supportive personal productivity coach. ${formatHint}

Today is ${dayOfWeek}, ${dateStr}. User's timezone: ${userTimezone}.
${crossChannelSection}

${soulBlock}

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

You can manage tasks, commitments, and analyze patterns via the manage_tasks tool. You can act on emails via the gmail_action tool. You can run safe shell commands, send desktop notifications, or read/write files in the user's workspace via the daemon_action tool when a desktop daemon is paired. When an Android device daemon is paired, use android_* actions to control the phone — open apps, browse, screenshot, read the screen, and access files. Always confirm with the user before tap/type/swipe actions. Use these proactively when the user asks to do something — don't just describe what you'd do. Respond in the same language the user writes in.${openclawSection}

## Autonomous background jobs
When a user's request involves multi-step research, drafting a document or plan, or composing an email — anything that would take more than a quick lookup — call the queue_background_job tool immediately instead of answering inline. This queues the work for a background sub-agent and lets you reply instantly. After calling the tool, tell the user: "I've queued that — you'll get a notification when it's done." Do not attempt to do the research or drafting yourself in the same turn. Examples of requests that MUST use queue_background_job:
- "research my competitors", "find me market data on X", "look into Y"
- "write a memo/proposal/blog post about X", "draft a document for Y"
- "make a plan for Z", "break down this project", "create an action plan"
- "write an email to X", "draft a message to Y", "compose an outreach to Z"

## Critical rules — no empty promises
**Act, don't announce**: If you say you will do something (create a document, save data, log an entry, send a message, post to a channel), you MUST call the relevant tool in that same response. Never say you will do something and then fail to do it. There is no "I'll do that now" without an immediate tool call.

**If you can't act yet**: If you are genuinely missing required data to take the action, say exactly what one piece of information is missing and ask for only that. Do not say "I'll do it" and then ask five clarifying questions. One missing piece = one question, then act.

**No circular clarification**: Do not ask for data you already have. Before asking the user for an amount, date, vendor, or reference — check the "Items You Already Surfaced" section of your context. If the data is there, use it directly without asking.

**Fail explicitly**: If a tool call returns an error or fails, tell the user specifically what went wrong. Do not silently continue or pretend the action succeeded.`;

  const userMessageContent = imageUrl
    ? [
        { type: "text" as const, text: userText || "What do you see in this image?" },
        { type: "image_url" as const, image_url: { url: imageUrl } },
      ]
    : userText;

  const baseMessages: import("openai").default.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...recentMessages.map((m: { role: string; content: string }) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: m.content,
    })),
    { role: "user", content: userMessageContent },
  ];

  const agentCtx: import("../agent/types").ToolContext = {
    userId,
    channel: channelName,
    googleAccessToken: googleAccessToken || undefined,
    discordGuildId: discordGuildId || undefined,
    state: {
      dateKey,
      todayPlan,
      gmailMessageIds: gmailItems.map((i: { id?: string }) => i.id).filter((id): id is string => !!id),
      pendingAttachments: [],
    },
  };

  const agentResult = await runAgent({
    model: "gpt-5-mini",
    messages: baseMessages,
    tools: telegramCoachTools({ hasGoogle: !!googleAccessToken }),
    context: agentCtx,
    maxTurns: 6,
    maxCompletionTokens: getMaxTokensForChannel(channelName),
    onToken,
  });

  console.log(`[${channelName}] coach agent — turns=${agentResult.turns}, tools=${agentResult.toolCalls.length}, finish=${agentResult.finishReason}`);

  const rawReply = agentResult.reply;
  const reply = rawReply || "Sorry, I couldn't generate a response right now.";
  const attachments = (agentCtx.state.pendingAttachments || []) as ChannelAttachment[];

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

  return { reply, rawReply, attachments };
}
