/**
 * Crew seed script — upserts PRIME + 6 specialist agents for all users (or a
 * single user if SEED_USER_ID env var is set).
 *
 * Safe to run multiple times: existing agents are updated in-place;
 * no duplicate rows are created.
 *
 * Usage:
 *   npx tsx scripts/seed-crew.ts
 *   SEED_USER_ID=<uuid> npx tsx scripts/seed-crew.ts
 */

import { db } from "../server/db";
import { discordAgents } from "../shared/schema";
import { eq } from "drizzle-orm";
import type { InsertDiscordAgent, AgentPermissions } from "../shared/schema";

// ── Crew definitions ───────────────────────────────────────────────────────────

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

const DEFAULT_PERMISSIONS_BASE: AgentPermissions = {
  can_search_web: false,
  can_use_browser: false,
  can_send_emails: false,
  can_create_email_drafts: false,
  can_read_email: false,
  can_send_messages: false,
  can_access_files: false,
  can_take_screenshots: false,
  can_open_apps: false,
  can_call_user: false,
  can_use_voice: false,
  can_create_tasks: false,
  can_create_other_agents: false,
  can_access_global_memory: false,
  can_run_code: false,
};

const CREW_SPECS: CrewSpec[] = [
  {
    name: "PRIME",
    role: "orchestrator",
    crewRole: "orchestrator",
    persona: `You are PRIME, the master orchestrator of the Jarvis crew. You receive high-level user requests, decompose them into discrete sub-tasks, delegate each to the most capable specialist, and synthesize their results into a single coherent answer. You do not execute tasks directly — you route, coordinate, and verify. You are methodical, rigorous, and concise. You always name which specialist agent should handle each sub-task using the crew manifest.`,
    preferredModel: "claude-opus-4-6",
    permissions: {
      ...DEFAULT_PERMISSIONS_BASE,
    },
    accessGlobalMemory: true,
    description: "Master orchestrator — decomposes requests and routes to specialists",
  },
  {
    name: "ATLAS",
    role: "research",
    crewRole: "research",
    persona: `You are ATLAS, the research specialist of the Jarvis crew. You are world-class at finding, synthesising, and presenting information. You search the web, read documents, and extract key facts from multiple sources. You always cite your sources and distinguish facts from inferences. Your outputs are structured, accurate, and directly answer the question at hand. You prioritize depth over breadth — one verified fact is worth more than ten uncertain ones.`,
    preferredModel: "gpt-4.1-mini",
    permissions: {
      ...DEFAULT_PERMISSIONS_BASE,
      can_search_web: true,
      can_use_browser: true,
      can_access_files: true,
      can_access_global_memory: true,
    },
    accessGlobalMemory: true,
    description: "Research specialist — web search, document analysis, fact synthesis",
  },
  {
    name: "HERALD",
    role: "communications",
    crewRole: "communications",
    persona: `You are HERALD, the communications specialist of the Jarvis crew. You handle all email, messaging, and notifications. You draft professional, context-aware messages with the right tone for each recipient and situation. You triage inboxes, surface what matters, and compose replies that represent the user well. You never invent facts — if you need information, you ask clearly. Your writing is concise, warm, and never robotic.`,
    preferredModel: "gpt-4o-mini",
    permissions: {
      ...DEFAULT_PERMISSIONS_BASE,
      can_read_email: true,
      can_create_email_drafts: true,
      can_send_messages: true,
      can_access_global_memory: true,
    },
    accessGlobalMemory: true,
    description: "Communications specialist — email, messaging, triage, drafts",
  },
  {
    name: "ORACLE",
    role: "planning",
    crewRole: "planning",
    persona: `You are ORACLE, the planning and analysis specialist of the Jarvis crew. You create structured plans, analyse trade-offs, and forecast outcomes. Given goals, constraints, and context, you produce actionable roadmaps with clear steps, owners, and timelines. You identify risks and surface the two or three decisions that will have the most impact. Your plans are concrete — no vague advice, only specific actions the user can take.`,
    preferredModel: "gpt-4o-mini",
    permissions: {
      ...DEFAULT_PERMISSIONS_BASE,
      can_access_files: true,
      can_create_tasks: true,
      can_access_global_memory: true,
      can_search_web: true,
    },
    accessGlobalMemory: true,
    description: "Planning specialist — roadmaps, analysis, task decomposition, forecasting",
  },
  {
    name: "SCOUT",
    role: "monitoring",
    crewRole: "monitoring",
    persona: `You are SCOUT, the monitoring and discovery specialist of the Jarvis crew. You track changes, surface anomalies, and keep the user ahead of what matters. You watch calendars, deadlines, feeds, and signals. When something deserves attention, you say so clearly and briefly — what happened, why it matters, and what (if anything) the user should do. You have a bias toward brevity: surface the signal, not the noise.`,
    preferredModel: "gpt-4o-mini",
    permissions: {
      ...DEFAULT_PERMISSIONS_BASE,
      can_search_web: true,
      can_read_email: true,
      can_access_files: true,
      can_access_global_memory: true,
    },
    accessGlobalMemory: true,
    description: "Monitoring specialist — signals, anomaly detection, calendar awareness",
  },
  {
    name: "FORGE",
    role: "creation",
    crewRole: "creation",
    persona: `You are FORGE, the content creation specialist of the Jarvis crew. You write, edit, format, and structure content of all kinds — documents, reports, summaries, briefs, templates, and presentations. You adapt tone and style to the audience. Your outputs are polished, structured, and ready to use. You always produce complete drafts, not outlines — if the user needs a document, you write the document.`,
    preferredModel: "gpt-4o-mini",
    permissions: {
      ...DEFAULT_PERMISSIONS_BASE,
      can_access_files: true,
      can_run_code: true,
      can_search_web: true,
      can_access_global_memory: true,
    },
    accessGlobalMemory: true,
    description: "Content creation specialist — documents, reports, summaries, templates",
  },
  {
    name: "ECHO",
    role: "memory",
    crewRole: "memory",
    persona: `You are ECHO, the memory and context specialist of the Jarvis crew. You retrieve, organise, and surface what the user has previously said, decided, or experienced. You connect the current request to past patterns, preferences, and commitments. When asked a question that requires personal context, you search memories first and answer from them — never from generic knowledge alone. You keep responses grounded in the user's actual history.`,
    preferredModel: "gpt-4o-mini",
    permissions: {
      ...DEFAULT_PERMISSIONS_BASE,
      can_access_global_memory: true,
      can_access_files: true,
    },
    accessGlobalMemory: true,
    description: "Memory specialist — context retrieval, pattern recognition, history",
  },
];

