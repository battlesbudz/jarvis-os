export type CodexGatewayProbeStatus =
  | "healthy"
  | "local_gateway_down"
  | "public_tunnel_down"
  | "unknown";

export interface CodexGatewayProbeInput {
  localOk?: boolean | null;
  publicOk?: boolean | null;
  localUrl?: string | null;
  publicUrl?: string | null;
  localError?: string | null;
  publicError?: string | null;
}

export interface CodexGatewayProbeSummary {
  status: CodexGatewayProbeStatus;
  localUrl?: string;
  publicUrl?: string;
  recommendedAction: string;
}

const GATEWAY_REQUEST_PATTERNS = [
  /\b(codex|oauth|local)\s+gateway\b/i,
  /\bgateway\b.{0,80}\b(down|broken|failed|failing|offline|502|bad gateway|fix|restart|repair)\b/i,
  /\b(fix|restart|repair|recover)\b.{0,80}\bgateway\b/i,
];

export function classifyCodexGatewayRecoveryRequest(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return GATEWAY_REQUEST_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function summarizeGatewayProbe(input: CodexGatewayProbeInput): CodexGatewayProbeSummary {
  const localUrl = input.localUrl?.trim() || undefined;
  const publicUrl = input.publicUrl?.trim() || undefined;

  if (input.localOk === true && input.publicOk !== false) {
    return {
      status: "healthy",
      localUrl,
      publicUrl,
      recommendedAction: "The local gateway is responding. If Railway still cannot reach it, check that Railway is using the same public gateway URL and token.",
    };
  }

  if (input.localOk === true && input.publicOk === false) {
    return {
      status: "public_tunnel_down",
      localUrl,
      publicUrl,
      recommendedAction: "The local gateway process is alive, but the public tunnel is not reaching it. Restart or re-enable the tunnel, then refresh the Railway gateway URL if it changed.",
    };
  }

  if (input.localOk === false) {
    return {
      status: "local_gateway_down",
      localUrl,
      publicUrl,
      recommendedAction: "The local gateway process is not responding. Start the supervised gateway or install the Windows startup task so it auto-recovers.",
    };
  }

  return {
    status: "unknown",
    localUrl,
    publicUrl,
    recommendedAction: "Run the gateway doctor locally to check the process, tunnel, scheduled task, and logs.",
  };
}

export function buildCodexGatewayRecoveryReply(summary: CodexGatewayProbeSummary = summarizeGatewayProbe({})): string {
  const lines = [
    "I can help with the Codex gateway without using Codex itself.",
    `Current read: ${summary.status.replace(/_/g, " ")}.`,
    summary.recommendedAction,
    "Run this local helper on the desktop gateway machine:",
    "`npm.cmd run jarvis:oauth:gateway:doctor`",
    "If the supervisor is not installed yet, run:",
    "`npm.cmd run jarvis:oauth:gateway:install-startup`",
    "If it is installed but stuck, restart the Windows task named `Jarvis Codex OAuth Gateway` or run:",
    "`npm.cmd run jarvis:oauth:gateway:supervisor`",
  ];

  if (summary.publicUrl) {
    lines.push(`Public gateway URL being checked: ${summary.publicUrl}`);
  }
  if (summary.localUrl) {
    lines.push(`Local gateway URL being checked: ${summary.localUrl}`);
  }

  return lines.join("\n");
}
