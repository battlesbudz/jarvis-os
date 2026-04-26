/**
 * Discord Agent Commands — /agent subcommand handlers.
 *
 * Registers a /agent slash command with subcommands:
 *   /agent list            — list user's named agents
 *   /agent run <name> <msg>  — invoke a named agent directly
 *   /agent council <q>     — run council mode (all agents respond)
 *   /agent create <name> <role> — quick-create a named agent
 *   /agent assign <name>   — assign current channel to named agent
 *
 * Intended to be registered alongside the existing /jarvis command in
 * slashCommands.ts. Registration is idempotent.
 */
import { runNamedAgent } from "../agent/runNamedAgent";
import { runCouncil } from "../agent/council";
import {
  listAgents,
  createAgent,
  assignChannel,
} from "../agent/agentManager";

const DISCORD_API = "https://discord.com/api/v10";
const EPHEMERAL = 64;

export const AGENT_COMMAND = {
  name: "agent",
  description: "Manage and invoke Jarvis sub-agents",
  options: [
    {
      type: 1, // SUB_COMMAND
      name: "list",
      description: "List your active named agents",
    },
    {
      type: 1,
      name: "run",
      description: "Invoke a named agent with a message",
      options: [
        {
          type: 3, // STRING
          name: "name",
          description: "Agent name",
          required: true,
        },
        {
          type: 3,
          name: "message",
          description: "Message to send to the agent",
          required: true,
        },
      ],
    },
    {
      type: 1,
      name: "council",
      description: "Ask all your agents a question and get a synthesized answer",
      options: [
        {
          type: 3,
          name: "question",
          description: "The question to put to the council",
          required: true,
        },
      ],
    },
    {
      type: 1,
      name: "create",
      description: "Quick-create a named agent",
      options: [
        {
          type: 3,
          name: "name",
          description: "Agent name",
          required: true,
        },
        {
          type: 3,
          name: "role",
          description: "Agent role (coach, researcher, coder, writer, analyst, custom)",
          required: true,
        },
      ],
    },
    {
      type: 1,
      name: "assign",
      description: "Assign this channel to a named agent (messages here go to that agent)",
      options: [
        {
          type: 3,
          name: "name",
          description: "Agent name",
          required: true,
        },
      ],
    },
  ],
};

// ── Register agent command ─────────────────────────────────────────────────────

export async function registerAgentCommand(
  applicationId: string,
  botToken: string,
  guildId?: string,
): Promise<void> {
  const url = guildId
    ? `${DISCORD_API}/applications/${applicationId}/guilds/${guildId}/commands`
    : `${DISCORD_API}/applications/${applicationId}/commands`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(AGENT_COMMAND),
  });

  if (!resp.ok) {
    const body = await resp.text();
    console.error(`[AgentCommands] failed to register /agent command: ${resp.status} ${body}`);
  } else {
    console.log("[AgentCommands] /agent command registered");
  }
}

// ── Command dispatcher ─────────────────────────────────────────────────────────

export async function handleAgentCommand(
  interaction: Record<string, unknown>,
  userId: string,
): Promise<{ content: string; flags?: number }> {
  const data = interaction.data as Record<string, unknown>;
  const options = (data?.options as Array<Record<string, unknown>>) ?? [];
  const subcommand = options[0];
  const subName = subcommand?.name as string;
  const subOpts = (subcommand?.options as Array<Record<string, unknown>>) ?? [];

  function opt(name: string): string {
    return String(subOpts.find((o) => o.name === name)?.value ?? "");
  }

  try {
    switch (subName) {
      case "list": {
        const agents = await listAgents(userId);
        if (agents.length === 0) {
          return { content: "You have no active agents. Create one with `/agent create`.", flags: EPHEMERAL };
        }
        const lines = agents.map((a) =>
          `• **${a.name}** (${a.role}) — ${a.channelId ? `#channel assigned` : "no channel"}${a.loopEnabled ? " 🔄" : ""}`,
        );
        return { content: `**Your Agents (${agents.length})**\n${lines.join("\n")}`, flags: EPHEMERAL };
      }

      case "run": {
        const name = opt("name");
        const message = opt("message");
        const agents = await listAgents(userId);
        const agent = agents.find((a) => a.name.toLowerCase() === name.toLowerCase());
        if (!agent) {
          return { content: `Agent "${name}" not found. Use \`/agent list\` to see your agents.`, flags: EPHEMERAL };
        }
        const result = await runNamedAgent({
          agentId: agent.id,
          userId,
          userMessage: message,
          platform: "discord",
        });
        return { content: `**${agent.name}:** ${result.reply.slice(0, 1900)}` };
      }

      case "council": {
        const question = opt("question");
        const result = await runCouncil(userId, question);
        if (result.agentCount === 0) {
          return { content: "No active agents found. Create agents first with `/agent create`.", flags: EPHEMERAL };
        }
        const header = `**Council Response** (${result.succeededCount}/${result.agentCount} agents responded)\n\n`;
        return { content: (header + result.synthesis).slice(0, 1990) };
      }

      case "create": {
        const name = opt("name");
        const role = opt("role");
        const agentId = await createAgent(userId, { name, role, platforms: ["discord"] });
        return {
          content: `✅ Created agent **${name}** (${role}) — ID: \`${agentId}\`\nUse \`/agent assign ${name}\` in a channel to route messages to this agent.`,
          flags: EPHEMERAL,
        };
      }

      case "assign": {
        const name = opt("name");
        const agents = await listAgents(userId);
        const agent = agents.find((a) => a.name.toLowerCase() === name.toLowerCase());
        if (!agent) {
          return { content: `Agent "${name}" not found.`, flags: EPHEMERAL };
        }
        const channelId = (interaction as Record<string, unknown>).channel_id as string | undefined;
        if (!channelId) {
          return { content: "Could not determine channel ID.", flags: EPHEMERAL };
        }
        await assignChannel(agent.id, "discord", channelId);
        return {
          content: `✅ This channel is now assigned to **${name}**. All messages here will be handled by this agent.`,
        };
      }

      default:
        return { content: "Unknown subcommand.", flags: EPHEMERAL };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: `❌ Error: ${msg.slice(0, 500)}`, flags: EPHEMERAL };
  }
}
