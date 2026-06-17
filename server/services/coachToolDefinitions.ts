import OpenAI from "openai";

export function coachFunctionTool(
  definition: OpenAI.Chat.Completions.ChatCompletionFunctionTool["function"],
): OpenAI.Chat.Completions.ChatCompletionFunctionTool {
  return { type: "function", function: definition };
}

export function buildCoachPostTranscriptTools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return [
    coachFunctionTool({
        name: "connect_channel",
        description: "Generate a one-tap deep link so the user can connect a new messaging channel (Telegram, WhatsApp, Slack, or Discord) to Jarvis. Returns a tappable link button. Use proactively when the user asks to connect/link any of these services.",
        parameters: {
          type: "object",
          properties: {
            channel: {
              type: "string",
              enum: ["telegram", "whatsapp", "discord", "slack"],
              description: "Which channel to generate a connection link for.",
            },
          },
          required: ["channel"],
        },
    }),
    coachFunctionTool({
        name: "schedule_jarvis_task",
        description: "Schedule a future item for the user's own to-do list or reminder list. Use for human tasks, habits, errands, chores, and tasks Jarvis cannot physically do, such as DoorDash work or calls the user must personally make. These are non-executable user tasks by default. Do not use this for autonomous Jarvis work like checking inboxes, sending reports, running scripts, or operating connected apps later; use explicit cron/job tools for those.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short title for the scheduled task (e.g. 'Review inbox', 'Send weekly update')" },
            description: { type: "string", description: "Optional details for the user's task/reminder." },
            scheduledAt: { type: "string", description: "When the task should appear or remind the user. Accepts ISO 8601 or common natural language like 'in an hour', 'tomorrow at 9am', 'daily', or 'next Monday at 10am'." },
            recurrence: { type: "string", description: "Optional recurrence pattern: 'daily', 'weekly', 'weekdays', 'every Monday', 'every Sunday', etc. Omit for one-time tasks." },
            taskKind: { type: "string", enum: ["user_task", "jarvis_action"], description: "Defaults to user_task. Only use jarvis_action when Jarvis can actually perform the scheduled action with tools." },
          },
          required: ["title", "scheduledAt"],
        },
    }),
    coachFunctionTool({
        name: "image_generate",
        description:
          "Generate an image from a text prompt using GPT Image and display it inline in the chat. " +
          "Use for concept illustrations, motivational visuals, meal plan photos, mind maps, or any explicit image request. " +
          "Do NOT call this for text-only answers - only when the user explicitly asks for an image or a visual would meaningfully enhance the response.",
        parameters: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description: "A detailed description of the image to generate. Include style, content, mood, and any relevant details.",
            },
            size: {
              type: "string",
              enum: ["square", "landscape", "portrait"],
              description: "Image aspect ratio: square (1:1, default), landscape (16:9), portrait (9:16).",
            },
            caption: {
              type: "string",
              description: "Optional short caption displayed below the image in chat (1-2 sentences max).",
            },
          },
          required: ["prompt"],
        },
    }),
  ];
}
