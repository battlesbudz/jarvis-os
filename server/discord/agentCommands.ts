/**
 * Discord Agent Commands — /agent and /ask slash command handlers.
 *
 * /agent subcommands:
 *   list                       — list user's named agents
 *   run <name> <msg>           — invoke a named agent directly
 *   ask <name> <msg>           — alias for run
 *   council <q>                — run council mode (all agents respond)
 *   create <name> <role>       — quick-create a named agent
 *   assign <name>              — assign this channel to a named agent
 *   disable <name>             — disable a named agent
 *   enable <name>              — re-enable a disabled agent
 *   delete <name>              — permanently delete a named agent
 *   set-permission <name> <perm> <on|off> — toggle a named permission
 *   memory-summary <name>      — show recent agent memories
 *   clear-memory <name>        — wipe all memories for an agent
 *   approvals                  — list pending approval gates
 *   status <name>              — show agent status/health
 *
 * /ask <name> <message>        — shortcut top-level command to query an agent
 */
import { runNamedAgent } from "../agent/runNamedAgent";
import { runCouncil } from "../agent/council";
import {
  listAgents,
  createAgent,
  assignChannel,
  removeChannel,
  enableAgent,
  disableAgent,
  deleteAgent,
  updateAgent,
} from "../agent/agentManager";
import { readAgentMemories, clearAgentMemory } from "../agent/agentMemory";
import { listPendingGates } from "../agent/agentApproval";

const EPHEMERAL = 64;

// ── /agents command definition ─────────────────────────────────────────────────
// Primary slash command. Named /agents (plural) to match task spec.
// Any Discord guild that registered the old /agent command will simply have
// the old one replaced on the next call to registerSlashCommands().

export const AGENT_COMMAND = {
  name: "agents",
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
        { type: 3, name: "name", description: "Agent name", required: true },
        { type: 3, name: "message", description: "Message to send to the agent", required: true },
      ],
    },
    {
      type: 1,
      name: "ask",
      description: "Ask a named agent a question (alias for run)",
      options: [
        { type: 3, name: "name", description: "Agent name", required: true },
        { type: 3, name: "message", description: "Your question", required: true },
      ],
    },
    {
      type: 1,
      name: "council",
      description: "Ask all your agents a question and get a synthesized answer",
      options: [
        { type: 3, name: "question", description: "The question to put to the council", required: true },
      ],
    },
    {
      type: 1,
      name: "create",
      description: "Quick-create a named agent",
      options: [
        { type: 3, name: "name", description: "Agent name", required: true },
        {
          type: 3,
          name: "role",
          description: "Agent role (coach, researcher, coder, writer, analyst, custom)",
          required: true,
        },
        { type: 3, name: "persona", description: "Optional persona prompt", required: false },
      ],
    },
    {
      type: 1,
      name: "assign",
      description: "Assign this channel to a named agent (messages here go to that agent)",
      options: [{ type: 3, name: "name", description: "Agent name", required: true }],
    },
    {
      type: 1,
      name: "unassign",
      description: "Remove this channel from a named agent (stops routing here)",
      options: [{ type: 3, name: "name", description: "Agent name", required: true }],
    },
    {
      type: 1,
      name: "disable",
      description: "Disable a named agent (stops it from running)",
      options: [{ type: 3, name: "name", description: "Agent name", required: true }],
    },
    {
      type: 1,
      name: "enable",
      description: "Re-enable a disabled agent",
      options: [{ type: 3, name: "name", description: "Agent name", required: true }],
    },
    {
      type: 1,
      name: "delete",
      description: "Permanently delete a named agent and all its memories",
      options: [{ type: 3, name: "name", description: "Agent name", required: true }],
    },
    {
      type: 1,
      name: "set-permission",
      description: "Toggle a permission on or off for a named agent",
      options: [
        { type: 3, name: "name", description: "Agent name", required: true },
        {
          type: 3,
          name: "permission",
          description: "Permission key (e.g. can_send_email, can_browse, can_schedule)",
          required: true,
        },
        {
          type: 5, // BOOLEAN
          name: "enabled",
          description: "Turn the permission on (true) or off (false)",
          required: true,
        },
      ],
    },
    {
      type: 1,
      name: "memory-summary",
      description: "Show recent memories for a named agent",
      options: [{ type: 3, name: "name", description: "Agent name", required: true }],
    },
    {
      type: 1,
      name: "clear-memory",
      description: "Wipe all memories for a named agent (irreversible)",
      options: [{ type: 3, name: "name", description: "Agent name", required: true }],
    },
    {
      type: 1,
      name: "approvals",
      description: "List pending tool approval requests from your agents",
    },
    {
      type: 1,
      name: "status",
      description: "Show the health/status of a named agent",
      options: [{ type: 3, name: "name", description: "Agent name", required: true }],
    },
  ],
};

// ── /ask top-level command ─────────────────────────────────────────────────────

