import OpenAI from "openai";
import { coachFunctionTool } from "./coachToolDefinitions";

export function buildCoreCoachTools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return [
    coachFunctionTool({
      name: "add_task",
      description: "Add a new task to the user's plan for today",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Task title" },
          category: { type: "string", enum: ["health", "work", "personal", "learning", "finance", "social"], description: "Task category" },
          duration: { type: "number", description: "Estimated duration in minutes" },
        },
        required: ["title", "category"],
      },
    }),
    coachFunctionTool({
      name: "add_to_brain_dump",
      description: "Add an item to the user's brain dump inbox",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
    }),
    coachFunctionTool({
      name: "log_goal_progress",
      description: "Log progress toward a goal",
      parameters: {
        type: "object",
        properties: {
          goalTitle: { type: "string", description: "Partial or full goal title to match" },
          amount: { type: "number", description: "Amount to add to current progress" },
        },
        required: ["goalTitle", "amount"],
      },
    }),
    coachFunctionTool({
      name: "update_life_context",
      description: "Update one or more life context fields for the user",
      parameters: {
        type: "object",
        properties: {
          priorityGoal: { type: "string" },
          currentBlocker: { type: "string" },
          improvementArea: { type: "string" },
          upcomingDeadline: { type: "string" },
          freeText: { type: "string" },
        },
      },
    }),
    coachFunctionTool({
      name: "complete_task",
      description: "Mark a task as complete in today's plan",
      parameters: {
        type: "object",
        properties: {
          taskTitle: { type: "string", description: "Partial or full title of the task to complete" },
        },
        required: ["taskTitle"],
      },
    }),
    ...(process.env.TAVILY_API_KEY ? [coachFunctionTool({
      name: "web_search",
      description: "Search the internet for real-time information such as current events, weather, stock prices, news, product reviews, or anything else that requires up-to-date data. Use this when the user asks about something you don't know or when current information is needed.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query to look up" },
        },
        required: ["query"],
      },
    })] : []),
  ];
}
