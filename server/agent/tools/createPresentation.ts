import type { AgentTool } from "../types";
import { createDriveBinaryFile } from "../../integrations/googleDrive";

export interface PresentationSlide {
  heading: string;
  bullets: string[];
  notes?: string;
}

export interface PresentationOutline {
  title: string;
  subtitle?: string;
  slides: PresentationSlide[];
}

/**
 * Generate a .pptx Buffer from a structured outline using PptxGenJS.
 *
 * Design: "Midnight Executive" palette — navy background for title/outro,
 * off-white content slides, consistent typography throughout.
 */
async function outlineToPptxBuffer(outline: PresentationOutline): Promise<Buffer> {
  const { default: PptxGenJS } = await import("pptxgenjs");

  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_16x9";
  pres.title = outline.title;

  const COLORS = {
    navy: "1E2761",
    iceBlue: "CADCFC",
    white: "FFFFFF",
    offWhite: "F7F9FC",
    darkText: "1A1A2E",
    mutedText: "4A5568",
    accent: "3B82F6",
  };

  // ── Title slide ─────────────────────────────────────────────────────────────
  const titleSlide = pres.addSlide();
  titleSlide.background = { color: COLORS.navy };

  // Accent bar
  titleSlide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 4.5, w: 10, h: 1.125,
    fill: { color: COLORS.accent },
    line: { color: COLORS.accent },
  });

  titleSlide.addText(outline.title, {
    x: 0.6, y: 1.2, w: 8.8, h: 1.8,
    fontSize: 40,
    fontFace: "Calibri",
    bold: true,
    color: COLORS.white,
    align: "left",
    valign: "middle",
  });

  if (outline.subtitle) {
    titleSlide.addText(outline.subtitle, {
      x: 0.6, y: 2.9, w: 8.8, h: 0.9,
      fontSize: 18,
      fontFace: "Calibri",
      color: COLORS.iceBlue,
      align: "left",
      valign: "top",
    });
  }

  // Slide count label
  titleSlide.addText(`${outline.slides.length} slides`, {
    x: 0.6, y: 4.55, w: 3, h: 0.5,
    fontSize: 13,
    fontFace: "Calibri",
    color: COLORS.white,
    align: "left",
    valign: "middle",
  });

  // ── Content slides ───────────────────────────────────────────────────────────
  outline.slides.forEach((slide, idx) => {
    const s = pres.addSlide();
    s.background = { color: COLORS.offWhite };

    // Header bar
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0, y: 0, w: 10, h: 1.0,
      fill: { color: COLORS.navy },
      line: { color: COLORS.navy },
    });

    // Slide number badge
    s.addText(String(idx + 1), {
      x: 9.0, y: 0.05, w: 0.7, h: 0.7,
      fontSize: 11,
      fontFace: "Calibri",
      bold: true,
      color: COLORS.navy,
      align: "center",
      valign: "middle",
      fill: { color: COLORS.iceBlue },
    });

    // Heading
    s.addText(slide.heading, {
      x: 0.4, y: 0.08, w: 8.3, h: 0.84,
      fontSize: 22,
      fontFace: "Calibri",
      bold: true,
      color: COLORS.white,
      align: "left",
      valign: "middle",
      margin: 0,
    });

    // Bullets
    if (slide.bullets.length > 0) {
      const bulletItems = slide.bullets.map((b, i) => ({
        text: b,
        options: {
          bullet: true,
          breakLine: i < slide.bullets.length - 1,
          fontSize: 16,
          fontFace: "Calibri",
          color: COLORS.darkText,
          paraSpaceAfter: 6,
        },
      }));

      s.addText(bulletItems, {
        x: 0.5, y: 1.15, w: 9.0, h: 4.2,
        valign: "top",
      });
    }

    // Speaker notes
    if (slide.notes) {
      s.addNotes(slide.notes);
    }
  });

  // ── Closing slide ────────────────────────────────────────────────────────────
  const outro = pres.addSlide();
  outro.background = { color: COLORS.navy };

  outro.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 2.4, w: 10, h: 0.08,
    fill: { color: COLORS.accent },
    line: { color: COLORS.accent },
  });

  outro.addText("Thank You", {
    x: 0.6, y: 1.0, w: 8.8, h: 1.3,
    fontSize: 44,
    fontFace: "Calibri",
    bold: true,
    color: COLORS.white,
    align: "center",
    valign: "middle",
  });

  outro.addText(outline.title, {
    x: 0.6, y: 2.6, w: 8.8, h: 0.7,
    fontSize: 16,
    fontFace: "Calibri",
    color: COLORS.iceBlue,
    align: "center",
    valign: "middle",
  });

  // ── Write to buffer ──────────────────────────────────────────────────────────
  const data = await pres.write({ outputType: "nodebuffer" }) as Buffer;
  return data;
}

