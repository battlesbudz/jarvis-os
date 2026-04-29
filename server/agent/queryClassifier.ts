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

/**
 * Patterns that indicate the user wants Jarvis to build a new tool or feature.
 *
 * Deliberately narrow to avoid false positives:
 *   - "build a plan" / "build a schedule" → NOT matched (no tool noun)
 *   - "write a memo" / "write a report" → NOT matched ("write" excluded from
 *     the broad pattern; only matched via specific write sub-patterns)
 *   - "build a weather lookup tool" → matched (allows up to 4 intermediate words)
 *   - "add a Notion integration" → matched
 *   - "write a script that does X" → matched
 *   - "implement a new capability to track stocks" → matched
 */
const BUILD_TOOL_NOUNS =
  "tool|integration|capability|feature|plugin|command|script|function|bot|webhook|connector|module|agent";

const BUILD_PATTERNS = [
  // (build verb) + up to 4 intermediate words + (tool/feature noun)
  // "write" is intentionally excluded to avoid "write a memo about a feature".
  new RegExp(
    `\\b(build|create|make|implement|add|code)\\s+(?:\\w+\\s+){0,4}(${BUILD_TOOL_NOUNS})\\b`,
    "i",
  ),
  // "write a script|function|tool|bot|integration|module|capability" (specific write forms)
  new RegExp(
    `\\bwrite\\s+(?:a\\s+|an\\s+|the\\s+)?(?:new\\s+)?(script|function|tool|integration|module|bot|capability)\\b`,
    "i",
  ),
  // "write (the) code (for|to|that)" — clearly about software development
  /\bwrite\s+(the\s+)?code\s+(for|to|that)\b/i,
  // "add support for" or "add an integration for/with"
  /\badd\s+(support\s+for|an?\s+integration\s+(for|with|to))\b/i,
  // "extend yourself/Jarvis" or "give yourself/Jarvis a new tool/capability"
  /\b(extend\s+(yourself|jarvis)|give\s+(yourself|jarvis)\s+(?:a\s+)?(?:new\s+)?(tool|capability|power|ability))\b/i,
];

/**
 * Patterns that identify iterative build refinements / follow-up tweaks.
 *
 * These cover messages that don't contain a tool noun but are clearly asking
 * Jarvis to adjust something it just built:
 *   - "now add retry logic"
 *   - "also add error handling"
 *   - "update it to support timeouts"
 *   - "change it to use async/await"
 *   - "fix the bug in it"
 *   - "make it also log to console"
 *   - "rename the variable X to Y"
 *   - "refactor it to be cleaner"
 */
const BUILD_REFINEMENT_PATTERNS = [
  // "now add X" / "also add X" / "then add X"
  /\b(now|also|then)\s+add\b/i,
  // "also make it (do|support|handle|work|log|return|accept|use) X"
  /\balso\s+make\s+it\b/i,
  // "update it to …" / "change it to …" / "modify it to …"
  /\b(update|change|modify|adjust)\s+it\s+to\b/i,
  // "fix (the|a|any)? X in it" / "fix the bug in it" / "fix it to …"
  /\bfix\s+(the\s+|a\s+|any\s+)?\w+(\s+\w+)?\s+in\s+it\b/i,
  /\bfix\s+it\s+to\b/i,
  // "make it (also )? (support|handle|accept|return|log|use|work|run) …"
  /\bmake\s+it\s+(also\s+)?(support|handle|accept|return|log|use|work|run|check|retry|validate|include|exclude|store|save|send|fetch|call|catch|throw|wrap|expose|add)\b/i,
  // "add retry logic" / "add error handling" / "add logging" / "add caching"
  // without a build verb — covers common dev tweaks that need no tool noun
  /\badd\s+(retry|error\s+handling|logging|caching|validation|rate.?limit|timeout|auth|authentication|pagination|sorting|filtering|debounce|throttl)\b/i,
  // "refactor it …" / "clean it up" / "simplify it"
  /\b(refactor|clean\s+up|simplify|optimis|optimiz)\s+(it|the)\b/i,
  // "rename X to Y (in it)" 
  /\brename\s+\S+\s+to\s+\S+/i,
];

/**
 * Returns true when the user is asking Jarvis to build a new tool or feature.
 *
 * Used by coachAgent to short-circuit the orchestrator and route directly to
 * the build_feature background job, exactly as research intent is routed to
 * the research job via queue_background_job.
 */
export function classifyBuildIntent(text: string): boolean {
  if (!text || text.trim().length === 0) return false;
  return BUILD_PATTERNS.some((re) => re.test(text));
}

/**
 * Stable substring that Jarvis always includes in the ack reply when a build
 * job is successfully queued.  Exported so coachAgent.ts can embed it in the
 * reply it sends — keeping the marker and the reply in sync automatically and
 * avoiding a hidden copy-paste coupling.
 */
export const BUILD_ACK_MARKER = "queued that build job";

/**
 * Returns true when the current message is a follow-up refinement to an
 * ongoing build conversation.
 *
 * Two conditions must both be true:
 *   1. The most-recent assistant message in chatHistory contains the build-ack
 *      marker (i.e. Jarvis already acknowledged a build request this session).
 *   2. The current message matches at least one BUILD_REFINEMENT_PATTERN OR
 *      one of the regular BUILD_PATTERNS (the user may rephrase the original
 *      request entirely).
 *
 * chatHistory is stored newest-first (as per coachAgent convention).
 */
export function classifyBuildFollowUp(
  text: string,
  chatHistory: Array<{ role: string; content: string }>,
): boolean {
  if (!text || text.trim().length === 0) return false;

  // Find the most-recent assistant message
  const lastAssistant = chatHistory.find((m) => m.role === "assistant");
  if (!lastAssistant || !lastAssistant.content.includes(BUILD_ACK_MARKER)) {
    return false;
  }

  // The prior turn was a build ack — any refinement pattern now qualifies
  return (
    BUILD_REFINEMENT_PATTERNS.some((re) => re.test(text)) ||
    BUILD_PATTERNS.some((re) => re.test(text))
  );
}
