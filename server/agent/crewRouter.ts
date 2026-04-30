/**
 * crewRouter — resolves the specialist agent for a given sub-task.
 *
 * Called by executeSubTask in orchestrator.ts after PRIME returns an `assignTo`
 * field on a sub-task. Looks up the named crew agent by crewRole tag in
 * configJson; returns null if not found so the caller falls back to bare harness.
 */
import { db } from "../db";
import { discordAgents } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import type { DiscordAgent } from "@shared/schema";

/** Crew role tags recognised by the router. */
export const CREW_ROLES = [
  "orchestrator",
  "research",
  "communications",
  "planning",
  "monitoring",
  "creation",
  "memory",
] as const;

export type CrewRole = (typeof CREW_ROLES)[number];

/** Map specialist names (as PRIME uses them) to crewRole tags. */
const NAME_TO_ROLE: Record<string, CrewRole> = {
  PRIME: "orchestrator",
  ATLAS: "research",
  HERALD: "communications",
  ORACLE: "planning",
  SCOUT: "monitoring",
  FORGE: "creation",
  ECHO: "memory",
};

/**
 * Resolve a specialist agent for a given `assignTo` value (agent name or role)
 * and userId.
 *
 * Returns the DiscordAgent row if found and active, null otherwise.
 * The caller falls back to the bare harness when null is returned.
 */
export async function resolveSpecialist(
  assignTo: string | undefined,
  userId: string,
): Promise<DiscordAgent | null> {
  if (!assignTo) return null;

  const normalised = assignTo.trim().toUpperCase();

  // Map the name to a crewRole if known, otherwise treat assignTo as a role directly.
  const crewRole: string = NAME_TO_ROLE[normalised] ?? assignTo.toLowerCase();

  try {
    const allAgents = await db
      .select()
      .from(discordAgents)
      .where(and(eq(discordAgents.userId, userId), eq(discordAgents.isActive, 1)));

    const match = allAgents.find((a) => {
      const cfg = (a.configJson ?? {}) as Record<string, unknown>;
      // Never route to the orchestrator agent (PRIME) as a sub-task specialist
      if (cfg.crewRole === "orchestrator") return false;
      return cfg.crewRole === crewRole && cfg.isCrewMember === true;
    });

    if (match) {
      console.log(`[crewRouter] resolved "${assignTo}" → ${match.name} (${match.id})`);
    } else {
      console.warn(`[crewRouter] no specialist found for assignTo="${assignTo}" crewRole="${crewRole}" userId=${userId}`);
    }

    return match ?? null;
  } catch (err) {
    console.error(`[crewRouter] lookup failed for "${assignTo}":`, err);
    return null;
  }
}

/**
 * Return the crew manifest block for inclusion in PRIME's decomposition prompt.
 * Listed agents are loaded from the DB for the given user; falls back to the
 * static manifest if the DB is unavailable.
 */
export async function getCrewManifest(userId: string): Promise<string> {
  const staticManifest = `## Crew Manifest
You have access to the following specialist agents. When decomposing sub-tasks, include an "assignTo" field naming the best specialist.

| Agent  | Role           | Capabilities |
|--------|----------------|--------------|
| ATLAS  | Research       | Web search, document analysis, fact synthesis, source citation |
| HERALD | Communications | Email read/draft, messaging, inbox triage, reply composition |
| ORACLE | Planning       | Structured plans, task decomposition, trade-off analysis, timelines |
| SCOUT  | Monitoring     | Calendar awareness, deadline tracking, anomaly detection, signal surfacing |
| FORGE  | Creation       | Document writing, reports, summaries, templates, content formatting |
| ECHO   | Memory         | Personal context retrieval, preference lookup, history recall |

Assignment rules:
- Use ATLAS for any information retrieval or web research sub-task.
- Use HERALD for any email reading, drafting, or messaging sub-task.
- Use ORACLE for planning, scheduling, or analysis sub-tasks.
- Use SCOUT for monitoring, calendar, or deadline-awareness sub-tasks.
- Use FORGE for writing, document creation, or content sub-tasks.
- Use ECHO when the sub-task requires the user's personal history or preferences.
- Omit "assignTo" (or set to null) only for truly generic tasks with no specialist fit.`;

  try {
    const allAgents = await db
      .select()
      .from(discordAgents)
      .where(and(eq(discordAgents.userId, userId), eq(discordAgents.isActive, 1)));

    const crew = allAgents.filter((a) => {
      const cfg = (a.configJson ?? {}) as Record<string, unknown>;
      return cfg.isCrewMember === true && cfg.crewRole !== "orchestrator";
    });

    if (crew.length === 0) return staticManifest;

    const rows = crew.map((a) => {
      const cfg = (a.configJson ?? {}) as Record<string, unknown>;
      const desc = typeof cfg.description === "string" ? cfg.description : a.role;
      return `| ${a.name.padEnd(6)} | ${(a.role ?? "").padEnd(14)} | ${desc} |`;
    });

    return `## Crew Manifest
You have access to the following specialist agents. When decomposing sub-tasks, include an "assignTo" field naming the best specialist.

| Agent  | Role           | Capabilities |
|--------|----------------|--------------|
${rows.join("\n")}

Assignment rules:
- Use ATLAS for any information retrieval or web research sub-task.
- Use HERALD for any email reading, drafting, or messaging sub-task.
- Use ORACLE for planning, scheduling, or analysis sub-tasks.
- Use SCOUT for monitoring, calendar, or deadline-awareness sub-tasks.
- Use FORGE for writing, document creation, or content sub-tasks.
- Use ECHO when the sub-task requires the user's personal history or preferences.
- Omit "assignTo" (or set to null) only for truly generic tasks with no specialist fit.`;
  } catch {
    return staticManifest;
  }
}