function safeFilename(name: string, ext: string): string {
  return name.replace(/[^A-Za-z0-9._\- ]+/g, "_").slice(0, 80).trim() + ext;
}

export const createPresentationTool: AgentTool = {
  name: "create_presentation",
  description:
    "Create a PowerPoint presentation (.pptx) from a structured outline — title, slides with headings and bullet points. Use when the user asks to 'create a deck', 'build a presentation', 'make slides', 'create a pitch deck', etc. Delivers the .pptx file on the current channel and optionally saves it to Google Drive.",
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Presentation title, shown on the cover slide and as the file name",
      },
      subtitle: {
        type: "string",
        description: "Optional subtitle shown below the title on the cover slide (e.g. date, author, topic summary)",
      },
      slides: {
        type: "array",
        description: "Ordered list of slides. Each slide has a heading and an array of bullet point strings.",
        items: {
          type: "object",
          properties: {
            heading: { type: "string", description: "Slide title / section heading" },
            bullets: {
              type: "array",
              items: { type: "string" },
              description: "Bullet points for this slide (3–6 items per slide is ideal)",
            },
            notes: {
              type: "string",
              description: "Optional presenter notes for this slide",
            },
          },
          required: ["heading", "bullets"],
        },
      },
      save_to_drive: {
        type: "boolean",
        description: "If true and the user has Google Drive connected, also save the .pptx to their Jarvis Drive folder.",
      },
    },
    required: ["title", "slides"],
  },
  async execute(args, ctx) {
    const a = args as {
      title?: string;
      subtitle?: string;
      slides?: Array<{ heading?: string; bullets?: unknown[]; notes?: string }>;
      save_to_drive?: boolean;
    };

    const title = String(a.title || "").trim() || "Presentation";
    const subtitle = a.subtitle ? String(a.subtitle).trim() : undefined;

    if (!Array.isArray(a.slides) || a.slides.length === 0) {
      return {
        ok: false,
        content: "At least one slide is required. Provide a slides array with heading and bullets.",
        label: "No slides provided",
      };
    }

    // Normalise slides
    const slides: PresentationSlide[] = a.slides.map((s) => ({
      heading: String(s.heading || "").trim() || "Slide",
      bullets: Array.isArray(s.bullets)
        ? s.bullets.map((b) => String(b).trim()).filter(Boolean)
        : [],
      notes: s.notes ? String(s.notes).trim() : undefined,
    }));

    const outline: PresentationOutline = { title, subtitle, slides };

    // ── Generate .pptx ────────────────────────────────────────────────────────
    let pptxBuffer: Buffer;
    try {
      pptxBuffer = await outlineToPptxBuffer(outline);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[create_presentation] PPTX generation failed:", msg);
      return { ok: false, content: `Presentation generation failed: ${msg}`, label: "PPTX generation failed" };
    }

    const filename = safeFilename(title, ".pptx");
    const results: string[] = [];

    // ── Queue for channel delivery ─────────────────────────────────────────────
    const pending = (ctx.state.pendingAttachments ||= []);
    pending.push({
      kind: "document",
      filename,
      content: pptxBuffer,
      caption: `${title} — ${slides.length} slides`,
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
    results.push("queued for delivery on this channel");

    // ── Optionally save to Drive ───────────────────────────────────────────────
    if (a.save_to_drive && ctx.googleAccessToken) {
      try {
        const file = await createDriveBinaryFile(
          ctx.googleAccessToken,
          filename,
          pptxBuffer,
          "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        );
        results.push(`saved to Google Drive: ${file.webViewLink}`);
        console.log(`[${ctx.channel || "Agent"}] create_presentation saved to Drive: ${file.webViewLink}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[create_presentation] Drive upload failed:", msg);
        results.push(`Drive upload failed: ${msg}`);
      }
    }

    console.log(
      `[${ctx.channel || "Agent"}] create_presentation title="${title}" slides=${slides.length} size=${pptxBuffer.length}B`
    );

    return {
      ok: true,
      content: `Presentation "${filename}" created (${slides.length} content slides + cover + closing, ${Math.round(pptxBuffer.length / 1024)} KB) — ${results.join("; ")}.`,
      label: `Created presentation: ${title}`,
      detail: filename,
    };
  },
};
