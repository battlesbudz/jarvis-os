import type { AgentTool } from "../agent/types";
import type { Capability, CapabilityHealthStatus } from "./types";

interface IntegrationDepSummary {
  label: string;
  toolNames: string[];
}

/**
 * Central registry for all Capability modules.
 *
 * Capabilities register themselves on import (via capabilities/index.ts).
 * Consumers (harness, integrationValidator, tools/index.ts) read the registry
 * at runtime rather than hard-coding per-integration or per-tool knowledge.
 */
export class CapabilityRegistry {
  private readonly _caps = new Map<string, Capability>();

  register(cap: Capability): void {
    this._caps.set(cap.id, cap);
  }

  getAll(): Capability[] {
    return Array.from(this._caps.values());
  }

  getById(id: string): Capability | undefined {
    return this._caps.get(id);
  }

  getByGroup(group: string): Capability[] {
    return this.getAll().filter((c) => c.toolGroups.includes(group));
  }

  // ── Tool assembly ──────────────────────────────────────────────────────────

  /**
   * Returns all registered tools, deduplicated by name.
   * First capability to register a tool name wins.
   * This is the single source of truth for ALL_TOOLS in tools/index.ts.
   */
  getAllTools(): AgentTool[] {
    const seen = new Set<string>();
    const result: AgentTool[] = [];
    for (const cap of this.getAll()) {
      for (const tool of cap.tools) {
        if (!seen.has(tool.name)) {
          seen.add(tool.name);
          result.push(tool);
        }
      }
    }
    return result;
  }

  /**
   * Returns a Set of tool names that require a valid Google OAuth token.
   * Derived from `googleGatedToolNames` declared across all capabilities.
   */
  getGoogleGatedNames(): Set<string> {
    const result = new Set<string>();
    for (const cap of this.getAll()) {
      for (const name of cap.googleGatedToolNames ?? []) {
        result.add(name);
      }
    }
    return result;
  }

  /**
   * Returns a map of toolName → toolGroups[], built from capability metadata.
   * For each tool, the groups come from either:
   *   - `cap.toolGroupOverrides[tool.name]`  (per-tool precision), or
   *   - `cap.toolGroups`                     (capability-level default)
   *
   * This replaces the hardcoded TOOL_GROUP_MAP in tools/index.ts.
   */
  buildToolGroupMap(): Record<string, string[]> {
    const map: Record<string, string[]> = {};
    for (const cap of this.getAll()) {
      for (const tool of cap.tools) {
        if (!map[tool.name]) {
          map[tool.name] = [];
        }
        const groups = cap.toolGroupOverrides?.[tool.name] ?? cap.toolGroups;
        for (const group of groups) {
          if (!map[tool.name].includes(group)) {
            map[tool.name].push(group);
          }
        }
      }
    }
    return map;
  }

  // ── Integration dependencies ───────────────────────────────────────────────

  /**
   * Returns a map of integrationId → { label, toolNames } for the harness
   * to use when excluding tools for broken integrations.
   *
   * Tool names from multiple capabilities that share the same integrationId
   * are merged. The label from the first capability to register "wins" so
   * callers should use a consistent label across capabilities.
   */
  getIntegrationDeps(): Record<string, IntegrationDepSummary> {
    const result: Record<string, IntegrationDepSummary> = {};
    for (const cap of this.getAll()) {
      for (const dep of cap.integrationDependencies ?? []) {
        if (!result[dep.integrationId]) {
          result[dep.integrationId] = { label: dep.label, toolNames: [] };
        }
        for (const name of dep.toolNames) {
          if (!result[dep.integrationId].toolNames.includes(name)) {
            result[dep.integrationId].toolNames.push(name);
          }
        }
      }
    }
    return result;
  }

  // ── Health checks ──────────────────────────────────────────────────────────

  /**
   * Run health checks for all capabilities that declare one.
   * Returns a map of capabilityId → CapabilityHealthStatus.
   * Errors inside individual health checks are caught and returned as unhealthy.
   */
  async getHealthStatuses(
    context?: { userId?: string },
  ): Promise<Record<string, CapabilityHealthStatus>> {
    const results: Record<string, CapabilityHealthStatus> = {};
    await Promise.all(
      this.getAll()
        .filter((c) => c.healthCheck)
        .map(async (c) => {
          try {
            results[c.id] = await c.healthCheck!(context);
          } catch {
            results[c.id] = { healthy: false, reason: "Health check threw an error" };
          }
        }),
    );
    return results;
  }
}

export const capabilityRegistry = new CapabilityRegistry();
