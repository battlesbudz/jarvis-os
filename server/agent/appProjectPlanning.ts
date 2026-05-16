function normalizePlanningQuestion(question: unknown): string | null {
  if (typeof question === "string") {
    const trimmed = question.trim();
    return trimmed ? trimmed : null;
  }
  if (!question || typeof question !== "object" || Array.isArray(question)) return null;

  const record = question as Record<string, unknown>;
  const candidates = [
    record.question,
    record.text,
    record.prompt,
    record.label,
    record.title,
    record.summary,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  try {
    const compact = JSON.stringify(record);
    return compact && compact !== "{}" ? compact.slice(0, 300) : null;
  } catch {
    return null;
  }
}

export function normalizePlanningQuestions(questions: unknown): string[] {
  if (!Array.isArray(questions)) return [];
  return questions
    .map(normalizePlanningQuestion)
    .filter((q): q is string => Boolean(q));
}
