export const SOUL_FIELD_MAX_CHARS = 360;
export const SOUL_BULLET_MAX_CHARS = 260;

const SOUL_EXCLUDED_SOURCE_TYPES = new Set(["inbox_triage", "jarvis_self_knowledge"]);
const TRANSIENT_SOUL_MEMORY_RE =
  /\b(Browser QA|Test Projedct|codex-chat-delegation-smoke|Embeddings skipped|Router works|OpenCode|manual action of creating project|cannot start project from here)\b/i;

export function compactSoulText(value: string, maxChars = SOUL_BULLET_MAX_CHARS): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

export function shouldIncludeMemoryInSoul(memory: {
  content: string;
  sourceType?: string | null;
  source_type?: string | null;
}): boolean {
  const sourceType = memory.sourceType ?? memory.source_type ?? null;
  if (sourceType && SOUL_EXCLUDED_SOURCE_TYPES.has(sourceType)) return false;
  return !TRANSIENT_SOUL_MEMORY_RE.test(memory.content);
}
