import { db } from "./db";
import { eq, and } from "drizzle-orm";
import * as schema from "@shared/schema";
import { learnFromDismissal } from "./inboxRules";
import { gmailModifyMessage } from "./integrations/gmail";
import { getValidGoogleTokens } from "./userTokenStore";

export interface ActionResult {
  success: boolean;
  message: string;
  learned?: boolean;
}

async function getGoogleToken(userId: string): Promise<string | null> {
  try {
    const tokens = await getValidGoogleTokens(userId);
    return tokens?.[0] || null;
  } catch {
    return null;
  }
}

export async function executeInboxAction(
  userId: string,
  itemId: string,
  actionType: string,
  telegramChatId?: string
): Promise<ActionResult> {
  const [item] = await db
    .select()
    .from(schema.inboxItems)
    .where(and(eq(schema.inboxItems.id, itemId), eq(schema.inboxItems.userId, userId)));

  if (!item) {
    return { success: false, message: "Item not found" };
  }

  switch (actionType) {
    case "dismiss": {
      const result = await learnFromDismissal(userId, itemId, telegramChatId);
      return {
        success: true,
        message: result.learned
          ? `Dismissed. Jarvis learned to suppress ${result.ruleName}`
          : "Dismissed",
        learned: result.learned,
      };
    }

    case "never_again": {
      const senderDomain = item.sender
        ? (item.sender.match(/@([a-zA-Z0-9.-]+)/)?.[1] || "").toLowerCase()
        : "";
      const pattern = senderDomain
        ? `Auto: suppress ${senderDomain}`
        : `Auto: suppress "${item.subject || item.sender}"`;
      const matchHints = senderDomain
        ? { domains: [senderDomain] }
        : { subjectKeywords: [(item.subject || "").toLowerCase()] };

      await db.insert(schema.inboxRules).values({
        userId,
        type: "suppress",
        scope: item.sourceType === "calendar" ? "calendar" : "email",
        pattern,
        matchHints,
        source: "user",
      });
      await db
        .update(schema.inboxItems)
        .set({ status: "dismissed", actedAt: new Date() })
        .where(eq(schema.inboxItems.id, itemId));
      return { success: true, message: "Rule created — you'll never see these again" };
    }

    case "archive": {
      if (item.sourceType !== "email") {
        return { success: false, message: "Archive only works for emails" };
      }
      const rawId = (item.sourceId || "").replace(/^gmail:/, "");
      const token = await getGoogleToken(userId);
      if (!token) {
        return { success: false, message: "No Google connection found" };
      }
      try {
        await gmailModifyMessage(rawId, [], ["INBOX"], token);
        await db
          .update(schema.inboxItems)
          .set({ status: "approved", actedAt: new Date() })
          .where(eq(schema.inboxItems.id, itemId));
        return { success: true, message: "Email archived" };
      } catch (err: any) {
        return { success: false, message: `Archive failed: ${err.message || "unknown error"}` };
      }
    }

    case "mark_important": {
      if (item.sourceType !== "email") {
        return { success: false, message: "Only works for emails" };
      }
      const rawId = (item.sourceId || "").replace(/^gmail:/, "");
      const token = await getGoogleToken(userId);
      if (!token) {
        return { success: false, message: "No Google connection found" };
      }
      try {
        await gmailModifyMessage(rawId, ["STARRED"], [], token);
        await db
          .update(schema.inboxItems)
          .set({ status: "approved", actedAt: new Date() })
          .where(eq(schema.inboxItems.id, itemId));
        return { success: true, message: "Email starred" };
      } catch (err: any) {
        return { success: false, message: `Star failed: ${err.message || "unknown error"}` };
      }
    }

    case "save_as_task": {
      const taskTitle = item.subject || item.snippet || "Untitled task";
      const plans = await db
        .select()
        .from(schema.plans)
        .where(eq(schema.plans.userId, userId));
      const today = new Date().toISOString().slice(0, 10);
      const existingPlan = plans.find((p: any) => p.date === today);
      const planData: any = existingPlan?.data || { tasks: [] };
      const tasks = Array.isArray(planData.tasks) ? planData.tasks : [];
      const newTask = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        title: taskTitle,
        completed: false,
        duration: 15,
        priority: "high",
        source: item.sourceType === "email" ? "email" : "calendar",
      };
      tasks.push(newTask);
      planData.tasks = tasks;

      await db
        .insert(schema.plans)
        .values({ userId, date: today, data: planData })
        .onConflictDoUpdate({
          target: [schema.plans.userId, schema.plans.date],
          set: { data: planData, updatedAt: new Date() },
        });

      await db
        .update(schema.inboxItems)
        .set({ status: "approved", actedAt: new Date() })
        .where(eq(schema.inboxItems.id, itemId));

      return { success: true, message: `Task added: "${taskTitle}"` };
    }

    case "save_to_focus": {
      const contextText = `${item.subject || ""} — ${item.snippet || ""}`.trim();
      const [existing] = await db
        .select()
        .from(schema.lifeContext)
        .where(eq(schema.lifeContext.userId, userId));
      const data: any = existing?.data || {};
      const freeText = (data.freeText || "") + `\n[From ${item.sourceType}] ${contextText}`;
      data.freeText = freeText.trim();

      await db
        .insert(schema.lifeContext)
        .values({ userId, data })
        .onConflictDoUpdate({
          target: schema.lifeContext.userId,
          set: { data, updatedAt: new Date() },
        });

      await db
        .update(schema.inboxItems)
        .set({ status: "approved", actedAt: new Date() })
        .where(eq(schema.inboxItems.id, itemId));

      return { success: true, message: "Saved to your life context" };
    }

    default:
      return { success: false, message: `Unknown action: ${actionType}` };
  }
}
