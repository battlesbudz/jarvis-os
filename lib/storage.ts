import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Task {
  id: string;
  title: string;
  category: 'calendar' | 'fitness' | 'finance' | 'career' | 'personal' | 'social';
  completed: boolean;
  priority: 'high' | 'medium' | 'low';
  time?: string;
  description?: string;
  subtasks?: Task[];
  isSubtask?: boolean;
  parentId?: string;
  goalId?: string;
}

export interface DayPlan {
  date: string;
  tasks: Task[];
  greeting: string;
  insight: string;
}

export interface Goal {
  id: string;
  title: string;
  category: 'fitness' | 'finance' | 'career' | 'personal' | 'social';
  target: number;
  current: number;
  unit: string;
  createdAt: string;
}

export interface Suggestion {
  id: string;
  title: string;
  description: string;
  category: 'activity' | 'date_night' | 'finance' | 'career' | 'wellness';
  icon: string;
  actionLabel: string;
}

export interface ConnectedPlatform {
  id: string;
  name: string;
  category: 'calendar' | 'fitness' | 'finance' | 'social';
  connected: boolean;
  icon: string;
}

export interface UserStats {
  streak: number;
  totalCompleted: number;
  bestStreak: number;
  xp: number;
  badges: string[];
}

export type BadgeId =
  | 'first_step'
  | 'on_a_roll'
  | 'week_warrior'
  | 'centurion'
  | 'goal_getter'
  | 'calendar_pro'
  | 'perfect_day';

export interface BadgeDefinition {
  id: BadgeId;
  label: string;
  icon: string;
  description: string;
}

export const ALL_BADGES: BadgeDefinition[] = [
  { id: 'first_step',   label: 'First Step',    icon: 'star-outline',          description: 'Complete your first task' },
  { id: 'on_a_roll',    label: 'On a Roll',     icon: 'flame-outline',         description: '3-day streak' },
  { id: 'week_warrior', label: 'Week Warrior',  icon: 'trophy-outline',        description: '7-day streak' },
  { id: 'centurion',    label: 'Centurion',     icon: 'ribbon-outline',        description: 'Complete 100 tasks' },
  { id: 'goal_getter',  label: 'Goal Getter',   icon: 'flag-outline',          description: 'Log progress on a goal' },
  { id: 'calendar_pro', label: 'Calendar Pro',  icon: 'calendar-outline',      description: 'Complete a calendar event' },
  { id: 'perfect_day',  label: 'Perfect Day',   icon: 'checkmark-done-outline', description: 'Finish every task in a day' },
];

const LEVEL_THRESHOLDS = [0, 100, 250, 500, 1000, 2000, 3500, 5000, 7500, 10000];
const LEVEL_NAMES = [
  'Beginner', 'Planner', 'Achiever', 'Momentum',
  'Focused', 'Dedicated', 'Elite', 'Master', 'Legend', 'GamePlan Pro',
];

export function getLevel(xp: number): number {
  let level = 1;
  for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) {
    if (xp >= LEVEL_THRESHOLDS[i]) level = i + 1;
    else break;
  }
  return level;
}

export function getLevelName(xp: number): string {
  return LEVEL_NAMES[Math.min(getLevel(xp) - 1, LEVEL_NAMES.length - 1)];
}

export function getXpForNextLevel(xp: number): { current: number; needed: number; level: number; progress: number } {
  const level = getLevel(xp);
  if (level >= LEVEL_THRESHOLDS.length) {
    return { current: xp, needed: LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1], level, progress: 1 };
  }
  const floorXp = LEVEL_THRESHOLDS[level - 1];
  const ceilXp = LEVEL_THRESHOLDS[level];
  const current = xp - floorXp;
  const needed = ceilXp - floorXp;
  return { current, needed, level, progress: Math.min(current / needed, 1) };
}

export function xpForTask(priority: 'high' | 'medium' | 'low', isGoalLinked = false): number {
  if (isGoalLinked) return 20;
  if (priority === 'high') return 15;
  if (priority === 'medium') return 10;
  return 10;
}

export function checkAutoAwardBadges(stats: UserStats): BadgeId[] {
  const newBadges: BadgeId[] = [];
  const has = (id: BadgeId) => stats.badges.includes(id);
  if (!has('first_step') && stats.totalCompleted >= 1) newBadges.push('first_step');
  if (!has('on_a_roll') && stats.streak >= 3) newBadges.push('on_a_roll');
  if (!has('week_warrior') && stats.streak >= 7) newBadges.push('week_warrior');
  if (!has('centurion') && stats.totalCompleted >= 100) newBadges.push('centurion');
  return newBadges;
}

export interface CompletionHistoryItem {
  title: string;
  category: string;
  completed: boolean;
  hadSubtasks: boolean;
  date: string;
}

