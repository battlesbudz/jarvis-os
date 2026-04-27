/**
 * mentionMatcher — scan a Discord message body against each agent's
 * mentionPatterns list and return the first matching agent.
 *
 * Pattern rules:
 *  - If the pattern string looks like /expr/flags it is compiled as a RegExp
 *    and tested against the raw text.
 *  - Otherwise it is treated as a plain substring match (case-insensitive).
 */
import type { DiscordAgent } from "@shared/schema";

const REGEX_PATTERN = /^\/(.+)\/([gimsuy]*)$/;

function compilePattern(pattern: string): RegExp | null {
  const m = REGEX_PATTERN.exec(pattern);
  if (!m) return null;
  try {
    return new RegExp(m[1], m[2]);
  } catch {
    return null;
  }
}

export function matchMentionPattern(
  text: string,
  agents: DiscordAgent[],
): DiscordAgent | null {
  const lowerText = text.toLowerCase();

  for (const agent of agents) {
    const patterns = (agent.mentionPatterns as string[] | null) ?? [];
    if (patterns.length === 0) continue;

    for (const pattern of patterns) {
      if (!pattern || !pattern.trim()) continue;

      const regex = compilePattern(pattern.trim());
      if (regex) {
        if (regex.test(text)) return agent;
      } else {
        if (lowerText.includes(pattern.trim().toLowerCase())) return agent;
      }
    }
  }

  return null;
}
