import { db } from "./db";
import * as schema from "@shared/schema";
import type { MomentumStepData } from "@shared/schema";
import { eq, and, lt } from "drizzle-orm";
import { sendMessageWithButtons, sendMessage } from "./integrations/telegram";
import { createRoutedChatCompletion } from "./agent/routedChatCompletion";

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const STEP_DELAY_MS = 3 * 60 * 1000;

export async function generateMomentumSteps(
  userId: string,
  context: {
    tasks: any[];
    goals: any[];
    stats: any;
    dateKey: string;
  }
): Promise<MomentumStepData[]> {
  const incompleteTasks = (context.tasks || []).filter((t: any) => !t.completed);
  const taskList =
    incompleteTasks
      .slice(0, 5)
      .map((t: any) => t.title)
      .join(", ") || "no specific tasks planned";
  const goalsText =
    (context.goals || [])
      .slice(0, 3)
      .map((g: any) => `${g.title} (${g.current || 0}/${g.target})`)
      .join(", ") || "none set";
  const streak = context.stats?.streak || 0;
  const completedToday = (context.tasks || []).filter((t: any) => t.completed).length;

  const prompt = `You are designing a 4-step momentum sequence for someone with ADHD who has task aversion right now.

Their situation:
- Today's tasks: ${taskList}
- Goals: ${goalsText}
- Streak: ${streak} days
- Completed today: ${completedToday} tasks
- Date: ${context.dateKey}

Design 4 escalating micro-tasks. Step 1 must be TINY — a single physical action that takes under 60 seconds and removes all friction (e.g., "Just open your email and glance at the subject lines — don't reply to anything"). Each step is slightly larger than the last.

Each step must use a specific ADHD tactic:
- Step 1: Implementation intention ("When you sit down, just... [specific physical action]")
- Step 2: Identity framing ("You're someone who... one quick thing to prove it")
- Step 3: Social contrast or streak leverage ("Yesterday/this week you did X... let's match it with one thing")
- Step 4: Momentum statement ("You're already rolling — just one more and you can call it a win")

Respond with a JSON array of 4 objects: [{ "text": "message to send", "tactic": "implementation_intention|identity_framing|social_contrast|momentum" }, ...]
Keep each text under 2 sentences. Plain text only — no markdown, no asterisks.`;

  try {
    const { getModel } = await import("./lib/modelPrefs");
    const model = await getModel(userId, "planning");

    const resp = await createRoutedChatCompletion({
      model,
      messages: [
        { role: "system", content: "You are an ADHD productivity coach. Respond with valid JSON only." },
        { role: "user", content: prompt },
      ],
      max_completion_tokens: 800,
    }, { tier: "balanced", logPrefix: "[MomentumCoach]", userId });

    const raw = resp.choices[0]?.message?.content || "[]";
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed: unknown = JSON.parse(cleaned);
    if (!Array.isArray(parsed) || parsed.length < 4) throw new Error("bad shape");

    const xpPerStep = [5, 10, 15, 20];
    return parsed.slice(0, 4).map((s: any, i: number): MomentumStepData => ({
      text: typeof s.text === "string" ? s.text : String(s.text),
      tactic: typeof s.tactic === "string" ? s.tactic : "momentum",
      xp: xpPerStep[i],
    }));
  } catch (err) {
    console.error("[Momentum] Failed to generate steps:", err);
    return [
      { text: "When you sit down right now, just open your task list — don't do anything yet, just look.", tactic: "implementation_intention", xp: 5 },
      { text: "You're someone who follows through. Pick the smallest task on that list and spend just 5 minutes on it.", tactic: "identity_framing", xp: 10 },
      { text: "You've already done 2 things — that's momentum. One more task and you'll have a real streak going.", tactic: "social_contrast", xp: 15 },
      { text: "You're rolling now. One final thing and you can close your laptop knowing today counted.", tactic: "momentum", xp: 20 },
    ];
  }
}

export async function startMomentumSession(
  userId: string,
  chatId: string,
  context: { tasks: any[]; goals: any[]; stats: any; dateKey: string }
): Promise<void> {
  const steps = await generateMomentumSteps(userId, context);

  await db
    .insert(schema.momentumSessions)
    .values({
      userId,
      currentStep: 0,
      sessionDate: context.dateKey,
      completedSteps: 0,
      steps,
      status: "active",
      lastStepAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.momentumSessions.userId,
      set: {
        currentStep: 0,
        sessionDate: context.dateKey,
        completedSteps: 0,
        steps,
        status: "active",
        lastStepAt: new Date(),
      },
    });

  const step = steps[0];
  await sendMessageWithButtons(chatId, `Jarvis here. ${step.text}`, [
    { text: "✅ Done", callback_data: `momentum_done:${userId}:0` },
  ]);
  console.log(`[Momentum] Session started for user ${userId}, step 0`);
}

