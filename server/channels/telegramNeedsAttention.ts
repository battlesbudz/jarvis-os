export interface TelegramNeedsAttentionDecision {
  shouldRouteToTask: boolean;
  shouldShowTaskList: boolean;
}

const GENERAL_QUESTION_RE =
  /^(?:who|what|when|where|why|how|can|could|would|should|do|does|did|is|are|am|will|tell|explain|help|build|create|make|fix|look|check)\b/i;

const TASK_REFERENCE_RE =
  /^(?:answer|task|for task|regarding|about(?: that| the)? task|needs you|guidance)\b/i;

const SHORT_TASK_ANSWER_RE =
  /^(?:yes|yep|yeah|no|nope|nah|correct|right|use|include|exclude|focus|prioritize|both|all|only)\b/i;

export function getTelegramNeedsAttentionDecision(
  rawText: string,
  needsAttentionCount: number,
): TelegramNeedsAttentionDecision {
  const text = rawText.trim();
  if (!text || text.startsWith("/") || needsAttentionCount === 0) {
    return { shouldRouteToTask: false, shouldShowTaskList: false };
  }

  const explicitTaskReference = TASK_REFERENCE_RE.test(text);
  const looksLikeGeneralQuestion = text.includes("?") || GENERAL_QUESTION_RE.test(text);

  if (needsAttentionCount > 1) {
    return {
      shouldRouteToTask: false,
      shouldShowTaskList: explicitTaskReference,
    };
  }

  return {
    shouldRouteToTask: explicitTaskReference || (!looksLikeGeneralQuestion && SHORT_TASK_ANSWER_RE.test(text)),
    shouldShowTaskList: false,
  };
}
