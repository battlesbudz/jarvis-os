import assert from "node:assert/strict";
import { calculateGoalPacing, normalizeGoalPacingMode } from "../../goalPacing";

function run(): void {
  assert.equal(normalizeGoalPacingMode("light"), "light");
  assert.equal(normalizeGoalPacingMode("ambitious"), "ambitious");
  assert.equal(normalizeGoalPacingMode("unknown"), "balanced");

  const lowCompletion = calculateGoalPacing({
    completionRate: 0.4,
    energyLevel: 5,
    mode: "ambitious",
  });
  assert.equal(lowCompletion.dailyCap, 1);
  assert.ok(lowCompletion.reasons.some((r) => r.includes("completion")));

  const lowEnergy = calculateGoalPacing({
    completionRate: 0.9,
    energyLevel: 2,
    mode: "ambitious",
  });
  assert.equal(lowEnergy.dailyCap, 1);
  assert.ok(lowEnergy.reasons.some((r) => r.includes("energy")));

  const balancedHighEnergy = calculateGoalPacing({
    completionRate: 0.8,
    energyLevel: 4,
    mode: "balanced",
  });
  assert.equal(balancedHighEnergy.dailyCap, 3);

  const lightMode = calculateGoalPacing({
    completionRate: 0.95,
    energyLevel: 5,
    mode: "light",
  });
  assert.equal(lightMode.dailyCap, 1);
  assert.ok(lightMode.reasons.some((r) => r.includes("Light")));

  const lowHistoricalEnergy = calculateGoalPacing({
    completionRate: 0.85,
    recentEnergyLevels: [2, 2, 3, 2],
    mode: "ambitious",
  });
  assert.equal(lowHistoricalEnergy.dailyCap, 1);
  assert.equal(lowHistoricalEnergy.historicalEnergyAverage, 2.25);
  assert.ok(lowHistoricalEnergy.reasons.some((r) => r.includes("Recent energy pattern")));

  const strongHistoricalEnergy = calculateGoalPacing({
    completionRate: 0.85,
    recentEnergyLevels: [4, 5, 4, 5],
    mode: "balanced",
  });
  assert.equal(strongHistoricalEnergy.dailyCap, 3);
  assert.equal(strongHistoricalEnergy.energyLevel, null);
  assert.equal(strongHistoricalEnergy.historicalEnergyAverage, 4.5);
  assert.ok(strongHistoricalEnergy.reasons.some((r) => r.includes("historically strong")));

  const heavyWorkload = calculateGoalPacing({
    completionRate: 0.9,
    energyLevel: 5,
    existingPlanTaskCount: 6,
    mode: "ambitious",
  });
  assert.equal(heavyWorkload.dailyCap, 1);
  assert.equal(heavyWorkload.workloadTaskCount, 6);
  assert.ok(heavyWorkload.reasons.some((r) => r.includes("already has 6 tasks")));

  const weakWeekday = calculateGoalPacing({
    completionRate: 0.9,
    energyLevel: 5,
    weekdayCompletionRate: 0.35,
    mode: "ambitious",
  });
  assert.equal(weakWeekday.dailyCap, 1);
  assert.equal(weakWeekday.weekdayCompletionRate, 0.35);
  assert.ok(weakWeekday.reasons.some((r) => r.includes("this weekday")));

  const packedCalendar = calculateGoalPacing({
    completionRate: 0.9,
    energyLevel: 5,
    calendarBusyMinutes: 390,
    mode: "ambitious",
  });
  assert.equal(packedCalendar.dailyCap, 1);
  assert.equal(packedCalendar.calendarBusyMinutes, 390);
  assert.ok(packedCalendar.reasons.some((r) => r.includes("calendar is packed")));

  const closeDeadline = calculateGoalPacing({
    completionRate: 0.85,
    energyLevel: 4,
    nearestDeadlineDays: 1,
    mode: "balanced",
  });
  assert.equal(closeDeadline.dailyCap, 3);
  assert.equal(closeDeadline.nearestDeadlineDays, 1);
  assert.ok(closeDeadline.reasons.some((r) => r.includes("deadline")));

  console.log("All goal pacing assertions passed.");
}

run();
