/**
 * coreAgentSeed — Ensures every user has the two core platform bots.
 *
 * Core bots are always-on platform connectors (Telegram, Discord).
 * Channel agents and research agents are created on-demand by the orchestrator
 * via setup_named_agent — they are NOT pre-seeded here.
 *
 * Idempotent: checks by (userId, name) before inserting.
 */
import { db } from "../db";
import { eq } from "drizzle-orm";
import { discordAgents, users } from "@shared/schema";
import { DEFAULT_AGENT_PERMISSIONS } from "@shared/schema";

interface CoreAgentDef {
  name: string;
  role: string;
  persona: string;
  platforms: string[];
  loopEnabled: boolean;
  loopIntervalMinutes: number;
}

const CORE_AGENTS: CoreAgentDef[] = [
  {
    name: "Jarvis Telegram Bot",
    role: "support",
    persona:
      "I am Jarvis's Telegram interface — always on, always listening. I handle direct messages from the user, extract commitments, answer questions, and route tasks. I'm conversational, concise, and proactive. I remember what matters and surface the right thing at the right time.",
    platforms: ["telegram"],
    loopEnabled: false,
    loopIntervalMinutes: 60,
  },
  {
    name: "Jarvis Discord Bot",
    role: "support",
    persona:
      "I am Jarvis's Discord presence — a strategic co-pilot operating inside your server. I monitor channels, coordinate sub-agents, surface insights, and keep your workspace intelligence alive. The orchestrator can spawn me new channel agents at any time — each gets its own persona, memory, and task queue.",
    platforms: ["discord"],
    loopEnabled: false,
    loopIntervalMinutes: 60,
  },
  {
    name: "Discord Channel Agent",
    role: "researcher",
    persona:
      "I am a dedicated Discord channel monitor and researcher. I track activity across assigned channels, surface important updates, synthesize discussions into briefings, and execute channel-specific tasks delegated by the orchestrator. Each channel I'm assigned to becomes my focus area.",
    platforms: ["discord"],
    loopEnabled: false,
    loopIntervalMinutes: 60,
  },
];

export const CORE_AGENT_NAMES = new Set(CORE_AGENTS.map((a) => a.name.toLowerCase()));

export async function seedCoreAgentsForUser(userId: string): Promise<void> {
  const existing = await db
    .select({ name: discordAgents.name })
    .from(discordAgents)
    .where(eq(discordAgents.userId, userId));

  const existingNames = new Set(existing.map((a) => a.name.toLowerCase()));

  for (const def of CORE_AGENTS) {
    if (existingNames.has(def.name.toLowerCase())) continue;

    await db.insert(discordAgents).values({
      userId,
      name: def.name,
      role: def.role,
      persona: def.persona,
      isActive: 1,
      loopEnabled: def.loopEnabled ? 1 : 0,
      loopIntervalMinutes: def.loopIntervalMinutes,
      platforms: def.platforms,
      permissions: { ...DEFAULT_AGENT_PERMISSIONS },
      memoryScope: "agent_private",
      accessGlobalMemory: false,
      allowedUsers: [],
      allowedConversations: [],
      privateMode: false,
      platformChannels: {},
      heartbeatFailCount: 0,
    });

    console.log(`[CoreAgentSeed] seeded "${def.name}" for user ${userId}`);
  }
}

export async function seedCoreAgentsForAllUsers(): Promise<void> {
  try {
    const allUsers = await db.select({ id: users.id }).from(users);
    console.log(`[CoreAgentSeed] Seeding core agents for ${allUsers.length} user(s)…`);
    for (const user of allUsers) {
      await seedCoreAgentsForUser(user.id).catch((err) => {
        console.error(`[CoreAgentSeed] Failed for user ${user.id}:`, err);
      });
    }
    console.log("[CoreAgentSeed] Done.");
  } catch (err) {
    console.error("[CoreAgentSeed] Startup seeding failed (non-fatal):", err);
  }
}
