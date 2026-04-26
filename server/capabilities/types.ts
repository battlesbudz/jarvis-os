/**
 * Core types for the Jarvis capability module system.
 *
 * Each capability domain (Calendar, Email, Discord, etc.) implements the
 * Capability interface so it can register itself with the CapabilityRegistry.
 * The harness and pre-flight validator consume the registry rather than
 * hard-coding per-integration knowledge.
 */

import type { AgentTool } from "../agent/types";

/** Configuration value required by a capability. */
export interface ConfigRequirement {
  key: string;
  label: string;
  optional?: boolean;
}

/** Result of a lightweight capability health check (config-only, no network). */
export interface CapabilityHealthStatus {
  healthy: boolean;
  reason?: string;
}

/**
 * Describes the runtime relationship between a capability and an external
 * integration. When `integrationId` has status `broken` in the pre-flight
 * validator, `toolNames` are excluded from the active session and the model
 * is notified via the system prompt.
 *
 * `toolNames: []` is valid for channel-only integrations (Telegram, Slack,
 * WhatsApp, Outlook) — there are no agent tools to gate, but the harness
 * still injects an advisory note so the model can explain the broken channel
 * to the user.
 */
export interface IntegrationDependency {
  integrationId: string;
  label: string;
  toolNames: string[];
}

/**
 * A self-contained capability module: a logical domain that groups related
 * agent tools, declares its external dependencies, and optionally exposes a
 * lightweight health check.
 *
 * Registered capabilities are consumed by:
 *   - `harness.ts`              — tool exclusion when integrations are broken
 *   - `integrationValidator.ts` — config-level health checks on startup
 */
export interface Capability {
  id: string;
  label: string;
  /** ToolGroup strings this capability contributes to (matches tools/index.ts ToolGroup union). */
  toolGroups: string[];
  tools: AgentTool[];
  /**
   * Subset of `tools` that require a valid Google OAuth token.
   * Kept separate from integrationDependencies because Google gating applies
   * at tool-list assembly time (before the session starts), not just when the
   * integration is actively broken.
   */
  googleGatedToolNames?: string[];
  /** External integrations this capability depends on. */
  integrationDependencies?: IntegrationDependency[];
  /** Env vars / secrets required at the config level. */
  configRequirements?: ConfigRequirement[];
  /**
   * Per-tool group overrides for tools whose group membership differs from the
   * capability's default `toolGroups`. For example, a tool might belong to both
   * "discord" (capability default) and "system" (override needed for that tool).
   *
   * When absent for a tool, the tool inherits all groups from `toolGroups`.
   * When present, the override completely replaces the default for that tool.
   */
  toolGroupOverrides?: Record<string, string[]>;
  /**
   * Lightweight config-level health check — no external network calls.
   * Returns healthy:false when required env vars are missing.
   * The full OAuth-ping health check is done by integrationValidator.ts.
   */
  healthCheck?: (context?: { userId?: string }) => Promise<CapabilityHealthStatus>;
}
