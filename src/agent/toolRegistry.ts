/**
 * toolRegistry.ts — SDK Tool Registry (Jarvis-controlled)
 *
 * SDK has a limited set of built-in tools (draft_email, send_email, reminder).
 * External tool execution goes through Jarvis's sdkGateway.ts.
 *
 * JARVIS OWNS tool policy:
 * - SDK cannot self-register external tools
 * - External tool calls go through Jarvis's toolRiskScoring
 * - External tool calls go through Jarvis's approval gates
 *
 * @deprecated External tool execution should go through server/agent/sdkGateway.ts
 */

import type { AgentSdkRunStore } from "./runStore";

// ── SDK Built-in Tool Boundaries ──────────────────────────────────────────────
// Jarvis controls which external tools the SDK can access.
// SDK's built-in tools (draft_email, send_email, reminder) are still functional.

export interface AgentSdkToolDeps {
  userId: string;
  runId: string;
  store: AgentSdkRunStore;
  includeDraftEmailTool?: boolean;
  includeSendEmailTool?: boolean;
  includeReminderTool?: boolean;
  readContext?: (query: string) => Promise<string>;
  sendEmail?: (args: {
    to: string;
    subject: string;
    body: string;
    provider?: "google" | "microsoft";
  }) => Promise<{ ok: boolean; messageId?: string; error?: string }>;
  createInternalReminder?: (args: {
    title: string;
    description?: string;
    scheduledAt: string;
    recurrence?: string;
  }) => Promise<{ ok: boolean; id?: string; scheduledAt?: string; recurrence?: string | null; deduped?: boolean; error?: string }>;
}

/**
 * Create SDK built-in tools.
 * 
 * Tools include:
 * - read_context: Always included, reads Jarvis memory/context
 * - draft_email: Included by default, drafts email without sending
 * - send_email: Included by default (unless excluded), requires HITL approval
 * - create_internal_reminder: Only when includeReminderTool=true
 * 
 * NOTE: External tool execution (e.g., browser, file operations) should go through
 * server/agent/sdkGateway.ts which routes through Jarvis's tool policy and approval gates.
 */
export function createAgentSdkTools(deps: AgentSdkToolDeps) {
  const {
    runId,
    store,
    includeDraftEmailTool = true,
    includeSendEmailTool = true,
    includeReminderTool = false,
    sendEmail,
    createInternalReminder,
    readContext,
  } = deps;

  const tools: any[] = [];

  // read_context tool - always included
  tools.push({
    type: "function",
    function: {
      name: "read_context",
      description: "Read a small amount of Jarvis memory/context relevant to drafting the email.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Query to search context" },
        },
        required: ["query"],
      },
      execute: async (args: { query: string }) => ({
        context: readContext ? await readContext(args.query) : "",
      }),
    },
  });

  // draft_email tool - saves draft, no send (default)
  if (includeDraftEmailTool !== false) {
    tools.push({
      type: "function",
      function: {
        name: "draft_email",
        description: "Draft an email without sending it. Saves to draft for user review.",
        parameters: {
          type: "object",
          properties: {
            to: { type: "string", description: "Recipient email address" },
            subject: { type: "string", description: "Email subject" },
            body: { type: "string", description: "Email body" },
          },
          required: ["to", "subject", "body"],
        },
        execute: async (args: { to: string; subject: string; body: string }) => {
          const record = await store.load(runId);
          if (record) {
            record.meta.draft = { to: args.to, subject: args.subject, body: args.body };
            record.meta.updatedAt = new Date().toISOString();
            await store.save(record);
          }
          return { drafted: true, ...args };
        },
      },
    });
  }

  // send_email tool - requires approval through HITL (default)
  if (includeSendEmailTool === false) {
    // Only reminder when send_email is excluded
    if (includeReminderTool && createInternalReminder) {
      tools.push({
        type: "function",
        function: {
          name: "create_internal_reminder",
          description: "Create a reminder for the user.",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string", description: "Reminder title" },
              description: { type: "string", description: "Optional description" },
              scheduledAt: { type: "string", description: "When to remind (ISO date or relative)" },
            },
            required: ["title", "scheduledAt"],
          },
          execute: async (args: { title: string; description?: string; scheduledAt: string }) => {
            const result = await createInternalReminder(args);
            if (result.ok && result.id) {
              const record = await store.load(runId);
              if (record) {
                record.meta.reminder = {
                  id: result.id,
                  title: args.title,
                  scheduledAt: result.scheduledAt || args.scheduledAt,
                  recurrence: result.recurrence ?? null,
                  deduped: result.deduped,
                };
                record.meta.updatedAt = new Date().toISOString();
                await store.save(record);
              }
            }
            return { created: result.ok, ...result };
          },
        },
      });
    }
    return tools;
  }

  // send_email tool (included by default when includeSendEmailTool !== false)
  if (sendEmail) {
    tools.push({
      type: "function",
      function: {
        name: "send_email",
        description: "Send an email. REQUIRES USER APPROVAL before sending.",
        parameters: {
          type: "object",
          properties: {
            to: { type: "string", description: "Recipient email address" },
            subject: { type: "string", description: "Email subject" },
            body: { type: "string", description: "Email body" },
          },
          required: ["to", "subject", "body"],
        },
        execute: async (args: { to: string; subject: string; body: string }) => {
          // Email send goes through HITL approval
          const result = await sendEmail(args);
          if (result.ok) {
            const record = await store.load(runId);
            if (record) {
              record.meta.status = "complete";
              record.meta.sentEmailId = result.messageId;
              record.meta.updatedAt = new Date().toISOString();
              await store.save(record);
            }
          }
          return { sent: result.ok, ...result };
        },
      },
    });
  }

  // create_internal_reminder tool
  if (includeReminderTool && createInternalReminder) {
    tools.push({
      type: "function",
      function: {
        name: "create_internal_reminder",
        description: "Create a reminder for the user.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Reminder title" },
            description: { type: "string", description: "Optional description" },
            scheduledAt: { type: "string", description: "When to remind (ISO date or relative)" },
          },
          required: ["title", "scheduledAt"],
        },
        execute: async (args: { title: string; description?: string; scheduledAt: string }) => {
          const result = await createInternalReminder(args);
          if (result.ok && result.id) {
            const record = await store.load(runId);
            if (record) {
              record.meta.reminder = {
                id: result.id,
                title: args.title,
                scheduledAt: result.scheduledAt || args.scheduledAt,
                recurrence: result.recurrence ?? null,
                deduped: result.deduped,
              };
              record.meta.updatedAt = new Date().toISOString();
              await store.save(record);
            }
          }
          return { created: result.ok, ...result };
        },
      },
    });
  }

  return tools;
}

// ── Tool Policy Enforcement ───────────────────────────────────────────────────
// External tool calls should go through Jarvis's sdkGateway

export const SDK_TOOL_POLICY = {
  // External tools the SDK can request (routed through Jarvis)
  allowedExternalTools: [] as string[],

  // Tools the SDK can NEVER request
  blockedTools: [
    "android_sms_send",
    "android_notification_reply",
    "android_camera_clip",
    "android_screen_record",
  ] as string[],

  // Message for external tool requests
  externalToolError: "External tool execution should go through Jarvis's sdkGateway.ts",
} as const;