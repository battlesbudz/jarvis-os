import type { ApprovalGate } from "./agentApproval";

export const DIRECT_EMAIL_APPROVAL_AGENT_ID = "jarvis-direct-email-hitl";

export interface DirectEmailApprovalRequest {
  userId: string;
  text: string;
  channel?: string;
}

export interface ParsedDirectEmailIntent {
  to: string;
  subject: string;
  body: string;
  provider?: "google" | "microsoft";
}

export interface DirectEmailApprovalResult {
  handled: boolean;
  reply?: string;
  gateId?: string;
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

function unquote(value: string): string {
  return value.trim().replace(/^["'“”]+|["'“”]+$/g, "").trim();
}

function captureAfterLabel(text: string, labels: string[], stopLabels: string[]): string {
  const labelPattern = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const stopPattern = stopLabels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const quoted = new RegExp(`\\b(?:${labelPattern})\\s*[:=]?\\s*["“]([^"”]+)["”]`, "i").exec(text);
  if (quoted?.[1]) return unquote(quoted[1]);
  const unquoted = new RegExp(`\\b(?:${labelPattern})\\s*[:=]?\\s*([\\s\\S]+?)(?=\\b(?:${stopPattern})\\s*[:=]?|$)`, "i").exec(text);
  return unquoted?.[1] ? unquote(unquoted[1]) : "";
}

export function parseDirectEmailApprovalIntent(text: string): ParsedDirectEmailIntent | null {
  const original = text.trim();
  const lower = original.toLowerCase();
  if (!/\b(email|e-mail)\b/.test(lower)) return null;
  if (!/\b(send|sent)\b/.test(lower)) return null;
  if (!/\b(draft|write|compose)\b/.test(lower)) return null;

  const to = original.match(new RegExp(`\\b(?:to|recipient)\\s*[:=]?\\s*(${EMAIL_RE.source})`, "i"))?.[1]
    || original.match(EMAIL_RE)?.[0]
    || "";
  const subject = captureAfterLabel(original, ["subject"], ["body", "message", "email body", "ask me", "approval"]);
  const body = captureAfterLabel(original, ["body", "message", "email body"], ["ask me", "approval", "before sending"]);
  const provider = /\boutlook|microsoft\b/i.test(original) ? "microsoft" : /\bgmail|google\b/i.test(original) ? "google" : undefined;

  if (!to || !subject || !body) return null;
  return { to, subject, body, provider };
}

async function ensureDirectEmailApprovalAgent(userId: string): Promise<void> {
  const [{ db }, schema] = await Promise.all([
    import("../db"),
    import("@shared/schema"),
  ]);
  await db.insert(schema.discordAgents).values({
    id: DIRECT_EMAIL_APPROVAL_AGENT_ID,
    userId,
    name: "Jarvis Email Approval",
    role: "system",
    persona: "Creates approval gates for explicit email-send requests before any email is sent.",
    platforms: ["app", "telegram", "discord"],
    permissions: {
      ...schema.DEFAULT_AGENT_PERMISSIONS,
      can_create_email_drafts: true,
      can_send_emails: false,
    },
    memoryScope: "agent_private",
  }).onConflictDoNothing();
}

export async function handleDirectEmailApprovalRequest(input: DirectEmailApprovalRequest): Promise<DirectEmailApprovalResult> {
  const parsed = parseDirectEmailApprovalIntent(input.text);
  if (!parsed) return { handled: false };

  const { requestApproval } = await import("./agentApproval");
  const { notifyApprovalRequest } = await import("./approvalNotifications");
  await ensureDirectEmailApprovalAgent(input.userId);
  const description = [
    "Jarvis drafted an email and needs approval before sending.",
    "",
    `To: ${parsed.to}`,
    `Subject: ${parsed.subject}`,
    "",
    parsed.body.slice(0, 1200),
  ].join("\n");

  const gate = await requestApproval({
    agentId: DIRECT_EMAIL_APPROVAL_AGENT_ID,
    userId: input.userId,
    toolName: "send_email",
    toolArgs: {
      ...parsed,
      __directEmailApproval: true,
      __originChannel: input.channel || "appchat",
    },
    description,
    initiatedBy: "user",
  });

  await notifyApprovalRequest({
    gateId: gate.id,
    agentId: DIRECT_EMAIL_APPROVAL_AGENT_ID,
    agentName: "Jarvis Email Approval",
    userId: input.userId,
    toolName: "send_email",
    description,
    originChannel: input.channel || "appchat",
  }).catch((err) => {
    console.warn("[direct-email-hitl] approval notification failed:", err instanceof Error ? err.message : String(err));
  });

  return {
    handled: true,
    gateId: gate.id,
    reply: `I drafted the email to ${parsed.to} and created an approval card before sending it.`,
  };
}

export function isDirectEmailApprovalGate(gate: ApprovalGate | null | undefined): boolean {
  return gate?.agentId === DIRECT_EMAIL_APPROVAL_AGENT_ID && gate.toolArgs?.__directEmailApproval === true;
}

export async function resumeDirectEmailApprovalGate(
  gate: ApprovalGate,
  approved: boolean,
): Promise<{ continued: boolean; reason: string; result?: unknown }> {
  if (!isDirectEmailApprovalGate(gate)) {
    return { continued: false, reason: "Gate is not owned by the direct email approval route." };
  }
  if (!approved) {
    return { continued: true, reason: "Email send rejected; no email was sent." };
  }

  const { sendEmailTool } = await import("./tools/sendEmail");
  const args = gate.toolArgs || {};
  const result = await sendEmailTool.execute(
    {
      to: String(args.to || ""),
      subject: String(args.subject || ""),
      body: String(args.body || ""),
      provider: args.provider === "microsoft" ? "microsoft" : "google",
    },
    {
      userId: gate.userId,
      channel: "direct-email-hitl",
      state: {},
    } as any,
  );

  return {
    continued: result.ok,
    reason: result.content,
    result,
  };
}
