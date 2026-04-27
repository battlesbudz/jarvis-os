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
import { and, eq } from "drizzle-orm";
import { discordAgents, users } from "@shared/schema";
import { DEFAULT_AGENT_PERMISSIONS } from "@shared/schema";

interface CoreAgentDef {
  name: string;
  role: string;
  persona: string;
  platforms: string[];
  loopEnabled: boolean;
  loopIntervalMinutes: number;
  /**
   * Preferred model for this agent. Used as the default when no per-request
   * model override is supplied to runNamedAgent.
   */
  preferredModel?: string;
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
    preferredModel: "gpt-4.1-mini",
  },
  {
    name: "Jarvis Discord Bot",
    role: "support",
    persona:
      "I am Jarvis's Discord presence — a strategic co-pilot operating inside your server. I monitor channels, coordinate sub-agents, surface insights, and keep your workspace intelligence alive. The orchestrator can spawn me new channel agents at any time — each gets its own persona, memory, and task queue.",
    platforms: ["discord"],
    loopEnabled: false,
    loopIntervalMinutes: 60,
    preferredModel: "gpt-4.1-mini",
  },
  {
    name: "Discord Channel Agent",
    role: "researcher",
    persona:
      "I am a dedicated Discord channel monitor and researcher. I track activity across assigned channels, surface important updates, synthesize discussions into briefings, and execute channel-specific tasks delegated by the orchestrator. Each channel I'm assigned to becomes my focus area.",
    platforms: ["discord"],
    loopEnabled: false,
    loopIntervalMinutes: 60,
    preferredModel: "gpt-4.1-mini",
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
    if (existingNames.has(def.name.toLowerCase())) {
      // Always sync preferredModel so model routing changes propagate to
      // existing agents (not just newly-seeded ones).
      if (def.preferredModel) {
        await db
          .update(discordAgents)
          .set({ preferredModel: def.preferredModel })
          .where(
            and(
              eq(discordAgents.userId, userId),
              eq(discordAgents.name, def.name),
            ),
          )
          .catch(() => {});
      }
      continue;
    }

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
      preferredModel: def.preferredModel ?? null,
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
