export type GoalPacingMode = "light" | "balanced" | "ambitious";

export interface GoalPacingInput {
  completionRate: number;
  energyLevel?: number;
  recentEnergyLevels?: number[];
  existingPlanTaskCount?: number;
  weekdayCompletionRate?: number;
  calendarBusyMinutes?: number;
  nearestDeadlineDays?: number;
  mode?: GoalPacingMode;
}

export interface GoalPacingDecision {
  mode: GoalPacingMode;
  dailyCap: number;
  completionRate: number;
  energyLevel: number | null;
  historicalEnergyAverage: number | null;
  workloadTaskCount: number;
  weekdayCompletionRate: number | null;
  calendarBusyMinutes: number;
  nearestDeadlineDays: number | null;
  reasons: string[];
}

const MODE_CAP: Record<GoalPacingMode, number> = {
  light: 1,
  balanced: 2,
  ambitious: 3,
};

export function normalizeGoalPacingMode(value: unknown): GoalPacingMode {
  return value === "light" || value === "balanced" || value === "ambitious"
    ? value
    : "balanced";
}

function clampRate(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

function normalizeCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function normalizeMinutes(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function normalizeDeadlineDays(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
}

function normalizeEnergy(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(1, Math.min(5, Math.round(value)));
}

function averageEnergy(values: unknown): number | null {
  if (!Array.isArray(values)) return null;
  const normalized = values
    .map(normalizeEnergy)
    .filter((value): value is number => value !== null);
  if (normalized.length === 0) return null;
  const average = normalized.reduce((sum, value) => sum + value, 0) / normalized.length;
  return Math.round(average * 100) / 100;
}

export function calculateGoalPacing(input: GoalPacingInput): GoalPacingDecision {
  const mode = normalizeGoalPacingMode(input.mode);
  const completionRate = clampRate(input.completionRate);
  const energyLevel = normalizeEnergy(input.energyLevel);
  const historicalEnergyAverage = averageEnergy(input.recentEnergyLevels);
  const workloadTaskCount = normalizeCount(input.existingPlanTaskCount);
  const weekdayCompletionRate =
    typeof input.weekdayCompletionRate === "number" && Number.isFinite(input.weekdayCompletionRate)
      ? clampRate(input.weekdayCompletionRate)
      : null;
  const calendarBusyMinutes = normalizeMinutes(input.calendarBusyMinutes);
  const nearestDeadlineDays = normalizeDeadlineDays(input.nearestDeadlineDays);
  const reasons: string[] = [];
  let dailyCap = MODE_CAP[mode];

  if (mode === "light") {
    reasons.push("Light mode keeps goal-tree handoff to one task.");
  } else if (mode === "ambitious") {
    reasons.push("Ambitious mode can surface up to three goal tasks.");
  } else {
    reasons.push("Balanced mode starts with two goal tasks.");
  }

  if (completionRate < 0.5) {
    dailyCap = 1;
    reasons.push("Recent completion is below 50%, so Jarvis lowers goal pressure.");
  } else if (
    completionRate >= 0.75 &&
    (energyLevel !== null ? energyLevel >= 4 : historicalEnergyAverage !== null && historicalEnergyAverage >= 4) &&
    mode === "balanced"
  ) {
    dailyCap = 3;
    reasons.push(
      energyLevel !== null
        ? "Strong recent completion plus high energy allows one extra goal task."
        : "Strong recent completion plus historically strong energy allows one extra goal task.",
    );
  }

  if (energyLevel !== null && energyLevel <= 2) {
    dailyCap = 1;
    reasons.push("Today's energy is low, so Jarvis keeps goals light.");
  } else if (energyLevel === null && historicalEnergyAverage !== null && historicalEnergyAverage <= 2.5) {
    dailyCap = 1;
    reasons.push("Recent energy pattern is low, so Jarvis keeps goals light.");
  }

  if (workloadTaskCount >= 6) {
    dailyCap = 1;
    reasons.push(`Today's plan already has ${workloadTaskCount} tasks, so Jarvis keeps goals light.`);
  } else if (workloadTaskCount >= 4 && dailyCap > 2) {
    dailyCap = 2;
    reasons.push(`Today's plan already has ${workloadTaskCount} tasks, so Jarvis avoids extra goal pressure.`);
  }

  if (weekdayCompletionRate !== null && weekdayCompletionRate < 0.5) {
    dailyCap = 1;
    reasons.push("Your completion pattern for this weekday is low, so Jarvis keeps goals light.");
  }

  if (nearestDeadlineDays !== null && nearestDeadlineDays <= 2 && mode !== "light") {
    if (dailyCap < 3) dailyCap += 1;
    reasons.push("A goal deadline is close, so Jarvis adds one focused goal task if capacity allows.");
  }

  if (calendarBusyMinutes >= 360) {
    dailyCap = 1;
    reasons.push("Today's calendar is packed, so Jarvis keeps goal tasks to one.");
  } else if (calendarBusyMinutes >= 240 && dailyCap > 2) {
    dailyCap = 2;
    reasons.push("Today's calendar has several hours booked, so Jarvis avoids extra goal pressure.");
  }

  return {
    mode,
    dailyCap: Math.max(1, Math.min(3, dailyCap)),
    completionRate,
    energyLevel,
    historicalEnergyAverage,
    workloadTaskCount,
    weekdayCompletionRate,
    calendarBusyMinutes,
    nearestDeadlineDays,
    reasons,
  };
}
