/**
 * AgentConfigSchema — JSON import/export schema for agent configs.
 *
 * Agents can be exported to JSON and imported back, enabling sharing and
 * version control of agent configurations.
 *
 * The schema is also used to validate configs submitted via the REST API.
 */
import type { AgentPermissions, AgentMemoryScope } from "@shared/schema";
import { DEFAULT_AGENT_PERMISSIONS } from "@shared/schema";

// ── JSON Schema for agent config ───────────────────────────────────────────────

export interface AgentConfigFile {
  version: "1";
  name: string;
  role: string;
  personality_prompt?: string;
  platforms: string[];
  permissions: AgentPermissions;
  memory_scope: AgentMemoryScope;
  can_access_global_memory: boolean;
  private_mode?: boolean;
  loop_enabled?: boolean;
  loop_interval_minutes?: number;
  loop_prompt?: string;
  channel_id?: string;
  channel_name?: string;
  platform_channels?: Record<string, string[]>;
  allowed_users?: string[];
  allowed_conversations?: string[];
  tags?: string[];
  exported_at: string;
}

// ── Validation ─────────────────────────────────────────────────────────────────

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const VALID_ROLES = [
  "coach", "researcher", "coder", "writer", "analyst",
  "scheduler", "support", "security", "devops", "custom",
];
const VALID_PLATFORMS = ["discord", "telegram", "web", "api", "council"];
const VALID_SCOPES: AgentMemoryScope[] = ["agent_private", "shared", "global"];

export function validateAgentConfig(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!raw || typeof raw !== "object") {
    return { ok: false, errors: ["Config must be a JSON object"], warnings: [] };
  }

  const config = raw as Record<string, unknown>;

  // Required fields
  if (!config.name || typeof config.name !== "string" || !config.name.trim()) {
    errors.push("'name' is required and must be a non-empty string");
  } else if (config.name.length > 64) {
    errors.push("'name' must be ≤ 64 characters");
  }

  if (!config.role || typeof config.role !== "string") {
    errors.push("'role' is required");
  } else if (!VALID_ROLES.includes(config.role as string)) {
    warnings.push(`'role' "${config.role}" is not a standard role. Standard roles: ${VALID_ROLES.join(", ")}`);
  }

  // Platforms
  if (config.platforms !== undefined) {
    if (!Array.isArray(config.platforms)) {
      errors.push("'platforms' must be an array");
    } else {
      for (const p of config.platforms as string[]) {
        if (!VALID_PLATFORMS.includes(p)) {
          warnings.push(`Unknown platform: "${p}". Valid platforms: ${VALID_PLATFORMS.join(", ")}`);
        }
      }
    }
  }

  // Permissions
  if (config.permissions !== undefined) {
    if (typeof config.permissions !== "object" || Array.isArray(config.permissions)) {
      errors.push("'permissions' must be an object");
    } else {
      const perms = config.permissions as Record<string, unknown>;
      const validFlags = Object.keys(DEFAULT_AGENT_PERMISSIONS);
      for (const key of Object.keys(perms)) {
        if (!validFlags.includes(key)) {
          warnings.push(`Unknown permission flag: "${key}"`);
        } else if (typeof perms[key] !== "boolean") {
          errors.push(`Permission flag "${key}" must be a boolean`);
        }
      }
    }
  }

  // Memory scope
  if (config.memory_scope !== undefined && !VALID_SCOPES.includes(config.memory_scope as AgentMemoryScope)) {
    errors.push(`'memory_scope' must be one of: ${VALID_SCOPES.join(", ")}`);
  }

  // Numeric fields
  if (config.loop_interval_minutes !== undefined) {
    const n = Number(config.loop_interval_minutes);
    if (isNaN(n) || n < 1 || n > 10080) {
      errors.push("'loop_interval_minutes' must be between 1 and 10080 (1 week)");
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

// ── Export ─────────────────────────────────────────────────────────────────────

import type { DiscordAgent } from "@shared/schema";

export function exportAgentConfig(agent: DiscordAgent): AgentConfigFile {
  return {
    version: "1",
    name: agent.name,
    role: agent.role,
    personality_prompt: agent.persona ?? undefined,
    platforms: (agent.platforms as string[]) ?? ["discord"],
    permissions: ((agent.permissions as AgentPermissions) ?? DEFAULT_AGENT_PERMISSIONS),
    memory_scope: (agent.memoryScope as AgentMemoryScope) ?? "agent_private",
    can_access_global_memory: Boolean(agent.accessGlobalMemory),
    private_mode: Boolean(agent.privateMode),
    loop_enabled: agent.loopEnabled === 1,
    loop_interval_minutes: agent.loopIntervalMinutes ?? 60,
    loop_prompt: agent.loopPrompt ?? undefined,
    channel_id: agent.channelId ?? undefined,
    channel_name: agent.channelName ?? undefined,
    platform_channels: (agent.platformChannels as Record<string, string[]>) ?? undefined,
    allowed_users: (agent.allowedUsers as string[]) ?? [],
    allowed_conversations: (agent.allowedConversations as string[]) ?? [],
    exported_at: new Date().toISOString(),
  };
}

// ── Import helpers ─────────────────────────────────────────────────────────────

export function importConfigToCreateArgs(config: AgentConfigFile) {
  return {
    name: config.name.trim(),
    role: config.role,
    persona: config.personality_prompt,
    platforms: config.platforms ?? ["discord"],
    permissions: config.permissions,
    memoryScope: config.memory_scope ?? "agent_private",
    accessGlobalMemory: config.can_access_global_memory ?? false,
    privateMode: config.private_mode ?? false,
    loopEnabled: config.loop_enabled ?? false,
    loopIntervalMinutes: config.loop_interval_minutes ?? 60,
    loopPrompt: config.loop_prompt,
    channelId: config.channel_id,
    channelName: config.channel_name,
    platformChannels: config.platform_channels,
    configJson: config as unknown as Record<string, unknown>,
  };
}
