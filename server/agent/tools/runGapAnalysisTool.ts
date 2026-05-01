import type { AgentTool } from "../types";
import { runCapabilityGapAnalysis } from "../capabilityGapAnalyzer";

export const runGapAnalysisTool: AgentTool = {
  name: "run_capability_gap_analysis",
  description:
    "Immediately run a capability gap analysis for the current user. Use this when the user asks 'analyse my recent gaps', 'what can't you do?', 'scan for capability gaps', or wants to trigger the weekly gap scan without waiting until Sunday. It clusters recent failed requests, proposes or auto-builds new tools for low-risk gaps, and returns a plain-English summary of what was found and actioned.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  async execute(_args, ctx) {
    try {
      const { submitted, queued, failed } = await runCapabilityGapAnalysis(ctx.userId);

      if (failed) {
        return {
          ok: false,
          content:
            "Gap analysis encountered an error (the LLM clustering step failed or the database could not be reached). Check the server logs for details.",
          label: "Gap analysis failed",
        };
      }

      const total = submitted + queued;
      if (total === 0) {
        return {
          ok: true,
          content:
            "Gap analysis complete. No unaddressed capability gaps were found in the last 7 days — you're all caught up.",
          label: "Gap analysis: nothing to do",
        };
      }

      const parts: string[] = ["**Capability gap analysis complete.**", ""];

      if (submitted > 0) {
        parts.push(
          `🔨 **${submitted} auto-build job${submitted !== 1 ? "s" : ""} queued** — low-risk gaps will be built automatically and appear in your Build Log when done.`,
        );
      }
      if (queued > 0) {
        parts.push(
          `📋 **${queued} gap proposal${queued !== 1 ? "s" : ""} added to your inbox** — these need your review before Jarvis acts on them.`,
        );
      }

      parts.push(
        "",
        "The weekly Sunday run is unaffected and will still run independently.",
      );

      return {
        ok: true,
        content: parts.join("\n"),
        label: `Gap analysis: ${submitted} auto-built, ${queued} queued`,
        detail: `${total} gap cluster${total !== 1 ? "s" : ""} found`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        content: `Gap analysis failed: ${msg}`,
        label: "Gap analysis error",
      };
    }
  },
};
