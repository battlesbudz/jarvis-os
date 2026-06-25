import fs from "fs";
import path from "path";
import OpenAI from "openai";
import { and, desc, eq, gte } from "drizzle-orm";
import { morningVoiceNotes, userPreferences } from "@shared/schema";
import { db } from "../db";
import { routeModelTurn, streamModelTurn } from "../agent/modelRouter";
import type { ProviderChunk, ProviderTurnResult } from "../agent/providers/base";

export function providerLabelForModel(model: string): string {
  const normalized = model.toLowerCase();
  if (normalized.startsWith("chatgpt-codex-oauth/") || normalized.startsWith("codex-oauth/")) {
    return "chatgpt-codex-oauth";
  }
  if (normalized.startsWith("android-local-gemma/")) {
    return "android-local-gemma";
  }
  if (normalized.startsWith("google/") || normalized.startsWith("gemini-")) {
    return "google";
  }
  if (normalized.startsWith("anthropic/") || normalized.startsWith("claude-")) {
    return "anthropic";
  }
  if (normalized.startsWith("openai/") || normalized.startsWith("gpt-")) {
    return "openai";
  }
  if (
    normalized.startsWith("modelrelay/") ||
    normalized.startsWith("openai-compatible/") ||
    normalized.startsWith("openrouter/") ||
    normalized.startsWith("groq/") ||
    normalized.startsWith("together/") ||
    normalized.startsWith("fireworks/") ||
    normalized.startsWith("cerebras/") ||
    normalized.startsWith("nvidia/") ||
    normalized.startsWith("deepseek/")
  ) {
    return "openai-compatible";
  }
  return "openai";
}

// PRIME.md loader - Jarvis core identity and behavioral rules.
// Reads agents/PRIME.md once at module load. Sections are delimited by ## headings.
// Falls back to hardcoded defaults if the file is missing or unreadable.

export async function runCoachModelTurn(
  params: {
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
    tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
    toolChoice: "auto" | "required" | "none";
    maxCompletionTokens: number;
    requestedModel?: string;
    preferRequestedModel?: boolean;
    signal?: AbortSignal;
    userId?: string;
    logPrefix: string;
  },
): Promise<ProviderTurnResult> {
  return routeModelTurn({
    tier: "balanced",
    requestedModel: params.requestedModel,
    preferRequestedModel: params.preferRequestedModel,
    messages: params.messages,
    tools: params.tools,
    toolChoice: params.toolChoice,
    maxCompletionTokens: params.maxCompletionTokens,
    userId: params.userId,
    signal: params.signal,
    logPrefix: params.logPrefix,
    allowRuntimeIdentityShortcut: true,
  });
}

export async function streamCoachModelTurn(
  params: {
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
    tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
    toolChoice: "auto" | "required" | "none";
    maxCompletionTokens: number;
    requestedModel?: string;
    preferRequestedModel?: boolean;
    signal?: AbortSignal;
    userId?: string;
    logPrefix: string;
  },
  onChunk: (chunk: ProviderChunk) => void | Promise<void>,
): Promise<ProviderTurnResult> {
  return streamModelTurn({
    tier: "balanced",
    requestedModel: params.requestedModel,
    preferRequestedModel: params.preferRequestedModel,
    messages: params.messages,
    tools: params.tools,
    toolChoice: params.toolChoice,
    maxCompletionTokens: params.maxCompletionTokens,
    userId: params.userId,
    signal: params.signal,
    logPrefix: params.logPrefix,
    allowRuntimeIdentityShortcut: true,
  }, onChunk);
}

interface PrimeSections {
  coachingFrameworks: string;
  personas: Record<string, string>;
  coachingRules: string;
  emailFormat: string;
  actuation: string;
}

const JARVIS_RUNTIME_VOICE = `## Jarvis Runtime Voice
You are Jarvis: direct, useful, and grounded in the runtime context provided by JARVIS. Be concise by default. Give specific next actions. Do not introduce legacy product personas, coaching modes, or old product language.`;

