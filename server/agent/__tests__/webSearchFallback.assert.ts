import assert from "node:assert/strict";

import {
  buildBrowserSearchFallbackUrls,
  isBrowserSearchChallengeText,
} from "../tools/webSearchFallback";

function run(): void {
  const urls = buildBrowserSearchFallbackUrls("current OpenAI news");
  assert.equal(urls[0].startsWith("https://html.duckduckgo.com/html/?q="), true);
  assert.equal(urls.some((url) => url.includes("bing.com/search")), true);
  assert.equal(urls[urls.length - 1].includes("bing.com/search"), true);

  assert.equal(isBrowserSearchChallengeText("Bing needs one last step before showing results"), true);
  assert.equal(isBrowserSearchChallengeText("Please verify you are human to continue"), true);
  assert.equal(isBrowserSearchChallengeText("OpenAI announces a new product update with source links"), false);

  console.log("OK: browser search fallback avoids Bing-first and detects challenge pages");
}

run();
