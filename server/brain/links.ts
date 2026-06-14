import type { BrainLinkInput } from "./types";
import { personPageSlug } from "./slug";

export type PersonLinkHint = string | { name: string; toSlug: string };

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesHintBoundary(text: string, hint: string): boolean {
  const escaped = escapeRegex(hint);
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "iu");
  return pattern.test(text);
}

export function extractBrainLinks(text: string, personHints: PersonLinkHint[] = []): BrainLinkInput[] {
  const seen = new Set<string>();
  const links: BrainLinkInput[] = [];

  for (const hint of personHints) {
    const name = typeof hint === "string" ? hint : hint.name;
    const trimmed = name.trim();
    if (!trimmed) continue;
    if (!matchesHintBoundary(text, trimmed)) continue;

    const toSlug = typeof hint === "string" ? personPageSlug(trimmed) : hint.toSlug;
    const key = `mentions:${toSlug}`;
    if (seen.has(key)) continue;

    seen.add(key);
    links.push({ verb: "mentions", toSlug, confidence: 80 });
  }

  return links;
}
