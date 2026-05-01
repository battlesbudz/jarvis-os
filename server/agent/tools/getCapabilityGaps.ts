import type { AgentTool, ToolResult } from "../types";
import { db } from "../../db";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import * as schema from "@shared/schema";

interface GapGroup {
  userMessage: string;
  agentReplySnippet: string | null;
  detectedReason: string;
  channel: string | null;
  occurrenceCount: number;
  addressed: boolean;
  latestCreatedAt: string;
}

function formatGapsText(groups: GapGroup[]): string {
  if (groups.length === 0) {
    return "No capability gaps logged this week. Jarvis handled everything it was asked!";
  }

  const unaddressed = groups.filter((g) => !g.addressed);
  const addressed = groups.filter((g) => g.addressed);

  const lines: string[] = [
    `**Capability gaps this week** — ${unaddressed.length} unaddressed, ${addressed.length} dismissed`,
    "",
  ];

  if (unaddressed.length > 0) {
    lines.push("**Unaddressed:**");
    for (const g of unaddressed) {
      const freq = ` ×${g.occurrenceCount}`;
      const channel = g.channel ? ` [${g.channel}]` : "";
      lines.push(`• [${g.detectedReason}${freq}]${channel} ${g.userMessage.slice(0, 150)}`);
      if (g.agentReplySnippet) {
        lines.push(`  Jarvis said: "${g.agentReplySnippet.slice(0, 100)}"`);
      }
    }
    lines.push("");
  }

  if (addressed.length > 0) {
    lines.push("**Dismissed:**");
    for (const g of addressed) {
      const freq = ` ×${g.occurrenceCount}`;
      lines.push(`• ✓ [${g.detectedReason}${freq}] ${g.userMessage.slice(0, 120)}`);
    }
    lines.push("");
  }

  lines.push(
    "These will be analysed on Sunday's self-improvement cycle. " +
    "View or dismiss gaps in the app under Settings → Capability Gaps.",
  );

  return lines.join("\n");
}

export const getCapabilityGapsTool: AgentTool = {
  name: "get_capability_gaps",
  description:
    "List the capability gaps Jarvis has accumulated this week — requests it couldn't handle, " +
    "grouped by pattern with occurrence counts and addressed status. " +
    "Call when the user asks 'what couldn\\'t you do this week?', '/gaps', 'show me your gaps', " +
    "'what are your limitations?', or anything about weekly gaps or self-improvement gaps. " +
    "Optionally dismiss a gap group by providing dismiss_user_message and dismiss_detected_reason " +
    "so it is excluded from Sunday's analysis.",
  parameters: {
    type: "object",
    properties: {
      dismiss_user_message: {
        type: "string",
        description:
          "Optional. The exact userMessage of the gap group to dismiss. " +
          "Must be combined with dismiss_detected_reason.",
      },
      dismiss_detected_reason: {
        type: "string",
        description:
          "Optional. The detectedReason of the gap group to dismiss. " +
          "Must be combined with dismiss_user_message.",
      },
    },
    required: [],
  },
  async execute(args, ctx): Promise<ToolResult> {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const userMsg = args.dismiss_user_message ? String(args.dismiss_user_message).trim() : null;
      const reason = args.dismiss_detected_reason ? String(args.dismiss_detected_reason).trim() : null;

      if (userMsg && reason) {
        await db
          .update(schema.capabilityGaps)
          .set({ addressed: true })
          .where(
            and(
              eq(schema.capabilityGaps.userId, ctx.userId),
              eq(schema.capabilityGaps.userMessage, userMsg),
              eq(schema.capabilityGaps.detectedReason, reason),
            ),
          );
        const content = `Gap dismissed — it won't be included in Sunday's analysis.`;
        return { ok: true, content, label: "Gap dismissed" };
      }

      const rows = await db
        .select({
          userMessage: schema.capabilityGaps.userMessage,
          agentReplySnippet: sql<string | null>`MAX(${schema.capabilityGaps.agentReplySnippet})`,
          detectedReason: schema.capabilityGaps.detectedReason,
          channel: sql<string | null>`MAX(${schema.capabilityGaps.channel})`,
          occurrenceCount: sql<number>`COUNT(*)::int`,
          addressed: sql<boolean>`BOOL_AND(${schema.capabilityGaps.addressed})`,
          latestCreatedAt: sql<string>`MAX(${schema.capabilityGaps.createdAt})::text`,
        })
        .from(schema.capabilityGaps)
        .where(
          and(
            eq(schema.capabilityGaps.userId, ctx.userId),
            gte(schema.capabilityGaps.createdAt, sevenDaysAgo),
          ),
        )
        .groupBy(
          schema.capabilityGaps.userMessage,
          schema.capabilityGaps.detectedReason,
        )
        .orderBy(desc(sql`MAX(${schema.capabilityGaps.createdAt})`))
        .limit(25);

      const content = formatGapsText(rows as GapGroup[]);
      const unaddressedCount = (rows as GapGroup[]).filter((g) => !g.addressed).length;
      return {
        ok: true,
        content,
        label: "Capability gaps",
        detail: `${unaddressedCount} unaddressed this week`,
        metadata: { totalGroups: rows.length, unaddressedCount },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, content: `Failed to fetch capability gaps: ${msg}` };
    }
  },
};