const KEYS = {
  PLANS: 'gameplan_plans',
  GOALS: 'gameplan_goals',
  PLATFORMS: 'gameplan_platforms',
  STATS: 'gameplan_stats',
  ONBOARDED: 'gameplan_onboarded',
  HISTORY: 'gameplan_history',
};

function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

function getTodayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

const DEFAULT_PLATFORMS: ConnectedPlatform[] = [
  { id: 'google-calendar', name: 'Google Calendar', category: 'calendar', connected: false, icon: 'calendar' },
  { id: 'outlook', name: 'Microsoft Outlook', category: 'calendar', connected: false, icon: 'mail' },
];

function generateDailyTasks(goals: Goal[]): Task[] {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const tasks: Task[] = [];

  tasks.push({
    id: generateId(),
    title: 'Review today\'s calendar',
    category: 'calendar',
    completed: false,
    priority: 'high',
    time: '8:00 AM',
    description: 'Check upcoming meetings and deadlines',
  });

  const fitnessGoal = goals.find(g => g.category === 'fitness');
  if (fitnessGoal) {
    tasks.push({
      id: generateId(),
      title: `${fitnessGoal.title} - ${fitnessGoal.unit}`,
      category: 'fitness',
      completed: false,
      priority: 'high',
      time: '7:00 AM',
      description: `Progress: ${fitnessGoal.current}/${fitnessGoal.target} ${fitnessGoal.unit}`,
      goalId: fitnessGoal.id,
    });
  } else {
    tasks.push({
      id: generateId(),
      title: '30-minute workout',
      category: 'fitness',
      completed: false,
      priority: 'medium',
      time: '7:00 AM',
      description: 'Stay active to boost energy',
    });
  }

  const financeGoal = goals.find(g => g.category === 'finance');
  if (financeGoal) {
    tasks.push({
      id: generateId(),
      title: 'Track spending',
      category: 'finance',
      completed: false,
      priority: 'medium',
      time: '12:00 PM',
      description: `Goal: ${financeGoal.title}`,
      goalId: financeGoal.id,
    });
  }

  tasks.push({
    id: generateId(),
    title: 'Focus block: Deep work',
    category: 'career',
    completed: false,
    priority: 'high',
    time: '9:30 AM',
    description: 'No meetings, pure productivity',
  });

  if (dayOfWeek >= 1 && dayOfWeek <= 5) {
    tasks.push({
      id: generateId(),
      title: 'Professional development',
      category: 'career',
      completed: false,
      priority: 'low',
      time: '5:00 PM',
      description: 'Read, learn, or network for 20 mins',
    });
  }

  tasks.push({
    id: generateId(),
    title: 'Mindful break',
    category: 'personal',
    completed: false,
    priority: 'medium',
    time: '3:00 PM',
    description: 'Step away, breathe, reset',
  });

  if (dayOfWeek === 5 || dayOfWeek === 6) {
    tasks.push({
      id: generateId(),
      title: 'Plan something fun',
      category: 'social',
      completed: false,
      priority: 'medium',
      time: '6:00 PM',
      description: 'Reach out to friends or plan a date',
    });
  }

  tasks.push({
    id: generateId(),
    title: 'Evening reflection',
    category: 'personal',
    completed: false,
    priority: 'low',
    time: '9:00 PM',
    description: 'Review the day and set tomorrow\'s intention',
  });

  return tasks;
}

const INSIGHTS = [
  'You\'ve been consistent with fitness this week. Keep the momentum going!',
  'Try batching similar tasks together for better focus today.',
  'Your spending has been under control. Great discipline!',
  'Consider scheduling a break between back-to-back meetings.',
  'You\'re building a strong streak. Small wins compound into big results.',
  'Today is a great day to tackle that career goal you\'ve been putting off.',
  'Remember: progress, not perfection. You\'re doing great.',
];

export async function getCompletionHistory(): Promise<CompletionHistoryItem[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.HISTORY);
    if (!raw) return [];
    const history: CompletionHistoryItem[] = JSON.parse(raw);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoff = sevenDaysAgo.toISOString().split('T')[0];
    return history.filter(h => h.date >= cutoff);
  } catch (e) {
    console.error('Failed to get history:', e);
    return [];
  }
}

export async function recordCompletion(task: Task, completed: boolean): Promise<void> {
  try {
    const history = await getCompletionHistory();
    const today = getTodayKey();
    const existing = history.findIndex(h => h.title === task.title && h.date === today);
    const item: CompletionHistoryItem = {
      title: task.title,
      category: task.category,
      completed,
      hadSubtasks: !!(task.subtasks && task.subtasks.length > 0),
      date: today,
    };
    if (existing >= 0) {
      history[existing] = item;
    } else {
      history.push(item);
    }
    await AsyncStorage.setItem(KEYS.HISTORY, JSON.stringify(history));
  } catch (e) {
    console.error('Failed to record completion:', e);
  }
}

