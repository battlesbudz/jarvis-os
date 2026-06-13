type TaskOrderingItem = {
  title: string;
  completed: boolean;
  priority: "high" | "medium" | "low";
};

export function isLikelyQuick(title: string): boolean {
  const quickWords = /\b(quick|fast|brief|small|simple|easy|check|read|reply|send|call|text|ping|remind|look up|google|note)\b/i;
  return quickWords.test(title);
}

function countLeadingQuickWins<T extends TaskOrderingItem>(tasks: T[]): number {
  let count = 0;
  for (const t of tasks) {
    if (isLikelyQuick(t.title)) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

function findLastHighMedIndex<T extends TaskOrderingItem>(tasks: T[]): number {
  let idx = -1;
  for (let i = 0; i < tasks.length; i++) {
    if (tasks[i].priority === "high" || tasks[i].priority === "medium") {
      idx = i;
    }
  }
  return idx;
}

export function insertTaskAtOptimalPosition<T extends TaskOrderingItem>(
  tasks: T[],
  newTask: T,
  energyLevel?: number,
): T[] {
  const incomplete = tasks.filter((t) => !t.completed);
  const completed = tasks.filter((t) => t.completed);

  const isQuickWin = isLikelyQuick(newTask.title);
  const isHighPriority = newTask.priority === "high";
  const isLowPriority = newTask.priority === "low";
  const isLowEnergy = (energyLevel ?? 3) <= 2;

  if (isLowEnergy) {
    if (isQuickWin || isLowPriority) {
      return [newTask, ...incomplete, ...completed];
    }
    return [...incomplete, newTask, ...completed];
  }

  if (isQuickWin) {
    return [newTask, ...incomplete, ...completed];
  }
  if (isHighPriority) {
    const quickWinCount = countLeadingQuickWins(incomplete);
    return [
      ...incomplete.slice(0, quickWinCount),
      newTask,
      ...incomplete.slice(quickWinCount),
      ...completed,
    ];
  }
  if (isLowPriority) {
    return [...incomplete, newTask, ...completed];
  }
  const lastHighMedIdx = findLastHighMedIndex(incomplete);
  return [
    ...incomplete.slice(0, lastHighMedIdx + 1),
    newTask,
    ...incomplete.slice(lastHighMedIdx + 1),
    ...completed,
  ];
}

export function sortTasksByEnergy<T extends TaskOrderingItem>(tasks: T[], energyLevel: number): T[] {
  const incomplete = tasks.filter((t) => !t.completed);
  const completed = tasks.filter((t) => t.completed);

  if (energyLevel <= 2) {
    return [
      ...incomplete.filter((t) => t.priority === "low" || isLikelyQuick(t.title)),
      ...incomplete.filter((t) => t.priority === "medium" && !isLikelyQuick(t.title)),
      ...incomplete.filter((t) => t.priority === "high" && !isLikelyQuick(t.title)),
      ...completed,
    ];
  }
  const quickWins = incomplete.filter((t) => isLikelyQuick(t.title));
  const rest = incomplete.filter((t) => !isLikelyQuick(t.title));
  return [
    ...quickWins,
    ...rest.filter((t) => t.priority === "high"),
    ...rest.filter((t) => t.priority === "medium"),
    ...rest.filter((t) => t.priority === "low"),
    ...completed,
  ];
}
