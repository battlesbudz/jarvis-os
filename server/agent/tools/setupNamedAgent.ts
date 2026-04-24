import type { AgentTool } from "../types";
import { createDiscordChannel, registerNamedAgent } from "../../discord/manager";
import { db } from "../../db";
import { discordAgents } from "@shared/schema";
import { eq } from "drizzle-orm";

const DEFAULT_PERSONAS: Record<string, string> = {
  coder: "You are a focused software engineer. You implement features, write clean code, and provide detailed progress updates. Always summarize what you just built and what you're working on next.",
  researcher: "You are a deep research specialist. You find information, synthesize stories, and produce structured briefings. Always cite sources and provide multiple angles on each story.",
  writer: "You are a content writing agent. You write scripts, posts, and articles in the user's established voice and style. Always match the tone of prior approved content.",
  visual: "You are a visual concepts specialist. You generate detailed thumbnail concepts, design briefs, and visual direction notes with specific color palettes, layouts, and text overlay suggestions.",
  custom: "You are a specialized assistant. Focus on the task at hand and provide high-quality, actionable outputs.",
};

const DEFAULT_NAMES: Record<string, string> = {
  coder: "Charlie",
  researcher: "Echo",
  writer: "Quill",
  visual: "Pixel",
};

export const setupNamedAgentTool: AgentTool = {
  name: "setup_named_agent",
  description:
    "Create a named AI sub-agent with a distinct persona that lives in its own dedicated Discord channel. " +
    "Built-in roles: coder (Charlie), researcher (Echo), writer (Quill), visual (Pixel). " +
    "Use when the user asks to 'set up a coding agent', 'create a research assistant in Discord', etc. " +
    "Each agent gets its own channel and responds with a focused persona when messaged there. " +
    "Optionally enable an autonomous loop where the agent proactively works on tasks at a set interval.",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "The agent's name (e.g. 'Charlie', 'Echo'). Defaults to the role's default name if omitted.",
      },
      role: {
        type: "string",
        enum: ["coder", "researcher", "writer", "visual", "custom"],
        description: "The agent's role. Determines the default persona and channel name.",
      },
      persona: {
        type: "string",
        description: "Optional custom persona text. Defaults to the built-in persona for the role.",
      },
      loopEnabled: {
        type: "boolean",
        description: "Set to true to enable autonomous operation — the agent will proactively work on tasks at the set interval.",
      },
      loopIntervalMinutes: {
        type: "number",
        description: "How often the autonomous loop fires in minutes. Default: 60.",
      },
      loopPrompt: {
        type: "string",
        description: "What the looping agent does each cycle (e.g. 'Check the goal list and work on the next highest-priority task').",
      },
    },
    required: ["role"],
  },
  async execute(args: {
    name?: string;
    role: string;
    persona?: string;
    loopEnabled?: boolean;
    loopIntervalMinutes?: number;
    loopPrompt?: string;
  }, ctx) {
    const { userId } = ctx;

    const role = args.role || "custom";
    const name = args.name || DEFAULT_NAMES[role] || "Agent";
    const persona = args.persona || DEFAULT_PERSONAS[role] || DEFAULT_PERSONAS.custom;
    const channelName = `${name.toLowerCase()}-${role}`;

    // Create the dedicated channel
    const channelResult = await createDiscordChannel(userId, {
      channelName,
      topic: `${name} — ${role} agent. ${persona.slice(0, 100)}`,
      categoryName: "🧠 Jarvis Workspace",
      pinMessage: `**${name} — ${role.charAt(0).toUpperCase() + role.slice(1)} Agent**\n\n${persona}\n\n_Message ${name} here to get started. ${args.loopEnabled ? `I'll also proactively post updates every ${args.loopIntervalMinutes ?? 60} minutes.` : "I respond to your messages."}_`,
    });

    const channelId = channelResult.channelId;

    // Register agent in DB
    const agentId = await registerNamedAgent(userId, {
      name,
      role,
      persona,
      channelId,
      channelName,
      loopEnabled: args.loopEnabled,
      loopIntervalMinutes: args.loopIntervalMinutes,
      loopPrompt: args.loopPrompt,
    });

    const loopInfo = args.loopEnabled
      ? ` The loop is enabled — ${name} will proactively post updates every ${args.loopIntervalMinutes ?? 60} minutes.`
      : "";

    return {
      ok: true,
      content:
        `Created **${name}** (${role} agent) with a dedicated #${channelName} channel.${loopInfo} ` +
        `Message ${name} in that channel to get started. Agent ID: \`${agentId}\`.`,
      label: `Agent created: ${name} (${role})`,
      detail: agentId,
    };
  },
};
