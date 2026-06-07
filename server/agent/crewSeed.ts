import { and, eq } from "drizzle-orm";
import { db } from "../db";
import {
  DEFAULT_AGENT_PERMISSIONS,
  discordAgents,
  users,
  type AgentPermissions,
  type InsertDiscordAgent,
} from "@shared/schema";

interface CrewSpec {
  name: string;
  role: string;
  crewRole: string;
  persona: string;
  preferredModel: string;
  permissions: AgentPermissions;
  accessGlobalMemory: boolean;
  description: string;
}

const basePermissions: AgentPermissions = {
  ...DEFAULT_AGENT_PERMISSIONS,
  can_access_global_memory: true,
};

const CREW_SPECS: CrewSpec[] = [
  {
    name: "PRIME",
    role: "orchestrator",
    crewRole: "orchestrator",
    persona: "You are PRIME, the Jarvis crew orchestrator. Decompose requests, route each sub-task to the best specialist, verify results, and synthesize one clear answer.",
    preferredModel: "chatgpt-codex-oauth/auto",
    permissions: { ...basePermissions },
    accessGlobalMemory: true,
    description: "Master orchestrator for routing and verification",
  },
  {
    name: "ATLAS",
    role: "research",
    crewRole: "research",
    persona: "You are ATLAS, the Jarvis research specialist. Gather current evidence, compare sources, cite what you read, and avoid unsupported claims.",
    preferredModel: "gpt-4.1-mini",
    permissions: { ...basePermissions, can_search_web: true, can_use_browser: true, can_access_files: true },
    accessGlobalMemory: true,
    description: "Research, document analysis, and source synthesis",
  },
  {
    name: "HERALD",
    role: "communications",
    crewRole: "communications",
    persona: "You are HERALD, the Jarvis communications specialist. Read real message context before drafting, triage urgency, and keep replies concise and user-authentic.",
    preferredModel: "gpt-4o-mini",
    permissions: { ...basePermissions, can_read_email: true, can_create_email_drafts: true, can_send_messages: true },
    accessGlobalMemory: true,
    description: "Email, messages, inbox triage, and drafts",
  },
  {
    name: "ORACLE",
    role: "planning",
    crewRole: "planning",
    persona: "You are ORACLE, the Jarvis planning specialist. Turn goals into concrete steps, timelines, owners, risks, and a first move.",
    preferredModel: "gpt-4o-mini",
    permissions: { ...basePermissions, can_access_files: true, can_create_tasks: true, can_search_web: true, can_access_calendar: true },
    accessGlobalMemory: true,
    description: "Plans, trade-off analysis, task decomposition, and timelines",
  },
  {
    name: "SCOUT",
    role: "monitoring",
    crewRole: "monitoring",
    persona: "You are SCOUT, the Jarvis monitoring specialist. Watch live signals, deadlines, and anomalies, and surface only what deserves attention.",
    preferredModel: "gpt-4o-mini",
    permissions: { ...basePermissions, can_search_web: true, can_read_email: true, can_access_files: true, can_access_calendar: true },
    accessGlobalMemory: true,
    description: "Monitoring, calendar awareness, anomalies, and signal surfacing",
  },
  {
    name: "FORGE",
    role: "creation",
    crewRole: "creation",
    persona: "You are FORGE, the Jarvis creation specialist. Produce complete, polished, ready-to-use artifacts rather than outlines.",
    preferredModel: "gpt-4o-mini",
    permissions: { ...basePermissions, can_access_files: true, can_run_code: true, can_search_web: true },
    accessGlobalMemory: true,
    description: "Documents, reports, summaries, and content artifacts",
  },
  {
    name: "ECHO",
    role: "memory",
    crewRole: "memory",
    persona: "You are ECHO, the Jarvis memory specialist. Retrieve and attribute the user's actual prior context, preferences, and decisions.",
    preferredModel: "gpt-4o-mini",
    permissions: { ...basePermissions, can_access_files: true },
    accessGlobalMemory: true,
    description: "Memory lookup, preferences, and historical context",
  },
];

async function upsertCrewAgent(userId: string, spec: CrewSpec): Promise<"created" | "updated"> {
  const existing = await db
    .select({ id: discordAgents.id, name: discordAgents.name, configJson: discordAgents.configJson })
    .from(discordAgents)
    .where(and(eq(discordAgents.userId, userId), eq(discordAgents.name, spec.name)));

  const matching = existing.find((agent) => {
    const cfg = (agent.configJson ?? {}) as Record<string, unknown>;
    return cfg.crewRole === spec.crewRole;
  }) ?? existing[0];

  const values: Partial<InsertDiscordAgent> = {
    userId,
    name: spec.name,
    role: spec.role,
    persona: spec.persona,
    platforms: ["internal"],
    permissions: spec.permissions,
    memoryScope: "agent_private",
    accessGlobalMemory: spec.accessGlobalMemory,
    allowedUsers: [],
    allowedConversations: [],
    privateMode: false,
    platformChannels: {},
    configJson: {
      crewRole: spec.crewRole,
      description: spec.description,
      isCrewMember: true,
    },
    preferredModel: spec.preferredModel,
    isActive: 1,
    loopEnabled: 0,
    loopIntervalMinutes: 60,
    heartbeatFailCount: 0,
    mentionPatterns: [],
  };

  if (matching) {
    await db
      .update(discordAgents)
      .set(values)
      .where(eq(discordAgents.id, matching.id));
    return "updated";
  }

  await db.insert(discordAgents).values(values as InsertDiscordAgent);
  return "created";
}

export async function seedCrewAgentsForUser(userId: string): Promise<void> {
  let created = 0;
  let updated = 0;

  for (const spec of CREW_SPECS) {
    try {
      const result = await upsertCrewAgent(userId, spec);
      if (result === "created") created++;
      else updated++;
    } catch (err) {
      console.error(`[CrewSeed] Failed to seed ${spec.name} for user ${userId}:`, err);
    }
  }

  if (created > 0 || updated > 0) {
    console.log(`[CrewSeed] ensured crew for user ${userId}: ${created} created, ${updated} updated`);
  }
}

export async function seedCrewAgentsForAllUsers(): Promise<void> {
  try {
    const allUsers = await db.select({ id: users.id }).from(users);
    console.log(`[CrewSeed] Seeding crew agents for ${allUsers.length} user(s)`);
    for (const user of allUsers) {
      await seedCrewAgentsForUser(user.id);
    }
    console.log("[CrewSeed] Done.");
  } catch (err) {
    console.error("[CrewSeed] Startup seeding failed (non-fatal):", err);
  }
}
