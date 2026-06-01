import assert from "node:assert/strict";

import {
  buildBrowserSearchFallbackUrls,
  formatNewsRssSearchResults,
  isBrowserSearchChallengeText,
  isNewsLikeSearchQuery,
} from "../tools/webSearchFallback";

function run(): void {
  const urls = buildBrowserSearchFallbackUrls("current OpenAI news");
  assert.equal(urls[0].startsWith("https://html.duckduckgo.com/html/?q="), true);
  assert.equal(urls.some((url) => url.includes("bing.com/search")), true);
  assert.equal(urls[urls.length - 1].includes("bing.com/search"), true);

  assert.equal(isBrowserSearchChallengeText("Bing needs one last step before showing results"), true);
  assert.equal(isBrowserSearchChallengeText("Please verify you are human to continue"), true);
  assert.equal(isBrowserSearchChallengeText("OpenAI announces a new product update with source links"), false);
  assert.equal(isNewsLikeSearchQuery("current OpenAI news"), true);
  assert.equal(isNewsLikeSearchQuery("what is a binary tree"), false);

  const rss = `<?xml version="1.0"?><rss><channel><item>
    <title><![CDATA[OpenAI launches example product]]></title>
    <link>https://example.com/openai</link>
    <source url="https://example.com">Example News</source>
    <pubDate>Mon, 01 Jun 2026 01:00:00 GMT</pubDate>
    <description><![CDATA[<p>Short description about OpenAI.</p>]]></description>
  </item></channel></rss>`;
  const formatted = formatNewsRssSearchResults("current OpenAI news", rss);
  assert.match(formatted, /Google News RSS/);
  assert.match(formatted, /OpenAI launches example product/);
  assert.match(formatted, /URL: https:\/\/example\.com\/openai/);

  console.log("OK: search fallback avoids Bing-first, detects challenges, and formats news RSS");
}

run();
