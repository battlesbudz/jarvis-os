/**
 * AgentConfigSchema — Zod-validated JSON import/export schema for agent configs.
 *
 * Agents can be exported to JSON and imported back, enabling sharing and
 * version control of agent configurations.
 *
 * The schema is also used to validate configs submitted via the REST API.
 */
import { z } from "zod";
import type { AgentPermissions, AgentMemoryScope } from "@shared/schema";
import { DEFAULT_AGENT_PERMISSIONS } from "@shared/schema";
import type { DiscordAgent } from "@shared/schema";

// ── Zod schema for agent permissions ──────────────────────────────────────────

export const AgentPermissionsSchema = z.object({
  can_search_web: z.boolean().default(true),
  can_use_browser: z.boolean().default(false),
  can_send_emails: z.boolean().default(false),
  can_create_email_drafts: z.boolean().default(false),
  can_read_email: z.boolean().default(false),
  can_send_messages: z.boolean().default(true),
  can_access_files: z.boolean().default(false),
  can_take_screenshots: z.boolean().default(false),
  can_open_apps: z.boolean().default(false),
  can_call_user: z.boolean().default(false),
  can_use_voice: z.boolean().default(false),
  can_create_tasks: z.boolean().default(true),
  can_create_other_agents: z.boolean().default(false),
  can_access_global_memory: z.boolean().default(false),
});

// ── Zod schema for agent config file ──────────────────────────────────────────

const VALID_ROLES = [
  "coach", "researcher", "coder", "writer", "analyst",
  "scheduler", "support", "security", "devops", "custom",
] as const;

const VALID_PLATFORMS = ["discord", "telegram", "web", "api", "council"] as const;
const VALID_SCOPES = ["agent_private", "shared", "global"] as const;

export const AgentConfigFileSchema = z.object({
  version: z.literal("1"),
  name: z
    .string()
    .min(1, "name is required")
    .max(64, "name must be ≤ 64 characters")
    .refine((v) => v.trim().length > 0, "name must not be blank"),
  role: z
    .string()
    .min(1, "role is required"),
  personality_prompt: z.string().optional(),
  platforms: z
    .array(z.string())
    .default(["discord"])
    .refine(
      (arr) => arr.every((p) => (VALID_PLATFORMS as readonly string[]).includes(p)),
      { message: `platforms must only contain: ${VALID_PLATFORMS.join(", ")}` },
    ),
  permissions: AgentPermissionsSchema.default(DEFAULT_AGENT_PERMISSIONS),
  memory_scope: z.enum(VALID_SCOPES).default("agent_private"),
  can_access_global_memory: z.boolean().default(false),
  private_mode: z.boolean().optional().default(false),
  loop_enabled: z.boolean().optional().default(false),
  loop_interval_minutes: z
    .number()
    .int()
    .min(1, "loop_interval_minutes must be ≥ 1")
    .max(10080, "loop_interval_minutes must be ≤ 10080 (1 week)")
    .optional(),
  loop_prompt: z.string().optional(),
  channel_id: z.string().optional(),
  channel_name: z.string().optional(),
  platform_channels: z.record(z.array(z.string())).optional(),
  allowed_users: z.array(z.string()).optional().default([]),
  allowed_conversations: z.array(z.string()).optional().default([]),
  tags: z.array(z.string()).optional(),
  /**
   * Optional TTS voice persona for this agent.
   * When set, the agent's auto-TTS replies use this voice instead of the user's
   * global preference. Accepts OpenAI voice IDs (alloy, echo, fable, onyx,
   * nova, shimmer) or an ElevenLabs voice ID / name.
   */
  tts_voice: z.string().optional(),
  exported_at: z.string().datetime({ message: "exported_at must be a valid ISO 8601 datetime" }),
});

export type AgentConfigFile = z.infer<typeof AgentConfigFileSchema>;

// ── Validation ─────────────────────────────────────────────────────────────────

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function validateAgentConfig(raw: unknown): ValidationResult {
  const result = AgentConfigFileSchema.safeParse(raw);
  if (result.success) {
    const warnings: string[] = [];
    const data = raw as Record<string, unknown>;

    // Warn on non-standard roles (not hard errors)
    if (
      data.role &&
      typeof data.role === "string" &&
      !(VALID_ROLES as readonly string[]).includes(data.role)
    ) {
      warnings.push(
        `'role' "${data.role}" is not a standard role. Standard roles: ${VALID_ROLES.join(", ")}`,
      );
    }

    return { ok: true, errors: [], warnings };
  }

  // Map Zod issues to error strings
  const errors = result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `'${issue.path.join(".")}': ` : "";
    return `${path}${issue.message}`;
  });
  return { ok: false, errors, warnings: [] };
}

// ── Export ─────────────────────────────────────────────────────────────────────

export function exportAgentConfig(agent: DiscordAgent): AgentConfigFile {
  const configJson = (agent.configJson ?? {}) as Record<string, unknown>;
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
    tts_voice: typeof configJson.tts_voice === "string" ? configJson.tts_voice : undefined,
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
