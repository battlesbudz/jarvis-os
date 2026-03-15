import * as cheerio from "cheerio";
import OpenAI from "openai";
import { db } from "./db";
import { eq } from "drizzle-orm";
import { websiteCrawls } from "@shared/schema";
import * as dns from "node:dns/promises";
import * as net from "node:net";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const MAX_PAGES = 60;
const FETCH_TIMEOUT = 10000;

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 0) return true;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
  }
  return false;
}

async function isSafeUrl(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const hostname = parsed.hostname;
    if (hostname === 'localhost' || hostname === '0.0.0.0') return false;
    if (net.isIP(hostname)) return !isPrivateIp(hostname);
    const addresses = await dns.resolve4(hostname).catch(() => []);
    const addresses6 = await dns.resolve6(hostname).catch(() => []);
    const allAddrs = [...addresses, ...addresses6];
    if (allAddrs.length === 0) return false;
    return !allAddrs.some(isPrivateIp);
  } catch {
    return false;
  }
}

function normalizeUrl(base: string, href: string): string | null {
  try {
    const url = new URL(href, base);
    url.hash = "";
    url.search = "";
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

function isSameDomain(base: string, candidate: string): boolean {
  try {
    const baseHost = new URL(base).hostname;
    const candidateHost = new URL(candidate).hostname;
    return baseHost === candidateHost;
  } catch {
    return false;
  }
}

function isPageUrl(url: string): boolean {
  const ext = url.split(".").pop()?.toLowerCase() || "";
  const skipExts = [
    "png", "jpg", "jpeg", "gif", "svg", "webp", "ico",
    "pdf", "zip", "tar", "gz", "mp3", "mp4", "avi",
    "css", "js", "woff", "woff2", "ttf", "eot",
  ];
  return !skipExts.includes(ext);
}

const MAX_REDIRECTS = 5;

async function fetchPage(url: string): Promise<string | null> {
  try {
    let currentUrl = url;
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      const safe = await isSafeUrl(currentUrl);
      if (!safe) return null;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
      const res = await fetch(currentUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent": "GamePlanBot/1.0 (website context crawler)",
          "Accept": "text/html",
        },
        redirect: "manual",
      });
      clearTimeout(timer);

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) return null;
        currentUrl = new URL(location, currentUrl).href;
        continue;
      }

      if (!res.ok) return null;
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("text/html")) return null;
      return await res.text();
    }
    return null;
  } catch {
    return null;
  }
}

function extractText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, nav, footer, header, noscript, iframe, svg").remove();
  const text = $("body").text();
  return text
    .replace(/\s+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 15000);
}

function extractLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const links: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const normalized = normalizeUrl(baseUrl, href);
    if (normalized && isSameDomain(baseUrl, normalized) && isPageUrl(normalized)) {
      links.push(normalized);
    }
  });
  return [...new Set(links)];
}

async function crawlWebsite(rootUrl: string): Promise<{ pages: { url: string; text: string }[]; error?: string }> {
  const visited = new Set<string>();
  const queue: string[] = [rootUrl];
  const pages: { url: string; text: string }[] = [];

  while (queue.length > 0 && pages.length < MAX_PAGES) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    const html = await fetchPage(url);
    if (!html) continue;

    const text = extractText(html);
    if (text.length > 50) {
      pages.push({ url, text });
    }

    const links = extractLinks(html, url);
    for (const link of links) {
      if (!visited.has(link) && !queue.includes(link)) {
        queue.push(link);
      }
    }
  }

  return { pages };
}

async function summarizeWithLLM(pages: { url: string; text: string }[]): Promise<string> {
  const combined = pages
    .map((p, i) => `--- Page ${i + 1}: ${p.url} ---\n${p.text.slice(0, 3000)}`)
    .join("\n\n")
    .slice(0, 60000);

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You are a concise business analyst. Given crawled website content, produce a structured summary about the person/business. Output these sections (skip any that have no data):

## Business Overview
One paragraph: what this person/business does, who they serve, their value proposition.

## Products & Services
Bullet list of what they offer.

## Key Differentiators
What makes them unique or notable.

## Target Audience
Who they serve / their ideal customer.

## Background & Credentials
Any bio, experience, certifications, or notable achievements.

## Contact & Location
Any location, contact info, or social links found.

Keep each section concise. Total output should be under 800 words.`,
      },
      {
        role: "user",
        content: `Summarize this website content:\n\n${combined}`,
      },
    ],
    temperature: 0.3,
    max_tokens: 1500,
  });

  return response.choices[0]?.message?.content || "Unable to generate summary.";
}

export async function startWebsiteCrawl(userId: string, url: string): Promise<void> {
  let normalizedUrl = url.trim();
  if (!normalizedUrl.startsWith("http://") && !normalizedUrl.startsWith("https://")) {
    normalizedUrl = "https://" + normalizedUrl;
  }

  const safe = await isSafeUrl(normalizedUrl);
  if (!safe) {
    await db
      .insert(websiteCrawls)
      .values({ userId, url: normalizedUrl, status: "error", pageCount: 0, summary: "URL is not allowed. Please use a public website URL." })
      .onConflictDoUpdate({
        target: websiteCrawls.userId,
        set: { url: normalizedUrl, status: "error", pageCount: 0, summary: "URL is not allowed. Please use a public website URL.", crawledAt: new Date() },
      });
    return;
  }

  await db
    .insert(websiteCrawls)
    .values({ userId, url: normalizedUrl, status: "crawling", pageCount: 0 })
    .onConflictDoUpdate({
      target: websiteCrawls.userId,
      set: { url: normalizedUrl, status: "crawling", pageCount: 0, summary: null, crawledAt: null },
    });

  (async () => {
    try {
      const { pages } = await crawlWebsite(normalizedUrl);

      if (pages.length === 0) {
        await db
          .update(websiteCrawls)
          .set({ status: "error", summary: "Could not fetch any pages from this URL.", crawledAt: new Date() })
          .where(eq(websiteCrawls.userId, userId));
        return;
      }

      const summary = await summarizeWithLLM(pages);

      await db
        .update(websiteCrawls)
        .set({
          status: "done",
          pageCount: pages.length,
          summary,
          crawledAt: new Date(),
        })
        .where(eq(websiteCrawls.userId, userId));
    } catch (err) {
      console.error("Website crawl error:", err);
      await db
        .update(websiteCrawls)
        .set({
          status: "error",
          summary: `Crawl failed: ${err instanceof Error ? err.message : "Unknown error"}`,
          crawledAt: new Date(),
        })
        .where(eq(websiteCrawls.userId, userId));
    }
  })();
}
