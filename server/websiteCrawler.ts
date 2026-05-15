import * as cheerio from "cheerio";
import { db } from "./db";
import { eq } from "drizzle-orm";
import { websiteCrawls } from "@shared/schema";
import { createRoutedOpenAIChatShim } from "./agent/routedChatCompletion";
import * as dns from "node:dns/promises";
import * as net from "node:net";

const openai = createRoutedOpenAIChatShim("[WebsiteCrawler]", "balanced");

const MAX_PAGES = 60;
const FETCH_TIMEOUT_MS = 8000;
const MAX_TEXT_PER_PAGE = 5000;

// ── SSRF protection ────────────────────────────────────────────────────────────
// Private / reserved IPv4 ranges and IPv6 loopback.
const BLOCKED_PREFIXES_V4 = [
  "0.",          // 0.0.0.0/8
  "10.",         // 10.0.0.0/8 — RFC 1918
  "127.",        // 127.0.0.0/8 — loopback
  "169.254.",    // 169.254.0.0/16 — link-local / cloud metadata (AWS IMDSv1)
  "172.16.",     // 172.16.0.0/12 — RFC 1918 (172.16–172.31)
  "172.17.", "172.18.", "172.19.", "172.20.", "172.21.", "172.22.", "172.23.",
  "172.24.", "172.25.", "172.26.", "172.27.", "172.28.", "172.29.", "172.30.", "172.31.",
  "192.0.0.",    // 192.0.0.0/24 — IETF protocol
  "192.0.2.",    // 192.0.2.0/24 — TEST-NET-1
  "192.168.",    // 192.168.0.0/16 — RFC 1918
  "198.18.",     // 198.18.0.0/15 — benchmarking
  "198.19.",
  "198.51.100.", // 198.51.100.0/24 — TEST-NET-2
  "203.0.113.",  // 203.0.113.0/24 — TEST-NET-3
  "224.",        // 224.0.0.0/4 — multicast
  "240.",        // 240.0.0.0/4 — reserved
  "255.",        // 255.255.255.255
];

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.internal",
]);

function isPrivateIp(ip: string): boolean {
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    // ::1 loopback, fc00::/7 ULA, fe80::/10 link-local
    return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd")
      || lower.startsWith("fe8") || lower.startsWith("fe9")
      || lower.startsWith("fea") || lower.startsWith("feb");
  }
  for (const prefix of BLOCKED_PREFIXES_V4) {
    if (ip.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Validates a URL for SSRF safety:
 * - Must be http or https
 * - Must not target blocked hostnames
 * - Resolves DNS and blocks private / reserved IPs
 * Returns null on failure (safe to ignore), throws Error with message on violation.
 */
async function validatePublicUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Disallowed protocol: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error(`Blocked hostname: ${hostname}`);
  }

  // If the hostname is already a raw IP address, check it directly.
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error(`Blocked private IP: ${hostname}`);
    }
    return parsed;
  }

  // Resolve DNS and check every returned address.
  let addresses: string[] = [];
  try {
    const v4 = await dns.resolve4(hostname).catch(() => [] as string[]);
    const v6 = await dns.resolve6(hostname).catch(() => [] as string[]);
    addresses = [...v4, ...v6];
  } catch {
    throw new Error(`DNS resolution failed for: ${hostname}`);
  }

  if (addresses.length === 0) {
    throw new Error(`No DNS records for: ${hostname}`);
  }

  for (const addr of addresses) {
    if (isPrivateIp(addr)) {
      throw new Error(`Hostname ${hostname} resolves to private IP: ${addr}`);
    }
  }

  return parsed;
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.search = "";
    return u.href;
  } catch {
    return url;
  }
}

function isSameOrigin(base: string, link: string): boolean {
  try {
    const baseUrl = new URL(base);
    const linkUrl = new URL(link, base);
    return linkUrl.hostname === baseUrl.hostname;
  } catch {
    return false;
  }
}

function resolveUrl(base: string, href: string): string | null {
  try {
    const resolved = new URL(href, base);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return null;
    return resolved.href;
  } catch {
    return null;
  }
}

const MAX_REDIRECTS = 5;

/**
 * Fetch a URL with manual redirect handling so every hop is validated
 * against the SSRF blocklist before any internal request is made.
 */
