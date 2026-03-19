import OpenAI from "openai";
import { db } from "./db";
import { eq, desc } from "drizzle-orm";
import { userDocuments } from "@shared/schema";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const MAX_DOCS_PER_USER = 10;
const MAX_EXTRACTED_CHARS = 80000;
const MAX_SUMMARY_INPUT_CHARS = 60000;

type SupportedMime =
  | "application/pdf"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "application/msword"
  | "text/plain"
  | "text/markdown"
  | "text/csv"
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif";

export const SUPPORTED_MIME_TYPES: SupportedMime[] = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
  "text/markdown",
  "text/csv",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

export const SUPPORTED_EXTENSIONS = [".pdf", ".docx", ".doc", ".txt", ".md", ".csv", ".jpg", ".jpeg", ".png", ".webp", ".gif"];

async function extractFromPdf(buffer: Buffer): Promise<string> {
  const pdfParse = (await import("pdf-parse")).default;
  const data = await pdfParse(buffer);
  return data.text || "";
}

async function extractFromDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value || "";
}

async function extractFromImage(buffer: Buffer, mimeType: string): Promise<string> {
  const base64 = buffer.toString("base64");
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const response = await openai.chat.completions.create({
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
            text: "Extract all text from this image. Return only the text content, preserving structure as much as possible. If there is no text, describe what you see concisely.",
          },
        ],
      },
    ],
    max_tokens: 4096,
  });

  return response.choices[0]?.message?.content || "";
}

async function summarizeText(name: string, text: string): Promise<string> {
  const input = text.slice(0, MAX_SUMMARY_INPUT_CHARS);
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You are a document summarizer. Given content from a document, produce a dense, structured summary that captures the key information an AI assistant would need to answer questions about it. Include: main topics, key facts, names/entities, dates, action items, and any important details. Be thorough but concise. Output under 600 words.`,
      },
      {
        role: "user",
        content: `Document name: "${name}"\n\nContent:\n${input}`,
      },
    ],
    temperature: 0.2,
    max_tokens: 1000,
  });

  return response.choices[0]?.message?.content || text.slice(0, 3000);
}

export async function processDocument(
  userId: string,
  documentId: string,
  name: string,
  mimeType: string,
  buffer: Buffer
): Promise<void> {
  try {
    let extractedText = "";

    if (mimeType === "application/pdf") {
      extractedText = await extractFromPdf(buffer);
    } else if (
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      mimeType === "application/msword"
    ) {
      extractedText = await extractFromDocx(buffer);
    } else if (
      mimeType.startsWith("text/") ||
      mimeType === "application/json"
    ) {
      extractedText = buffer.toString("utf-8");
    } else if (mimeType.startsWith("image/")) {
      extractedText = await extractFromImage(buffer, mimeType);
    } else {
      extractedText = buffer.toString("utf-8");
    }

    extractedText = extractedText
      .replace(/\r\n/g, "\n")
      .replace(/\n{4,}/g, "\n\n\n")
      .trim()
      .slice(0, MAX_EXTRACTED_CHARS);

    const needsSummary = extractedText.length > 6000;
    const summary = needsSummary
      ? await summarizeText(name, extractedText)
      : null;

    await db
      .update(userDocuments)
      .set({ status: "ready", extractedText, summary })
      .where(eq(userDocuments.id, documentId));

    console.log(`[Docs] Processed "${name}" — ${extractedText.length} chars${needsSummary ? ", summarized" : ""}`);
  } catch (err) {
    console.error(`[Docs] Error processing "${name}":`, err);
    await db
      .update(userDocuments)
      .set({
        status: "error",
        summary: `Failed to extract text: ${err instanceof Error ? err.message : "Unknown error"}`,
      })
      .where(eq(userDocuments.id, documentId));
  }
}

export async function getUserDocumentContext(userId: string): Promise<string> {
  const docs = await db
    .select()
    .from(userDocuments)
    .where(eq(userDocuments.userId, userId))
    .orderBy(desc(userDocuments.uploadedAt))
    .limit(MAX_DOCS_PER_USER);

  const readyDocs = docs.filter((d) => d.status === "ready" && (d.extractedText || d.summary));
  if (readyDocs.length === 0) return "";

  const sections = readyDocs.map((doc) => {
    const content = doc.summary || (doc.extractedText?.slice(0, 5000) ?? "");
    return `### ${doc.name}\n${content}`;
  });

  return `\n## My Documents & Knowledge Base\nThe user has uploaded the following documents. Refer to this content when answering questions — treat it as authoritative information about them or their business.\n\n${sections.join("\n\n")}`;
}

export { MAX_DOCS_PER_USER };
