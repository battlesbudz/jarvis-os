/**
 * Jarvis Activation Planner — Control Plane
 *
 * Runs before each heartbeat tick and channel session. Reads Foresight
 * predictions, emotional state, active skill packs, and time-of-day to
 * produce a CapabilityManifest and SessionContext that tell the harness
 * exactly what to focus on for this tick or session.
 *
 * Returns a `shouldRun` flag so the heartbeat can skip a full model
 * session when no actionable context is found, reducing idle cost.
 */

import { db } from "../db";
import { eq, desc } from "drizzle-orm";
import * as schema from "@shared/schema";
import { getTodayPredictions } from "../intelligence/predictor";
import type { EmotionalState } from "../intelligence/emotional-state";

// ─── Exported types ───────────────────────────────────────────────────────────

/**
 * Describes which capability groups were activated or suppressed for a
 * session, and the plain-language reasons behind each decision.
 */
export interface CapabilityManifest {
  /** Capability IDs (from capabilityRegistry) that are active for this session. */
  activeCapabilityIds: string[];
  /** Capability IDs that were explicitly suppressed by a planner rule. */
  suppressedCapabilityIds: string[];
  /**
   * Consolidated set of tool groups the active capabilities contribute.
   * Derived from `activeCapabilityIds` × `cap.toolGroups`.
   */
  activatedToolGroups: string[];
  /**
   * Plain-language explanation for each capability activation / suppression.
   * Keys are capability IDs; values are the rule that triggered the decision.
   * Developer-facing only — used for debugging and a future admin view.
   */
  reasons: Record<string, string>;
}

/** Structured summary of what Jarvis should focus on for this tick or session. */
export interface SessionContext {
  /** High-level focus areas derived from predictions + emotional state. */
  focusAreas: string[];
  /**
   * Urgent signals that should be surfaced proactively (energy dip incoming,
   * overdue reply, project stalling, etc.).
   */
  urgentSignals: string[];
  /** The user's current emotional state snapshot, or null if unavailable. */
  energyState: {
    stressScore: number;
    flowScore: number;
    label: string;
  } | null;
  /** Top Foresight predictions for today (human-readable). */
  topPredictions: Array<{
    type: string;
    humanReadable: string;
    actionSuggestion: string | null;
    confidenceScore: number;
  }>;
  /** Broad bucket of the current local hour. */
  timeOfDay: "morning" | "afternoon" | "evening" | "night";
  /** User's local date key (YYYY-MM-DD). */
  dateKey: string;
  /** Number of active skill packs loaded for this user. */
  activeSkillCount: number;
}

/**
 * The complete output of the planner. Callers (heartbeat, channel handlers,
 * harness) consume this to decide what to load and whether to run at all.
 */
