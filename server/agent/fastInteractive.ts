const FAST_REPLY_BLOCKERS = [
  /\b(full\s+(jarvis\s+)?workflow|full\s+orchestrator|slow\s+path|fast\s+path|use\s+(the\s+)?tools?|tool\s+access|tools?\b|orchestrator)\b/i,
  /\b(email|gmail|inbox|calendar|schedule|meeting|remind|reminder|task|commitment|goal|memory|remember)\b/i,
  /\b(research|search|look up|browse|website|web|latest|current|recent|today|news|source|sources|price|weather|stock)\b/i,
  /\b(open|click|tap|type|swipe|screenshot|desktop|terminal|shell|file|folder|repo|code|build|deploy|railway)\b/i,
  /\b(android|phone|app|youtube|discord|slack|telegram settings|connected channel)\b/i,
  /\b(create|send|post|delete|edit|update|change|install|download|upload)\b/i,
];

export function isFastLaneDeflection(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return [
    /\bneed(s)?\s+(the\s+)?full\s+(jarvis\s+)?workflow\b/i,
    /\b(full\s+(jarvis\s+)?workflow|full\s+orchestrator)\b/i,
    /\b(no|not|don't|do not|can't|cannot)\s+(have\s+)?access\s+to\s+tools?\b/i,
    /\bfrom\s+this\s+fast\s+path\b/i,
  ].some((pattern) => pattern.test(trimmed));
}

export function isFastInteractiveRequest(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith("/") || trimmed.length > 320) return false;
  if (FAST_REPLY_BLOCKERS.some((pattern) => pattern.test(trimmed))) return false;

  return (
    /^(hi|hey|hello|yo|sup)\b/i.test(trimmed) ||
    /\b(joke|say|repeat|reply with|what are you|who are you|are you there|test)\b/i.test(trimmed) ||
    /^[\w\s'",.!?;-]{1,160}$/.test(trimmed)
  );
}
