import OpenAI from "openai";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { db } from "../db";
import { getOpenAIClientConfig } from "../agent/providers/env";
import { getValidGoogleTokens } from "../userTokenStore";
import { getGoogleCalendarEvents } from "../integrations/googleCalendar";
import { getRecentEmailCommitments } from "../integrations/gmail";

const openai = new OpenAI(getOpenAIClientConfig());

export async function buildPlanFromInputs(body: any): Promise<{
  reasoning: string;
  tasks: Array<{ title: string; category: string; priority: string; duration?: number; time?: string; description?: string }>;
}> {
  const { goals, calendarEvents, gmailItems, brainDump, completionHistory, energyLevel, coachingMode, existingTasks, userId } = body;

  const goalsText = Array.isArray(goals) && goals.length > 0
    ? goals.map((g: any) => `- ${g.title} (${g.category}): ${g.current}/${g.target} ${g.unit} — ${Math.round((g.current / Math.max(g.target, 1)) * 100)}% complete`).join('\n')
    : 'No goals set';

  const calendarText = Array.isArray(calendarEvents) && calendarEvents.length > 0
    ? calendarEvents.map((e: any) => `- ${e.time ? e.time + ': ' : ''}${e.title}${e.description ? ' (' + e.description + ')' : ''}`).join('\n')
    : 'No calendar events today';

  const gmailText = Array.isArray(gmailItems) && gmailItems.length > 0
    ? gmailItems.slice(0, 20).map((e: any) => `- From: ${e.from || 'unknown'} | "${e.subject}" — ${e.snippet}`).join('\n')
    : 'No emails available';

  const brainDumpText = Array.isArray(brainDump) && brainDump.length > 0
    ? brainDump.map((b: any) => `- ${b.text || b}`).join('\n')
    : 'No brain dump items';

  const historyText = Array.isArray(completionHistory) && completionHistory.length > 0
    ? (() => {
        const completed = completionHistory.filter((h: any) => h.completed).slice(0, 8);
        const skipped = completionHistory.filter((h: any) => !h.completed).slice(0, 8);
        return `Completed recently: ${completed.map((h: any) => h.title).join(', ') || 'none'}\nLeft undone recently: ${skipped.map((h: any) => h.title).join(', ') || 'none'}`;
      })()
    : 'No history available';

  const existingText = Array.isArray(existingTasks) && existingTasks.length > 0
    ? existingTasks.map((t: { title: string; category?: string; priority?: string; completed?: boolean }) => `- ${t.title} (${t.category}, ${t.priority}${t.completed ? ', done' : ''})`).join('\n')
    : 'No existing tasks';

  const energyDescriptions: Record<number, string> = {
    1: 'Dead — barely functional, needs very light tasks',
    2: 'Low — limited capacity, keep it simple',
    3: 'Okay — moderate capacity, balanced day',
    4: 'Good — solid capacity, can handle challenging work',
    5: 'On Fire — peak capacity, front-load the hard stuff',
  };
  const energyText = typeof energyLevel === 'number' && energyLevel >= 1 && energyLevel <= 5
    ? `${energyLevel}/5 — ${energyDescriptions[energyLevel]}`
    : 'Not checked in';

  const predictionContext = typeof body.predictionContext === 'string' ? body.predictionContext : null;

  const modeInstructions: Record<string, string> = {
    mentor: 'Coaching style: Mentor mode — include Deep Work blocks, be supportive, suggest learning and growth tasks.',
    drill: 'Coaching style: Drill Sergeant mode — aggressive prioritization, no fluff, only the tasks that move the needle.',
    friend: 'Coaching style: Friend mode — balanced and encouraging, mix of productive and enjoyable tasks.',
  };
  const modeText = coachingMode && modeInstructions[coachingMode]
    ? modeInstructions[coachingMode]
    : '';

  const now = new Date();
  const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const { buildAiContextSections } = await import("../memory/promptContext");
  const planSeed = [
    ...(Array.isArray(goals) ? goals.slice(0, 3).map((g: any) => g?.title).filter(Boolean) : []),
    ...(Array.isArray(brainDump) ? brainDump.slice(0, 3).map((b: any) => b?.text || b).filter(Boolean) : []),
  ].join(" • ");
  const { soulSection: planSoul, patternSection: planPatterns, memorySection: planMemories, emotionalStateSection: planEmotionalState, vaultSection: planVault } =
    await buildAiContextSections(typeof userId === "string" ? userId : undefined, planSeed);

  const prompt = `You are Jarvis, an autonomous planning AI. Build a realistic, prioritized daily plan for this person.

Today is ${dayOfWeek}, ${dateStr}.${planSoul}${planPatterns}${planMemories}${planEmotionalState}${planVault}

## Calendar
${calendarText}

## Goals
${goalsText}

## Recent Emails
${gmailText}

## Brain Dump (unprocessed thoughts/tasks)
${brainDumpText}

## Recent History
${historyText}

## Currently Planned Tasks
${existingText}

## Energy Level
${energyText}
${predictionContext ? `\n## Jarvis Foresight (pattern-based predictions)\n${predictionContext}\nScheduling rules based on these predictions:\n1. Place demanding/deep-focus tasks BEFORE the predicted dip hour and AT the predicted peak hour (if humanReadable mentions one).\n2. Move routine, low-effort, or administrative tasks INTO the predicted dip window.\n3. If a procrastination risk is flagged for a category, put a small "starter" version of that task first thing in the morning to build momentum.\n4. Assign a specific time (the "time" field in each task JSON) to at least one task that was explicitly positioned due to a Foresight prediction.\n` : ''}
${modeText}

## Rules
- Use their actual calendar to block around meetings (leave 10min buffer before/after)
- Pull tasks from brain dump that should be actioned today
- Surface email commitments that need a response or action today
- Apply their goals — at least one task should move a goal forward
- Match energy level to task difficulty
- Generate 4-7 tasks max — quality over quantity
- Be specific: "Review Q2 proposal draft" not "Work on proposal"
- For each task, add a brief description referencing WHY it made the cut (email, goal, deadline, brain dump)
- Do NOT duplicate calendar events as tasks
- Each task needs: title, category (one of: fitness, finance, career, personal, social), priority (high, medium, low), and optionally: duration (minutes), time (e.g. "9:30 AM"), description

Return JSON: { "reasoning": "2-3 sentences on your planning logic — always name at least one concrete data point (goal, email, brain dump item). If Jarvis Foresight predictions are present, explicitly call out a task that was timed around a prediction (e.g. 'Deep work block at 9 AM — your predicted peak energy window' or 'Admin tasks slotted at 3 PM to avoid your energy dip').", "tasks": [{ "title": "...", "category": "...", "priority": "...", "duration": 60, "time": "9:30 AM", "description": "..." }] }
Return ONLY the JSON object.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    max_completion_tokens: 2000,
  });

  const content = response.choices[0]?.message?.content || '{"reasoning":"","tasks":[]}';
  try {
    const parsed = JSON.parse(content);
    const validCategories = ['fitness', 'finance', 'career', 'personal', 'social'];
    const validPriorities = ['high', 'medium', 'low'];
    const tasks = Array.isArray(parsed.tasks)
      ? parsed.tasks.slice(0, 7).map((t: Record<string, unknown>) => ({
          title: String(t.title || 'Task'),
          category: validCategories.includes(t.category as string) ? String(t.category) : 'personal',
          priority: validPriorities.includes(t.priority as string) ? String(t.priority) : 'medium',
          duration: typeof t.duration === 'number' ? t.duration : undefined,
          time: t.time ? String(t.time) : undefined,
          description: t.description ? String(t.description) : undefined,
        }))
      : [];
    return {
      reasoning: String(parsed.reasoning || ''),
      tasks,
    };
  } catch {
    return { reasoning: '', tasks: [] };
  }
}

