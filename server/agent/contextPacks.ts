export type ContextPackId =
  | "always_on_kernel"
  | "daily_planning_context"
  | "memory_context"
  | "email_context"
  | "calendar_context"
  | "code_work_context"
  | "self_healing_context"
  | "research_context"
  | "business_context"
  | "daemon_context";

export type ContextTaskType =
  | "general"
  | "daily_planning"
  | "memory_query"
  | "memory_work"
  | "email_draft"
  | "email_action"
  | "calendar_query"
  | "calendar_action"
  | "code_work"
  | "self_healing"
  | "research"
  | "business_ops"
  | "daemon_action";

export type ContextRiskLevel = "low" | "medium" | "high";

export type ContextToolAllowance =
  | "none"
  | "read_context"
  | "search"
  | "draft_only"
  | "local_patch"
  | "run_checks"
  | "queue_job"
  | "approval_gated_action";

export interface ContextPackDecisionInput {
  userMessage: string;
  channel?: string;
}

export interface ContextPackDecision {
  taskType: ContextTaskType;
  route: string;
  riskLevel: ContextRiskLevel;
  requiredContextPacks: ContextPackId[];
  toolsAllowed: ContextToolAllowance[];
  approvalRequired: boolean;
  outputDestination?: string;
  reasons: string[];
}

const DAILY_DESTINATION = "workspaces/battles/daily-command-center/";
const BUSINESS_DESTINATION = "workspaces/battles/business/";
const RESEARCH_DESTINATION = "workspaces/battles/research/";
const PRODUCTION_DESTINATION = "workspaces/battles/production/";

