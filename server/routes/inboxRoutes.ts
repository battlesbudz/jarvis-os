import type { Express, Request, Response } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import * as schema from "@shared/schema";
import { db } from "../db";
import { getValidGoogleTokens } from "../userTokenStore";

const paramValue = (value: string | string[]): string => Array.isArray(value) ? (value[0] ?? "") : value;

export function registerInboxRoutes(app: Express): void {
  app.get("/api/inbox/items", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const statusFilter = typeof req.query.status === "string" ? req.query.status : "pending";
      // Dismissed inbox fetches should show only Jarvis auto-handled items, not user-hidden items.
      const whereClause = statusFilter === "dismissed"
        ? and(
            eq(schema.inboxItems.userId, userId),
            eq(schema.inboxItems.status, statusFilter),
            sql`${schema.inboxItems.jarvisReason} IS NOT NULL`
          )
        : and(eq(schema.inboxItems.userId, userId), eq(schema.inboxItems.status, statusFilter));
      const items = await db
        .select()
        .from(schema.inboxItems)
        .where(whereClause)
        .orderBy(desc(schema.inboxItems.surfacedAt))
        .limit(50);
      res.json(items);
    } catch (error) {
      console.error("Error fetching inbox items:", error);
      res.status(500).json({ error: "Failed to fetch inbox items" });
    }
  });

  app.post("/api/inbox/items/:id/important", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = paramValue(req.params.id);

      const [item] = await db
        .select()
        .from(schema.inboxItems)
        .where(and(eq(schema.inboxItems.id, id), eq(schema.inboxItems.userId, userId)));

      if (!item) return res.status(404).json({ error: "Item not found" });

      if (item.sourceType === "email" || item.sourceType === "gmail") {
        const senderPart = item.sender
          ? `emails from ${item.sender}`
          : item.subject
            ? `emails with subject "${item.subject}"`
            : "this type of email";
        const memoryContent = `User marked as important: ${senderPart}${item.snippet ? ` - "${item.snippet.slice(0, 120)}"` : ""}. Always surface similar emails.`;

        await db.insert(schema.userMemories).values({
          userId,
          content: memoryContent,
          category: "Email Pattern",
          confidence: 95,
          relevanceScore: 80,
          sourceType: "email_pattern",
          sourceRef: item.sourceId || null,
        });

        const senderDomain = item.sender
          ? (item.sender.match(/@([a-zA-Z0-9.-]+)/)?.[1] || "").toLowerCase()
          : "";
        const senderEmail = item.sender ? item.sender.toLowerCase() : "";

        const subjectKw = (item.subject || "").toLowerCase().trim().slice(0, 60);
        const canCreateRule = senderDomain || subjectKw.length > 0;

        if (canCreateRule) {
          const matchHints = senderDomain
            ? { domains: [senderDomain], senders: senderEmail ? [senderEmail] : [] }
            : { subjectKeywords: [subjectKw] };
          const pattern = senderDomain
            ? `Always surface emails from ${senderDomain}`
            : `Always surface: "${item.subject}"`;

          const { getUserInboxRules } = await import("../inboxRules");
          const existingRules = await getUserInboxRules(userId);
          const alreadyExists = existingRules.some(r => {
            if (r.type !== "surface" || r.scope !== "email") return false;
            const hints = (r.matchHints || {}) as { domains?: string[]; subjectKeywords?: string[] };
            if (senderDomain && hints.domains?.includes(senderDomain)) return true;
            if (!senderDomain && subjectKw && hints.subjectKeywords?.includes(subjectKw)) return true;
            return false;
          });

          if (!alreadyExists) {
            await db.insert(schema.inboxRules).values({
              userId,
              type: "surface",
              scope: "email",
              pattern,
              matchHints,
              source: "user",
            });
          }
        }
      }

      await db
        .update(schema.inboxItems)
        .set({ status: "important", actedAt: new Date() })
        .where(and(eq(schema.inboxItems.id, id), eq(schema.inboxItems.userId, userId)));

      res.json({ success: true, message: "Saved to Jarvis memory" });
    } catch (error) {
      console.error("Error marking inbox item as important:", error);
      res.status(500).json({ error: "Failed to mark as important" });
    }
  });

  app.post("/api/inbox/items/:id/action", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = paramValue(req.params.id);
      const { actionType } = req.body;
      if (!actionType) return res.status(400).json({ error: "actionType is required" });

      let telegramChatId: string | undefined;
      try {
        const [link] = await db.select().from(schema.telegramLinks).where(eq(schema.telegramLinks.userId, userId));
        telegramChatId = link?.chatId;
      } catch {}

      const { executeInboxAction } = await import("../inboxActions");
      const result = await executeInboxAction(userId, id, actionType, telegramChatId);

      // Resolve the matching Ego action only after the inbox action succeeds.
      if (result.success) {
        const egoOutcome = (actionType === "dismiss" || actionType === "never_again")
          ? "dismissed"
          : "acted_on";
        db.select({ sourceId: schema.inboxItems.sourceId })
          .from(schema.inboxItems)
          .where(eq(schema.inboxItems.id, id))
          .then(([item]) => {
            if (!item?.sourceId) return;
            import("../intelligence/actionLog").then(({ resolveActionByMetadataKey }) => {
              resolveActionByMetadataKey(userId, "proactive_message", "sourceId", item.sourceId!, egoOutcome).catch(() => {});
            }).catch(() => {});
          })
          .catch(() => {});
      }

      res.json(result);
    } catch (error) {
      console.error("Error executing inbox action:", error);
      res.status(500).json({ error: "Failed to execute action" });
    }
  });

  app.get("/api/inbox/rules", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const rules = await db
        .select()
        .from(schema.inboxRules)
        .where(eq(schema.inboxRules.userId, userId));
      res.json(rules);
    } catch (error) {
      console.error("Error fetching inbox rules:", error);
      res.status(500).json({ error: "Failed to fetch rules" });
    }
  });

  app.post("/api/inbox/rules", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { pattern, type, scope } = req.body;
      if (!pattern || !type || !scope) {
        return res.status(400).json({ error: "pattern, type, and scope are required" });
      }
      const { createRuleFromText } = await import("../inboxRules");
      const rule = await createRuleFromText(userId, pattern, type, scope);
      res.json(rule);
    } catch (error) {
      console.error("Error creating inbox rule:", error);
      res.status(500).json({ error: "Failed to create rule" });
    }
  });

  app.delete("/api/inbox/rules/:id", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = paramValue(req.params.id);
      await db
        .delete(schema.inboxRules)
        .where(and(eq(schema.inboxRules.id, id), eq(schema.inboxRules.userId, userId)));
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting inbox rule:", error);
      res.status(500).json({ error: "Failed to delete rule" });
    }
  });

  app.patch("/api/inbox/rules/:id", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = paramValue(req.params.id);
      const { active } = req.body;
      const isActive = active === true || active === "true" || active === 1;
      await db
        .update(schema.inboxRules)
        .set({ active: isActive, updatedAt: new Date() })
        .where(and(eq(schema.inboxRules.id, id), eq(schema.inboxRules.userId, userId)));
      res.json({ success: true });
    } catch (error) {
      console.error("Error updating inbox rule:", error);
      res.status(500).json({ error: "Failed to update rule" });
    }
  });

  app.get("/api/email-drafts", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const drafts = await db
        .select()
        .from(schema.emailDrafts)
        .where(and(eq(schema.emailDrafts.userId, userId), eq(schema.emailDrafts.status, "pending_approval")))
        .orderBy(desc(schema.emailDrafts.createdAt));
      res.json(drafts);
    } catch (error) {
      console.error("Error fetching email drafts:", error);
      res.status(500).json({ error: "Failed to fetch drafts" });
    }
  });

  app.post("/api/email-drafts/:id/approve", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = paramValue(req.params.id);
      const { editedSubject, editedBody } = req.body as { editedSubject?: string; editedBody?: string };

      const [draft] = await db
        .select()
        .from(schema.emailDrafts)
        .where(and(eq(schema.emailDrafts.id, id), eq(schema.emailDrafts.userId, userId)))
        .limit(1);
      if (!draft) return res.status(404).json({ error: "Draft not found" });
      if (draft.status !== "pending_approval") return res.status(400).json({ error: "Draft already actioned" });

      const subject = editedSubject?.trim() || draft.draftSubject;
      const body = editedBody?.trim() || draft.draftBody;
      const recipientMatch = (draft.fromSender || "").match(/<([^>]+)>/);
      const recipient = recipientMatch ? recipientMatch[1] : (draft.fromSender || "").trim();
      if (!recipient || !recipient.includes("@")) {
        return res.status(400).json({ error: "Could not determine recipient address" });
      }

      const tokens = await getValidGoogleTokens(userId);
      const token = tokens?.[0];
      if (!token) return res.status(400).json({ error: "Gmail not connected" });

      const { createGmailDraft } = await import("../integrations/gmail");
      const result = await createGmailDraft(token, recipient, subject, body);

      await db
        .update(schema.emailDrafts)
        .set({
          status: "approved",
          gmailDraftId: result.draftId,
          gmailDraftUrl: result.gmailUrl,
          actedAt: new Date(),
          draftSubject: subject,
          draftBody: body,
        })
        .where(eq(schema.emailDrafts.id, id));

      res.json({ success: true, gmailDraftUrl: result.gmailUrl });
    } catch (error) {
      console.error("Error approving email draft:", error);
      res.status(500).json({ error: "Failed to approve draft" });
    }
  });

  app.post("/api/email-drafts/:id/discard", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = paramValue(req.params.id);
      await db
        .update(schema.emailDrafts)
        .set({ status: "discarded", actedAt: new Date() })
        .where(and(eq(schema.emailDrafts.id, id), eq(schema.emailDrafts.userId, userId)));
      res.json({ success: true });
    } catch (error) {
      console.error("Error discarding email draft:", error);
      res.status(500).json({ error: "Failed to discard draft" });
    }
  });
}