async function fetchWithSafeRedirects(
  startUrl: string,
  signal: AbortSignal,
): Promise<Response | null> {
  let currentUrl = startUrl;
  let hops = 0;

  while (hops <= MAX_REDIRECTS) {
    try {
      await validatePublicUrl(currentUrl);
    } catch {
      return null;
    }

    const res = await fetch(currentUrl, {
      signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; JarvisBot/1.0; +https://jarvis.app)" },
      redirect: "manual",
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return null;
      try {
        currentUrl = new URL(location, currentUrl).href;
      } catch {
        return null;
      }
      hops++;
      continue;
    }

    return res;
  }

  return null;
}

async function fetchPage(url: string): Promise<{ text: string; links: string[] }> {
  // Pre-validate the starting URL before opening any connection.
  try {
    await validatePublicUrl(url);
  } catch {
    return { text: "", links: [] };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchWithSafeRedirects(url, controller.signal);
    clearTimeout(timer);

    if (!res) return { text: "", links: [] };
    if (!res.ok) return { text: "", links: [] };
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return { text: "", links: [] };
    const html = await res.text();
    const $ = cheerio.load(html);

    $("script, style, nav, footer, iframe, noscript, svg, [aria-hidden='true'], header").remove();
    $("[class*='menu'], [class*='nav'], [class*='sidebar'], [class*='cookie'], [id*='nav'], [id*='menu']").remove();

    const title = $("title").text().trim();
    const metaDesc = $("meta[name='description']").attr("content") || "";

    let mainContent = $("article, main, [role='main'], .content, #content, .post, #post").text();
    if (!mainContent.trim()) mainContent = $("body").text();

    const cleaned = mainContent
      .replace(/\t/g, " ")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, MAX_TEXT_PER_PAGE);

    const parts: string[] = [];
    if (title) parts.push(`[${title}]`);
    if (metaDesc) parts.push(metaDesc);
    if (cleaned) parts.push(cleaned);
    const text = parts.join("\n");

    const links: string[] = [];
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      const resolved = resolveUrl(url, href);
      if (resolved && isSameOrigin(url, resolved)) {
        links.push(normalizeUrl(resolved));
      }
    });

    return { text, links: [...new Set(links)] };
  } catch {
    clearTimeout(timer);
    return { text: "", links: [] };
  }
}

async function distillSummary(url: string, allText: string): Promise<string> {
  const truncated = allText.slice(0, 80000);
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You are an expert at reading websites and extracting key information about a person or business. Given crawled page content, write a concise structured summary that a personal AI assistant can use to always know who the user is, what they do, what they offer, and any other key facts. Format as a short markdown document with sections: About, What They Do/Offer, Key Facts. Be specific and factual — only include what is clearly stated on the site. Max 600 words.",
      },
      {
        role: "user",
        content: `Website: ${url}\n\n---\n${truncated}`,
      },
    ],
    max_tokens: 1000,
    temperature: 0.2,
  });
  return response.choices[0]?.message?.content?.trim() || "";
}

export async function startWebsiteCrawl(userId: string, url: string): Promise<void> {
  const crawledAt = new Date();
  try {
    // Validate the root URL first — abort early if private/blocked.
    await validatePublicUrl(url);

    await db
      .insert(websiteCrawls)
      .values({ userId, url, status: "crawling", pageCount: 0, summary: null, crawledAt })
      .onConflictDoUpdate({
        target: websiteCrawls.userId,
        set: { url, status: "crawling", pageCount: 0, summary: null, crawledAt },
      });

    const visited = new Set<string>();
    const queue: string[] = [normalizeUrl(url)];
    const allTexts: string[] = [];

    while (queue.length > 0 && visited.size < MAX_PAGES) {
      const next = queue.shift()!;
      if (visited.has(next)) continue;
      visited.add(next);

      const { text, links } = await fetchPage(next);
      if (text.trim()) allTexts.push(`--- Page: ${next} ---\n${text}`);

      for (const link of links) {
        if (!visited.has(link) && !queue.includes(link)) {
          queue.push(link);
        }
      }
    }

    const pageCount = visited.size;
    const combinedText = allTexts.join("\n\n");

    let summary = "";
    if (combinedText.trim()) {
      summary = await distillSummary(url, combinedText);
    }

    await db
      .update(websiteCrawls)
      .set({ status: "done", pageCount, summary, crawledAt: new Date() })
      .where(eq(websiteCrawls.userId, userId));

    console.log(`[websiteCrawler] done for user ${userId}: ${pageCount} pages`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[websiteCrawler] error:", msg);
    await db
      .update(websiteCrawls)
      .set({ status: "error" })
      .where(eq(websiteCrawls.userId, userId));
  }
}

export async function getWebsiteCrawlSummaryBlock(userId: string): Promise<string> {
  try {
    const rows = await db
      .select()
      .from(websiteCrawls)
      .where(eq(websiteCrawls.userId, userId))
      .limit(1);
    const row = rows[0];
    if (!row || row.status !== "done" || !row.summary) return "";
    return `\n## My Business / Background (from website crawl of ${row.url})\n${row.summary}\n`;
  } catch {
    return "";
  }
}