const PRIME_DEFAULTS: PrimeSections = {
  coachingFrameworks: `## Operating Frameworks Jarvis Can Draw From
Apply these when relevant — reference them by name:
- Atomic Habits (James Clear): Habits = cue + craving + response + reward. Small 1% improvements compound. Environment design > willpower.
- Deep Work (Cal Newport): Protect deep focus blocks. Shallow work is the enemy. Produce at a high level.
- 80/20 Principle (Pareto): 20% of efforts produce 80% of results. Identify and double down on the 20%.
- Extreme Ownership (Jocko Willink): No excuses. Own every outcome. Simplify plans. Cover and move.
- The ONE Thing (Gary Keller): What is the one thing that makes everything else easier or unnecessary?
- OKRs (Measure What Matters): Objectives + Key Results. Ambitious goals + measurable milestones.
- 7 Habits (Stephen Covey): Be proactive. Begin with the end in mind. First things first. Sharpen the saw.
- Essentialism (Greg McKeown): Less but better. Eliminate the trivial many. Protect your highest contribution.
- ADHD Strategies: Task decomposition. External accountability. Body doubling. Time-blocking. Momentum before perfectionism.
- Stoicism (Marcus Aurelius): Focus only on what you control. Obstacles are the way. Memento mori.
- First Principles (Musk): Strip back assumptions. Reason from fundamentals. Don't copy — derive.
When you reference a framework, name the author/book naturally: "Per Atomic Habits..." or "This is an OKR problem..."`,
  personas: {
    sharp: JARVIS_RUNTIME_VOICE,
    drill: JARVIS_RUNTIME_VOICE,
    mentor: JARVIS_RUNTIME_VOICE,
    strategist: JARVIS_RUNTIME_VOICE,
    flow: JARVIS_RUNTIME_VOICE,
  },
  coachingRules: `## Jarvis Runtime Rules

**Response length**: Keep replies short. 2–4 sentences is the default. Use a bullet list only when you have 3+ specific items to name. Never write multi-paragraph essays — the user is on their phone.

**Question-first rule**: When the user's message is open-ended, vague, or could go several directions ("help me", "what should I focus on", "I'm struggling", "any advice?") — ask ONE focused clarifying question before giving advice. Do not give generic advice while waiting for context. One question, nothing else.

**When you have enough context**: Give the direct, specific answer. No caveats, no generic encouragement padding, no restating what they said.

**Exception**: If the user explicitly asks for a plan, full strategy, or deep analysis, you may give a longer structured response — but still prefer lists over paragraphs.

**Other rules**:
- Be direct. Name what you see. Offer a concrete fix.
- For financial/career topics: think like a business advisor. Suggest specific resources (tools, books, frameworks) by name.
- You know what they've been skipping — call it out when relevant.
- Never say "I don't have access to your data" — everything is above.
- Respond in the same language the user writes in.
- **Background job domain context**: When formulating a background job description from a follow-up message, include the full conversation topic (domain) in the prompt — not just the literal words of the latest message. The sub-agent has no access to conversation history. Example: if the conversation is about finding pets to adopt and the user says "find shelters in that area", the job prompt must be "find animal shelters in [city] — this is part of a search to adopt a cat". Always ask yourself what the conversation is actually about and include that domain explicitly.`,
  emailFormat: `## Email Drafting
When asked to write or draft an email, format your response like this:
---EMAIL DRAFT---
To: [recipient]
Subject: [subject line]
Body:
[email body]
---END DRAFT---
Then add a brief note like "I've formatted this as a draft — tap 'Save to Drafts' to send it to your Gmail."`,
  actuation: `## Actuation — You Have Real Hands
You can take real actions on connected services. Use these tools proactively when the user asks:

- **check_connections** — Always call this before claiming a service is (or isn't) connected. Never make assumptions about connection status.
- **generate_reconnect_link** — When a Google or Microsoft account is disconnected and the user wants to reconnect, call this to generate a tappable OAuth button. After calling it, say something like "I've added a button below — tap it to reconnect." Do NOT write the URL in your message text.
- **connect_channel** — When the user asks to connect Telegram, WhatsApp, Slack, or Discord, call this to generate a connection code. After calling it, the tool result JSON contains a "code" field for Telegram. For Telegram: say "I've added a button below — tap it to open Telegram, then type the code **[CODE]** in the chat." (replace [CODE] with the actual code value from the tool result). Do NOT write raw URLs. Supported channels: telegram, whatsapp, slack, discord.
- **create_calendar_event** — When the user says "block time", "schedule a meeting", "add to my calendar" — call this to actually create the event. Don't describe what you'd do, do it.
- **fetch_emails** — Fetch inbox emails on demand beyond the ambient context.
- **send_email** — When the user explicitly confirms they want to send an email (not just draft), call this. Always confirm before sending.
- **schedule_jarvis_task** — Schedule a future task for Jarvis to act on at a specific time. Use when the user says "remind me to...", "schedule...", "do X at Y time", or asks Jarvis to take an action later. Always confirm the scheduled time before calling. Supports recurrence (daily, weekly, weekdays, every Monday, etc.).
- **daemon_action** — Execute actions on the user's paired daemon (desktop or Android). {{DAEMON_SECTION}}
- **image_generate** — Generate an image from a text prompt. Use model "dalle" (default, fast) for illustrations and concepts. Use model "flux" when the user asks for photorealistic or artistic images (requires INFSH_API_KEY).
- **generate_video** — Generate a short AI video (2-6 min). Always warn the user it will take a few minutes before calling. Requires INFSH_API_KEY. Use for animated scenes or explicit video requests only.
{{SELF_IMPROVEMENT_SECTION}}
**Critical rule**: Never claim you can or cannot access a service without first calling check_connections. Never promise to send an email, create a calendar event, or run a daemon command if you haven't verified the service is connected. When a user asks to connect any channel, always call connect_channel rather than giving manual instructions.`,
};

