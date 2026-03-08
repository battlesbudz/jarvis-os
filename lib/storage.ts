import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Task {
  id: string;
  title: string;
  category: 'calendar' | 'fitness' | 'finance' | 'career' | 'personal' | 'social';
  completed: boolean;
  priority: 'high' | 'medium' | 'low';
  time?: string;
  description?: string;
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
}

const KEYS = {
  PLANS: 'gameplan_plans',
  GOALS: 'gameplan_goals',
  PLATFORMS: 'gameplan_platforms',
  STATS: 'gameplan_stats',
  ONBOARDED: 'gameplan_onboarded',
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
  { id: '1', name: 'Google Calendar', category: 'calendar', connected: false, icon: 'calendar' },
  { id: '2', name: 'Apple Health', category: 'fitness', connected: false, icon: 'heart-pulse' },
  { id: '3', name: 'Mint', category: 'finance', connected: false, icon: 'credit-card' },
  { id: '4', name: 'LinkedIn', category: 'social', connected: false, icon: 'briefcase' },
  { id: '5', name: 'Strava', category: 'fitness', connected: false, icon: 'bike' },
  { id: '6', name: 'Outlook', category: 'calendar', connected: false, icon: 'mail' },
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

export async function getTodayPlan(goals: Goal[]): Promise<DayPlan> {
  const key = getTodayKey();
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
}

export async function updateTaskCompletion(date: string, taskId: string, completed: boolean): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.PLANS);
    const plans: Record<string, DayPlan> = raw ? JSON.parse(raw) : {};
    if (plans[date]) {
      plans[date].tasks = plans[date].tasks.map(t =>
        t.id === taskId ? { ...t, completed } : t
      );
      await AsyncStorage.setItem(KEYS.PLANS, JSON.stringify(plans));
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
    return raw ? JSON.parse(raw) : { streak: 0, totalCompleted: 0, bestStreak: 0 };
  } catch (e) {
    console.error('Failed to get stats:', e);
    return { streak: 0, totalCompleted: 0, bestStreak: 0 };
  }
}

export async function incrementStats(): Promise<UserStats> {
  const stats = await getStats();
  stats.totalCompleted += 1;
  stats.streak += 1;
  if (stats.streak > stats.bestStreak) stats.bestStreak = stats.streak;
  await AsyncStorage.setItem(KEYS.STATS, JSON.stringify(stats));
  return stats;
}

export async function decrementStats(): Promise<UserStats> {
  const stats = await getStats();
  stats.totalCompleted = Math.max(0, stats.totalCompleted - 1);
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

export { generateId, getTodayKey, getGreeting };
