import type { Capability, CapabilityHealthStatus } from "./types";

interface IntegrationDepSummary {
  label: string;
  toolNames: string[];
}

/**
 * Central registry for all Capability modules.
 *
 * Capabilities register themselves on import (via capabilities/index.ts).
 * Consumers (harness, integrationValidator) read the registry at runtime
 * rather than hard-coding per-integration or per-tool knowledge.
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
