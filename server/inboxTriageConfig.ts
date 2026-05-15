export function isInboxTriageEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.JARVIS_INBOX_TRIAGE_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}
