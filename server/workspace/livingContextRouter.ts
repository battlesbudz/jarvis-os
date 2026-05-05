import type { ToolContext } from "../agent/types";
import { createLivingContextUpdateTool } from "../agent/tools/livingContextUpdateTool";

export type LivingContextSourceType = "conversation" | "email";

export interface LivingContextInput {
  userId: string;
  text: string;
  sourceType: LivingContextSourceType;
  sourceRef?: string;
  requireOwner?: boolean;
}

export interface LivingContextMatch {
  target: string;
  topic: string;
  learned: string;
  fillsQuestion: string;
  confidence: number;
}

const ROUTES: Array<{
  target: string;
  topic: string;
  fillsQuestion: string;
  keywords: RegExp[];
}> = [
  {
    target: "licensing_readiness",
    topic: "Licensing readiness",
    fillsQuestion: "What is still needed for final OCM/licensing approval?",
    keywords: [
      /\bocm\b/i,
      /\blicens(?:e|ing|ure)\b/i,
      /\bfinal approval\b/i,
      /\bconditional approval\b/i,
      /\bdeficienc(?:y|ies)\b/i,
      /\bregulator(?:y|s)?\b/i,
      /\bapplication status\b/i,
    ],
  },
  {
    target: "facility_readiness",
    topic: "Facility readiness",
    fillsQuestion: "What facility readiness items are blocking operations?",
    keywords: [
      /\bfacility\b/i,
      /\binspection\b/i,
      /\binspector\b/i,
      /\bbuildout\b/i,
      /\bsite control\b/i,
      /\bzoning\b/i,
      /\blease\b/i,
      /\bsecurity\b/i,
      /\bequipment\b/i,
    ],
  },
  {
    target: "compliance_readiness",
    topic: "Compliance readiness",
    fillsQuestion: "Which compliance requirements or SOPs still need confirmation?",
    keywords: [
      /\bcompliance\b/i,
      /\bsop(?:s)?\b/i,
      /\brecord ?keeping\b/i,
      /\binventory tracking\b/i,
      /\bpackag(?:e|ing)\b/i,
      /\blabel(?:s|ing)?\b/i,
      /\btesting\b/i,
      /\bwaste\b/i,
      /\brecall\b/i,
      /\btraining\b/i,
    ],
  },
  {
    target: "product_readiness",
    topic: "Product readiness",
    fillsQuestion: "Which product line is ready or blocked?",
    keywords: [
      /\bpre[- ]?roll(?:s)?\b/i,
      /\bbattle brew\b/i,
      /\btea\b/i,
      /\bedible(?:s)?\b/i,
      /\bproduct(?:s)?\b/i,
      /\bformulation\b/i,
      /\bfirst batch\b/i,
    ],
  },
  {
    target: "first_revenue_plan",
    topic: "First revenue path",
    fillsQuestion: "What is the shortest compliant path to first revenue?",
    keywords: [
      /\bretail(?:er|ers)?\b/i,
      /\bdistribution\b/i,
      /\bdistributor(?:s)?\b/i,
      /\brevenue\b/i,
      /\bfirst sale\b/i,
      /\bcash ?flow\b/i,
      /\bfunding\b/i,
      /\bpartnership(?:s)?\b/i,
      /\bprocessor(?:s)?\b/i,
      /\bcultivator(?:s)?\b/i,
    ],
  },
];

const QUESTION_START = /^(who|what|when|where|why|how|can|could|should|would|do|does|did|is|are|am|will)\b/i;
const COMMAND_ONLY = /\b(can you|could you|please|make it|build|create|add|change|edit|update|implement|push|commit)\b/i;

function splitCandidateSentences(text: string): string[] {
  return text
    .replace(/\r/g, "\n")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.replace(/^\s*(user|me|sender|email|assistant)\s*:\s*/i, "").trim())
    .filter(Boolean);
}

function isDeclarativeFact(sentence: string, sourceType: LivingContextSourceType): boolean {
  const clean = sentence.trim();
  if (clean.length < 12 || clean.length > 500) return false;
  if (clean.endsWith("?")) return false;
  if (sourceType === "conversation" && QUESTION_START.test(clean)) return false;
  if (sourceType === "conversation" && COMMAND_ONLY.test(clean) && !/\b(is|are|was|were|said|confirmed|approved|pending|waiting|need|needs|blocked|ready|done|complete)\b/i.test(clean)) {
    return false;
  }
  return true;
}

export function detectLivingContextUpdate(input: Pick<LivingContextInput, "text" | "sourceType">): LivingContextMatch | null {
  const sentences = splitCandidateSentences(input.text);
  for (const sentence of sentences) {
    if (!isDeclarativeFact(sentence, input.sourceType)) continue;
    for (const route of ROUTES) {
      if (!route.keywords.some((keyword) => keyword.test(sentence))) continue;
      return {
        target: route.target,
        topic: route.topic,
        learned: sentence,
        fillsQuestion: route.fillsQuestion,
        confidence: input.sourceType === "conversation" ? 92 : 75,
      };
    }
  }
  return null;
}

export async function processLivingContextUpdate(input: LivingContextInput): Promise<{
  updated: boolean;
  match?: LivingContextMatch;
  detail?: string;
}> {
  const match = detectLivingContextUpdate(input);
  if (!match) return { updated: false };

  const tool = createLivingContextUpdateTool({
    requireOwner: input.requireOwner ?? true,
  });
  const ctx: ToolContext = {
    userId: input.userId,
    state: {},
    channel: "living-context-router",
  };

  const result = await tool.execute({
    action: "append_learning",
    target: match.target,
    topic: match.topic,
    learned: match.learned,
    sourceType: input.sourceType,
    sourceRef: input.sourceRef ?? input.sourceType,
    confidence: match.confidence,
    status: "confirmed",
    fillsQuestion: match.fillsQuestion,
    approvalSensitive: true,
  }, ctx);

  return {
    updated: result.ok,
    match,
    detail: result.content,
  };
}
