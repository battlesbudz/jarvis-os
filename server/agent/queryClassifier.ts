/**
 * Query intent classifier — pure utility, no external deps.
 *
 * Lightweight keyword heuristic that runs in <1ms per query with no LLM call.
 * Separating this from activationPlanner.ts allows tests to import the real
 * implementation without pulling in DB or OpenAI connections.
 */

const RESEARCH_PATTERNS = [
  /\b(search|look up|lookup|google|find|browse|research|investigate)\b/i,
  /\b(article|website|url|link|page|source|reference|docs?|documentation)\b/i,
  /\b(what is|what are|who is|where is|how does|how do|explain|define|tell me about)\b/i,
  /\b(youtube|video|transcript|watch|summarize this)\b/i,
  /\b(latest news|news about|read about|fetch|scrape|crawl)\b/i,
  /https?:\/\//i,
];

/**
 * Classify a user's query as "research" (web/doc lookup) or "general"
 * (conversational or task-management).
 *
 * Used by the activation planner (Rule 8c) to decide whether to activate
 * or suppress the browser + research capability for a given channel session.
 */
export function classifyQueryIntent(text: string): "research" | "general" {
  if (!text || text.trim().length === 0) return "general";
  return RESEARCH_PATTERNS.some((re) => re.test(text)) ? "research" : "general";
}