function loadPrimeSections(): PrimeSections {
  const filePath = path.resolve(process.cwd(), "agents/PRIME.md");
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
    console.log('[routes] agents/PRIME.md loaded — sections: coachingFrameworks, personas (5), coachingRules, emailFormat, actuation');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[routes] agents/PRIME.md unavailable: ${reason} — using built-in defaults`);
    return PRIME_DEFAULTS;
  }
  // Split on "\n## " to extract sections. Prepend "\n" so the first ## is captured.
  const sectionMap: Record<string, string> = {};
  const chunks = ('\n' + content).split('\n## ');
  for (const chunk of chunks.slice(1)) {
    const heading = chunk.split('\n')[0].trim();
    sectionMap[heading] = '## ' + chunk.trimEnd();
  }
  const personas: Record<string, string> = { ...PRIME_DEFAULTS.personas };
  return {
    coachingFrameworks: sectionMap['Operating Frameworks Jarvis Can Draw From'] ?? sectionMap['Coaching Frameworks You Draw From'] ?? PRIME_DEFAULTS.coachingFrameworks,
    personas,
    coachingRules:      sectionMap['Jarvis Runtime Rules'] ?? sectionMap['How you coach'] ?? PRIME_DEFAULTS.coachingRules,
    emailFormat:        sectionMap['Email Drafting']                      ?? PRIME_DEFAULTS.emailFormat,
    actuation:          sectionMap['Actuation — You Have Real Hands']     ?? PRIME_DEFAULTS.actuation,
  };
}

const PRIME = loadPrimeSections();

function readPromptDoc(relativePath: string, maxChars: number): string {
  try {
    const filePath = path.resolve(process.cwd(), relativePath);
    const root = path.resolve(process.cwd());
    if (!filePath.startsWith(root)) return "";
    return fs.readFileSync(filePath, "utf8").trim().slice(0, maxChars);
  } catch {
    return "";
  }
}

function loadAgentRoutingPromptBlock(): string {
  const docs = [
    ["agents/CONTEXT.md", readPromptDoc("agents/CONTEXT.md", 2500)],
    ["agents/ROUTING.md", readPromptDoc("agents/ROUTING.md", 4000)],
    ["agents/TOOL_POLICY.md", readPromptDoc("agents/TOOL_POLICY.md", 2500)],
    ["workspaces/battles/CONTEXT.md", readPromptDoc("workspaces/battles/CONTEXT.md", 2000)],
    ["workspaces/battles/WORKSPACE_MAP.md", readPromptDoc("workspaces/battles/WORKSPACE_MAP.md", 2000)],
  ].filter(([, content]) => content.trim());

  if (docs.length === 0) return "";

  return "\n## Jarvis Workspace Router\n" +
    "Use this repo-backed router to choose the right workspace, avoid broad context loading, respect tool approval boundaries, and place outputs in the correct folder.\n\n" +
    docs.map(([name, content]) => `### ${name}\n${content}`).join("\n\n") +
    "\n";
}

