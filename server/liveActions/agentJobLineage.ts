import { and, eq, inArray, sql } from "drizzle-orm";
import * as schema from "@shared/schema";
import { db } from "../db";
import type { AgentJobRow } from "./adapters/agentJob";

function inputOf(job: AgentJobRow): Record<string, unknown> {
  return job.input && typeof job.input === "object" && !Array.isArray(job.input)
    ? job.input as Record<string, unknown>
    : {};
}

function retryParentId(job: AgentJobRow): string | null {
  const value = inputOf(job).retryOfJobId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function agentJobLineageKey(job: AgentJobRow, jobsById: ReadonlyMap<string, AgentJobRow>): string {
  const seen = new Set<string>();
  let current = job;
  while (!seen.has(current.id)) {
    seen.add(current.id);
    const input = inputOf(current);
    const parentId = retryParentId(current);
    if (!parentId) return current.id;
    const durableRoot = input.liveActionLineageKey;
    if (typeof durableRoot === "string" && durableRoot.trim()) return durableRoot.trim().slice(0, 200);
    const parent = jobsById.get(parentId);
    if (!parent) return parentId.slice(0, 200);
    current = parent;
  }
  return [...seen].sort()[0]!.slice(0, 200);
}

export async function loadAgentJobRetryFamily(
  userId: string,
  seedJobs: AgentJobRow[],
  descendantRoots: string[] = [],
): Promise<Map<string, AgentJobRow>> {
  const jobsById = new Map(seedJobs.map((job) => [job.id, job]));
  let ancestorIds = [...new Set(seedJobs.map(retryParentId).filter((id): id is string => !!id))]
    .filter((id) => !jobsById.has(id));
  while (ancestorIds.length > 0) {
    const ancestors = await db.select().from(schema.agentJobs).where(and(
      eq(schema.agentJobs.userId, userId),
      inArray(schema.agentJobs.id, ancestorIds),
    ));
    ancestorIds = [];
    for (const ancestor of ancestors) {
      if (jobsById.has(ancestor.id)) continue;
      jobsById.set(ancestor.id, ancestor);
      const parentId = retryParentId(ancestor);
      if (parentId && !jobsById.has(parentId)) ancestorIds.push(parentId);
    }
  }

  if (descendantRoots.length > 0) {
    let parentIds = [...new Set([...descendantRoots, ...jobsById.keys()])];
    while (parentIds.length > 0) {
      const descendants = await db.select().from(schema.agentJobs).where(and(
        eq(schema.agentJobs.userId, userId),
        inArray(sql<string>`${schema.agentJobs.input}->>'retryOfJobId'`, parentIds),
      ));
      parentIds = [];
      for (const descendant of descendants) {
        if (jobsById.has(descendant.id)) continue;
        jobsById.set(descendant.id, descendant);
        parentIds.push(descendant.id);
      }
    }
  }
  return jobsById;
}

export async function resolveAgentJobLineageKey(userId: string, job: AgentJobRow): Promise<string> {
  const jobsById = await loadAgentJobRetryFamily(userId, [job]);
  return agentJobLineageKey(job, jobsById);
}