export async function getTodayPlan(goals: Goal[]): Promise<DayPlan> {
  const key = getTodayKey();
  try {
    const raw = await AsyncStorage.getItem(KEYS.PLANS);
    const plans: Record<string, DayPlan> = raw ? JSON.parse(raw) : {};

    if (plans[key]) {
      return plans[key];
    }

    const plan: DayPlan = {
      date: key,
      tasks: generateDailyTasks(goals),
      greeting: getGreeting(),
      insight: INSIGHTS[Math.floor(Math.random() * INSIGHTS.length)],
    };

    plans[key] = plan;
    await AsyncStorage.setItem(KEYS.PLANS, JSON.stringify(plans));
    return plan;
  } catch (e) {
    console.error('Failed to get plan:', e);
    return {
      date: key,
      tasks: generateDailyTasks(goals),
      greeting: getGreeting(),
      insight: INSIGHTS[0],
    };
  }
}

export async function savePlan(plan: DayPlan): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.PLANS);
    const plans: Record<string, DayPlan> = raw ? JSON.parse(raw) : {};
    plans[plan.date] = plan;
    await AsyncStorage.setItem(KEYS.PLANS, JSON.stringify(plans));
  } catch (e) {
    console.error('Failed to save plan:', e);
  }
}

export async function updateTaskCompletion(date: string, taskId: string, completed: boolean): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.PLANS);
    const plans: Record<string, DayPlan> = raw ? JSON.parse(raw) : {};
    if (plans[date]) {
      let foundTask: Task | undefined;
      plans[date].tasks = plans[date].tasks.map(t => {
        if (t.id === taskId) {
          foundTask = t;
          return { ...t, completed };
        }
        if (t.subtasks) {
          const updatedSubtasks = t.subtasks.map(st => {
            if (st.id === taskId) {
              foundTask = st;
              return { ...st, completed };
            }
            return st;
          });
          const allSubtasksDone = updatedSubtasks.every(st => st.completed) && updatedSubtasks.length > 0;
          return {
            ...t,
            subtasks: updatedSubtasks,
            completed: allSubtasksDone,
          };
        }
        return t;
      });
      await AsyncStorage.setItem(KEYS.PLANS, JSON.stringify(plans));

      if (foundTask) {
        await recordCompletion(foundTask, completed);
      }
    }
    if (completed) {
      await incrementStats();
    } else {
      await decrementStats();
    }
  } catch (e) {
    console.error('Failed to update task:', e);
  }
}

export async function replaceTaskWithSubtasks(
  date: string,
  taskId: string,
  subtaskTitles: string[]
): Promise<DayPlan | null> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.PLANS);
    const plans: Record<string, DayPlan> = raw ? JSON.parse(raw) : {};
    if (!plans[date]) return null;

    plans[date].tasks = plans[date].tasks.map(t => {
      if (t.id === taskId) {
        const subtasks: Task[] = subtaskTitles.map(title => ({
          id: generateId(),
          title,
          category: t.category,
          completed: false,
          priority: t.priority,
          isSubtask: true,
          parentId: t.id,
        }));
        return { ...t, completed: false, subtasks };
      }
      return t;
    });

    await AsyncStorage.setItem(KEYS.PLANS, JSON.stringify(plans));
    return plans[date];
  } catch (e) {
    console.error('Failed to replace task with subtasks:', e);
    return null;
  }
}

export async function getGoals(): Promise<Goal[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.GOALS);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Failed to get goals:', e);
    return [];
  }
}

export async function saveGoal(goal: Goal): Promise<void> {
  try {
    const goals = await getGoals();
    const idx = goals.findIndex(g => g.id === goal.id);
    if (idx >= 0) {
      goals[idx] = goal;
    } else {
      goals.push(goal);
    }
    await AsyncStorage.setItem(KEYS.GOALS, JSON.stringify(goals));
  } catch (e) {
    console.error('Failed to save goal:', e);
  }
}

export async function updateGoalProgress(goalId: string, amount: number): Promise<Goal | null> {
  try {
    const goals = await getGoals();
    const idx = goals.findIndex(g => g.id === goalId);
    if (idx < 0) return null;
    const updated = {
      ...goals[idx],
      current: Math.min(goals[idx].target, goals[idx].current + amount),
    };
    goals[idx] = updated;
    await AsyncStorage.setItem(KEYS.GOALS, JSON.stringify(goals));
    return updated;
  } catch (e) {
    console.error('Failed to update goal progress:', e);
    return null;
  }
}

export async function deleteGoal(id: string): Promise<void> {
  try {
    const goals = await getGoals();
    await AsyncStorage.setItem(KEYS.GOALS, JSON.stringify(goals.filter(g => g.id !== id)));
  } catch (e) {
    console.error('Failed to delete goal:', e);
  }
}

