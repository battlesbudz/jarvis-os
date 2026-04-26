/**
 * AgentManager — CRUD operations for the multi-agent ego system.
 *
 * All operations persist to the `discord_agents` table (extended with ego
 * columns). Platform routing, permission management, and memory namespace
 * assignments are also handled here.
 */
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { discordAgents, DEFAULT_AGENT_PERMISSIONS } from "@shared/schema";
import type { AgentPermissions, AgentMemoryScope, DiscordAgent, InsertDiscordAgent } from "@shared/schema";
import { logAgentEvent } from "./agentLogger";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CreateAgentConfig {
  name: string;
  role?: string;
  persona?: string;
  platforms?: string[];
  permissions?: Partial<AgentPermissions>;
  memoryScope?: AgentMemoryScope;
  accessGlobalMemory?: boolean;
  privateMode?: boolean;
  channelId?: string;
  channelName?: string;
  loopEnabled?: boolean;
  loopIntervalMinutes?: number;
  loopPrompt?: string;
  platformChannels?: Record<string, string[]>;
  configJson?: Record<string, unknown>;
}

export interface UpdateAgentPatch {
  name?: string;
  persona?: string;
  platforms?: string[];
  permissions?: Partial<AgentPermissions>;
  memoryScope?: AgentMemoryScope;
  accessGlobalMemory?: boolean;
  privateMode?: boolean;
  channelId?: string;
  channelName?: string;
  loopEnabled?: boolean;
  loopIntervalMinutes?: number;
  loopPrompt?: string;
  platformChannels?: Record<string, string[]>;
  isActive?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function mergePermissions(partial?: Partial<AgentPermissions>): AgentPermissions {
  if (!partial) return { ...DEFAULT_AGENT_PERMISSIONS };
  return { ...DEFAULT_AGENT_PERMISSIONS, ...partial };
}

// ── createAgent ────────────────────────────────────────────────────────────────

/**
 * Create a new named agent for a user.
 * Enforces deduplication: a user cannot have two active agents with the same
 * name (case-insensitive).
 */
export async function createAgent(userId: string, config: CreateAgentConfig): Promise<string> {
  const name = config.name.trim();
  if (!name) throw new Error("Agent name is required");

  // Deduplication guard: prevent duplicate names per user (case-insensitive).
  const allActive = await db
    .select()
    .from(discordAgents)
    .where(and(eq(discordAgents.userId, userId), eq(discordAgents.isActive, 1)));

  const nameLower = name.toLowerCase();
  const conflict = allActive.find((a) => a.name.toLowerCase() === nameLower);
  if (conflict) {
    throw new Error(`Agent "${name}" already exists for this user. Choose a different name.`);
  }

  const values: InsertDiscordAgent = {
    userId,
    name,
    role: config.role || "custom",
    persona: config.persona,
    channelId: config.channelId,
    channelName: config.channelName,
    isActive: 1,
    loopEnabled: config.loopEnabled ? 1 : 0,
    loopIntervalMinutes: config.loopIntervalMinutes ?? 60,
    loopPrompt: config.loopPrompt,
    platforms: config.platforms ?? ["discord"],
    permissions: mergePermissions(config.permissions),
    memoryScope: config.memoryScope ?? "agent_private",
    accessGlobalMemory: config.accessGlobalMemory ?? false,
    allowedUsers: [],
    allowedConversations: [],
    privateMode: config.privateMode ?? false,
    platformChannels: config.platformChannels ?? {},
    configJson: config.configJson,
    heartbeatFailCount: 0,
  };

  const [row] = await db.insert(discordAgents).values(values).returning({ id: discordAgents.id });
  const agentId = row.id;

  logAgentEvent({
    event: "agent_created",
    agentId,
    userId,
    detail: `role=${values.role} platforms=${(values.platforms as string[]).join(",")}`,
  });

  console.log(`[AgentManager] created agent "${name}" (${agentId}) for user ${userId}`);
  return agentId;
}

// ── getAgent ───────────────────────────────────────────────────────────────────

export async function getAgent(agentId: string): Promise<DiscordAgent | null> {
  const [row] = await db
    .select()
    .from(discordAgents)
    .where(eq(discordAgents.id, agentId))
    .limit(1);
  return row ?? null;
}

// ── listAgents ─────────────────────────────────────────────────────────────────

export async function listAgents(userId: string, includeDisabled = false): Promise<DiscordAgent[]> {
  if (includeDisabled) {
    return db.select().from(discordAgents).where(eq(discordAgents.userId, userId));
  }
  return db.select().from(discordAgents).where(
    and(eq(discordAgents.userId, userId), eq(discordAgents.isActive, 1)),
  );
}

// ── updateAgent ────────────────────────────────────────────────────────────────

export async function updateAgent(agentId: string, patch: UpdateAgentPatch): Promise<void> {
  const updates: Partial<InsertDiscordAgent> = {};
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.persona !== undefined) updates.persona = patch.persona;
  if (patch.platforms !== undefined) updates.platforms = patch.platforms;
  if (patch.permissions !== undefined) {
    // Merge with existing permissions to avoid wiping unmentioned flags.
    const existing = await getAgent(agentId);
    const current = (existing?.permissions as AgentPermissions) ?? DEFAULT_AGENT_PERMISSIONS;
    updates.permissions = { ...current, ...patch.permissions };
  }
  if (patch.memoryScope !== undefined) updates.memoryScope = patch.memoryScope;
  if (patch.accessGlobalMemory !== undefined) updates.accessGlobalMemory = patch.accessGlobalMemory;
  if (patch.privateMode !== undefined) updates.privateMode = patch.privateMode;
  if (patch.channelId !== undefined) updates.channelId = patch.channelId;
  if (patch.channelName !== undefined) updates.channelName = patch.channelName;
  if (patch.loopEnabled !== undefined) updates.loopEnabled = patch.loopEnabled ? 1 : 0;
  if (patch.loopIntervalMinutes !== undefined) updates.loopIntervalMinutes = patch.loopIntervalMinutes;
  if (patch.loopPrompt !== undefined) updates.loopPrompt = patch.loopPrompt;
  if (patch.platformChannels !== undefined) updates.platformChannels = patch.platformChannels;
  if (patch.isActive !== undefined) updates.isActive = patch.isActive ? 1 : 0;

