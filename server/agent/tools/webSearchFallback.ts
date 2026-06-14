const SEARCH_CHALLENGE_PATTERNS = [
  /\bone last step\b/i,
  /\bverify (?:you are|that you are) (?:a )?human\b/i,
  /\bunusual traffic\b/i,
  /\bcomplete the captcha\b/i,
  /\bsolve the captcha\b/i,
  /\bchecking your browser\b/i,
];

export function buildBrowserSearchFallbackUrls(query: string): string[] {
  const encoded = encodeURIComponent(query);
  return [
    `https://html.duckduckgo.com/html/?q=${encoded}`,
    `https://www.google.com/search?q=${encoded}`,
    `https://search.brave.com/search?q=${encoded}`,
    `https://www.bing.com/search?q=${encoded}`,
  ];
}

export function isBrowserSearchChallengeText(text: string): boolean {
  return SEARCH_CHALLENGE_PATTERNS.some((pattern) => pattern.test(text));
}

export function isNewsLikeSearchQuery(query: string): boolean {
  return /\b(news|latest|current|today|recent|breaking|announc(?:e|ed|ement)|launch(?:ed|es)?)\b/i.test(query);
}

function decodeXmlEntity(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .trim();
}

function tagValue(item: string, tag: string): string {
  const match = item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXmlEntity(match[1]) : "";
}

export function formatNewsRssSearchResults(query: string, xml: string, limit = 5): string {
  const items = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)]
    .slice(0, limit)
    .map((match, index) => {
      const item = match[0];
      const title = tagValue(item, "title");
      const link = tagValue(item, "link");
      const source = tagValue(item, "source");
      const published = tagValue(item, "pubDate");
      const description = tagValue(item, "description").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const lines = [
        `${index + 1}. ${title || "(untitled)"}`,
        source ? `   Source: ${source}` : "",
        published ? `   Published: ${published}` : "",
        link ? `   URL: ${link}` : "",
        description ? `   Snippet: ${description.slice(0, 300)}` : "",
      ].filter(Boolean);
      return lines.join("\n");
    })
    .filter(Boolean);

  if (items.length === 0) return "";
  return [
    `News search results for: ${query}`,
    "Source feed: Google News RSS",
    "",
    items.join("\n\n"),
  ].join("\n");
}

export async function newsRssSearchFallback(query: string): Promise<string> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url, {
    headers: {
      "user-agent": "Jarvis/1.0 (+https://gameplanjarvisai.up.railway.app)",
      accept: "application/rss+xml, application/xml, text/xml",
    },
  });
  if (!res.ok) throw new Error(`news RSS returned HTTP ${res.status}`);
  const formatted = formatNewsRssSearchResults(query, await res.text());
  if (!formatted) throw new Error("news RSS returned no results");
  return formatted;
}
