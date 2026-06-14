/**
 * agentPolicyManager — per-agent approval policy management.
 *
 * Each named agent can have one of four policy scopes:
 *   "global"     — use global system defaults (requiresApproval + initiatedBy logic)
 *   "permissive" — auto-approve all HIGH_RISK_TOOLS that are not STRICTLY_IRREVERSIBLE
 *   "strict"     — require manual approval for every HIGH_RISK_TOOLS call, even when
 *                  Jarvis-initiated
 *   "custom"     — follow global defaults, but additionally auto-approve tools whose
 *                  name matches any pattern in the agent's allowlist
 *
 * Pattern matching supports exact names ("create_gmail_draft") and simple prefix wildcards
 * ("gmail_*"). No regex — intentionally simple to avoid misconfig footguns.
 */
import { db } from "../db";
import { agentApprovalPolicies, agentApprovalAllowlist } from "@shared/schema";
import type { AgentPolicyScope, AgentApprovalAllowlistEntry } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AgentPolicy {
  agentId: string;
  scope: AgentPolicyScope;
  allowlist: AgentApprovalAllowlistEntry[];
}

// ── Policy CRUD ────────────────────────────────────────────────────────────────

/**
 * Get the policy for an agent (returns null if no custom policy has been set,
 * meaning the agent uses global defaults).
 */
export async function getAgentPolicy(agentId: string): Promise<AgentPolicy | null> {
  const [policyRow] = await db
    .select()
    .from(agentApprovalPolicies)
    .where(eq(agentApprovalPolicies.agentId, agentId))
    .limit(1);

  const allowlist = await db
    .select()
    .from(agentApprovalAllowlist)
    .where(eq(agentApprovalAllowlist.agentId, agentId))
    .orderBy(agentApprovalAllowlist.createdAt);

  if (!policyRow) {
    return allowlist.length > 0
      ? { agentId, scope: "global", allowlist }
      : null;
  }

  return {
    agentId,
    scope: policyRow.scope,
    allowlist,
  };
}

/**
 * Set the policy scope for an agent. Creates the policy row if it doesn't
 * exist (upsert).
 */
export async function setAgentPolicyScope(
  agentId: string,
  userId: string,
  scope: AgentPolicyScope,
): Promise<void> {
  await db
    .insert(agentApprovalPolicies)
    .values({ agentId, userId, scope, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: agentApprovalPolicies.agentId,
      set: { scope, updatedAt: new Date() },
    });
}

/**
 * Add a tool allowlist pattern for an agent.
 * Returns the created entry.
 */
export async function addAllowlistPattern(
  agentId: string,
  userId: string,
  pattern: string,
): Promise<AgentApprovalAllowlistEntry> {
  const [entry] = await db
    .insert(agentApprovalAllowlist)
    .values({ agentId, userId, pattern: pattern.trim() })
    .returning();
  return entry;
}

/**
 * Remove an allowlist pattern by ID. Only succeeds if the pattern belongs
 * to the specified agent (owner check).
 */
export async function removeAllowlistPattern(
  patternId: string,
  agentId: string,
): Promise<boolean> {
  const result = await db
    .delete(agentApprovalAllowlist)
    .where(
      and(
        eq(agentApprovalAllowlist.id, patternId),
        eq(agentApprovalAllowlist.agentId, agentId),
      ),
    );
  return (result.rowCount ?? 0) > 0;
}

// ── Pattern matching ───────────────────────────────────────────────────────────

/**
 * Returns true if toolName matches the given pattern.
 * Supports:
 *   "create_gmail_draft"   — exact match
 *   "gmail_*"       — prefix wildcard (must end with *)
 */
export function matchesPattern(toolName: string, pattern: string): boolean {
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1);
    return toolName.startsWith(prefix);
  }
  return toolName === pattern;
}

/**
 * Increment the use_count and update last_used_at for a matched allowlist entry.
 * Non-blocking — errors are swallowed.
 */
export function recordAllowlistHit(patternId: string): void {
  db.update(agentApprovalAllowlist)
    .set({
      useCount: sql`use_count + 1`,
      lastUsedAt: new Date(),
    })
    .where(eq(agentApprovalAllowlist.id, patternId))
    .catch(() => {});
}

// ── Core policy decision ───────────────────────────────────────────────────────

export type PolicyDecision =
  | { action: "auto_approve"; reason: string; patternId?: string }
  | { action: "require_approval"; reason: string }
  | { action: "use_global"; reason: string };

/**
 * Check the agent's approval policy for a specific tool call.
 * Returns a PolicyDecision that tells the caller what to do:
 *
 *   auto_approve    — skip the gate entirely (track allowlist hit if applicable)
 *   require_approval — create a gate and wait for the user
 *   use_global       — fall through to the existing global logic
 *
 * This function does NOT check whether the tool is in HIGH_RISK_TOOLS — that
 * check happens upstream in requiresApproval(). The policy is only consulted
 * when the tool already requires approval under global rules.
 */
export async function evaluatePolicyForTool(
  agentId: string,
  toolName: string,
  isStrictlyIrreversible: boolean,
): Promise<PolicyDecision> {
  let policy: AgentPolicy | null;
  try {
    policy = await getAgentPolicy(agentId);
  } catch {
    return { action: "use_global", reason: "policy load failed" };
  }

  if (!policy || policy.scope === "global") {
    if (policy && policy.allowlist.length > 0) {
      const hit = policy.allowlist.find((e) => matchesPattern(toolName, e.pattern));
      if (hit && !isStrictlyIrreversible) {
        recordAllowlistHit(hit.id);
        return { action: "auto_approve", reason: `allowlist pattern "${hit.pattern}"`, patternId: hit.id };
      }
    }
    return { action: "use_global", reason: "no custom policy" };
  }

  if (policy.scope === "strict") {
    return { action: "require_approval", reason: "agent policy is strict" };
  }

  if (policy.scope === "permissive") {
    if (isStrictlyIrreversible) {
      return { action: "require_approval", reason: "strictly irreversible tool — permissive policy still requires approval" };
    }
    return { action: "auto_approve", reason: "agent policy is permissive" };
  }

  // scope === "custom" — check allowlist patterns
  if (policy.scope === "custom") {
    const hit = policy.allowlist.find((e) => matchesPattern(toolName, e.pattern));
    if (hit && !isStrictlyIrreversible) {
      recordAllowlistHit(hit.id);
      return { action: "auto_approve", reason: `custom allowlist pattern "${hit.pattern}"`, patternId: hit.id };
    }
    return { action: "require_approval", reason: "no matching custom allowlist pattern" };
  }

  return { action: "use_global", reason: "unknown scope" };
}