export async function getPlatforms(): Promise<ConnectedPlatform[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.PLATFORMS);
    return raw ? JSON.parse(raw) : DEFAULT_PLATFORMS;
  } catch (e) {
    console.error('Failed to get platforms:', e);
    return DEFAULT_PLATFORMS;
  }
}

export async function togglePlatform(id: string): Promise<void> {
  try {
    const platforms = await getPlatforms();
    const updated = platforms.map(p =>
      p.id === id ? { ...p, connected: !p.connected } : p
    );
    await AsyncStorage.setItem(KEYS.PLATFORMS, JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to toggle platform:', e);
  }
}

export async function getStats(): Promise<UserStats> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.STATS);
    const base = { streak: 0, totalCompleted: 0, bestStreak: 0, xp: 0, badges: [] };
    return raw ? { ...base, ...JSON.parse(raw) } : base;
  } catch (e) {
    console.error('Failed to get stats:', e);
    return { streak: 0, totalCompleted: 0, bestStreak: 0, xp: 0, badges: [] };
  }
}

export async function incrementStats(
  priority: 'high' | 'medium' | 'low' = 'medium',
  isGoalLinked = false
): Promise<{ stats: UserStats; xpEarned: number; newBadges: BadgeId[] }> {
  const stats = await getStats();
  const xpEarned = xpForTask(priority, isGoalLinked);
  stats.totalCompleted += 1;
  stats.streak += 1;
  stats.xp = (stats.xp || 0) + xpEarned;
  if (stats.streak > stats.bestStreak) stats.bestStreak = stats.streak;
  const newBadges = checkAutoAwardBadges(stats);
  stats.badges = [...new Set([...stats.badges, ...newBadges])];
  await AsyncStorage.setItem(KEYS.STATS, JSON.stringify(stats));
  return { stats, xpEarned, newBadges };
}

export async function awardBadge(badgeId: BadgeId): Promise<void> {
  const stats = await getStats();
  if (!stats.badges.includes(badgeId)) {
    stats.badges = [...stats.badges, badgeId];
    await AsyncStorage.setItem(KEYS.STATS, JSON.stringify(stats));
  }
}

export async function decrementStats(): Promise<UserStats> {
  const stats = await getStats();
  stats.totalCompleted = Math.max(0, stats.totalCompleted - 1);
  stats.xp = Math.max(0, (stats.xp || 0) - 10);
  await AsyncStorage.setItem(KEYS.STATS, JSON.stringify(stats));
  return stats;
}

export async function regeneratePlan(goals: Goal[]): Promise<DayPlan> {
  const key = getTodayKey();
  const raw = await AsyncStorage.getItem(KEYS.PLANS);
  const plans: Record<string, DayPlan> = raw ? JSON.parse(raw) : {};

  const plan: DayPlan = {
    date: key,
    tasks: generateDailyTasks(goals),
    greeting: getGreeting(),
    insight: INSIGHTS[Math.floor(Math.random() * INSIGHTS.length)],
  };

  plans[key] = plan;
  await AsyncStorage.setItem(KEYS.PLANS, JSON.stringify(plans));
  return plan;
}

export function getSuggestions(): Suggestion[] {
  const day = new Date().getDay();
  const suggestions: Suggestion[] = [
    {
      id: '1',
      title: 'Try a new restaurant',
      description: 'Explore that new Italian place downtown for a relaxed dinner.',
      category: 'date_night',
      icon: 'restaurant',
      actionLabel: 'Plan it',
    },
    {
      id: '2',
      title: 'Automate your savings',
      description: 'Set up a recurring transfer of $50/week to your savings account.',
      category: 'finance',
      icon: 'trending-up',
      actionLabel: 'Learn more',
    },
    {
      id: '3',
      title: 'Morning yoga flow',
      description: 'Start tomorrow with a 15-minute yoga session for flexibility.',
      category: 'wellness',
      icon: 'leaf',
      actionLabel: 'Schedule',
    },
    {
      id: '4',
      title: 'Update your LinkedIn',
      description: 'Add recent achievements to boost profile visibility.',
      category: 'career',
      icon: 'briefcase',
      actionLabel: 'Open',
    },
    {
      id: '5',
      title: 'Weekend hike',
      description: 'Check out trails nearby for a Saturday morning adventure.',
      category: 'activity',
      icon: 'compass',
      actionLabel: 'Explore',
    },
  ];

  if (day === 5 || day === 6) {
    suggestions.unshift({
      id: '6',
      title: 'Movie night in',
      description: 'Pick a new release and set up a cozy movie night at home.',
      category: 'date_night',
      icon: 'film',
      actionLabel: 'Browse',
    });
  }

  return suggestions;
}

export { generateId, getTodayKey, getGreeting, awardBadge };
