import type { AgentTool } from "../types";
import { db } from "../../db";
import { userDocuments } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { createDriveBinaryFile } from "../../integrations/googleDrive";

/**
 * Convert markdown text to a formatted PDF Buffer using PDFKit.
 *
 * Supported markdown constructs:
 *   # H1 — large title
 *   ## H2 — section heading
 *   ### H3 — sub-section heading
 *   **text** — bold (inline, stripped for PDFKit simplicity)
 *   - item / * item — bullet list
 *   blank line — paragraph break
 */
export async function markdownToPdfBuffer(title: string, markdown: string): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 72, size: "A4" });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const COLORS = {
      title: "#1a1a2e",
      h1: "#16213e",
      h2: "#0f3460",
      h3: "#533483",
      body: "#2d2d2d",
      bullet: "#0f3460",
      rule: "#cccccc",
    };

    const PAGE_W = doc.page.width - 144;

    // ── Cover title ────────────────────────────────────────────────────────────
    doc
      .font("Helvetica-Bold")
      .fontSize(26)
      .fillColor(COLORS.title)
      .text(title, { align: "left" });

    doc
      .moveDown(0.3)
      .strokeColor(COLORS.rule)
      .lineWidth(1)
      .moveTo(72, doc.y)
      .lineTo(72 + PAGE_W, doc.y)
      .stroke();

    doc.moveDown(0.8);

    // ── Parse & render lines ───────────────────────────────────────────────────
    const lines = markdown.split(/\r?\n/);
    let inList = false;

    const stripInline = (s: string) =>
      s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1").replace(/`(.+?)`/g, "$1");

    for (const raw of lines) {
      const line = raw.trimEnd();

      // Blank line — close list, add spacing
      if (!line.trim()) {
        if (inList) {
          inList = false;
          doc.moveDown(0.4);
        } else {
          doc.moveDown(0.6);
        }
        continue;
      }

      // H1
      if (/^# /.test(line)) {
        if (inList) { inList = false; doc.moveDown(0.4); }
        doc.moveDown(0.5);
        doc
          .font("Helvetica-Bold")
          .fontSize(20)
          .fillColor(COLORS.h1)
          .text(stripInline(line.replace(/^# /, "")), { lineGap: 2 });
        doc.moveDown(0.3);
        continue;
      }

      // H2
      if (/^## /.test(line)) {
        if (inList) { inList = false; doc.moveDown(0.4); }
        doc.moveDown(0.4);
        doc
          .font("Helvetica-Bold")
          .fontSize(16)
          .fillColor(COLORS.h2)
          .text(stripInline(line.replace(/^## /, "")), { lineGap: 2 });
        doc.moveDown(0.2);
        continue;
      }

      // H3
      if (/^### /.test(line)) {
        if (inList) { inList = false; doc.moveDown(0.4); }
        doc.moveDown(0.3);
        doc
          .font("Helvetica-Bold")
          .fontSize(13)
          .fillColor(COLORS.h3)
          .text(stripInline(line.replace(/^### /, "")), { lineGap: 2 });
        doc.moveDown(0.2);
        continue;
      }

      // Bullet list item (- or *)
      if (/^[-*] /.test(line)) {
        inList = true;
        const text = stripInline(line.replace(/^[-*] /, ""));
        doc
          .font("Helvetica")
          .fontSize(11)
          .fillColor(COLORS.body);
        // Bullet dot
        const bulletX = 72;
        const textX = 90;
        const y = doc.y;
        doc.text("•", bulletX, y, { continued: false, width: 14 });
        doc.text(text, textX, y, { width: PAGE_W - 18, lineGap: 2 });
        doc.moveDown(0.15);
        continue;
      }

      // Sub-bullet (  - or    *)
      if (/^ {2,4}[-*] /.test(line)) {
        inList = true;
        const text = stripInline(line.replace(/^ {2,4}[-*] /, ""));
        const bulletX = 100;
        const textX = 116;
        const y = doc.y;
        doc
          .font("Helvetica")
          .fontSize(10.5)
          .fillColor(COLORS.body);
        doc.text("◦", bulletX, y, { continued: false, width: 14 });
        doc.text(text, textX, y, { width: PAGE_W - 44, lineGap: 2 });
        doc.moveDown(0.1);
        continue;
      }

      // Horizontal rule
      if (/^---+$/.test(line.trim())) {
        if (inList) { inList = false; doc.moveDown(0.4); }
        doc.moveDown(0.3);
        doc
          .strokeColor(COLORS.rule)
          .lineWidth(0.5)
          .moveTo(72, doc.y)
          .lineTo(72 + PAGE_W, doc.y)
          .stroke();
        doc.moveDown(0.5);
        continue;
      }

      // Normal paragraph
      if (inList) { inList = false; doc.moveDown(0.4); }
      doc
        .font("Helvetica")
        .fontSize(11)
        .fillColor(COLORS.body)
        .text(stripInline(line), { lineGap: 3, paragraphGap: 4 });
    }

    doc.end();
  });
}

function safeFilename(name: string, ext: string): string {
  return name.replace(/[^A-Za-z0-9._\- ]+/g, "_").slice(0, 80).trim() + ext;
}

export const exportDocumentPdfTool: AgentTool = {
  name: "export_document_pdf",
  description:
    "Export a Jarvis document (or inline markdown text) as a formatted PDF file. Delivers the PDF on the current channel (Telegram/Discord) and optionally saves it to the user's Google Drive. Use when the user asks to 'export as PDF', 'create a PDF report', 'save as PDF', etc.",
  parameters: {
    type: "object",
    properties: {
      document_id: {
        type: "string",
        description: "ID of a document from the user's library (from list_documents). Takes priority over inline_text.",
      },
      inline_text: {
        type: "string",
        description: "Markdown text to render as PDF when no document_id is given.",
      },
      title: {
        type: "string",
        description: "Title to display at the top of the PDF. Defaults to the document name or 'Document'.",
      },
      save_to_drive: {
        type: "boolean",
        description: "If true and the user has Google Drive connected, also save the PDF to their Jarvis Drive folder.",
      },
    },
  },
  async execute(args, ctx) {
    const a = args as {
      document_id?: string;
      inline_text?: string;
      title?: string;
      save_to_drive?: boolean;
    };

    let markdown = "";
    let docTitle = a.title || "Document";

    // ── Fetch document from library ──────────────────────────────────────────
    if (a.document_id) {
      try {
        const rows = await db
          .select()
          .from(userDocuments)
          .where(and(eq(userDocuments.userId, ctx.userId), eq(userDocuments.id, a.document_id)))
          .limit(1);

        if (rows.length === 0) {
          return { ok: false, content: `No document found with id "${a.document_id}".`, label: "Document not found" };
        }
        const doc = rows[0];
        markdown = doc.extractedText || "";
        if (!a.title) docTitle = doc.name || "Document";
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, content: `Failed to read document: ${msg}`, label: "Read failed" };
      }
    } else if (a.inline_text) {
      markdown = String(a.inline_text);
    } else {
      return {
        ok: false,
        content: "Provide either a document_id or inline_text to export as PDF.",
        label: "Missing input",
      };
    }

    if (!markdown.trim()) {
      return { ok: false, content: "The document has no text content to export.", label: "Empty document" };
    }

    // ── Generate PDF ─────────────────────────────────────────────────────────
    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await markdownToPdfBuffer(docTitle, markdown);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[export_document_pdf] PDF generation failed:", msg);
      const fallbackContent = `⚠️ PDF generation failed — here is the markdown version:\n\n${markdown}`;
      return {
        ok: false,
        content: fallbackContent,
        label: "PDF generation failed — markdown fallback",
      };
    }

    const filename = safeFilename(docTitle, ".pdf");
    const results: string[] = [];

    // ── Queue for channel delivery ────────────────────────────────────────────
    const pending = (ctx.state.pendingAttachments ||= []);
    pending.push({
      kind: "document",
      filename,
      content: pdfBuffer,
      caption: docTitle,
      mimeType: "application/pdf",
    });
    results.push("queued for delivery on this channel");

    // ── Optionally save to Drive ──────────────────────────────────────────────
    if (a.save_to_drive && ctx.googleAccessToken) {
      try {
        const file = await createDriveBinaryFile(
          ctx.googleAccessToken,
          filename,
          pdfBuffer,
          "application/pdf"
        );
        results.push(`saved to Google Drive: ${file.webViewLink}`);
        console.log(`[${ctx.channel || "Agent"}] export_document_pdf saved to Drive: ${file.webViewLink}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[export_document_pdf] Drive upload failed:", msg);
        results.push(`Drive upload failed: ${msg}`);
      }
    }

    console.log(
      `[${ctx.channel || "Agent"}] export_document_pdf title="${docTitle}" size=${pdfBuffer.length}B`
    );

    return {
      ok: true,
      content: `PDF "${filename}" exported (${Math.round(pdfBuffer.length / 1024)} KB) — ${results.join("; ")}.`,
      label: `Exported PDF: ${docTitle}`,
      detail: filename,
    };
  },
};
