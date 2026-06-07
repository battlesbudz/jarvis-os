import { parseRuntimeDecision, type RuntimeDecision } from "./schemas";

const REDACTED = "[redacted]";
const SENSITIVE_KEY_PATTERN = /(^|[_-])?(auth|authorization|bearer|token|accessToken|access_?token|refreshToken|refresh_?token|idToken|id_?token|apiKey|api_?key|password|passwd|secret|clientSecret|client_?secret|cookie|cookies|session|sessionId|session_?id|privateKey|private_?key)([_-]|$)?/i;

export function redactRuntimeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactRuntimeValue(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactRuntimeValue(child),
    ]),
  );
}

export function redactRuntimeDecision(decision: RuntimeDecision): RuntimeDecision {
  return parseRuntimeDecision({
    ...decision,
    tools: decision.tools.map((tool) => ({
      ...tool,
      argsPreview: tool.argsPreview === undefined ? undefined : redactRuntimeValue(tool.argsPreview),
    })),
  });
}