const AGENT_ROUTING_PROMPT_BLOCK = loadAgentRoutingPromptBlock();

export function getPersonaBlock(coachingMode?: string): string {
  void coachingMode;
  return PRIME.personas.sharp;
}

const morningNoteSummaryCache = new Map<string, { summary: string; date: string }>();

export function clearMorningNoteSummary(userId: string): void {
  morningNoteSummaryCache.delete(userId);
}

export async function getUserLocalDate(userId: string): Promise<string> {
  try {
    const prefs = await db.select({ data: userPreferences.data })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);
    const tz = (prefs[0]?.data as Record<string, string>)?.timezone || 'America/New_York';
    return new Date().toLocaleDateString('en-CA', { timeZone: tz });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export async function getMorningNoteSummary(userId: string): Promise<string> {
  const today = await getUserLocalDate(userId);
  const cached = morningNoteSummaryCache.get(userId);
  if (cached && cached.date === today) return cached.summary;

  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const cutoffDate = thirtyDaysAgo.toISOString().slice(0, 10);

    const notes = await db.select()
      .from(morningVoiceNotes)
      .where(and(
        eq(morningVoiceNotes.userId, userId),
        gte(morningVoiceNotes.recordedAt, cutoffDate)
      ))
      .orderBy(desc(morningVoiceNotes.recordedAt))
      .limit(30);

    if (notes.length === 0) return '';

    const moodCounts: Record<string, number> = {};
    const allThemes: Record<string, number> = {};
    const allBlockers: Record<string, number> = {};
    const recentIntentions: string[] = [];

    for (const note of notes) {
      moodCounts[note.moodSignal] = (moodCounts[note.moodSignal] || 0) + 1;
      const themes = (note.themes as string[]) || [];
      for (const t of themes) allThemes[t] = (allThemes[t] || 0) + 1;
      const blockers = (note.blockers as string[]) || [];
      for (const b of blockers) allBlockers[b] = (allBlockers[b] || 0) + 1;
      if (note.intention) recentIntentions.push(note.intention);
    }

    const topMoods = Object.entries(moodCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m, c]) => `${m} (${c}x)`).join(', ');
    const topThemes = Object.entries(allThemes).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t, c]) => `${t} (${c}x)`).join(', ');
    const topBlockers = Object.entries(allBlockers).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([b, c]) => `${b} (${c}x)`).join(', ');

    let summary = `\n## Morning Voice Note Patterns (last ${notes.length} days)\n`;
    summary += `- Mood trend: ${topMoods}\n`;
    if (topThemes) summary += `- Recurring themes: ${topThemes}\n`;
    if (topBlockers) summary += `- Common blockers: ${topBlockers}\n`;
    if (recentIntentions.length > 0) summary += `- Recent intentions: ${recentIntentions.slice(0, 3).map(i => `"${i}"`).join(', ')}\n`;
    summary += `Use these patterns to provide personalized coaching. Reference specific trends when relevant.`;

    morningNoteSummaryCache.set(userId, { summary, date: today });
    return summary;
  } catch {
    return '';
  }
}