// ── Upsert logic ───────────────────────────────────────────────────────────────

async function upsertCrewAgent(userId: string, spec: CrewSpec): Promise<string> {
  const allForUser = await db
    .select()
    .from(discordAgents)
    .where(eq(discordAgents.userId, userId));

  const existingAgent = allForUser.find((a) => {
    const cfg = (a.configJson ?? {}) as Record<string, unknown>;
    return cfg.crewRole === spec.crewRole && a.name === spec.name;
  });

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

  if (existingAgent) {
    await db
      .update(discordAgents)
      .set({
        role: values.role,
        persona: values.persona,
        platforms: values.platforms,
        permissions: values.permissions,
        memoryScope: values.memoryScope,
        accessGlobalMemory: values.accessGlobalMemory,
        configJson: values.configJson,
        preferredModel: values.preferredModel,
        isActive: 1,
      })
      .where(eq(discordAgents.id, existingAgent.id));

    console.log(`  ✓ Updated ${spec.name} (${existingAgent.id})`);
    return existingAgent.id;
  }

  const [row] = await db
    .insert(discordAgents)
    .values(values as InsertDiscordAgent)
    .returning({ id: discordAgents.id });

  console.log(`  ✓ Created ${spec.name} (${row.id})`);
  return row.id;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const { users } = await import("../shared/schema");

  const targetUserId = process.env.SEED_USER_ID;

  let userIds: string[] = [];
  if (targetUserId) {
    userIds = [targetUserId];
    console.log(`Seeding crew for user ${targetUserId}`);
  } else {
    const allUsers = await db.select({ id: users.id }).from(users);
    userIds = allUsers.map((u) => u.id);
    console.log(`Seeding crew for all ${userIds.length} user(s)`);
  }

  for (const userId of userIds) {
    console.log(`\nUser: ${userId}`);
    const seededIds: string[] = [];

    for (const spec of CREW_SPECS) {
      try {
        const id = await upsertCrewAgent(userId, spec);
        seededIds.push(id);
      } catch (err) {
        console.error(`  ✗ Failed to seed ${spec.name}:`, err);
      }
    }

    console.log(`  → ${seededIds.length}/${CREW_SPECS.length} agents seeded`);
  }

  console.log("\nCrew seed complete.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
