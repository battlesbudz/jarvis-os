import type { DiagnosticSubsystem } from "@shared/schema";

export type JarvisOsProbeStatus = "healthy" | "degraded" | "down" | "unknown";

export type JarvisOsRequiredFor =
  | "core"
  | "agent_loop"
  | "background_jobs"
  | "channel"
  | "integration"
  | "optional";

export interface JarvisOsProbe {
  id: string;
  label: string;
  status: JarvisOsProbeStatus;
  requiredFor: JarvisOsRequiredFor;
  message: string;
  fix?: string;
}

export interface JarvisOsReadinessReport {
  overallStatus: "ready" | "limited" | "blocked";
  generatedAt: string;
  canStartServer: boolean;
  canRunAgentLoop: boolean;
  canRunBackgroundJobs: boolean;
  canUseExternalChannels: boolean;
  blockers: JarvisOsProbe[];
  warnings: JarvisOsProbe[];
  probes: JarvisOsProbe[];
}

const REQUIRED_FOR_BY_SUBSYSTEM: Partial<Record<DiagnosticSubsystem, JarvisOsRequiredFor>> = {
  database: "core",
  agent_harness: "agent_loop",
  job_queue: "background_jobs",
  workflow_engine: "background_jobs",
  channel_registry: "channel",
  integration: "integration",
  heartbeat: "optional",
  memory: "optional",
};

const FIX_BY_REQUIRED_FOR: Record<JarvisOsRequiredFor, string> = {
  core: "Fix core server setup first. Check DATABASE_URL, migrations, and database reachability.",
  agent_loop: "Fix AI provider setup. Check OpenAI or configured model-provider credentials.",
  background_jobs: "Fix job queue and workflow persistence before starting autonomous background work.",
  channel: "Connect at least one delivery channel before relying on external notifications.",
  integration: "Reconnect or repair the affected integration before using related tools.",
  optional: "Review this subsystem before enabling related automation.",
};

function isBad(status: JarvisOsProbeStatus): boolean {
  return status === "down" || status === "unknown";
}

function isCoreRequired(requiredFor: JarvisOsRequiredFor): boolean {
  return requiredFor === "core" || requiredFor === "agent_loop" || requiredFor === "background_jobs";
}

function hasBadProbe(probes: JarvisOsProbe[], requiredFor: JarvisOsRequiredFor): boolean {
  return probes.some((probe) => probe.requiredFor === requiredFor && isBad(probe.status));
}

export function classifyJarvisOsReadiness(probes: JarvisOsProbe[]): JarvisOsReadinessReport {
  const blockers = probes.filter((probe) => isBad(probe.status) && isCoreRequired(probe.requiredFor));

  const warnings = probes.filter((probe) => {
    if (probe.status === "degraded") return true;
    return isBad(probe.status) && !isCoreRequired(probe.requiredFor);
  });

  const canStartServer = !hasBadProbe(probes, "core");
  const canRunAgentLoop = canStartServer && !hasBadProbe(probes, "agent_loop");
  const canRunBackgroundJobs =
    canRunAgentLoop &&
    !hasBadProbe(probes, "background_jobs") &&
    !probes.some((probe) => probe.requiredFor === "background_jobs" && probe.status === "degraded");
  const canUseExternalChannels = !hasBadProbe(probes, "channel");

  const overallStatus = blockers.length > 0 ? "blocked" : warnings.length > 0 ? "limited" : "ready";

  return {
    overallStatus,
    generatedAt: new Date().toISOString(),
    canStartServer,
    canRunAgentLoop,
    canRunBackgroundJobs,
    canUseExternalChannels,
    blockers,
    warnings,
    probes,
  };
}

export function formatJarvisOsReadiness(report: JarvisOsReadinessReport): string {
  const lines = [
    `Jarvis OS readiness: ${report.overallStatus}`,
    `Server: ${report.canStartServer ? "ready" : "blocked"}`,
    `Agent loop: ${report.canRunAgentLoop ? "ready" : "blocked"}`,
    `Background jobs: ${report.canRunBackgroundJobs ? "ready" : "blocked"}`,
    `External channels: ${report.canUseExternalChannels ? "ready" : "limited"}`,
  ];

  if (report.blockers.length > 0) {
    lines.push("", "Blockers:");
    for (const blocker of report.blockers) {
      lines.push(`- ${blocker.label}: ${blocker.message}${blocker.fix ? ` | Fix: ${blocker.fix}` : ""}`);
    }
  }

  if (report.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const warning of report.warnings) {
      lines.push(`- ${warning.label}: ${warning.message}${warning.fix ? ` | Fix: ${warning.fix}` : ""}`);
    }
  }

  return lines.join("\n");
}

function subsystemMessage(status: JarvisOsProbeStatus, label: string, lastEvent?: string): string {
  if (lastEvent) return lastEvent;
  if (status === "healthy") return `${label} is healthy.`;
  if (status === "degraded") return `${label} is degraded.`;
  if (status === "down") return `${label} is down.`;
  return `${label} status is unknown.`;
}

export async function getJarvisOsReadiness(userId?: string): Promise<JarvisOsReadinessReport> {
  let health;
  try {
    const diagnostics = await import("./diagnosticsService");
    health = await diagnostics.runHealthCheck(userId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const skippedMessage = "Skipped because core diagnostics could not load.";
    return classifyJarvisOsReadiness([
      {
        id: "database",
        label: "Database",
        status: "down",
        requiredFor: "core",
        message,
        fix: FIX_BY_REQUIRED_FOR.core,
      },
      {
        id: "agent_harness",
        label: "Agent Harness",
        status: "unknown",
        requiredFor: "agent_loop",
        message: skippedMessage,
        fix: FIX_BY_REQUIRED_FOR.agent_loop,
      },
      {
        id: "job_queue",
        label: "Job Queue",
        status: "unknown",
        requiredFor: "background_jobs",
        message: skippedMessage,
        fix: FIX_BY_REQUIRED_FOR.background_jobs,
      },
      {
        id: "channel_registry",
        label: "Channel Delivery",
        status: "unknown",
        requiredFor: "channel",
        message: skippedMessage,
        fix: FIX_BY_REQUIRED_FOR.channel,
      },
    ]);
  }

  const probes: JarvisOsProbe[] = health.subsystems.map((subsystem) => {
    const requiredFor = REQUIRED_FOR_BY_SUBSYSTEM[subsystem.name] ?? "optional";
    return {
      id: subsystem.name,
      label: subsystem.label,
      status: subsystem.status,
      requiredFor,
      message: subsystemMessage(subsystem.status, subsystem.label, subsystem.lastEvent),
      fix: subsystem.status === "healthy" ? undefined : FIX_BY_REQUIRED_FOR[requiredFor],
    };
  });

  return classifyJarvisOsReadiness(probes);
}
