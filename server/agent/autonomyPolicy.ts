export type AutonomyReadiness = "ready" | "limited" | "blocked";

export type AutonomyMode =
  | "answer_inline"
  | "queue_background_job"
  | "requires_approval"
  | "blocked_by_setup";

export interface AutonomyPolicyInput {
  userText: string;
  readiness: AutonomyReadiness;
  hasApproval: boolean;
}

export interface AutonomyPolicyDecision {
  mode: AutonomyMode;
  reason: string;
  agentType?: "research" | "deep_research" | "writing" | "planning" | "email";
}

const BACKGROUND_PATTERNS = [
  /\bresearch\b/i,
  /\blook into\b/i,
  /\bcompare\b/i,
  /\breport\b/i,
  /\bdeep dive\b/i,
  /\bcompile\b/i,
  /\bdocument\b/i,
  /\bchecklist\b/i,
  /\bwrite (a|an|the)\b/i,
  /\bdraft (a|an|the)?\b/i,
  /\bplan\b/i,
  /\banaly[sz]e\b/i,
];

const EXTERNAL_ACTION_PATTERNS = [
  /\bsend\b/i,
  /\bpost\b/i,
  /\bschedule\b/i,
  /\bdelete\b/i,
  /\bpurchase\b/i,
  /\bcommit\b/i,
  /\bcontact\b/i,
  /\bdeploy\b/i,
  /\bsubmit\b/i,
];

function inferAgentType(text: string): AutonomyPolicyDecision["agentType"] {
  if (/\bemail\b|\breply\b|\breplies\b/i.test(text)) return "email";
  if (/\bplan\b|\broadmap\b|\bsequence\b/i.test(text)) return "planning";
  if (/\bwrite\b|\bdraft\b|\bmemo\b|\bdoc\b|\bdocument\b|\bcompile\b|\bchecklist\b/i.test(text)) return "writing";
  if (/\bcompare\b|\bdeep dive\b|\bmarket\b|\bstrategy\b|\bcrm\b|\breport\b/i.test(text)) {
    return "deep_research";
  }
  return "research";
}

export function decideAutonomyMode(input: AutonomyPolicyInput): AutonomyPolicyDecision {
  const text = input.userText.trim();

  if (input.readiness === "blocked") {
    return {
      mode: "blocked_by_setup",
      reason: "Jarvis core setup is blocked, so autonomous work should not start until doctor blockers are fixed.",
    };
  }

  if (!input.hasApproval && EXTERNAL_ACTION_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      mode: "requires_approval",
      reason: "The request appears to involve an external action or irreversible side effect.",
    };
  }

  if (BACKGROUND_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      mode: "queue_background_job",
      reason: "The request is multi-step and should produce a reviewable deliverable instead of blocking the chat.",
      agentType: inferAgentType(text),
    };
  }

  return {
    mode: "answer_inline",
    reason: "The request is short, low-risk, and can be answered immediately.",
  };
}