export interface ActivationPlan {
  capabilityManifest: CapabilityManifest;
  sessionContext: SessionContext;
  /**
   * When false the caller should skip spinning up a full model session.
   * All non-LLM background tasks (emotional state, gut scan, memory pass,
   * prediction validation) MUST still run even when shouldRun is false.
   */
  shouldRun: boolean;
  /**
   * Plain-language summary of why shouldRun was set to false (or why the
   * session was activated). Developer-facing only.
   */
  reason: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function localHour(now: Date, tz: string): number {
  return new Date(now.toLocaleString("en-US", { timeZone: tz })).getHours();
}

function localDateKey(now: Date, tz: string): string {
  const d = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function hourToTimeOfDay(hour: number): SessionContext["timeOfDay"] {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

// ─── ActivationPlanner ────────────────────────────────────────────────────────

export class ActivationPlanner {
  /**
   * Run the planner for a given user + optional channel.
   *
   * @param userId   The user to plan for.
   * @param channel  Optional channel name (e.g. "Telegram", "Discord #research").
   *                 When provided it is logged for observability but does not
   *                 currently gate capability decisions (channel scoping is the
   *                 harness's responsibility).
   * @param timezone Optional timezone override. When omitted the planner reads
   *                 the user's stored preference.
   */
  async plan(
    userId: string,
    channel?: string,
    timezone?: string,
  ): Promise<ActivationPlan> {
    const now = new Date();
    const tz = timezone ?? (await this.resolveTimezone(userId));
    const hour = localHour(now, tz);
    const dateKey = localDateKey(now, tz);
    const timeOfDay = hourToTimeOfDay(hour);

    // ── 1. Gather signals in parallel ─────────────────────────────────────
    const [emotionalStateRow, predictions, skillCount] = await Promise.all([
      this.fetchEmotionalState(userId),
      this.fetchPredictions(userId, dateKey),
      this.fetchSkillCount(userId),
    ]);

    // ── 2. Build session context ───────────────────────────────────────────
    const sessionContext = this.buildSessionContext({
      emotionalStateRow,
      predictions,
      skillCount,
      timeOfDay,
      dateKey,
    });

    // ── 3. Apply priority-ordered planning rules ───────────────────────────
    return this.applyRules({ sessionContext, timeOfDay, predictions, emotionalStateRow, channel });
  }

  // ── Signal fetchers ───────────────────────────────────────────────────────

  private async resolveTimezone(userId: string): Promise<string> {
    try {
      const rows = await db
        .select({ data: schema.userPreferences.data })
        .from(schema.userPreferences)
        .where(eq(schema.userPreferences.userId, userId))
        .limit(1);
      const prefs = (rows[0]?.data as { timezone?: string }) || {};
      return prefs.timezone || "America/New_York";
    } catch {
      return "America/New_York";
    }
  }

  private async fetchEmotionalState(
    userId: string,
  ): Promise<typeof schema.userEmotionalState.$inferSelect | null> {
    try {
      const rows = await db
        .select()
        .from(schema.userEmotionalState)
        .where(eq(schema.userEmotionalState.userId, userId))
        .limit(1);
      return rows[0] ?? null;
    } catch {
      return null;
    }
  }

  private async fetchPredictions(
    userId: string,
    dateKey: string,
  ): Promise<schema.JarvisPrediction[]> {
    try {
      return await getTodayPredictions(userId, dateKey, 55);
    } catch {
      return [];
    }
  }

  private async fetchSkillCount(userId: string): Promise<number> {
    try {
      const { loadUserSkills } = await import("../intelligence/skillWriter");
      const skills = await loadUserSkills(userId);
      return skills.length;
    } catch {
      return 0;
    }
  }

  // ── Session context builder ───────────────────────────────────────────────

  private buildSessionContext(opts: {
    emotionalStateRow: typeof schema.userEmotionalState.$inferSelect | null;
    predictions: schema.JarvisPrediction[];
    skillCount: number;
    timeOfDay: SessionContext["timeOfDay"];
    dateKey: string;
  }): SessionContext {
    const { emotionalStateRow, predictions, skillCount, timeOfDay, dateKey } = opts;

    const focusAreas: string[] = [];
    const urgentSignals: string[] = [];

    // Energy state
    const energyState = emotionalStateRow
      ? {
          stressScore: emotionalStateRow.stressScore,
          flowScore: emotionalStateRow.flowScore,
          label: emotionalStateRow.label,
        }
      : null;

    if (emotionalStateRow) {
      if (emotionalStateRow.stressScore >= 7) {
        urgentSignals.push(`High stress detected (score: ${emotionalStateRow.stressScore}/10)`);
        focusAreas.push("stress management");
      } else if (emotionalStateRow.flowScore >= 7) {
        focusAreas.push("deep work — user is in flow state");
      } else if (emotionalStateRow.label) {
        focusAreas.push(`user state: ${emotionalStateRow.label}`);
      }
    }

    // Predictions
    const topPredictions = predictions.slice(0, 3).map((p) => ({
      type: p.predictionType,
      humanReadable: p.humanReadable,
      actionSuggestion: p.actionSuggestion ?? null,
      confidenceScore: p.confidenceScore,
    }));

    for (const p of predictions) {
      switch (p.predictionType) {
        case "energy_dip":
          urgentSignals.push(`Energy dip predicted (${p.confidenceScore}% confidence)`);
          focusAreas.push("schedule lighter tasks around predicted dip");
          break;
        case "procrastination_risk":
          urgentSignals.push("Procrastination risk flagged for today");
          focusAreas.push("task accountability");
          break;
        case "email_overdue":
          urgentSignals.push(`Overdue email reply detected (${p.confidenceScore}% confidence)`);
          focusAreas.push("email follow-up");
          break;
        case "project_stall":
          urgentSignals.push(`Project stall risk detected (${p.confidenceScore}% confidence)`);
          focusAreas.push("goal progress review");
          break;
      }
    }

    // Time-of-day focus
    switch (timeOfDay) {
      case "morning":
        focusAreas.push("morning planning");
        break;
      case "evening":
        focusAreas.push("evening wrap-up");
        break;
      case "night":
        // No additional focus for night — planner will likely set shouldRun: false
        break;
    }

    return {
      focusAreas: [...new Set(focusAreas)],
      urgentSignals: [...new Set(urgentSignals)],
      energyState,
      topPredictions,
      timeOfDay,
      dateKey,
      activeSkillCount: skillCount,
    };
  }

  // ── Rule engine ───────────────────────────────────────────────────────────

  private applyRules(opts: {
    sessionContext: SessionContext;
    timeOfDay: SessionContext["timeOfDay"];
    predictions: schema.JarvisPrediction[];
    emotionalStateRow: typeof schema.userEmotionalState.$inferSelect | null;
    channel?: string;
  }): ActivationPlan {
    const { sessionContext, timeOfDay, predictions, emotionalStateRow, channel } = opts;

    const reasons: Record<string, string> = {};
    const activeCapabilityIds: string[] = [];
    const suppressedCapabilityIds: string[] = [];

    const hasUrgentSignals = sessionContext.urgentSignals.length > 0;
    const hasEveningWork = timeOfDay === "evening";
    const isChannelSession = !!channel;

    // ── Rule 1: Night-time with no urgent signals → skip model session ─────
    // Channel sessions always run (user explicitly sent a message).
    if (timeOfDay === "night" && !hasUrgentSignals && !isChannelSession) {
      return {
        capabilityManifest: this.buildManifest(
          activeCapabilityIds,
          suppressedCapabilityIds,
          reasons,
        ),
        sessionContext,
        shouldRun: false,
        reason:
          "Night-time hours (0–4am local) with no urgent signals — skipping model session to reduce idle cost",
      };
    }

    // ── Rule 2: High stress → activate coaching, suppress heavy compute ────
    if (emotionalStateRow && emotionalStateRow.stressScore >= 7) {
      activeCapabilityIds.push("coaching", "memory");
      suppressedCapabilityIds.push("browser", "discord");
      reasons["coaching"] =
        `Activated: user stress score is ${emotionalStateRow.stressScore}/10 (overwhelmed)`;
      reasons["memory"] =
        "Activated: memory context needed for personalised support during high-stress state";
      reasons["browser"] =
        "Suppressed: heavy compute capabilities disabled during high-stress to keep session lightweight";
      reasons["discord"] =
        "Suppressed: async/community tools deprioritised when user is stressed";
    }

    // ── Rule 3: Energy dip prediction → coaching + scheduling awareness ────
    const energyDipPred = predictions.find((p) => p.predictionType === "energy_dip");
    if (energyDipPred) {
      if (!activeCapabilityIds.includes("coaching")) activeCapabilityIds.push("coaching");
      if (!activeCapabilityIds.includes("calendar")) activeCapabilityIds.push("calendar");
      reasons["coaching"] =
        reasons["coaching"] ||
        `Activated: energy dip predicted at ${energyDipPred.confidenceScore}% confidence`;
      reasons["calendar"] =
        "Activated: calendar access needed to reschedule tasks around predicted energy dip";
    }

    // ── Rule 4: Email overdue → activate email capabilities ────────────────
    const emailPred = predictions.find((p) => p.predictionType === "email_overdue");
    if (emailPred) {
      if (!activeCapabilityIds.includes("email")) activeCapabilityIds.push("email");
      reasons["email"] =
        `Activated: overdue email reply detected (${emailPred.confidenceScore}% confidence)`;
    }

    // ── Rule 5: Project stall → activate coaching + goal-related tools ─────
    const stallPred = predictions.find((p) => p.predictionType === "project_stall");
    if (stallPred) {
      if (!activeCapabilityIds.includes("coaching")) activeCapabilityIds.push("coaching");
      if (!activeCapabilityIds.includes("memory")) activeCapabilityIds.push("memory");
      reasons["coaching"] =
        reasons["coaching"] ||
        `Activated: project stall risk at ${stallPred.confidenceScore}% confidence`;
      reasons["memory"] =
        reasons["memory"] ||
        "Activated: memory needed to reference goal context";
    }

    // ── Rule 6: Evening work → wrap-up capabilities ────────────────────────
    if (hasEveningWork || isChannelSession) {
      if (!activeCapabilityIds.includes("coaching")) activeCapabilityIds.push("coaching");
      reasons["coaching"] = reasons["coaching"] || "Activated: evening wrap-up context";
    }

    // ── Rule 7: Morning → planning capabilities ────────────────────────────
    if (timeOfDay === "morning" || isChannelSession) {
      if (!activeCapabilityIds.includes("coaching")) activeCapabilityIds.push("coaching");
      if (!activeCapabilityIds.includes("calendar")) activeCapabilityIds.push("calendar");
      reasons["coaching"] = reasons["coaching"] || "Activated: morning planning context";
      reasons["calendar"] =
        reasons["calendar"] || "Activated: calendar context for morning briefing";
    }

    // ── Rule 8: Channel sessions always have full capability access ────────
    // The channel-scope tool filter in the harness is the authoritative gate;
    // the planner's manifest is advisory context, not an exclusion list.
    if (isChannelSession) {
      for (const id of [
        "coaching",
        "calendar",
        "email",
        "research",
        "memory",
        "connections",
        "scheduling",
        "system",
        "media",
        "drive",
      ]) {
        if (!activeCapabilityIds.includes(id) && !suppressedCapabilityIds.includes(id)) {
          activeCapabilityIds.push(id);
          reasons[id] = "Activated: channel session — full context available";
        }
      }
    }

    // ── Rule 9: No actionable signals in off-peak hours → shouldRun: false ─
    // Only applies to heartbeat ticks (not channel sessions).
    if (!isChannelSession && !hasUrgentSignals && timeOfDay === "afternoon" && activeCapabilityIds.length === 0) {
      return {
        capabilityManifest: this.buildManifest(
          activeCapabilityIds,
          suppressedCapabilityIds,
          reasons,
        ),
        sessionContext,
        shouldRun: false,
        reason:
          "No actionable signals found during off-peak hours — skipping model session",
      };
    }

    const manifest = this.buildManifest(activeCapabilityIds, suppressedCapabilityIds, reasons);
    const hasSomethingToDo =
      hasUrgentSignals ||
      isChannelSession ||
      activeCapabilityIds.length > 0 ||
      hasEveningWork;

    const reason = hasSomethingToDo
      ? `Session activated: ${sessionContext.focusAreas.slice(0, 2).join(", ") || timeOfDay + " context"}`
      : "No actionable context — heartbeat tick can be skipped";

    return {
      capabilityManifest: manifest,
      sessionContext,
      shouldRun: hasSomethingToDo,
      reason,
    };
  }

  // ── Manifest builder ──────────────────────────────────────────────────────

  private buildManifest(
    activeCapabilityIds: string[],
    suppressedCapabilityIds: string[],
    reasons: Record<string, string>,
  ): CapabilityManifest {
    // Derive activatedToolGroups lazily from the registry without blocking
    // (registry may not be fully loaded in some test contexts).
    let activatedToolGroups: string[] = [];
    try {
      const { capabilityRegistry } = require("../capabilities/index") as {
        capabilityRegistry: { getById: (id: string) => { toolGroups: string[] } | undefined };
      };
      const groups = new Set<string>();
      for (const id of activeCapabilityIds) {
        const cap = capabilityRegistry.getById(id);
        if (cap) {
          for (const g of cap.toolGroups) groups.add(g);
        }
      }
      activatedToolGroups = Array.from(groups);
    } catch {
      // Best-effort — registry import may not be available in all contexts
    }

    return {
      activeCapabilityIds: [...new Set(activeCapabilityIds)],
      suppressedCapabilityIds: [...new Set(suppressedCapabilityIds)],
      activatedToolGroups,
      reasons,
    };
  }
}

/** Singleton instance — shared across heartbeat and channel handlers. */
export const activationPlanner = new ActivationPlanner();