export async function buildPlanForUser(userId: string): Promise<{
  tasks: Array<{ title: string; category: string; priority: string; duration?: number; time?: string; description?: string }>;
  reasoning: string;
} | null> {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const [goalsRow, historyRow, brainDumpRow, lifeContextRow, prefsRow, energyRow] = await Promise.all([
      db.select({ data: schema.goals.data }).from(schema.goals).where(eq(schema.goals.userId, userId)),
      db.select({ data: schema.completionHistory.data }).from(schema.completionHistory).where(eq(schema.completionHistory.userId, userId)),
      db.select({ data: schema.brainDumpInbox.data }).from(schema.brainDumpInbox).where(eq(schema.brainDumpInbox.userId, userId)),
      db.select({ data: schema.lifeContext.data }).from(schema.lifeContext).where(eq(schema.lifeContext.userId, userId)),
      db.select({ data: schema.userPreferences.data }).from(schema.userPreferences).where(eq(schema.userPreferences.userId, userId)),
      db.select({ data: schema.energyCheckins.data }).from(schema.energyCheckins).where(and(eq(schema.energyCheckins.userId, userId), eq(schema.energyCheckins.date, today))),
    ]);

    const goals = (goalsRow[0]?.data as any[]) || [];
    const completionHistory = (historyRow[0]?.data as any[]) || [];
    const brainDump = (brainDumpRow[0]?.data as any[]) || [];
    const prefs = (prefsRow[0]?.data as any) || {};
    const coachingMode = prefs.coachingMode;
    const energyCheckin = energyRow[0]?.data as any;
    const energyLevel = energyCheckin?.energy;

    let calendarEvents: any[] = [];
    let gmailItems: any[] = [];

    try {
      const googleTokens = await getValidGoogleTokens(userId);
      if (googleTokens.length > 0) {
        const startTime = new Date(today + 'T00:00:00').toISOString();
        const endTime = new Date(today + 'T23:59:59').toISOString();
        const events = await getGoogleCalendarEvents(today, startTime, endTime, googleTokens[0]);
        calendarEvents = events.map((e: any) => ({
          title: e.title,
          time: e.start ? new Date(e.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : undefined,
          description: e.location || e.description,
        }));
      }
    } catch {}

    try {
      const googleTokens = await getValidGoogleTokens(userId);
      if (googleTokens.length > 0) {
        gmailItems = await getRecentEmailCommitments(7, googleTokens[0]);
      }
    } catch {}

    // Fetch today's predictions and the user's energy peak hour to steer task
    // ordering toward energy windows.
    let predictionContext: string | null = null;
    try {
      const [{ getTodayPredictions }, { analysePatterns }] = await Promise.all([
        import("../intelligence/predictor"),
        import("../intelligence/pattern-analyser"),
      ]);
      const [preds, analysis] = await Promise.all([
        getTodayPredictions(userId, today, 55),
        analysePatterns(userId, 60),
      ]);

      if (preds.length > 0) {
        const peakHour = analysis.peakEnergyHour;
        const dipHour = analysis.dipEnergyHour;

        // Format a human-readable hour string (e.g. "10am", "3pm").
        const fmtHour = (h: number) =>
          h === 0 ? 'midnight' : h < 12 ? `${h}am` : h === 12 ? 'noon' : `${h - 12}pm`;

        // Prepend explicit peak/dip anchor lines so the LLM has definitive
        // hours to work with, regardless of what humanReadable contains.
        const anchorLines = [
          `- [peak_energy_window] Schedule deep/focus work at or before ${fmtHour(peakHour)} — this is your historically highest-energy hour.`,
          `- [low_energy_window] Avoid cognitively demanding tasks around ${fmtHour(dipHour)} — this is your historically lowest-energy hour.`,
        ].join('\n');

        const predLines = preds
          .slice(0, 4)
          .map((p) => {
            const predictedHour = p.targetDatetime
              ? new Date(p.targetDatetime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
              : null;
            const timeTag = predictedHour ? ` @ ${predictedHour}` : '';
            return `- [${p.predictionType}${timeTag}] ${p.humanReadable}${p.actionSuggestion ? ` → ${p.actionSuggestion}` : ''}`;
          })
          .join('\n');

        predictionContext = `${anchorLines}\n${predLines}`;
      }
    } catch {}

    const result = await buildPlanFromInputs({
      goals: goals.map((g: any) => ({
        title: g.title,
        category: g.category,
        current: g.current,
        target: g.target,
        unit: g.unit,
      })),
      calendarEvents,
      gmailItems,
      brainDump,
      completionHistory,
      energyLevel: energyLevel ?? 3,
      coachingMode,
      existingTasks: [],
      userId,
      predictionContext,
    });

    if (!result || result.tasks.length === 0) return null;
    return result;
  } catch (err) {
    console.error(`buildPlanForUser failed for ${userId}:`, err);
    return null;
  }
}