export async function handleMomentumDone(
  userId: string,
  chatId: string,
  stepIndex: number
): Promise<void> {
  const rows = await db
    .select()
    .from(schema.momentumSessions)
    .where(eq(schema.momentumSessions.userId, userId))
    .limit(1);
  if (rows.length === 0) return;

  const session = rows[0];
  if (session.status === "expired") {
    await sendMessage(chatId, "That session already expired — start fresh tomorrow.");
    return;
  }

  const steps = session.steps as MomentumStepData[];
  if (stepIndex >= steps.length) return;
  if (session.currentStep !== stepIndex) return;

  const completedStep = steps[stepIndex];
  const xpEarned = completedStep.xp;

  await awardXp(userId, xpEarned);

  const nextStep = stepIndex + 1;
  const newCompletedSteps = (session.completedSteps || 0) + 1;
  const isFinished = nextStep >= steps.length;

  await db
    .update(schema.momentumSessions)
    .set({
      currentStep: nextStep,
      completedSteps: newCompletedSteps,
      status: isFinished ? "completed" : "active",
      lastStepAt: new Date(),
    })
    .where(eq(schema.momentumSessions.userId, userId));

  const ackMessages: Record<string, string> = {
    implementation_intention: `Done — +${xpEarned} XP. That first step is always the hardest.`,
    identity_framing: `Locked in — +${xpEarned} XP. That's exactly who you are.`,
    social_contrast: `Nice — +${xpEarned} XP. Momentum is real now.`,
    momentum: `That's it — +${xpEarned} XP. Today counts.`,
  };
  const ack = ackMessages[completedStep.tactic] ?? `+${xpEarned} XP. Keep going.`;
  await sendMessage(chatId, ack);

  if (isFinished) {
    const totalXp = steps.reduce((sum, s) => sum + s.xp, 0);
    await sendMessage(chatId, `Full sequence complete — ${totalXp} XP earned today. That's a win.`);
    return;
  }

  setTimeout(async () => {
    try {
      const freshRows = await db
        .select()
        .from(schema.momentumSessions)
        .where(eq(schema.momentumSessions.userId, userId))
        .limit(1);
      if (freshRows.length === 0 || freshRows[0].currentStep !== nextStep) return;

      const freshSession = freshRows[0];
      if (freshSession.status !== "active") return;

      const lastStepTime = freshSession.lastStepAt ? new Date(freshSession.lastStepAt) : new Date();
      if (Date.now() - lastStepTime.getTime() > SESSION_TIMEOUT_MS) {
        await expireSession(userId, chatId);
        return;
      }

      const nextStepData = (freshSession.steps as MomentumStepData[])[nextStep];
      await sendMessageWithButtons(chatId, nextStepData.text, [
        { text: "✅ Done", callback_data: `momentum_done:${userId}:${nextStep}` },
      ]);
      console.log(`[Momentum] Sent step ${nextStep} to user ${userId}`);
    } catch (err) {
      console.error("[Momentum] Error sending next step:", err);
    }
  }, STEP_DELAY_MS);
}

async function expireSession(userId: string, chatId: string): Promise<void> {
  await db
    .update(schema.momentumSessions)
    .set({ status: "expired" })
    .where(eq(schema.momentumSessions.userId, userId));
  await sendMessage(chatId, "No worries — we'll pick it back up tomorrow.");
  console.log(`[Momentum] Session expired for user ${userId}`);
}

async function awardXp(userId: string, amount: number): Promise<void> {
  try {
    const rows = await db
      .select()
      .from(schema.stats)
      .where(eq(schema.stats.userId, userId))
      .limit(1);
    if (rows.length === 0) return;
    const data = (rows[0].data as Record<string, unknown>) ?? {};
    const currentXp = Number(data.xp ?? 0);
    await db
      .update(schema.stats)
      .set({ data: { ...data, xp: currentXp + amount }, updatedAt: new Date() })
      .where(eq(schema.stats.userId, userId));
  } catch (err) {
    console.error("[Momentum] Failed to award XP:", err);
  }
}

export async function hasMomentumSessionToday(userId: string, dateKey: string): Promise<boolean> {
  const rows = await db
    .select({ sessionDate: schema.momentumSessions.sessionDate })
    .from(schema.momentumSessions)
    .where(eq(schema.momentumSessions.userId, userId))
    .limit(1);
  return rows.length > 0 && rows[0].sessionDate === dateKey;
}

export async function expireStaleMomentumSessions(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - SESSION_TIMEOUT_MS);
    const staleSessions = await db
      .select()
      .from(schema.momentumSessions)
      .where(
        and(
          eq(schema.momentumSessions.status, "active"),
          lt(schema.momentumSessions.lastStepAt, cutoff)
        )
      );

    for (const session of staleSessions) {
      const links = await db
        .select({ chatId: schema.telegramLinks.chatId })
        .from(schema.telegramLinks)
        .where(eq(schema.telegramLinks.userId, session.userId))
        .limit(1);

      await db
        .update(schema.momentumSessions)
        .set({ status: "expired" })
        .where(eq(schema.momentumSessions.userId, session.userId));

      if (links.length > 0) {
        await sendMessage(links[0].chatId, "No worries — we'll pick it back up tomorrow.").catch(() => {});
      }
      console.log(`[Momentum] Sweep expired session for user ${session.userId}`);
    }
  } catch (err) {
    console.error("[Momentum] Error in expiry sweep:", err);
  }
}

export function startMomentumExpiryScheduler(): void {
  setInterval(() => {
    expireStaleMomentumSessions().catch(err =>
      console.error("[Momentum] Expiry scheduler error:", err)
    );
  }, 5 * 60 * 1000);
  console.log("[Momentum] Expiry scheduler started (5-min interval)");
}
