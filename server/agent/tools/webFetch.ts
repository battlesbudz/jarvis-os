import type { AgentTool } from "../types";
import * as cheerio from "cheerio";

const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { text: string; fetchedAt: number }>();

function cleanExpiredCache(): void {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now - entry.fetchedAt > CACHE_TTL_MS) {
      cache.delete(key);
    }
  }
}

function htmlToReadableText(html: string): string {
  const $ = cheerio.load(html);

  $("script, style, nav, footer, iframe, noscript, svg, [aria-hidden='true']").remove();
  $("[class*='menu'], [class*='nav'], [class*='sidebar'], [class*='cookie'], [id*='nav'], [id*='menu']").remove();

  const title = $("title").text().trim();
  const metaDesc = $("meta[name='description']").attr("content") || "";

  let mainContent = $("article, main, [role='main'], .content, #content, .post, #post").text();
  if (!mainContent.trim()) {
    mainContent = $("body").text();
  }

  const cleaned = mainContent
    .replace(/\t/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const parts: string[] = [];
  if (title) parts.push(`# ${title}`);
  if (metaDesc) parts.push(`*${metaDesc}*`);
  if (cleaned) parts.push(cleaned);

  return parts.join("\n\n");
}

export const webFetchTool: AgentTool = {
  name: "web_fetch",
  description:
    "Fetch and read the content of any URL — news articles, documentation, shared links, web pages. Converts HTML to clean readable text. Results are cached for 15 minutes. Use this when the user shares a link, or when you already know a URL from research and want to read its contents directly.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The full URL to fetch (must start with https:// or http://)",
      },
      max_chars: {
        type: "number",
        description:
          "Maximum characters of content to return (default 8000, max 20000). Use a lower value for a quick summary.",
      },
    },
    required: ["url"],
  },
  async execute(args, ctx) {
    const url = String(args.url || "").trim();
    const maxChars = Math.min(20000, Math.max(500, Number(args.max_chars) || 8000));

    if (!url) {
      return { ok: false, content: "No URL provided.", label: "web_fetch: no URL" };
    }

    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return {
        ok: false,
        content: `Invalid URL — must start with http:// or https://. Got: ${url}`,
        label: "web_fetch: invalid URL",
      };
    }

    cleanExpiredCache();

    const cached = cache.get(url);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      const truncated = cached.text.slice(0, maxChars);
      const wasCut = cached.text.length > maxChars;
      console.log(`[${ctx.channel || "Agent"}] web_fetch cache hit → ${url}`);
      return {
        ok: true,
        content: truncated + (wasCut ? `\n\n[…content truncated at ${maxChars} chars]` : ""),
        label: `Fetched (cached): ${url}`,
        detail: `${truncated.length} chars (cached)`,
      };
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; Jarvis/1.0; +https://jarvis.ai)",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return {
          ok: false,
          content: `HTTP ${response.status} ${response.statusText} for URL: ${url}`,
          label: `web_fetch: HTTP ${response.status}`,
        };
      }

      const contentType = response.headers.get("content-type") || "";

      let text: string;
      if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
        const html = await response.text();
        text = htmlToReadableText(html);
      } else if (contentType.includes("text/") || contentType.includes("application/json")) {
        text = await response.text();
      } else {
        return {
          ok: false,
          content: `Unsupported content type "${contentType}" — can only read HTML and text pages.`,
          label: "web_fetch: unsupported type",
        };
      }

      if (!text.trim()) {
        return {
          ok: false,
          content: `URL returned empty content: ${url}`,
          label: "web_fetch: empty response",
        };
      }

      cache.set(url, { text, fetchedAt: Date.now() });

      const truncated = text.slice(0, maxChars);
      const wasCut = text.length > maxChars;

      console.log(
        `[${ctx.channel || "Agent"}] web_fetch ${url} → ${text.length} chars${wasCut ? ` (truncated to ${maxChars})` : ""}`,
      );

      return {
        ok: true,
        content: truncated + (wasCut ? `\n\n[…content truncated at ${maxChars} chars]` : ""),
        label: `Fetched: ${url}`,
        detail: `${truncated.length} chars read`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const label =
        msg.includes("abort") || msg.includes("timeout")
          ? "web_fetch: timed out"
          : msg.includes("ENOTFOUND") || msg.includes("EAI_AGAIN")
          ? "web_fetch: domain not found"
          : "web_fetch: failed";
      return { ok: false, content: `${label}: ${msg}`, label, detail: msg };
    }
  },
};
