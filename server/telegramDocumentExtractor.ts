import OpenAI from "openai";
import { downloadTelegramFileBuffer } from "./integrations/telegram";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 20_000;

let _openai: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
  }
  return _openai;
}

export const INGESTABLE_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
]);

const CSV_MIMES = new Set([
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
]);

const INGESTABLE_EXTENSIONS = new Set([".pdf", ".docx", ".txt", ".md", ".csv"]);

export function isIngestableDocument(mimeType: string | undefined, filename?: string): boolean {
  if (mimeType && INGESTABLE_MIME_TYPES.has(mimeType)) return true;
  if (filename) {
    const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0];
    if (ext && INGESTABLE_EXTENSIONS.has(ext)) return true;
  }
  return false;
}

export interface DocumentExtractionResult {
  text: string;
  filename: string;
  fileSizeBytes: number;
  pageCount?: number;
  charCount: number;
  truncated: boolean;
}

async function extractPdf(buffer: Buffer): Promise<{ text: string; pageCount: number }> {
  const { pathToFileURL } = await import("url");
  const { resolve } = await import("path");
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as typeof import("pdfjs-dist");
  const workerPath = resolve("./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

  const uint8 = new Uint8Array(buffer);
  const loadingTask = pdfjs.getDocument({ data: uint8, useSystemFonts: true });
  const pdf = await loadingTask.promise;
  const pageCount = pdf.numPages;

  let fullText = "";
  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = (content.items as Array<{ str?: string }>)
      .filter((item) => typeof item.str === "string")
      .map((item) => item.str as string)
      .join(" ");
    fullText += pageText + "\n";
  }

  return { text: fullText.trim(), pageCount };
}

const MAX_OCR_PAGES = 10;