export function buildCoachSystemPrompt(goals: any[], stats: any, history: any[], calendarEvents: any[] = [], lifeContext?: any, gmailItems?: any[], gmailConnected?: boolean, slackMessages?: any[], slackConnected?: boolean, commitmentsList?: any[], coachingMode?: string, memories?: { content: string; category: string }[], telegramMessages?: any[], telegramConnected?: boolean, morningNoteSummary?: string, documentsContext?: string, crossChannelContext?: string, soulBlock?: string, daemonSection?: string, emotionalStateBlock?: string, selfImprovementSection?: string, websiteContext?: string): string {
  const completedHistory = history.filter((h: any) => h.completed);
  const skippedHistory = history.filter((h: any) => !h.completed);
  const completionRate = history.length > 0
    ? Math.round((completedHistory.length / history.length) * 100)
    : 0;

  const categorySkipCounts: Record<string, number> = {};
  skippedHistory.forEach((h: any) => {
    categorySkipCounts[h.category] = (categorySkipCounts[h.category] || 0) + 1;
  });
  const strugglingCategories = Object.entries(categorySkipCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cat]) => cat);

  const goalsText = goals.length > 0
    ? goals.map((g: any) => `  - ${g.title} (${g.category}): ${g.current}/${g.target} ${g.unit} — ${Math.round((g.current / Math.max(g.target, 1)) * 100)}% complete`).join('\n')
    : '  - No goals set yet';

  const recentCompleted = completedHistory.slice(0, 8).map((h: any) => h.title).join(', ') || 'none';
  const recentSkipped = skippedHistory.slice(0, 8).map((h: any) => h.title).join(', ') || 'none';

  const calendarText = calendarEvents.length > 0
    ? calendarEvents.slice(0, 8).map((e: any) => `  - ${e.time ? e.time + ': ' : ''}${e.title}`).join('\n')
    : '  - No calendar events today';

  const lifeContextSection = lifeContext
    ? `\n## About This Person\n` +
      (lifeContext.priorityGoal ? `- Priority right now: ${lifeContext.priorityGoal}\n` : '') +
      (lifeContext.upcomingDeadline ? `- Upcoming commitment: ${lifeContext.upcomingDeadline}\n` : '') +
      (lifeContext.improvementArea ? `- Wants to improve: ${lifeContext.improvementArea}\n` : '') +
      (lifeContext.currentBlocker ? `- Current blocker: ${lifeContext.currentBlocker}\n` : '') +
      (lifeContext.freeText ? `- Additional context: ${lifeContext.freeText}` : '')
    : '';

  const documentsSection = documentsContext || '';
  const websiteSection = websiteContext || '';

  const gmailSection = gmailItems && gmailItems.length > 0
    ? `\n## Recent Emails (last 7 days)\n` +
      gmailItems.slice(0, 40).map((i: any) => {
        const dateStr = i.date ? new Date(i.date).toLocaleDateString('en-US', {month:'short',day:'numeric'}) : '';
        const acct = i.accountEmail ? ` [${i.accountEmail}]` : '';
        const labelStr = i.labels?.length ? ` [${i.labels.join(', ')}]` : '';
        return `- [${dateStr}]${acct}${labelStr} From: ${i.from || 'unknown'} | "${i.subject}" — ${i.snippet}`;
      }).join('\n') +
      `\n(Use these to identify commitments, deadlines, or threads the user hasn't logged as tasks yet. Each email is labelled with which Gmail account it came from. When asked about a specific account, filter to those rows. Labels like ⭐ Starred and Important indicate priority. Promotions/Social are lower signal. Refer to these directly — do not ask for more info.)`
    : gmailConnected
      ? `\n## Recent Emails\nGmail is connected but no emails were found in the last 7 days. Do not pretend to have email data you don't have.`
      : `\n## Recent Emails\nGmail is not connected — you have no access to the user's inbox. If asked about emails, tell them to connect Gmail in the Profile tab.`;

  const slackSection = slackConnected
    ? (slackMessages && slackMessages.length > 0
        ? `\n## Recent Slack Messages (last 7 days)\n` +
          slackMessages.slice(0, 50).map((m: any) => {
            const dateStr = m.timestamp ? new Date(m.timestamp).toLocaleDateString('en-US', {month:'short',day:'numeric'}) : '';
            const channelLabel = m.channelType === 'dm' ? 'DM' : m.channelType === 'group' ? 'Group' : `#${m.channel}`;
            return `- [${dateStr}] [${channelLabel}] ${m.user}: ${m.text}`;
          }).join('\n') +
          `\n(Use these to identify commitments, follow-ups, and unresolved discussions. Treat Slack messages like emails — surface actionable items without asking for more info.)`
        : `\n## Recent Slack Messages\nSlack is connected but no messages were found in the last 7 days.`)
    : '';

  const memoriesSection = (() => {
    if (!memories || memories.length === 0) return '';
    const categoryLabels: Record<string, string> = {
      personality: 'Personality & Communication',
      values: 'Values & Motivations',
      work_style: 'Work Style & Patterns',
      accomplishment: 'Accomplishments & Wins',
      goal_discovered: 'Discovered Goals',
      relationship: 'Key People & Relationships',
      pattern: 'Recurring Patterns',
      preference: 'Preferences',
      fact: 'General Facts',
      goal: 'Goals',
      achievement: 'Achievements',
    };
    const grouped: Record<string, string[]> = {};
    for (const m of memories) {
      const cat = m.category || 'fact';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(m.content);
    }
    let section = '\n## What I Know About You (from past conversations)';
    for (const [cat, items] of Object.entries(grouped)) {
      const label = categoryLabels[cat] || cat;
      section += `\n### ${label}\n${items.map(i => `- ${i}`).join('\n')}`;
    }
    return section;
  })();

  const telegramSection = telegramConnected
    ? (telegramMessages && telegramMessages.length > 0
        ? `\n## Recent Telegram Group Messages (last 7 days)\n` +
          telegramMessages.slice(0, 50).map((m: any) => {
            const dateStr = m.timestamp ? new Date(m.timestamp).toLocaleDateString('en-US', {month:'short',day:'numeric'}) : '';
            return `- [${dateStr}] [${m.chatTitle || 'Group'}] ${m.fromUser}: ${m.text}`;
          }).join('\n') +
          `\n(Use these to identify commitments, follow-ups, and context. Treat like Slack messages.)`
        : `\n## Recent Telegram Group Messages\nTelegram is connected but no group messages were found in the last 7 days.`)
    : '';

  const now = new Date();
  const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const personaBlock = getPersonaBlock(coachingMode);

  return `You are Jarvis — a sharp, supportive AI operating partner embedded in the JARVIS app. You know this user's goals, habits, and patterns through the runtime context below. Give specific, actionable help — not generic motivational fluff.

Today is ${dayOfWeek}, ${dateStr}.
${crossChannelContext || ''}
${AGENT_ROUTING_PROMPT_BLOCK}

${PRIME.coachingFrameworks}

${personaBlock}
${soulBlock && soulBlock.trim() ? soulBlock : memoriesSection}${emotionalStateBlock && emotionalStateBlock.trim() ? emotionalStateBlock : ''}

## User Profile
- Current streak: ${stats.streak || 0} days
- Best streak: ${stats.bestStreak || 0} days
- Total tasks completed: ${stats.totalCompleted || 0}
- Total XP earned: ${stats.xp || 0}
- Task completion rate (last 7 days): ${completionRate}% (${completedHistory.length} completed, ${skippedHistory.length} skipped)
${strugglingCategories.length > 0 ? `- Struggling most with: ${strugglingCategories.join(', ')}` : ''}${soulBlock && soulBlock.trim() ? '' : lifeContextSection}${websiteSection}${documentsSection}

## Active Goals
${goalsText}

## Today's Calendar
${calendarText}${gmailSection}${slackSection}${telegramSection}

## Recent Activity (last 7 days)
- Completed: ${recentCompleted}
- Left undone: ${recentSkipped}
${morningNoteSummary || ''}
${PRIME.coachingRules}

${PRIME.emailFormat}

${PRIME.actuation
  .replace('{{DAEMON_SECTION}}', daemonSection || 'Call check_connections first to determine which daemon type is paired and which actions are available.')
  .replace('{{SELF_IMPROVEMENT_SECTION}}', selfImprovementSection ? `\n${selfImprovementSection}` : '')}`;
}
