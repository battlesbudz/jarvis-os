import { tool } from "@openrouter/agent";
import { z } from "zod/v4";
import type { AgentSdkRunStore } from "./runStore";

export interface AgentSdkToolDeps {
  userId: string;
  runId: string;
  store: AgentSdkRunStore;
  readContext?: (query: string) => Promise<string>;
  sendEmail?: (args: {
    to: string;
    subject: string;
    body: string;
    provider?: "google" | "microsoft";
  }) => Promise<{ ok: boolean; messageId?: string; error?: string }>;
}

export function createAgentSdkTools(deps: AgentSdkToolDeps) {
  const readContext = tool({
    name: "read_context",
    description: "Read a small amount of Jarvis memory/context relevant to drafting the email.",
    inputSchema: z.object({ query: z.string() }),
    outputSchema: z.object({ context: z.string() }),
    execute: async ({ query }) => ({
      context: deps.readContext ? await deps.readContext(query) : "",
    }),
  });

  const draftEmail = tool({
    name: "draft_email",
    description: "Create an internal email draft preview. This does not create a Gmail draft and does not send.",
    inputSchema: z.object({
      to: z.string().email(),
      subject: z.string().min(1),
      body: z.string().min(1),
    }),
    outputSchema: z.object({
      drafted: z.boolean(),
      to: z.string(),
      subject: z.string(),
      body: z.string(),
    }),
    execute: async ({ to, subject, body }) => {
      const record = await deps.store.load(deps.runId);
      if (record) {
        record.meta.draft = { to, subject, body };
        record.meta.updatedAt = new Date().toISOString();
        await deps.store.save(record);
      }
      return { drafted: true, to, subject, body };
    },
  });

  const sendEmail = tool({
    name: "send_email",
    description: "Send the reviewed email. This requires human approval before execution.",
    inputSchema: z.object({
      to: z.string().email(),
      subject: z.string().min(1),
      body: z.string().min(1),
      provider: z.enum(["google", "microsoft"]).optional(),
    }),
    outputSchema: z.object({
      sent: z.boolean(),
      messageId: z.string().optional(),
      error: z.string().optional(),
    }),
    requireApproval: true,
    execute: async ({ to, subject, body, provider }) => {
      if (!deps.sendEmail) return { sent: false, error: "sendEmail adapter missing" };
      const result = await deps.sendEmail({ to, subject, body, provider });
      return result.ok
        ? { sent: true, messageId: result.messageId }
        : { sent: false, error: result.error || "Email send failed" };
    },
  });

  return [readContext, draftEmail, sendEmail] as const;
}
