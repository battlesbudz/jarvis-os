import OpenAI from "openai";
import { coachFunctionTool } from "./coachToolDefinitions";

export function buildConnectedServiceCoachTools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return [
    coachFunctionTool({
        name: "check_connections",
        description: "Check which external accounts and channels the user has connected (Google/Gmail/Calendar, Microsoft/Outlook, Telegram, WhatsApp, Discord, Desktop Daemon). Always call this before claiming a service is or isn't available.",
        parameters: { type: "object", properties: {} },
    }),
    coachFunctionTool({
        name: "generate_reconnect_link",
        description: "Generate a fresh OAuth authorization URL so the user can reconnect a disconnected Google or Microsoft account. Returns a tappable link button. Use after check_connections confirms the service is not connected.",
        parameters: {
          type: "object",
          properties: {
            provider: { type: "string", enum: ["google", "microsoft"], description: "Which provider to reconnect" },
          },
          required: ["provider"],
        },
    }),
    coachFunctionTool({
        name: "create_calendar_event",
        description: "Create a calendar event on the user's Google or Outlook calendar. Use when the user asks to schedule or block time. start and end must be ISO 8601 datetime strings.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Event title" },
            start: { type: "string", description: "Start datetime ISO 8601 (e.g. '2025-04-22T14:00:00Z')" },
            end: { type: "string", description: "End datetime ISO 8601 (e.g. '2025-04-22T15:00:00Z')" },
            description: { type: "string", description: "Optional event notes" },
            location: { type: "string", description: "Optional location or video link" },
            provider: { type: "string", enum: ["google", "microsoft"], description: "Calendar provider, default 'google'" },
          },
          required: ["title", "start", "end"],
        },
    }),
    coachFunctionTool({
        name: "fetch_calendar",
        description: "Fetch the user's Google Calendar events for a given day or date range. Use whenever the user asks about their schedule, meetings, availability, or what's coming up. Returns events with title, time, and location.",
        parameters: {
          type: "object",
          properties: {
            date: { type: "string", description: "ISO date YYYY-MM-DD. Defaults to today if omitted." },
            days: { type: "number", description: "Number of consecutive days to fetch starting from date. Default 1, max 14." },
          },
        },
    }),
    coachFunctionTool({
        name: "fetch_emails",
        description: "Fetch recent emails on demand. Use when the user asks about their inbox beyond what's already in the system context. provider: 'google' (Gmail) or 'microsoft' (Outlook). count: number of emails to fetch (default 10, max 25).",
        parameters: {
          type: "object",
          properties: {
            provider: { type: "string", enum: ["google", "microsoft"], description: "Email provider" },
            count: { type: "number", description: "Number of emails to fetch (max 25)" },
          },
          required: ["provider"],
        },
    }),
    coachFunctionTool({
        name: "send_email",
        description: "Send an email immediately via Gmail or Outlook. Only use after the user explicitly confirms they want to send. Requires Google or Microsoft to be connected. If the user has multiple Google accounts, pass accountHint with the sender email address to select the correct account.",
        parameters: {
          type: "object",
          properties: {
            to: { type: "string", description: "Recipient email address" },
            subject: { type: "string", description: "Email subject" },
            body: { type: "string", description: "Email body (plain text)" },
            provider: { type: "string", enum: ["google", "microsoft"], description: "Which provider to use, default 'google'" },
            accountHint: { type: "string", description: "Optional sender account email to disambiguate when multiple accounts are connected (e.g. 'alice@gmail.com')" },
          },
          required: ["to", "subject", "body"],
        },
    }),
  ];
}
