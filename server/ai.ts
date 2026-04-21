import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export interface CompletionHistoryItem {
  title: string;
  category: string;
  completed: boolean;
  hadSubtasks: boolean;
  date: string;
}

export interface ResizeTaskRequest {
  taskTitle: string;
  taskDescription?: string;
  detailLevel: number;
  direction: "smaller" | "bigger";
  history: CompletionHistoryItem[];
}

export interface ResizeTaskResponse {
  steps: string[];
}

export interface GeneratePlanRequest {
  goals: { id: string; title: string; category: string; current: number; target: number; unit: string }[];
  history: CompletionHistoryItem[];
  dayOfWeek: string;
  lifeContext?: {
    priorityGoal?: string;
    upcomingDeadline?: string;
    improvementArea?: string;
    currentBlocker?: string;
    freeText?: string;
  } | null;
  gmailItems?: { subject: string; snippet: string; date: string }[];
  energyCheckin?: { energy: number; focus: string; date: string } | null;
  existingTasks?: { title: string; description?: string; category: string }[];
  carriedOverTasks?: { title: string; category: string; skipDays: number }[];
  blockedTasks?: { title: string; skipDays: number; blockerType?: string }[];
  userId?: string;
}

export interface UnblockTaskRequest {
  taskTitle: string;
  taskDescription?: string;
  blockerType: 'too_big' | 'bad_timing' | 'need_info' | 'low_energy' | 'unknown';
  skipDays: number;
}

export interface UnblockTaskResponse {
  suggestion: string;
}

export interface GeneratePlanTask {
  title: string;
  category: string;
  priority: "high" | "medium" | "low";
  time: string;
  description: string;
  goalId?: string;
}

export interface GeneratePlanResponse {
  tasks: GeneratePlanTask[];
  insight: string;
}

export async function resizeTask(req: ResizeTaskRequest): Promise<ResizeTaskResponse> {
  const { taskTitle, taskDescription, detailLevel, direction, history } = req;

  const completedTasks = history.filter(h => h.completed).map(h => h.title);
  const skippedTasks = history.filter(h => !h.completed).map(h => h.title);

  const historyContext = completedTasks.length > 0 || skippedTasks.length > 0
    ? `\nRecent history for context:
- Tasks they completed recently: ${completedTasks.slice(0, 5).join(', ') || 'none'}
- Tasks they left undone recently: ${skippedTasks.slice(0, 5).join(', ') || 'none'}
Use this to calibrate step size. If they tend to skip tasks, make steps more approachable and concrete. If they complete everything easily, steps can be slightly more ambitious.`
    : '';

  let directionPrompt: string;
  if (direction === 'smaller') {
    const stepCounts: Record<number, string> = {
      1: '2-3 broad steps',
      2: '3-4 clear steps',
      3: '4-6 specific steps',
      4: '6-8 detailed steps',
      5: '8-12 very small, immediately actionable micro-steps',
    };
    directionPrompt = `Break this task into ${stepCounts[detailLevel] || '4-6 steps'}. Each step should be concrete and actionable — something you can do right now without thinking about what it means. For higher detail levels, break steps into the smallest possible actions (e.g., "open laptop" rather than "start working").`;
  } else {
    directionPrompt = `Combine or simplify this task into ${detailLevel <= 2 ? '1 single clear action' : '1-2 higher-level actions'}. Make it feel less overwhelming by framing it as one focused activity instead of multiple separate things.`;
  }

  const prompt = `You help people who struggle with getting started on tasks. Your job is to resize tasks to make them more manageable.

Task: "${taskTitle}"${taskDescription ? `\nContext: ${taskDescription}` : ''}
${historyContext}

${directionPrompt}

Rules:
- Start each step with a verb (action word)
- Keep language simple and encouraging
- No numbering, just the step text
- Each step should take no more than 5-15 minutes
- Make steps feel easy to start — low friction, low intimidation

Return ONLY a JSON object with a "steps" array of strings. No other text.`;

  const response = await openai.chat.completions.create({
    model: "gpt-5-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    max_completion_tokens: 8192,
  });

  const content = response.choices[0]?.message?.content || '{"steps":[]}';
  try {
    const parsed = JSON.parse(content);
    return { steps: Array.isArray(parsed.steps) ? parsed.steps : [] };
  } catch {
    return { steps: [] };
  }
}