  if (Object.keys(updates).length === 0) return;

  await db.update(discordAgents).set(updates).where(eq(discordAgents.id, agentId));
  console.log(`[AgentManager] updated agent ${agentId}`);
}

// ── disableAgent / enableAgent ─────────────────────────────────────────────────

export async function disableAgent(agentId: string): Promise<void> {
  await db.update(discordAgents).set({ isActive: 0 }).where(eq(discordAgents.id, agentId));
  logAgentEvent({ event: "agent_disabled_stuck", agentId, detail: "manually disabled" });
  console.log(`[AgentManager] disabled agent ${agentId}`);
}

export async function enableAgent(agentId: string): Promise<void> {
  await db
    .update(discordAgents)
    .set({ isActive: 1, stuckSince: null, heartbeatFailCount: 0 })
    .where(eq(discordAgents.id, agentId));
  console.log(`[AgentManager] enabled agent ${agentId}`);
}

// ── deleteAgent ────────────────────────────────────────────────────────────────

export async function deleteAgent(agentId: string): Promise<void> {
  await db.delete(discordAgents).where(eq(discordAgents.id, agentId));
  console.log(`[AgentManager] deleted agent ${agentId}`);
}

// ── assignChannel / removeChannel ─────────────────────────────────────────────

export async function assignChannel(agentId: string, platform: string, channelId: string): Promise<void> {
  const agent = await getAgent(agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  const channels = (agent.platformChannels as Record<string, string[]>) ?? {};
  const existing = channels[platform] ?? [];
  if (!existing.includes(channelId)) {
    channels[platform] = [...existing, channelId];
  }

  // Also update the flat channelId field for Discord backward compat.
  const updates: Partial<InsertDiscordAgent> = { platformChannels: channels };
  if (platform === "discord" && !agent.channelId) {
    updates.channelId = channelId;
  }

  await db.update(discordAgents).set(updates).where(eq(discordAgents.id, agentId));
  console.log(`[AgentManager] assigned ${platform}:${channelId} to agent ${agentId}`);
}

export async function removeChannel(agentId: string, platform: string, channelId: string): Promise<void> {
  const agent = await getAgent(agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  const channels = (agent.platformChannels as Record<string, string[]>) ?? {};
  channels[platform] = (channels[platform] ?? []).filter((id) => id !== channelId);

  await db.update(discordAgents).set({ platformChannels: channels }).where(eq(discordAgents.id, agentId));
  console.log(`[AgentManager] removed ${platform}:${channelId} from agent ${agentId}`);
}

// ── getAgentForChannel ─────────────────────────────────────────────────────────

/**
 * Find the active agent assigned to a given (userId, platform, channelId).
 * First checks the flat `channelId` field (Discord backward compat), then
 * the `platformChannels` jsonb map.
 */
export async function getAgentForChannel(
  userId: string,
  platform: string,
  channelId: string,
): Promise<DiscordAgent | null> {
  const agents = await db
    .select()
    .from(discordAgents)
    .where(and(eq(discordAgents.userId, userId), eq(discordAgents.isActive, 1)));

  for (const agent of agents) {
    // Legacy flat channelId match (Discord)
    if (agent.channelId === channelId) return agent;
    // platformChannels map match
    const pc = (agent.platformChannels as Record<string, string[]>) ?? {};
    if (pc[platform]?.includes(channelId)) return agent;
  }
  return null;
}

// ── loadAgentConfig ────────────────────────────────────────────────────────────

/**
 * Validate a raw config object (from JSON import) and create the agent.
 * Returns the new agent ID.
 */
export async function loadAgentConfig(
  userId: string,
  configJson: Record<string, unknown>,
): Promise<string> {
  const config: CreateAgentConfig = {
    name: String(configJson.name || ""),
    role: String(configJson.role || "custom"),
    persona: configJson.personality_prompt ? String(configJson.personality_prompt) : undefined,
    platforms: Array.isArray(configJson.platforms) ? configJson.platforms as string[] : ["discord"],
    permissions: (configJson.permissions as Partial<AgentPermissions>) ?? {},
    memoryScope: (configJson.memory_scope as AgentMemoryScope) ?? "agent_private",
    accessGlobalMemory: Boolean(configJson.can_access_global_memory ?? false),
    configJson,
  };

  if (!config.name) throw new Error("Config must include a 'name' field");

  return createAgent(userId, config);
}