async function renderPageToPngBase64(
  pdf: Awaited<ReturnType<(typeof import("pdfjs-dist"))["getDocument"]>["promise"]>,
  pageNum: number,
): Promise<string | null> {
  try {
    const { createCanvas } = await import("@napi-rs/canvas");
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");

    await page.render({
      canvas: null,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;

    const pngBuffer = canvas.toBuffer("image/png");
    return pngBuffer.toString("base64");
  } catch (err) {
    console.warn(`[TelegramDocs] page ${pageNum} render failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

async function extractPdfViaVision(buffer: Buffer): Promise<string> {
  try {
    const { pathToFileURL } = await import("url");
    const { resolve } = await import("path");
    const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as typeof import("pdfjs-dist");
    const workerPath = resolve("./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

    const uint8 = new Uint8Array(buffer);
    const pdf = await pdfjs.getDocument({ data: uint8, useSystemFonts: true }).promise;
    const pagesToProcess = Math.min(pdf.numPages, MAX_OCR_PAGES);
    if (pdf.numPages > MAX_OCR_PAGES) {
      console.log(`[TelegramDocs] vision OCR: PDF has ${pdf.numPages} pages — only reading first ${MAX_OCR_PAGES}`);
    }

    const pageTexts: string[] = [];
    for (let i = 1; i <= pagesToProcess; i++) {
      const base64 = await renderPageToPngBase64(pdf, i);
      if (!base64) continue;

      const dataUrl = `data:image/png;base64,${base64}`;
      try {
        const response = await getOpenAI().chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: { url: dataUrl, detail: "high" },
                },
                {
                  type: "text",
                  text: "Extract all text from this document page. Return only the text content, preserving structure (headings, paragraphs, tables) as much as possible. If there is no readable text on this page, return an empty string.",
                },
              ],
            },
          ],
          max_tokens: 4096,
        });

        const pageText = response.choices[0]?.message?.content?.trim() ?? "";
        if (pageText) {
          pageTexts.push(pageText);
        }
      } catch (apiErr) {
        console.warn(`[TelegramDocs] vision OCR API call failed for page ${i}:`, apiErr instanceof Error ? apiErr.message : apiErr);
      }
    }

    return pageTexts.join("\n\n");
  } catch (err) {
    console.warn("[TelegramDocs] vision OCR fallback failed:", err instanceof Error ? err.message : err);
    return "";
  }
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value || "";
}

function csvToTable(raw: string): string {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return raw;

  const rows = lines.map((line) => {
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        cells.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    return cells;
  });

  if (rows.length === 0) return raw;

  const colCount = Math.max(...rows.map((r) => r.length));
  const padded = rows.map((r) => {
    while (r.length < colCount) r.push("");
    return r;
  });

  const colWidths = Array.from({ length: colCount }, (_, ci) =>
    Math.min(40, Math.max(...padded.map((r) => r[ci]?.length ?? 0)))
  );

  const formatRow = (cells: string[]) =>
    "| " + cells.map((c, i) => c.slice(0, colWidths[i]).padEnd(colWidths[i])).join(" | ") + " |";

  const separator = "|-" + colWidths.map((w) => "-".repeat(w)).join("-|-") + "-|";

  const tableLines = [formatRow(padded[0]), separator, ...padded.slice(1).map(formatRow)];
  return tableLines.join("\n");
}

export async function extractTelegramDocument(
  fileId: string,
  mimeType: string,
  filename: string,
  fileSizeBytes: number | undefined,
): Promise<DocumentExtractionResult | { error: string }> {
  if (fileSizeBytes !== undefined && fileSizeBytes > MAX_FILE_BYTES) {
    const mb = (fileSizeBytes / 1024 / 1024).toFixed(1);
    return {
      error: `That file is ${mb} MB — Jarvis can only read documents up to 20 MB. Try splitting it or pasting the key sections as text.`,
    };
  }

  const downloaded = await downloadTelegramFileBuffer(fileId);
  if (!downloaded) {
    return { error: "Sorry, I couldn't download that file. Please try again." };
  }

  const { buffer } = downloaded;
  const actualBytes = buffer.length;

  if (actualBytes > MAX_FILE_BYTES) {
    return {
      error: "That file is over 20 MB — Jarvis can only read documents up to 20 MB. Try splitting it or pasting the key sections as text.",
    };
  }

  let rawText = "";
  let pageCount: number | undefined;

  const lowerFilename = filename.toLowerCase();
  const isPdf = mimeType === "application/pdf" || lowerFilename.endsWith(".pdf");
  const isDocx =
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lowerFilename.endsWith(".docx");
  const isCsv = CSV_MIMES.has(mimeType) || lowerFilename.endsWith(".csv");

  try {
    if (isPdf) {
      const result = await extractPdf(buffer);
      rawText = result.text;
      pageCount = result.pageCount;

      if (!rawText) {
        console.log(`[TelegramDocs] "${filename}" has no selectable text — attempting vision OCR`);
        rawText = await extractPdfViaVision(buffer);
        if (rawText) {
          console.log(`[TelegramDocs] vision OCR extracted ${rawText.length} chars from "${filename}"`);
        }
      }
    } else if (isDocx) {
      rawText = await extractDocx(buffer);
    } else if (isCsv) {
      rawText = csvToTable(buffer.toString("utf-8"));
    } else {
      rawText = buffer.toString("utf-8");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[TelegramDocs] extraction failed for "${filename}":`, msg);
    return { error: msg.length < 200 ? msg : "I ran into a problem reading that file. It might be encrypted, password-protected, or in an unsupported format." };
  }

  rawText = rawText
    .replace(/\r\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();

  if (!rawText) {
    return { error: "I couldn't extract any text from that file. It may be encrypted, password-protected, or empty." };
  }

  const truncated = rawText.length > MAX_EXTRACTED_CHARS;
  const text = truncated ? rawText.slice(0, MAX_EXTRACTED_CHARS) : rawText;

  return {
    text,
    filename,
    fileSizeBytes: actualBytes,
    pageCount,
    charCount: text.length,
    truncated,
  };
}

export function buildDocumentContextBlock(result: DocumentExtractionResult): string {
  const kb = (result.fileSizeBytes / 1024).toFixed(0);
  const sizePart = ` (${kb} KB)`;
  const pagePart = result.pageCount ? `, ${result.pageCount} page${result.pageCount !== 1 ? "s" : ""}` : "";
  const truncNote = result.truncated ? ", truncated to first 20 000 chars" : "";
  const header = `[Document: "${result.filename}"${sizePart}${pagePart}${truncNote}]`;
  return `${header}\n\n${result.text}`;
}