export async function unblockTask(req: UnblockTaskRequest): Promise<UnblockTaskResponse> {
  const { taskTitle, taskDescription, blockerType, skipDays } = req;

  const blockerGuide: Record<string, string> = {
    too_big: 'Identify the single smallest possible first action — something takeable in under 5 minutes — and describe it concretely.',
    bad_timing: 'Suggest a specific time block or trigger today when this task would fit naturally.',
    need_info: 'Identify exactly what information is missing and one specific place to find it.',
    low_energy: 'Either shrink the scope dramatically to a version doable in 10 minutes, or identify the one upcoming time today when energy will be higher.',
    unknown: 'Ask one clarifying question that would help identify the real blocker, then give a default starting action.',
  };

  const prompt = `You help people overcome mental blocks on tasks. Be direct, specific, and practical. No pep talk.

Task: "${taskTitle}"${taskDescription ? `\nContext: ${taskDescription}` : ''}
Days carried without completing: ${skipDays}
What the person says is blocking them: ${blockerType.replace('_', ' ')}

${blockerGuide[blockerType] || blockerGuide.unknown}

Write 2-3 sentences max. Focus on one concrete next action, not general advice. Make it feel achievable right now.

Return ONLY a JSON object: {"suggestion": "your 2-3 sentence response"}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-5-mini',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    max_completion_tokens: 512,
  });

  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content || '{}');
    return { suggestion: parsed.suggestion || 'Try starting with just one minute on this task — set a timer and begin.' };
  } catch {
    return { suggestion: 'Try starting with just one minute on this task — set a timer and begin.' };
  }
}

export async function generateSmartPlan(req: GeneratePlanRequest): Promise<GeneratePlanResponse> {
  const { goals, history, dayOfWeek, lifeContext, gmailItems, energyCheckin, existingTasks, carriedOverTasks, blockedTasks } = req;

  const completedTasks = history.filter(h => h.completed);
  const skippedTasks = history.filter(h => !h.completed);

  const energyFocusText = energyCheckin
    ? `\nMorning Check-in (Today's state):
- Energy Level: ${energyCheckin.energy}/5
- Focus Quality: ${energyCheckin.focus}
${energyCheckin.energy <= 2 ? "The user has low energy today. Keep the plan very light, focusing only on essential or low-effort tasks." : ""}
${energyCheckin.focus === 'Low' ? "The user is feeling foggy. Break tasks into even smaller, more manageable steps if possible, or avoid high-complexity deep work." : ""}`
    : '';

  const goalsText = goals.length > 0
    ? goals.map(g => `- [id:${g.id}] ${g.title} (${g.category}): ${g.current}/${g.target} ${g.unit}`).join('\n')
    : 'No specific goals set yet.';

  const historyText = history.length > 0
    ? `Completed ${completedTasks.length} of ${history.length} tasks in the last 7 days.
Tasks completed: ${completedTasks.map(h => h.title).slice(0, 8).join(', ') || 'none'}
Tasks left undone: ${skippedTasks.map(h => h.title).slice(0, 8).join(', ') || 'none'}
${skippedTasks.length > completedTasks.length ? 'This person tends to skip more tasks than they complete — keep today\'s plan lighter and more approachable.' : ''}
${completedTasks.length > skippedTasks.length ? 'This person is on a good streak — maintain momentum with a balanced plan.' : ''}`
    : 'No history yet — create a balanced starter plan.';

  // lifeCtxSection is now only a fallback when SOUL is unavailable —
  // SOUL is the authoritative "about this person" source (Phase 4).
  const lifeCtxSectionRaw = lifeContext
    ? `\nAbout this person:\n` +
      (lifeContext.priorityGoal ? `- Current priority: ${lifeContext.priorityGoal}\n` : '') +
      (lifeContext.upcomingDeadline ? `- Upcoming deadline: ${lifeContext.upcomingDeadline}\n` : '') +
      (lifeContext.improvementArea ? `- Wants to improve: ${lifeContext.improvementArea}\n` : '') +
      (lifeContext.currentBlocker ? `- Known blocker: ${lifeContext.currentBlocker}\n` : '') +
      (lifeContext.freeText ? `- Additional context: ${lifeContext.freeText}` : '')
    : '';

  const gmailSection = gmailItems && gmailItems.length > 0
    ? `\nRecent email signals (possible commitments/deadlines):\n` +
      gmailItems.slice(0, 8).map(i => `- "${i.subject}": ${i.snippet}`).join('\n')
    : '';

  const existingTasksSection = existingTasks && existingTasks.length > 0
    ? `\nUser-committed tasks (MUST include ALL of these in the plan — you may refine the wording for clarity but do not drop or skip any):\n` +
      existingTasks.map(t => `- ${t.title}${t.description ? `: ${t.description}` : ''}`).join('\n') +
      `\nThese count toward your task total. Add goal-aligned tasks to reach 5-8 total.`
    : '';

  const carriedOverSection = carriedOverTasks && carriedOverTasks.length > 0
    ? `\nCarried-over tasks (incomplete from previous days — MUST include all of them; consider breaking into a smaller first step if they've been skipped multiple days):\n` +
      carriedOverTasks.map(t => `- ${t.title} (${t.category}, skipped ${t.skipDays} day${t.skipDays > 1 ? 's' : ''})`).join('\n')
    : '';

  const blockedSection = blockedTasks && blockedTasks.length > 0
    ? `\nChronically stuck tasks (skipped 2+ days in a row — do NOT just repeat them verbatim; instead include a concrete "prepare to tackle" micro-task or a broken-down first step):\n` +
      blockedTasks.map(t => `- "${t.title}" (stuck ${t.skipDays} days${t.blockerType ? `, blocker: ${t.blockerType.replace('_', ' ')}` : ''})`).join('\n')
    : '';

  let soulSection = "";
  let patternSection = "";
  let memorySection = "";
  if (req.userId) {
    try {
      const { getSoul } = await import("./memory/soul");
      const soul = await getSoul(req.userId);
      const soulText = soul?.manualOverride || soul?.content;
      if (soulText && soulText.trim().length > 0) {
        soulSection = `\n\nWhat I know about this person (JARVIS Soul):\n${soulText.trim()}\n`;
      }
    } catch (e) { console.error("[generateSmartPlan] soul load failed", e); }
    try {
      const { db: ddb } = await import("./db");
      const { sql: dsql } = await import("drizzle-orm");
      interface PatternRow {
        patterns: unknown;
        summary: string | null;
      }
      interface PatternEntry {
        observation?: string;
        summary?: string;
      }
      const rows = await ddb.execute<PatternRow>(dsql`
        SELECT patterns, summary FROM weekly_insights
        WHERE user_id = ${req.userId}
        ORDER BY created_at DESC LIMIT 1
      `);
      const row = rows.rows?.[0];
      if (row) {
        const patterns: PatternEntry[] = Array.isArray(row.patterns) ? (row.patterns as PatternEntry[]) : [];
        const top = patterns
          .slice(0, 3)
          .map((p) => `- ${p.observation || p.summary || JSON.stringify(p)}`)
          .join("\n");
        if (top || row.summary) {
          patternSection = `\n\nRecent weekly patterns I've noticed:\n${row.summary ? row.summary + "\n" : ""}${top}\n`;
        }
      }
    } catch (e) { console.error("[generateSmartPlan] patterns load failed", e); }
    try {
      const { retrieveRelevantMemories: retrieveMemories } = await import("./memory/retrieve");
      const seedQuery = [
        lifeContext?.priorityGoal,
        lifeContext?.improvementArea,
        ...(goals.slice(0, 3).map(g => g.title)),
      ].filter(Boolean).join(" • ");
      if (seedQuery) {
        const mems = await retrieveMemories(req.userId, seedQuery, 6);
        if (mems.length > 0) {
          memorySection = `\n\nRelevant memories:\n${mems.map(m => `- [${m.category}] ${m.content}`).join("\n")}\n`;
        }
      }
    } catch (e) { console.error("[generateSmartPlan] retrieve failed", e); }
  }

  const prompt = `You create personalized daily task plans for people. Today is ${dayOfWeek}.${soulSection}${patternSection}${memorySection}

User's goals:
${goalsText}

Recent activity:
${historyText}${energyFocusText}${soulSection ? "" : lifeCtxSectionRaw}${gmailSection}${existingTasksSection}${carriedOverSection}${blockedSection}

Create a daily plan with 5-8 tasks. For each task provide:
- title: short, action-oriented task name
- category: one of "calendar", "fitness", "finance", "career", "personal", "social"
- priority: "high", "medium", or "low"
- time: suggested time like "7:00 AM", "9:30 AM", etc.
- description: one-line helpful context
- goalId: (optional) the id from the goals list above (e.g. "id:abc123") if this task directly works toward that specific goal — omit for general tasks

Rules:
- Align tasks with the user's goals
- When a task directly advances a specific goal (e.g. a fitness task for a running goal), set goalId to that goal's id (the value in [id:...])
- If they've been skipping fitness tasks, make fitness tasks easier/shorter
- If they've been completing everything, add one slightly challenging stretch task
- Include at least one personal/wellness task
- On weekends (Saturday/Sunday), lean more toward personal and social tasks
- Keep task names concise and starting with a verb
- Also include an "insight" — a brief motivational or strategic observation about their patterns

Return ONLY a JSON object with "tasks" array and "insight" string. No other text.`;

  const response = await openai.chat.completions.create({
    model: "gpt-5-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    max_completion_tokens: 8192,
  });

  const content = response.choices[0]?.message?.content || '{"tasks":[],"insight":""}';
  try {
    const parsed = JSON.parse(content);
    return {
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      insight: parsed.insight || 'Start small, stay consistent.',
    };
  } catch {
    return { tasks: [], insight: 'Start small, stay consistent.' };
  }
}
