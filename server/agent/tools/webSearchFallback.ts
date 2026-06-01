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