export const ASK_COMMAND = {
  name: "ask",
  description: "Quickly ask a named Jarvis sub-agent a question",
  options: [
    { type: 3, name: "agent", description: "Agent name to ask", required: true },
    { type: 3, name: "question", description: "Your question", required: true },
  ],
};

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
  function optBool(name: string): boolean {
    const v = subOpts.find((o) => o.name === name)?.value;
    return v === true || v === "true";
  }

  /** Find an agent by name (case-insensitive), includes disabled for manage ops. */
  async function findAgent(name: string) {
    const agents = await listAgents(userId, true); // includeDisabled=true
    return agents.find((a) => a.name.toLowerCase() === name.toLowerCase()) ?? null;
  }

  try {
    switch (subName) {
      // ── list ────────────────────────────────────────────────────────────────
      case "list": {
        const agents = await listAgents(userId, true);
        if (agents.length === 0) {
          return { content: "You have no agents. Create one with `/agent create`.", flags: EPHEMERAL };
        }
        const lines = agents.map((a) => {
          const statusIcon = a.isActive ? "🟢" : "🔴";
          const loopIcon = a.loopEnabled ? " 🔄" : "";
          const ch = a.channelId ? ` 📌 channel` : "";
          return `${statusIcon} **${a.name}** (${a.role})${loopIcon}${ch}`;
        });
        return { content: `**Your Agents (${agents.length})**\n${lines.join("\n")}`, flags: EPHEMERAL };
      }

      // ── run / ask ───────────────────────────────────────────────────────────
      case "run":
      case "ask": {
        const name = opt("name") || opt("agent");
        const message = opt("message") || opt("question");
        const agent = await findAgent(name);
        if (!agent) return { content: `Agent "${name}" not found.`, flags: EPHEMERAL };
        if (!agent.isActive) return { content: `Agent "${name}" is currently disabled.`, flags: EPHEMERAL };
        const result = await runNamedAgent({
          agentId: agent.id,
          userId,
          userMessage: message,
          platform: "discord",
          channelId: typeof interaction.channel_id === "string" ? interaction.channel_id : undefined,
        });
        return { content: `**${agent.name}:** ${result.reply.slice(0, 1900)}` };
      }

      // ── council ─────────────────────────────────────────────────────────────
      case "council": {
        const question = opt("question");
        const result = await runCouncil(userId, question);
        if (result.agentCount === 0) {
          return { content: "No active agents found. Create agents with `/agent create`.", flags: EPHEMERAL };
        }
        const header = `**Council Response** (${result.succeededCount}/${result.agentCount} agents)\n\n`;
        return { content: (header + result.synthesis).slice(0, 1990) };
      }

      // ── create ──────────────────────────────────────────────────────────────
      case "create": {
        const name = opt("name");
        const role = opt("role");
        const persona = opt("persona") || undefined;
        const agentId = await createAgent(userId, { name, role, persona, platforms: ["discord"] });
        return {
          content: `✅ Created **${name}** (${role}) — ID: \`${agentId}\`\nUse \`/agent assign ${name}\` in a channel to route messages here.`,
          flags: EPHEMERAL,
        };
      }

      // ── assign ──────────────────────────────────────────────────────────────
      case "assign": {
        const name = opt("name");
        const agent = await findAgent(name);
        if (!agent) return { content: `Agent "${name}" not found.`, flags: EPHEMERAL };
        const channelId = (interaction as Record<string, unknown>).channel_id as string | undefined;
        if (!channelId) return { content: "Could not determine channel ID.", flags: EPHEMERAL };
        await assignChannel(agent.id, "discord", channelId);
        return { content: `✅ This channel is now assigned to **${name}**. Messages here will go to this agent.` };
      }

      // ── unassign ─────────────────────────────────────────────────────────────
      case "unassign": {
        const name = opt("name");
        const agent = await findAgent(name);
        if (!agent) return { content: `Agent "${name}" not found.`, flags: EPHEMERAL };
        const channelId = (interaction as Record<string, unknown>).channel_id as string | undefined;
        if (!channelId) return { content: "Could not determine channel ID.", flags: EPHEMERAL };
        await removeChannel(agent.id, "discord", channelId);
        return { content: `✅ This channel has been removed from **${name}**.`, flags: EPHEMERAL };
      }

      // ── disable ─────────────────────────────────────────────────────────────
      case "disable": {
        const name = opt("name");
        const agent = await findAgent(name);
        if (!agent) return { content: `Agent "${name}" not found.`, flags: EPHEMERAL };
        await disableAgent(agent.id);
        return { content: `🔴 Agent **${name}** has been disabled.`, flags: EPHEMERAL };
      }

      // ── enable ──────────────────────────────────────────────────────────────
      case "enable": {
        const name = opt("name");
        const agent = await findAgent(name);
        if (!agent) return { content: `Agent "${name}" not found.`, flags: EPHEMERAL };
        await enableAgent(agent.id);
        return { content: `🟢 Agent **${name}** has been re-enabled.`, flags: EPHEMERAL };
      }

      // ── delete ──────────────────────────────────────────────────────────────
      case "delete": {
        const name = opt("name");
        const agent = await findAgent(name);
        if (!agent) return { content: `Agent "${name}" not found.`, flags: EPHEMERAL };
        await deleteAgent(agent.id);
        return { content: `🗑️ Agent **${name}** has been permanently deleted.`, flags: EPHEMERAL };
      }

      // ── set-permission ──────────────────────────────────────────────────────
      case "set-permission": {
        const name = opt("name");
        const permission = opt("permission");
        const enabled = optBool("enabled");
        const agent = await findAgent(name);
        if (!agent) return { content: `Agent "${name}" not found.`, flags: EPHEMERAL };
        const currentPerms = (agent.permissions as unknown as Record<string, boolean>) ?? {};
        const updatedPerms = { ...currentPerms, [permission]: enabled };
        await updateAgent(agent.id, { permissions: updatedPerms });
        return {
          content: `✅ Permission \`${permission}\` for **${name}** set to **${enabled ? "ON" : "OFF"}**.`,
          flags: EPHEMERAL,
        };
      }

      // ── memory-summary ──────────────────────────────────────────────────────
      case "memory-summary": {
        const name = opt("name");
        const agent = await findAgent(name);
        if (!agent) return { content: `Agent "${name}" not found.`, flags: EPHEMERAL };
        const memories = await readAgentMemories(agent.id, userId, "", 10);
        if (memories.length === 0) {
          return { content: `Agent **${name}** has no memories yet.`, flags: EPHEMERAL };
        }
        const lines = memories.map((m) => `• [${m.category}] ${m.content.slice(0, 120)}`);
        return {
          content: `**${name} — Recent Memories (${memories.length})**\n${lines.join("\n")}`,
          flags: EPHEMERAL,
        };
      }

      // ── clear-memory ────────────────────────────────────────────────────────
      case "clear-memory": {
        const name = opt("name");
        const agent = await findAgent(name);
        if (!agent) return { content: `Agent "${name}" not found.`, flags: EPHEMERAL };
        const deleted = await clearAgentMemory(agent.id, userId);
        return { content: `🧹 Cleared **${deleted}** memories for agent **${name}**.`, flags: EPHEMERAL };
      }

      // ── approvals ───────────────────────────────────────────────────────────
      case "approvals": {
        const gates = await listPendingGates(userId);
        if (gates.length === 0) {
          return { content: "✅ No pending approval requests.", flags: EPHEMERAL };
        }
        const lines = gates.map(
          (g) => `• Gate \`${g.id.slice(-8)}\` — **${g.toolName}** (${g.description.slice(0, 80)})`,
        );
        return {
          content: `**Pending Approvals (${gates.length})**\n${lines.join("\n")}\n\nApprove or reject in the app's Agents → Approvals tab.`,
          flags: EPHEMERAL,
        };
      }

      // ── status ──────────────────────────────────────────────────────────────
      case "status": {
        const name = opt("name");
        const agent = await findAgent(name);
        if (!agent) return { content: `Agent "${name}" not found.`, flags: EPHEMERAL };
        const statusIcon = agent.isActive ? "🟢 Active" : "🔴 Disabled";
        const loopStatus = agent.loopEnabled
          ? `🔄 Loop every ${agent.loopIntervalMinutes ?? 60}m`
          : "No loop";
        const lastBeat = agent.lastHeartbeatAt
          ? `Last heartbeat: ${new Date(agent.lastHeartbeatAt).toLocaleString()}`
          : "No heartbeat recorded";
        const stuckInfo = agent.stuckSince ? `⚠️ Stuck since ${new Date(agent.stuckSince).toLocaleString()}` : "";
        const failCount = (agent.heartbeatFailCount ?? 0) > 0 ? `Fail count: ${agent.heartbeatFailCount}/3` : "";
        const lines = [statusIcon, loopStatus, lastBeat, stuckInfo, failCount].filter(Boolean);
        return {
          content: `**${agent.name}** (${agent.role})\n${lines.join("\n")}`,
          flags: EPHEMERAL,
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

// ── /ask command dispatcher ────────────────────────────────────────────────────

export async function handleAskCommand(
  interaction: Record<string, unknown>,
  userId: string,
): Promise<{ content: string; flags?: number }> {
  const data = interaction.data as Record<string, unknown>;
  const options = (data?.options as Array<Record<string, unknown>>) ?? [];
  function opt(name: string): string {
    return String(options.find((o) => o.name === name)?.value ?? "");
  }

  const agentName = opt("agent");
  const question = opt("question");

  try {
    const agents = await listAgents(userId);
    const agent = agents.find((a) => a.name.toLowerCase() === agentName.toLowerCase());
    if (!agent) {
      return { content: `Agent "${agentName}" not found. Use \`/agent list\` to see your agents.`, flags: EPHEMERAL };
    }
    const result = await runNamedAgent({
      agentId: agent.id,
      userId,
      userMessage: question,
      platform: "discord",
      channelId: typeof interaction.channel_id === "string" ? interaction.channel_id : undefined,
    });
    return { content: `**${agent.name}:** ${result.reply.slice(0, 1900)}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: `❌ Error: ${msg.slice(0, 500)}`, flags: EPHEMERAL };
  }
}
