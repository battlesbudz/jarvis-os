export type GroundingIntent =
  | "broad_personal_summary"
  | "profile_recall"
  | "temporal_recall"
  | "relationship_recall"
  | "commitment_status"
  | "exact_recall";

export type GroundingQueryPurpose = "primary" | "temporal" | "relationship" | "commitment";

export type GroundingSourcePolicy = {
  profile: boolean;
  soul: boolean;
  memory: boolean;
  commitments: boolean;
};

export type GroundingPlannedQuery = {
  id: "primary" | "supporting";
  purpose: GroundingQueryPurpose;
  query: string;
};

export type GroundingQueryPlan = {
  schemaVersion: 1;
  intent: GroundingIntent;
  queries: GroundingPlannedQuery[];
  sources: GroundingSourcePolicy;
  canonicalOnly: true;
  maxQueries: 2;
};

export type BuildGroundingQueryPlanInput = {
  requestText: string;
  explicitQuery?: string;
};

export const ABOUT_YOU_GROUNDING_QUERY =
  "user profile preferences relationships work patterns goals blockers values commitments";

const SOURCE_POLICY: Record<GroundingIntent, GroundingSourcePolicy> = {
  broad_personal_summary: { profile: true, soul: true, memory: true, commitments: true },
  profile_recall: { profile: true, soul: true, memory: true, commitments: false },
  temporal_recall: { profile: false, soul: false, memory: true, commitments: false },
  relationship_recall: { profile: false, soul: false, memory: true, commitments: false },
  commitment_status: { profile: false, soul: false, memory: true, commitments: true },
  exact_recall: { profile: false, soul: false, memory: true, commitments: false },
};

function compactText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function boundedQuery(value: string): string {
  const compact = compactText(value).replace(/[?!.]+$/g, "").trim();
  return compact.length <= 240 ? compact : compact.slice(0, 240).trimEnd();
}

function normalized(value: string): string {
  return compactText(value).toLowerCase().replace(/[\u2019']/g, "");
}

export function classifyGroundingIntent(requestText: string): GroundingIntent {
  const text = normalized(requestText);
  if (/\b(?:what do you know about me|(?:tell|show) me what you know about me|what have i told you|what do you remember about me|whats in my memory|what is in my memory|show my memories|list my memories)\b/.test(text)) {
    return "broad_personal_summary";
  }
  if (/\b(?:my\s+)?(?:commitments?|tasks?|goals?|blockers?|deadlines?|due dates?|pending work)\b/.test(text)) {
    return "commitment_status";
  }
  if (/\b(?:relationship|relationships|family|friend|friends|partner|spouse|brother|sister|mother|father|parent|parents|collaborator|coworker|co-worker|person i told you about)\b/.test(text) ||
    /\bwhat did i tell you about (?:him|her|them|that person|my )\b/.test(text)) {
    return "relationship_recall";
  }
  if (/\b(?:a while ago|previously|before|last time|used to|current|currently|latest|newest|most recent|still|change[sd]?|decid(?:e|ed)|decision|supersed(?:e|ed|es))\b/.test(text)) {
    return "temporal_recall";
  }
  if (/\b(?:my\s+)?(?:profile|preferred name|name|timezone|time zone|language|communication style|preferences?|values?)\b/.test(text)) {
    return "profile_recall";
  }
  return "exact_recall";
}

export function shouldGroundPersonalMemoryRequest(requestText: string): boolean {
  const text = normalized(requestText);
  if (!text) return false;
  if (classifyGroundingIntent(text) !== "exact_recall") return true;
  return /\b(?:memory|memories|remember|recall|what have i told you|what did i (?:say|tell|decide)|did i tell you|do you know my|based on what you know about me)\b/.test(text);
}

function temporalSupportQuery(requestText: string): string {
  const subject = boundedQuery(requestText)
    .replace(/^.*?\b(?:decid(?:e|ed)|decision|remember|recall)\b\s*(?:what|that|about)?\s*/i, "")
    .replace(/\b(?:a while ago|previously|before|last time|used to)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return boundedQuery(`${subject || requestText} decision current latest updated supersedes`);
}

function relationshipSupportQuery(requestText: string): string {
  return boundedQuery(`${requestText} relationships people family friends collaborators`);
}

function commitmentSupportQuery(requestText: string): string {
  return boundedQuery(`${requestText} goals commitments tasks blockers due pending`);
}

function uniqueQueries(queries: GroundingPlannedQuery[]): GroundingPlannedQuery[] {
  const seen = new Set<string>();
  return queries.filter((query) => {
    const key = normalized(query.query);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 2);
}

export function buildGroundingQueryPlan(input: BuildGroundingQueryPlanInput): GroundingQueryPlan {
  const requestText = boundedQuery(input.requestText);
  const intent = classifyGroundingIntent(requestText);
  const explicitQuery = boundedQuery(input.explicitQuery ?? "");
  const primary = explicitQuery || (intent === "broad_personal_summary" ? ABOUT_YOU_GROUNDING_QUERY : requestText);
  const queries: GroundingPlannedQuery[] = [{
    id: "primary",
    purpose: "primary",
    query: primary || ABOUT_YOU_GROUNDING_QUERY,
  }];

  if (intent === "temporal_recall") {
    queries.push({ id: "supporting", purpose: "temporal", query: temporalSupportQuery(requestText) });
  } else if (intent === "relationship_recall") {
    queries.push({ id: "supporting", purpose: "relationship", query: relationshipSupportQuery(requestText) });
  } else if (intent === "commitment_status") {
    queries.push({ id: "supporting", purpose: "commitment", query: commitmentSupportQuery(requestText) });
  }

  return {
    schemaVersion: 1,
    intent,
    queries: uniqueQueries(queries),
    sources: { ...SOURCE_POLICY[intent] },
    canonicalOnly: true,
    maxQueries: 2,
  };
}
