import type { AgentTool } from "../types";
import { db } from "../../db";
import { userDocuments } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";

export const createDocumentTool: AgentTool = {
  name: "create_document",
  description:
    "Create a new text/markdown document in the user's JARVIS document library. Use this to draft notes, briefs, summaries, plans, or any longer-form content the user asks for. The user can review, edit, and reference these later. Returns the new document id.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Short descriptive title for the document" },
      content: { type: "string", description: "Full document body in markdown" },
      summary: { type: "string", description: "One-sentence summary (optional but recommended)" },
    },
    required: ["name", "content"],
  },
  async execute(args, ctx) {
    const a = args as { name?: string; content?: string; summary?: string };
    const name = String(a.name || "").trim().slice(0, 200);
    const content = String(a.content || "");
    const summary = a.summary ? String(a.summary).slice(0, 500) : null;

    if (!name) return { ok: false, content: "Document name is required.", label: "Missing name" };
    if (!content.trim()) return { ok: false, content: "Document content cannot be empty.", label: "Empty content" };

    try {
      const inserted = await db
        .insert(userDocuments)
        .values({
          userId: ctx.userId,
          name,
          mimeType: "text/markdown",
          sizeBytes: Buffer.byteLength(content, "utf8"),
          status: "ready",
          extractedText: content,
          summary,
        })
        .returning({ id: userDocuments.id });

      const docId = inserted[0]?.id || "";
      console.log(`[${ctx.channel || "Agent"}] create_document id=${docId} name="${name}" bytes=${Buffer.byteLength(content, "utf8")}`);

      // Queue this artifact for delivery on the calling channel (e.g. Telegram
      // sends the file after the agent finishes responding). The caller reads
      // ctx.state.pendingAttachments after runAgent returns.
      const pending = (ctx.state.pendingAttachments ||= []);
      const safeFilename = name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) + ".md";
      pending.push({
        kind: "document",
        documentId: docId,
        filename: safeFilename,
        content,
        caption: summary || name,
        mimeType: "text/markdown",
      });

      return {
        ok: true,
        content: `Created document "${name}" (id: ${docId}). It is saved in the user's Documents library and queued to be delivered on this channel.`,
        label: `Created document: ${name}`,
        detail: docId,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, content: `Failed to create document: ${msg}`, label: "Document create failed", detail: msg };
    }
  },
};

export const listDocumentsTool: AgentTool = {
  name: "list_documents",
  description:
    "List the user's recent documents (name, id, summary, uploaded date). Use this when the user asks 'what documents do I have' or before reading or updating a specific one.",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Max documents to return (default 20)" },
    },
  },
  async execute(args, ctx) {
    const limit = Math.min(Math.max(Number((args as { limit?: number }).limit) || 20, 1), 50);
    try {
      const rows = await db
        .select({
          id: userDocuments.id,
          name: userDocuments.name,
          summary: userDocuments.summary,
          uploadedAt: userDocuments.uploadedAt,
          status: userDocuments.status,
          sizeBytes: userDocuments.sizeBytes,
        })
        .from(userDocuments)
        .where(eq(userDocuments.userId, ctx.userId))
        .orderBy(desc(userDocuments.uploadedAt))
        .limit(limit);

      if (rows.length === 0) {
        return { ok: true, content: "The user has no documents yet.", label: "No documents" };
      }

      const formatted = rows
        .map((r) => `- [id:${r.id}] "${r.name}" — ${r.summary || "(no summary)"} (${r.status}, ${r.sizeBytes} bytes)`)
        .join("\n");

      return {
        ok: true,
        content: `User has ${rows.length} document(s):\n${formatted}`,
        label: `Listed ${rows.length} document(s)`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, content: `Failed to list documents: ${msg}`, label: "List failed" };
    }
  },
};

export const readDocumentTool: AgentTool = {
  name: "read_document",
  description:
    "Read the full content of a document by id. Use this when the user references a specific document or you need to update one.",
  parameters: {
    type: "object",
    properties: {
      document_id: { type: "string", description: "Document ID from [id:...] in list_documents output" },
    },
    required: ["document_id"],
  },
  async execute(args, ctx) {
    const documentId = String((args as { document_id?: string }).document_id || "");
    if (!documentId) {
      return { ok: false, content: "document_id is required.", label: "Missing id" };
    }
    try {
      const rows = await db
        .select()
        .from(userDocuments)
        .where(and(eq(userDocuments.userId, ctx.userId), eq(userDocuments.id, documentId)))
        .limit(1);
      if (rows.length === 0) {
        return { ok: false, content: `No document found with id "${documentId}".`, label: "Document not found" };
      }
      const doc = rows[0];
      const body = (doc.extractedText || "").slice(0, 12000);
      return {
        ok: true,
        content: `Document "${doc.name}" (id: ${doc.id}, ${doc.mimeType}):\n\n${body}`,
        label: `Read document: ${doc.name}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, content: `Failed to read document: ${msg}`, label: "Read failed" };
    }
  },
};
