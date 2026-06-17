import type OpenAI from "openai";
import { and, desc, eq, sql } from "drizzle-orm";
import { proactiveQuestionsSent } from "@shared/schema";
import { db } from "./db";
import { extractAndStore } from "./memory/extractor";
import { processLivingContextUpdate } from "./workspace/livingContextRouter";

async function extractProfileInBackground(userId: string, messages: any[]) {
  const recentMessages = messages.slice(-6);
  if (recentMessages.length === 0) return;
  const conversationText = recentMessages
    .map((m: any) => `${m.role}: ${m.content}`)
    .join("\n");
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
    // best-effort - never block the response
  }
}

async function markProactiveQuestionsAnswered(userId: string, messages: any[], openai: OpenAI) {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const unanswered = await db.select()
      .from(proactiveQuestionsSent)
      .where(
        and(
          eq(proactiveQuestionsSent.userId, userId),
          sql`${proactiveQuestionsSent.answeredAt} IS NULL`,
          sql`${proactiveQuestionsSent.sentAt} > ${twentyFourHoursAgo}`,
        ),
      )
      .orderBy(desc(proactiveQuestionsSent.sentAt))
      .limit(1);
    if (unanswered.length > 0) {
      const lastUserMessage = messages.filter((m: any) => m.role === "user").pop();
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
      const answer = (checkResponse.choices[0]?.message?.content || "").trim().toLowerCase();
      if (answer.startsWith("yes")) {
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

export function runCoachChatSideEffects(
  userId: string | null | undefined,
  messages: any[],
  openai: OpenAI,
): void {
  if (!userId) return;
  extractProfileInBackground(userId, messages);
  detectAndRecordBehaviorSignals(userId, messages);
  markProactiveQuestionsAnswered(userId, messages, openai).catch(() => {});
}
