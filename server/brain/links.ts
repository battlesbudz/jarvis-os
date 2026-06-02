import type { BrainLinkInput } from "./types";
import { personPageSlug } from "./slug";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesHintBoundary(text: string, hint: string): boolean {
  const escaped = escapeRegex(hint);
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "iu");
  return pattern.test(text);
}

export function extractBrainLinks(text: string, personHints: string[] = []): BrainLinkInput[] {
  const seen = new Set<string>();
  const links: BrainLinkInput[] = [];

  for (const name of personHints) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    if (!matchesHintBoundary(text, trimmed)) continue;

    const toSlug = personPageSlug(trimmed);
    const key = `mentions:${toSlug}`;
    if (seen.has(key)) continue;

    seen.add(key);
    links.push({ verb: "mentions", toSlug, confidence: 80 });
  }

  return links;
}
