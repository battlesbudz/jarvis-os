import type { AgentTool } from "../types";
import { runHealthCheck, runAIDiagnosis, getRecentEvents } from "../../diagnostics/diagnosticsService";
import type { DiagnosticSubsystem } from "@shared/schema";

export const selfDiagnoseTool: AgentTool = {
  name: "jarvis_self_diagnose",
  description:
    "Run a full self-diagnosis of all Jarvis subsystems (job queue, agent harness, channels, integrations, database, heartbeat). Call this when the user asks 'are you OK?', 'what's wrong?', 'why did that fail?', or any question about Jarvis's health or recent failures. Returns a plain-English health report with root cause analysis and recommended actions.",
  parameters: {
    type: "object",
    properties: {
      subsystem: {
        type: "string",
        description:
          "Optional: focus the diagnosis on a specific subsystem — job_queue, workflow_engine, agent_harness, channel_registry, integration, heartbeat, memory, database. Omit for a full system diagnosis.",
      },
    },
    required: [],
  },
  async execute(args, ctx) {
    try {
      const subsystem = args.subsystem ? String(args.subsystem).trim() as DiagnosticSubsystem : undefined;

      const [diagnosis, report] = await Promise.all([
        runAIDiagnosis(ctx.userId),
        runHealthCheck(ctx.userId),
      ]);

      const statusLines = report.subsystems
        .map((s) => {
          const icon = s.status === "healthy" ? "🟢" : s.status === "degraded" ? "🟡" : s.status === "down" ? "🔴" : "⚪";
          const errNote = s.errorCount15m > 0 ? ` (${s.errorCount15m} errors/15m)` : "";
          return `${icon} ${s.label}${errNote}`;
        })
        .join("\n");

      let focusedEvents = "";
      if (subsystem) {
        const events = await getRecentEvents({ userId: ctx.userId, subsystem, limit: 5, sinceMinutes: 60 });
        if (events.length > 0) {
          focusedEvents = `\n\nRecent ${subsystem} events:\n` +
            events.map((e) => `• [${e.severity}] ${e.message}`).join("\n");
        }
      }

      const content = `${diagnosis}\n\n**Subsystem Status:**\n${statusLines}${focusedEvents}`;

      console.log(`[${ctx.channel || "Agent"}] jarvis_self_diagnose user=${ctx.userId} overall=${report.overallStatus}`);

      return {
        ok: true,
        content,
        label: `Self-diagnosis: ${report.overallStatus}`,
        detail: `${report.degradedSubsystems.length} degraded subsystem(s)`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        content: `Self-diagnosis failed: ${msg}. This likely means the diagnostics service itself encountered an error.`,
        label: "Self-diagnosis error",
      };
    }
  },
};