function hasAny(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

function uniquePacks(packs: ContextPackId[]): ContextPackId[] {
  return [...new Set(packs)];
}

function includesActionVerb(text: string): boolean {
  return hasAny(text, /\b(send|sent|schedule|reschedule|cancel|delete|remove|move|rename|overwrite|post|publish|buy|purchase|pay|commit|push|merge|deploy|trigger|run|execute|control|rewrite)\b/);
}

function isDailyPlanning(text: string): boolean {
  return hasAny(text, /\b(plan my day|daily plan|morning plan|today'?s plan|today\b|daily command|command center|evening wrap|wrap-up|priority|priorities|goal task|tasks?\b)\b/);
}

function isEmail(text: string): boolean {
  return hasAny(text, /\b(email|gmail|outlook|inbox|reply|draft|message|text|telegram|discord|slack|whatsapp|dm)\b/);
}

function isCalendar(text: string): boolean {
  return hasAny(text, /\b(calendar|meeting|schedule|reschedule|availability|appointment|event|follow-up)\b/);
}

function isMemory(text: string): boolean {
  return hasAny(text, /\b(memory|memories|remember|learned|learn|why did you|source memory|provenance|preference|soul|context about me)\b/);
}

function isCodeWork(text: string): boolean {
  return hasAny(text, /\b(code|repo|bug|fix|implement|typescript|server|api|route|database|schema|test|build|lint|frontend|component|app screen|github)\b/);
}

function isSelfHealing(text: string): boolean {
  return hasAny(text, /\b(failed|failure|diagnose|debug|why.*failed|repair|self-heal|broken|regression|root cause)\b/);
}

function isResearch(text: string): boolean {
  return hasAny(text, /\b(research|source|sources|citation|cite|look up|search|find out|compare|market|analysis|current|latest)\b/);
}

function isBusiness(text: string): boolean {
  return hasAny(text, /\b(battles budz|business|ocm|licensing|compliance|sop|regulator|retailer|processor|cultivator|pricing|funding|contract|loan|investor|cannabis)\b/);
}

function isDaemon(text: string): boolean {
  return hasAny(text, /\b(daemon|desktop|android|phone|device|screen|camera|microphone|tap|type|swipe|shell|terminal control)\b/);
}

function addToolAllowance(base: ContextToolAllowance[], ...items: ContextToolAllowance[]): ContextToolAllowance[] {
  return [...new Set([...base, ...items])];
}

export function decideContextPacks(input: ContextPackDecisionInput): ContextPackDecision {
  const text = (input.userMessage || "").toLowerCase();
  const packs: ContextPackId[] = ["always_on_kernel"];
  const reasons: string[] = [];
  let taskType: ContextTaskType = "general";
  let route = "inline";
  let riskLevel: ContextRiskLevel = "low";
  let outputDestination: string | undefined;
  let toolsAllowed: ContextToolAllowance[] = ["read_context", "draft_only"];

  const actionVerb = includesActionVerb(text);
  const email = isEmail(text);
  const calendar = isCalendar(text);
  const memory = isMemory(text);
  const code = isCodeWork(text);
  const selfHealing = isSelfHealing(text);
  const research = isResearch(text);
  const business = isBusiness(text);
  const daemon = isDaemon(text);
  const daily = isDailyPlanning(text);

  if (daily) {
    taskType = "daily_planning";
    route = "planning";
    riskLevel = "medium";
    outputDestination = DAILY_DESTINATION;
    packs.push("daily_planning_context");
    toolsAllowed = addToolAllowance(toolsAllowed, "queue_job");
    reasons.push("Daily planning terms detected.");
  }

  if (email) {
    packs.push("email_context");
    if (taskType === "general") {
      taskType = actionVerb ? "email_action" : "email_draft";
      route = "communications";
      outputDestination = BUSINESS_DESTINATION;
    }
    toolsAllowed = addToolAllowance(toolsAllowed, "draft_only");
    reasons.push("Email or message context detected.");
  }

  if (calendar) {
    packs.push("calendar_context");
    if (taskType === "general") {
      taskType = actionVerb ? "calendar_action" : "calendar_query";
      route = "planning";
      outputDestination = DAILY_DESTINATION;
    }
    reasons.push("Calendar or scheduling context detected.");
  }

  if (memory) {
    packs.push("memory_context");
    if (taskType === "general") {
      taskType = actionVerb ? "memory_work" : "memory_query";
      route = "memory";
    }
    reasons.push("Memory, SOUL, or provenance context detected.");
  }

  if (research) {
    packs.push("research_context");
    if (taskType === "general") {
      taskType = "research";
      route = "research";
      outputDestination = RESEARCH_DESTINATION;
    }
    toolsAllowed = addToolAllowance(toolsAllowed, "search", "queue_job");
    reasons.push("Research or source-backed answer context detected.");
  }

  if (business) {
    packs.push("business_context");
    if (taskType === "general") {
      taskType = "business_ops";
      route = "business";
      outputDestination = BUSINESS_DESTINATION;
    }
    reasons.push("Business, licensing, compliance, or finance context detected.");
  }

  if (code) {
    packs.push("code_work_context");
    taskType = "code_work";
    route = "code";
    riskLevel = "high";
    outputDestination = PRODUCTION_DESTINATION;
    toolsAllowed = addToolAllowance(toolsAllowed, "local_patch", "run_checks");
    reasons.push("Repo or source-code work detected.");
  }

  if (selfHealing) {
    packs.push("self_healing_context");
    if (!code && taskType === "general") {
      taskType = "self_healing";
      route = "diagnostics";
      riskLevel = "medium";
    }
    reasons.push("Failure diagnosis or self-healing context detected.");
  }

  if (daemon) {
    packs.push("daemon_context");
    taskType = "daemon_action";
    route = "daemon";
    riskLevel = "high";
    toolsAllowed = addToolAllowance(toolsAllowed, "approval_gated_action");
    reasons.push("Daemon, device, or computer-control context detected.");
  }

  const approvalRequired =
    daemon ||
    code ||
    (email && actionVerb && !/\bdraft|preview|write\b/.test(text)) ||
    (calendar && actionVerb && !/\bshow|list|check|what'?s\b/.test(text)) ||
    (memory && actionVerb) ||
    hasAny(text, /\b(delete|overwrite|purchase|buy|pay|contract|commit|push|merge|deploy|post|publish|send|trigger|control|legal filing|licensing action)\b/);

  if (approvalRequired) {
    riskLevel = "high";
    toolsAllowed = addToolAllowance(toolsAllowed, "approval_gated_action");
    reasons.push("Requested action can affect external systems, durable state, code, devices, or commitments.");
  }

  if (taskType === "general") {
    toolsAllowed = ["read_context", "draft_only"];
    reasons.push("No specialized context pack detected.");
  }

  return {
    taskType,
    route,
    riskLevel,
    requiredContextPacks: uniquePacks(packs),
    toolsAllowed,
    approvalRequired,
    outputDestination,
    reasons,
  };
}
