import { getApiUrl } from '@/lib/query-client';
import { getAuthToken } from '@/lib/auth-context';

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
  fromBrainDump?: boolean;
  fromCarryover?: boolean;
  skipDays?: number;
}

export interface BlockedTask {
  title: string;
  category: string;
  skipDays: number;
  lastSkipDate: string;
  blockerType?: string;
  aiSuggestion?: string;
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
  lifetimeXp?: number;
  badges: string[];
  claimedRewards: Array<{ id: string; claimedAt: string }>;
  dailyXpEarned: { date: string; xp: number };
  lastStreakDate?: string;
}

export function getLifetimeXp(stats: UserStats): number {
  return stats.lifetimeXp ?? stats.xp ?? 0;
}

export interface Reward {
  id: string;
  title: string;
  description: string;
  icon: string;
  xpRequired: number;
  tier: 1 | 2 | 3 | 4 | 5;
  category: 'treat' | 'leisure' | 'social' | 'wellness' | 'splurge';
  tip: string;
}

const TIER_COLORS: Record<number, string> = {
  1: '#10B981',
  2: '#6366F1',
  3: '#F59E0B',
  4: '#EC4899',
  5: '#8B5CF6',
};
export { TIER_COLORS };

export const ALL_REWARDS: Reward[] = [
  { id: 'r1_drink',      tier: 1, xpRequired: 50,   category: 'treat',   icon: 'cafe-outline',         title: 'Favorite Drink Run',    description: 'Go get that drink you love — coffee, boba, smoothie, whatever calls to you.', tip: 'You showed up today. You deserve it.' },
  { id: 'r1_snack',      tier: 1, xpRequired: 50,   category: 'treat',   icon: 'pizza-outline',        title: 'Guilt-Free Snack',      description: 'Eat whatever snack you\'ve been craving. Zero guilt, full enjoyment.', tip: 'Small wins deserve small treats.' },
  { id: 'r1_scroll',     tier: 1, xpRequired: 50,   category: 'leisure', icon: 'phone-portrait-outline', title: 'Screen Time Pass',     description: 'Guilt-free 15 minutes of scrolling, videos, or whatever you feel like.', tip: 'A little mindless fun is good for the soul.' },
  { id: 'r1_walk',       tier: 1, xpRequired: 50,   category: 'wellness',icon: 'walk-outline',         title: 'Fresh Air Break',       description: 'Take a 10-minute walk just for yourself. No destination, no purpose — just breathe.', tip: 'Your brain needs rest too.' },
  { id: 'r2_gaming',     tier: 2, xpRequired: 150,  category: 'leisure', icon: 'game-controller-outline', title: 'Gaming Hour',         description: 'One full uninterrupted hour of whatever game you want. No guilt whatsoever.', tip: 'You\'ve earned your leisure time.' },
  { id: 'r2_episode',    tier: 2, xpRequired: 150,  category: 'leisure', icon: 'tv-outline',           title: 'Binge Pass',            description: 'Watch one full TV episode or YouTube video right now. No skipping to be "productive".', tip: 'Entertainment is rest. Rest is productive.' },
  { id: 'r2_takeout',    tier: 2, xpRequired: 150,  category: 'treat',   icon: 'bag-handle-outline',   title: 'Takeout Night',         description: 'Order from your go-to spot — no cooking, no dishes, just food you love.', tip: 'Nourish yourself. You\'ve been working hard.' },
  { id: 'r2_bath',       tier: 2, xpRequired: 150,  category: 'wellness',icon: 'water-outline',        title: 'Long Shower/Bath',      description: 'Take your time. Candles, music, whatever makes it feel luxurious.', tip: 'Slow down and enjoy the silence.' },
  { id: 'r2_nap',        tier: 2, xpRequired: 150,  category: 'wellness',icon: 'moon-outline',         title: 'Nap Pass',              description: 'Guilt-free nap, any length. Set your alarm or don\'t — you choose.', tip: 'Sleep is the ultimate productivity hack.' },
  { id: 'r3_movie',      tier: 3, xpRequired: 400,  category: 'leisure', icon: 'film-outline',         title: 'Movie Night',           description: 'Full movie of your choice tonight. Popcorn mandatory. Judgment-free zone.', tip: 'Sit back, relax, and just enjoy.' },
  { id: 'r3_sleepin',    tier: 3, xpRequired: 400,  category: 'wellness',icon: 'bed-outline',          title: 'Sleep In',              description: 'Set no alarm this coming weekend morning. Sleep until your body wakes you naturally.', tip: 'Your body knows what it needs.' },
  { id: 'r3_purchase',   tier: 3, xpRequired: 400,  category: 'splurge', icon: 'cart-outline',         title: 'New Game or Book',      description: 'Buy that game, book, album, or app you\'ve been eyeing. Under $20, no justification needed.', tip: 'Investing in joy is always a good spend.' },
  { id: 'r3_dessert',    tier: 3, xpRequired: 400,  category: 'treat',   icon: 'ice-cream-outline',    title: 'Dessert Run',           description: 'Go get your absolute favorite dessert. The good stuff — don\'t settle.', tip: 'Life is short. Eat the thing.' },
  { id: 'r3_hobby',      tier: 3, xpRequired: 400,  category: 'leisure', icon: 'color-palette-outline', title: 'Hobby Hour',           description: 'Spend a full hour on any hobby with zero guilt — drawing, music, building, gaming, whatever lights you up.', tip: 'The things you love make you who you are.' },
  { id: 'r4_daytrip',    tier: 4, xpRequired: 800,  category: 'social',  icon: 'map-outline',          title: 'Day Trip',              description: 'Plan a day trip somewhere you\'ve wanted to go. A nearby city, a park, a beach — you pick.', tip: 'You\'ve built enough momentum to go explore.' },
  { id: 'r4_shopping',   tier: 4, xpRequired: 800,  category: 'splurge', icon: 'storefront-outline',   title: 'Retail Therapy',        description: 'Buy something you\'ve been holding off on. You know the thing. Go get it.', tip: 'Delayed gratification finally pays off.' },
  { id: 'r4_selfcare',   tier: 4, xpRequired: 800,  category: 'wellness',icon: 'sparkles-outline',     title: 'Self-Care Day',         description: 'A full dedicated day: spa, haircut, grooming, face mask, whatever makes you feel like yourself again.', tip: 'You can\'t pour from an empty cup.' },
  { id: 'r4_nightout',   tier: 4, xpRequired: 800,  category: 'social',  icon: 'people-outline',       title: 'Night Out',             description: 'Plan a proper night out — with friends, solo, or with your partner. Dinner, drinks, or whatever you want.', tip: 'Connection and celebration go hand in hand.' },
  { id: 'r4_restaurant', tier: 4, xpRequired: 800,  category: 'treat',   icon: 'restaurant-outline',   title: 'Restaurant Splurge',    description: 'Book that nicer restaurant you\'ve been putting off. Get the good table. Order what you actually want.', tip: 'Experiences over things, every time.' },
  { id: 'r5_getaway',    tier: 5, xpRequired: 2000, category: 'splurge', icon: 'airplane-outline',     title: 'Weekend Getaway',       description: 'Book a trip anywhere for the weekend. Road trip, hotel, Airbnb — somewhere that isn\'t home.', tip: 'You\'ve built something real. Go celebrate it properly.' },
  { id: 'r5_bigbuy',     tier: 5, xpRequired: 2000, category: 'splurge', icon: 'gift-outline',         title: 'Big Purchase',          description: 'That expensive thing you keep talking yourself out of. You know what it is. Go get it.', tip: 'You worked for this. You\'ve absolutely earned it.' },
  { id: 'r5_dayoff',     tier: 5, xpRequired: 2000, category: 'wellness',icon: 'sunny-outline',        title: 'Full Day Off',          description: 'Take an entire day completely off — no work, no responsibilities, no guilt. Just live.', tip: 'Rest is not a reward. It\'s a right. Today it\'s both.' },
  { id: 'r5_party',      tier: 5, xpRequired: 2000, category: 'social',  icon: 'balloon-outline',      title: 'Throw a Party',         description: 'Invite people over and celebrate yourself. You\'ve hit a major milestone and that deserves to be shared.', tip: 'You built the discipline. Now share the joy.' },
  { id: 'r5_dreammeal',  tier: 5, xpRequired: 2000, category: 'treat',   icon: 'flame-outline',        title: 'Dream Meal',            description: 'Cook or order the most indulgent meal you can imagine. No calorie counting, no compromises.', tip: 'This is what finishing things tastes like.' },
];

export function getAvailableRewards(xp: number): Reward[] {
  return ALL_REWARDS.filter(r => r.xpRequired <= xp).sort((a, b) => a.xpRequired - b.xpRequired);
}

export const DAILY_XP_REQUIRED: Record<1 | 2 | 3 | 4 | 5, number> = {
  1: 30,
  2: 60,
  3: 100,
  4: 150,
  5: 200,
};

export function getDailyXpEarned(stats: UserStats): number {
  const today = getTodayKey();
  if (!stats.dailyXpEarned || stats.dailyXpEarned.date !== today) return 0;
  return stats.dailyXpEarned.xp;
}

export function getDailyBudgetRemaining(stats: UserStats): number {
  const todayXp = getDailyXpEarned(stats);
  const today = getTodayKey();
  const spent = (stats.claimedRewards || [])
    .filter(r => r.claimedAt.startsWith(today))
    .reduce((sum, claim) => {
      const reward = ALL_REWARDS.find(r => r.id === claim.id);
      return sum + (reward ? DAILY_XP_REQUIRED[reward.tier] : 0);
    }, 0);
  return Math.max(0, todayXp - spent);
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
  const base = priority === 'high' ? 15 : priority === 'medium' ? 10 : 5;
  return base + (isGoalLinked ? 10 : 0);
}

export function calculateTaskXp(task: { priority: 'high' | 'medium' | 'low'; goalId?: string }): number {
  return xpForTask(task.priority, !!task.goalId);
}

export function xpForSubtask(parentXp: number, subtaskCount: number): number {
  return Math.max(1, Math.floor(parentXp / subtaskCount));
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

export interface BrainDumpItem {
  id: string;
  text: string;
  createdAt: string;
}

export interface EnergyCheckin {
  energy: number;
  focus: string;
  date: string;
}

export type ViewMode = 'list' | 'timeline';

export interface TimerSettings {
  workDuration: number;
  breakDuration: number;
}

export interface LifeContext {
  priorityGoal: string;
  upcomingDeadline: string;
  improvementArea: string;
  currentBlocker: string;
  freeText: string;
  lastUpdated: string;
}

export interface CoachAction {
  type: 'task' | 'goal';
  title: string;
  category: string;
  priority?: 'high' | 'medium' | 'low';
  description?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actions?: CoachAction[];
  followups?: string[];
}

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

async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken();
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  return {};
}

interface ApiDataResponse {
  data: unknown;
  ok?: boolean;
}

interface UserPreferencesData {
  viewMode?: ViewMode;
  userName?: string;
  onboardingComplete?: boolean;
  dailyCoachNote?: { note: string; date: string } | null;
  platforms?: ConnectedPlatform[];
  migrationVersion?: number;
  [key: string]: unknown;
}

async function apiGet(path: string): Promise<ApiDataResponse> {
  const baseUrl = getApiUrl();
  const url = new URL(path, baseUrl);
  const authHeaders = await getAuthHeaders();
  const res = await fetch(url.toString(), {
    headers: { ...authHeaders },
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<ApiDataResponse>;
}

async function apiPut(path: string, data: unknown): Promise<ApiDataResponse> {
  const baseUrl = getApiUrl();
  const url = new URL(path, baseUrl);
  const authHeaders = await getAuthHeaders();
  const res = await fetch(url.toString(), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({ data }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<ApiDataResponse>;
}

async function apiDelete(path: string): Promise<ApiDataResponse> {
  const baseUrl = getApiUrl();
  const url = new URL(path, baseUrl);
  const authHeaders = await getAuthHeaders();
  const res = await fetch(url.toString(), {
    method: 'DELETE',
    headers: { ...authHeaders },
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<ApiDataResponse>;
}

const DEFAULT_PLATFORMS: ConnectedPlatform[] = [
  { id: 'google-calendar', name: 'Google Calendar', category: 'calendar', connected: false, icon: 'calendar' },
  { id: 'outlook', name: 'Microsoft Outlook', category: 'calendar', connected: false, icon: 'mail' },
  { id: 'gmail', name: 'Gmail', category: 'calendar', connected: false, icon: 'mail' },
];

function generateDailyTasks(goals: Goal[]): Task[] {
  if (goals.length === 0) return [];

  const today = new Date();
  const dayOfWeek = today.getDay();
  const tasks: Task[] = [];

  const fitnessGoal = goals.find(g => g.category === 'fitness');
  if (fitnessGoal) {
    tasks.push({
      id: generateId(),
      title: `${fitnessGoal.title}`,
      category: 'fitness',
      completed: false,
      priority: 'high',
      time: '7:00 AM',
      description: `Progress: ${fitnessGoal.current}/${fitnessGoal.target} ${fitnessGoal.unit}`,
      goalId: fitnessGoal.id,
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

  const careerGoal = goals.find(g => g.category === 'career');
  if (careerGoal) {
    tasks.push({
      id: generateId(),
      title: `Work on: ${careerGoal.title}`,
      category: 'career',
      completed: false,
      priority: 'high',
      time: '9:30 AM',
      description: 'Dedicated focus block',
      goalId: careerGoal.id,
    });
  }

  const personalGoal = goals.find(g => g.category === 'personal');
  if (personalGoal) {
    tasks.push({
      id: generateId(),
      title: `${personalGoal.title}`,
      category: 'personal',
      completed: false,
      priority: 'medium',
      time: '6:00 PM',
      description: 'Daily progress toward your personal goal',
      goalId: personalGoal.id,
    });
  }

  if (dayOfWeek >= 1 && dayOfWeek <= 5 && tasks.length < 3) {
    tasks.push({
      id: generateId(),
      title: 'Focus block: Deep work',
      category: 'career',
      completed: false,
      priority: 'high',
      time: '9:30 AM',
      description: 'No distractions, pure productivity',
    });
  }

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

const DEFAULT_STATS: UserStats = {
  streak: 0, totalCompleted: 0, bestStreak: 0, xp: 0, lifetimeXp: 0, badges: [], claimedRewards: [],
  dailyXpEarned: { date: '', xp: 0 },
};

export async function getBrainDumpInbox(): Promise<BrainDumpItem[]> {
  try {
    const result = await apiGet('/api/data/brain-dump-inbox');
    return (result.data as BrainDumpItem[]) || [];
  } catch {
    return [];
  }
}

export async function saveBrainDumpItem(text: string): Promise<void> {
  try {
    const inbox = await getBrainDumpInbox();
    const newItem: BrainDumpItem = {
      id: generateId(),
      text,
      createdAt: new Date().toISOString(),
    };
    inbox.push(newItem);
    await apiPut('/api/data/brain-dump-inbox', inbox);
  } catch {}
}

export async function clearBrainDumpItem(id: string): Promise<void> {
  try {
    const inbox = await getBrainDumpInbox();
    const updated = inbox.filter(item => item.id !== id);
    await apiPut('/api/data/brain-dump-inbox', updated);
  } catch {}
}

export async function addTaskToToday(task: Partial<Task>): Promise<void> {
  try {
    const goals = await getGoals();
    const plan = await getTodayPlan(goals);
    const newTask: Task = {
      id: generateId(),
      title: task.title || 'Untitled Task',
      category: (task.category || 'personal') as Task['category'],
      completed: false,
      priority: task.priority || 'low',
      ...task,
    };
    plan.tasks.push(newTask);
    await savePlan(plan);
  } catch {}
}

export async function getEnergyCheckin(date?: string): Promise<EnergyCheckin | null> {
  try {
    const key = date || getTodayKey();
    const result = await apiGet(`/api/data/energy-checkins/${key}`);
    return (result.data as EnergyCheckin) || null;
  } catch {
    return null;
  }
}

export async function saveEnergyCheckin(checkin: EnergyCheckin): Promise<void> {
  try {
    await apiPut(`/api/data/energy-checkins/${checkin.date}`, checkin);
  } catch {}
}

export async function getViewMode(): Promise<ViewMode> {
  try {
    const result = await apiGet('/api/data/user-preferences');
    const prefs = (result.data || {}) as UserPreferencesData;
    return prefs.viewMode || 'list';
  } catch {
    return 'list';
  }
}

export async function saveViewMode(mode: ViewMode): Promise<void> {
  try {
    const result = await apiGet('/api/data/user-preferences');
    const prefs = (result.data || {}) as UserPreferencesData;
    prefs.viewMode = mode;
    await apiPut('/api/data/user-preferences', prefs);
  } catch {}
}

export async function getTimerSettings(): Promise<TimerSettings> {
  try {
    const result = await apiGet('/api/data/timer-settings');
    if (!result.data) return { workDuration: 25, breakDuration: 5 };
    return result.data as TimerSettings;
  } catch {
    return { workDuration: 25, breakDuration: 5 };
  }
}

export async function saveTimerSettings(settings: TimerSettings): Promise<void> {
  try {
    await apiPut('/api/data/timer-settings', settings);
  } catch {}
}

export async function getLifeContext(): Promise<LifeContext | null> {
  try {
    const result = await apiGet('/api/data/life-context');
    return (result.data as LifeContext) || null;
  } catch {
    return null;
  }
}

export async function saveLifeContext(ctx: LifeContext): Promise<void> {
  try {
    await apiPut('/api/data/life-context', ctx);
  } catch {}
}

export async function getChatHistory(): Promise<ChatMessage[]> {
  try {
    const result = await apiGet('/api/data/chat-history');
    return (result.data as ChatMessage[]) || [];
  } catch {
    return [];
  }
}

export async function saveChatHistory(messages: ChatMessage[]): Promise<void> {
  try {
    await apiPut('/api/data/chat-history', messages);
  } catch {}
}

export async function clearChatHistory(): Promise<void> {
  try {
    await apiDelete('/api/data/chat-history');
  } catch {}
}

export async function getDailyCoachNote(): Promise<{ note: string; date: string } | null> {
  try {
    const result = await apiGet('/api/data/user-preferences');
    const prefs = (result.data || {}) as UserPreferencesData;
    return prefs.dailyCoachNote || null;
  } catch {
    return null;
  }
}

export async function saveDailyCoachNote(note: string): Promise<void> {
  try {
    const today = getTodayKey();
    const result = await apiGet('/api/data/user-preferences');
    const prefs = (result.data || {}) as UserPreferencesData;
    prefs.dailyCoachNote = { note, date: today };
    await apiPut('/api/data/user-preferences', prefs);
  } catch {}
}

export async function getCompletionHistory(): Promise<CompletionHistoryItem[]> {
  try {
    const result = await apiGet('/api/data/completion-history');
    const history = (result.data as CompletionHistoryItem[]) || [];
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
    await apiPut('/api/data/completion-history', history);
  } catch (e) {
    console.error('Failed to record completion:', e);
  }
}

export async function getTodayPlan(goals: Goal[]): Promise<DayPlan> {
  const key = getTodayKey();
  try {
    const result = await apiGet(`/api/data/plans/${key}`);
    if (result.data) {
      return result.data as DayPlan;
    }

    const baseTasks = generateDailyTasks(goals);

    const carryovers = await getCarryoverTasks();
    const enrichedCarryovers: Task[] = [];
    for (const ct of carryovers) {
      const baseWords = baseTasks.map(t => t.title.toLowerCase().split(/\s+/).filter(w => w.length > 3)).flat();
      const ctWords = ct.title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const isDupe = ctWords.some(w => baseWords.includes(w));
      if (!isDupe) {
        await recordTaskSkip(ct);
        const blocked = await getBlockedTask(ct.title);
        enrichedCarryovers.push({
          ...ct,
          fromCarryover: true,
          skipDays: blocked?.skipDays ?? 1,
        });
      }
    }

    const plan: DayPlan = {
      date: key,
      tasks: [...enrichedCarryovers, ...baseTasks],
      greeting: getGreeting(),
      insight: INSIGHTS[Math.floor(Math.random() * INSIGHTS.length)],
    };

    await apiPut(`/api/data/plans/${key}`, plan);
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
    await apiPut(`/api/data/plans/${plan.date}`, plan);
  } catch (e) {
    console.error('Failed to save plan:', e);
  }
}

export async function savePlanSnapshot(plan: DayPlan): Promise<void> {
  try {
    await apiPut('/api/data/plan-snapshots', { date: plan.date, tasks: plan.tasks });
  } catch (e) {
    console.error('Failed to save plan snapshot:', e);
  }
}

export async function getPlanSnapshot(): Promise<{ date: string; tasks: Task[] } | null> {
  try {
    const result = await apiGet('/api/data/plan-snapshots');
    if (!result.data) return null;
    const snapshot = result.data as { date: string; tasks: Task[] };
    if (snapshot.date !== getTodayKey()) return null;
    return snapshot;
  } catch {
    return null;
  }
}

export async function clearPlanSnapshot(): Promise<void> {
  try {
    await apiDelete('/api/data/plan-snapshots');
  } catch {}
}

export async function restorePlanSnapshot(goals: Goal[]): Promise<DayPlan | null> {
  try {
    const snapshot = await getPlanSnapshot();
    if (!snapshot) return null;
    const current = await getTodayPlan(goals);
    const restored: DayPlan = { ...current, tasks: snapshot.tasks };
    await savePlan(restored);
    await clearPlanSnapshot();
    return restored;
  } catch {
    return null;
  }
}

export interface TaskCompletionResult {
  task: Task | null;
  xpEarned: number;
  newBadges: string[];
}

export async function updateTaskCompletion(
  date: string,
  taskId: string,
  completed: boolean,
  allTasks?: Task[]
): Promise<TaskCompletionResult> {
  const emptyResult: TaskCompletionResult = { task: null, xpEarned: 0, newBadges: [] };
  try {
    const result = await apiGet(`/api/data/plans/${date}`);
    const plan = result.data as DayPlan | null;
    if (!plan) return emptyResult;

    let foundTask: Task | undefined;
    let parentTask: Task | undefined;
    plan.tasks = plan.tasks.map(t => {
      if (t.id === taskId) {
        foundTask = t;
        return { ...t, completed };
      }
      if (t.subtasks) {
        const updatedSubtasks = t.subtasks.map(st => {
          if (st.id === taskId) {
            foundTask = st;
            parentTask = t;
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
    await apiPut(`/api/data/plans/${date}`, plan);

    let xpEarned = 0;
    let newBadges: string[] = [];

    if (foundTask) {
      await recordCompletion(foundTask, completed);
      if (completed && foundTask.fromCarryover) {
        await clearBlockedTask(foundTask.title);
      }

      if (completed) {
        let xpOverride: number | undefined;
        if (foundTask.isSubtask && parentTask && parentTask.subtasks && parentTask.subtasks.length > 0) {
          const parentXp = calculateTaskXp(parentTask);
          xpOverride = xpForSubtask(parentXp, parentTask.subtasks.length);
        }
        const isGoalLinked = !!foundTask.goalId;
        const priority = foundTask.priority ?? 'medium';
        const statsResult = await incrementStats(priority, isGoalLinked, xpOverride);
        xpEarned = statsResult.xpEarned;
        newBadges = statsResult.newBadges;
      } else {
        let xpToRemove = 10;
        if (foundTask.isSubtask && parentTask && parentTask.subtasks && parentTask.subtasks.length > 0) {
          xpToRemove = xpForSubtask(calculateTaskXp(parentTask), parentTask.subtasks.length);
        } else {
          xpToRemove = calculateTaskXp(foundTask);
        }
        await decrementStats(xpToRemove);
      }
    }

    return { task: foundTask || null, xpEarned, newBadges };
  } catch (e) {
    console.error('Failed to update task:', e);
    return emptyResult;
  }
}

export async function replaceTaskWithSubtasks(
  date: string,
  taskId: string,
  subtaskTitles: string[]
): Promise<DayPlan | null> {
  try {
    const result = await apiGet(`/api/data/plans/${date}`);
    const plan = result.data as DayPlan | null;
    if (!plan) return null;

    plan.tasks = plan.tasks.map(t => {
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

    await apiPut(`/api/data/plans/${date}`, plan);
    return plan;
  } catch (e) {
    console.error('Failed to replace task with subtasks:', e);
    return null;
  }
}

export async function getGoals(): Promise<Goal[]> {
  try {
    const result = await apiGet('/api/data/goals');
    return (result.data as Goal[]) || [];
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
    await apiPut('/api/data/goals', goals);
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
    await apiPut('/api/data/goals', goals);
    return updated;
  } catch (e) {
    console.error('Failed to update goal progress:', e);
    return null;
  }
}

export async function deleteGoal(id: string): Promise<void> {
  try {
    const goals = await getGoals();
    await apiPut('/api/data/goals', goals.filter(g => g.id !== id));
  } catch (e) {
    console.error('Failed to delete goal:', e);
  }
}

export async function getPlatforms(): Promise<ConnectedPlatform[]> {
  try {
    const result = await apiGet('/api/data/user-preferences');
    const prefs = (result.data || {}) as UserPreferencesData;
    const saved = prefs.platforms || [];
    if (saved.length === 0) return DEFAULT_PLATFORMS;
    return DEFAULT_PLATFORMS.map(def => {
      const found = saved.find(p => p.id === def.id);
      return found ? { ...def, connected: found.connected } : def;
    });
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
    const result = await apiGet('/api/data/user-preferences');
    const prefs = (result.data || {}) as UserPreferencesData;
    prefs.platforms = updated;
    await apiPut('/api/data/user-preferences', prefs);
  } catch (e) {
    console.error('Failed to toggle platform:', e);
  }
}

export async function getStats(): Promise<UserStats> {
  try {
    const result = await apiGet('/api/data/stats');
    return result.data ? { ...DEFAULT_STATS, ...(result.data as UserStats) } : { ...DEFAULT_STATS };
  } catch (e) {
    console.error('Failed to get stats:', e);
    return { ...DEFAULT_STATS };
  }
}

export async function claimReward(rewardId: string): Promise<void> {
  const stats = await getStats();
  const todayStr = getTodayKey();
  const alreadyToday = stats.claimedRewards.some(
    r => r.id === rewardId && r.claimedAt.startsWith(todayStr)
  );
  if (alreadyToday) return;
  const reward = ALL_REWARDS.find(r => r.id === rewardId);
  const cost = reward ? DAILY_XP_REQUIRED[reward.tier] : 0;
  stats.xp = Math.max(0, (stats.xp || 0) - cost);
  stats.claimedRewards = [...stats.claimedRewards, { id: rewardId, claimedAt: new Date().toISOString() }];
  await apiPut('/api/data/stats', stats);
}

export async function incrementStats(
  priority: 'high' | 'medium' | 'low' = 'medium',
  isGoalLinked = false,
  xpOverride?: number
): Promise<{ stats: UserStats; xpEarned: number; newBadges: BadgeId[] }> {
  const stats = await getStats();
  const xpEarned = xpOverride ?? xpForTask(priority, isGoalLinked);
  stats.totalCompleted += 1;
  const prevXp = stats.xp || 0;
  stats.xp = prevXp + xpEarned;
  stats.lifetimeXp = (stats.lifetimeXp ?? prevXp) + xpEarned;

  const todayKey = getTodayKey();
  if (stats.lastStreakDate !== todayKey) {
    stats.streak += 1;
    stats.lastStreakDate = todayKey;
    if (stats.streak > stats.bestStreak) stats.bestStreak = stats.streak;
  }

  if (!stats.dailyXpEarned || stats.dailyXpEarned.date !== todayKey) {
    stats.dailyXpEarned = { date: todayKey, xp: xpEarned };
  } else {
    stats.dailyXpEarned = { date: todayKey, xp: stats.dailyXpEarned.xp + xpEarned };
  }

  const newBadges = checkAutoAwardBadges(stats);
  stats.badges = [...new Set([...stats.badges, ...newBadges])];
  await apiPut('/api/data/stats', stats);
  return { stats, xpEarned, newBadges };
}

export async function awardBadge(badgeId: BadgeId): Promise<void> {
  const stats = await getStats();
  if (!stats.badges.includes(badgeId)) {
    stats.badges = [...stats.badges, badgeId];
    await apiPut('/api/data/stats', stats);
  }
}

export async function decrementStats(xpAmount = 10): Promise<UserStats> {
  const stats = await getStats();
  stats.totalCompleted = Math.max(0, stats.totalCompleted - 1);
  stats.xp = Math.max(0, (stats.xp || 0) - xpAmount);
  const todayKey = getTodayKey();
  if (stats.dailyXpEarned && stats.dailyXpEarned.date === todayKey) {
    stats.dailyXpEarned = { date: todayKey, xp: Math.max(0, stats.dailyXpEarned.xp - xpAmount) };
  }
  await apiPut('/api/data/stats', stats);
  return stats;
}

export async function resetStats(): Promise<void> {
  await apiPut('/api/data/stats', { ...DEFAULT_STATS });
}

const CURRENT_MIGRATION_VERSION = 2;
export async function runMigrations(): Promise<void> {
  try {
    const result = await apiGet('/api/data/user-preferences');
    const prefs = (result.data || {}) as UserPreferencesData;
    const version = prefs.migrationVersion || 0;
    if (version < CURRENT_MIGRATION_VERSION) {
      await resetStats();
      prefs.migrationVersion = CURRENT_MIGRATION_VERSION;
      await apiPut('/api/data/user-preferences', prefs);
    }
  } catch {}
}

export async function regeneratePlan(goals: Goal[]): Promise<DayPlan> {
  const key = getTodayKey();

  const plan: DayPlan = {
    date: key,
    tasks: generateDailyTasks(goals),
    greeting: getGreeting(),
    insight: INSIGHTS[Math.floor(Math.random() * INSIGHTS.length)],
  };

  await apiPut(`/api/data/plans/${key}`, plan);
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

export async function getCompletedCalendarIds(): Promise<string[]> {
  try {
    const key = getTodayKey();
    const result = await apiGet(`/api/data/completed-calendar-ids/${key}`);
    return (result.data as string[]) || [];
  } catch {
    return [];
  }
}

export async function saveCompletedCalendarId(id: string, completed: boolean): Promise<void> {
  try {
    const key = getTodayKey();
    const existing = await getCompletedCalendarIds();
    let updated: string[];
    if (completed) {
      updated = Array.from(new Set([...existing, id]));
    } else {
      updated = existing.filter(i => i !== id);
    }
    await apiPut(`/api/data/completed-calendar-ids/${key}`, updated);
  } catch {}
}



export async function getUserName(): Promise<string> {
  try {
    const result = await apiGet('/api/data/user-preferences');
    const prefs = (result.data || {}) as UserPreferencesData;
    return prefs.userName || '';
  } catch {
    return '';
  }
}

export async function saveUserName(name: string): Promise<void> {
  try {
    const result = await apiGet('/api/data/user-preferences');
    const prefs = (result.data || {}) as UserPreferencesData;
    prefs.userName = name;
    await apiPut('/api/data/user-preferences', prefs);
  } catch {}
}

export async function isOnboardingComplete(): Promise<boolean> {
  try {
    const result = await apiGet('/api/data/user-preferences');
    const prefs = (result.data || {}) as UserPreferencesData;
    return prefs.onboardingComplete === true;
  } catch {
    return false;
  }
}

export async function setOnboardingComplete(): Promise<void> {
  try {
    const result = await apiGet('/api/data/user-preferences');
    const prefs = (result.data || {}) as UserPreferencesData;
    prefs.onboardingComplete = true;
    await apiPut('/api/data/user-preferences', prefs);
  } catch {}
}

export async function updateTask(date: string, taskId: string, updates: Partial<Task>): Promise<void> {
  try {
    const result = await apiGet(`/api/data/plans/${date}`);
    const plan = result.data as DayPlan | null;
    if (!plan) return;
    plan.tasks = plan.tasks.map(t => {
      if (t.id === taskId) return { ...t, ...updates };
      if (t.subtasks) {
        return {
          ...t,
          subtasks: t.subtasks.map(st =>
            st.id === taskId ? { ...st, ...updates } : st
          ),
        };
      }
      return t;
    });
    await apiPut(`/api/data/plans/${date}`, plan);
  } catch (e) {
    console.error('Failed to update task:', e);
  }
}

export async function deleteTask(date: string, taskId: string): Promise<void> {
  try {
    const result = await apiGet(`/api/data/plans/${date}`);
    const plan = result.data as DayPlan | null;
    if (!plan) return;
    const newTasks: Task[] = [];
    for (const t of plan.tasks) {
      if (t.id === taskId) continue;
      if (t.subtasks) {
        const filteredSubs = t.subtasks.filter(st => st.id !== taskId);
        newTasks.push({ ...t, subtasks: filteredSubs });
      } else {
        newTasks.push(t);
      }
    }
    plan.tasks = newTasks;
    await apiPut(`/api/data/plans/${date}`, plan);
  } catch (e) {
    console.error('Failed to delete task:', e);
  }
}

export async function reorderTasks(date: string, newOrder: Task[]): Promise<void> {
  try {
    const result = await apiGet(`/api/data/plans/${date}`);
    const plan = result.data as DayPlan | null;
    if (!plan) return;
    const completedTasks = plan.tasks.filter(t => t.completed);
    plan.tasks = [...newOrder, ...completedTasks];
    await apiPut(`/api/data/plans/${date}`, plan);
  } catch (e) {
    console.error('Failed to reorder tasks:', e);
  }
}

export async function addSubtaskManually(date: string, parentId: string, title: string): Promise<void> {
  try {
    const result = await apiGet(`/api/data/plans/${date}`);
    const plan = result.data as DayPlan | null;
    if (!plan) return;
    plan.tasks = plan.tasks.map(t => {
      if (t.id !== parentId) return t;
      const newSubtask: Task = {
        id: generateId(),
        title: title.trim(),
        category: t.category,
        completed: false,
        priority: t.priority,
        isSubtask: true,
        parentId: t.id,
      };
      const existingSubs = t.subtasks || [];
      return { ...t, subtasks: [...existingSubs, newSubtask], completed: false };
    });
    await apiPut(`/api/data/plans/${date}`, plan);
  } catch (e) {
    console.error('Failed to add subtask:', e);
  }
}

export async function getBlockedTasks(): Promise<BlockedTask[]> {
  try {
    const result = await apiGet('/api/data/blocked-tasks');
    return (result.data as BlockedTask[]) || [];
  } catch {
    return [];
  }
}

export async function getBlockedTask(title: string): Promise<BlockedTask | null> {
  const all = await getBlockedTasks();
  return all.find(b => b.title === title) ?? null;
}

export async function recordTaskSkip(task: Task): Promise<void> {
  try {
    const all = await getBlockedTasks();
    const today = getTodayKey();
    const idx = all.findIndex(b => b.title === task.title);
    if (idx >= 0) {
      if (all[idx].lastSkipDate !== today) {
        all[idx].skipDays += 1;
        all[idx].lastSkipDate = today;
      }
    } else {
      all.push({
        title: task.title,
        category: task.category,
        skipDays: 1,
        lastSkipDate: today,
      });
    }
    await apiPut('/api/data/blocked-tasks', all);
  } catch (e) {
    console.error('Failed to record task skip:', e);
  }
}

export async function clearBlockedTask(title: string): Promise<void> {
  try {
    const all = await getBlockedTasks();
    const updated = all.filter(b => b.title !== title);
    await apiPut('/api/data/blocked-tasks', updated);
  } catch (e) {
    console.error('Failed to clear blocked task:', e);
  }
}

export async function saveBlockerAnswer(title: string, blockerType: string, aiSuggestion: string): Promise<void> {
  try {
    const all = await getBlockedTasks();
    const idx = all.findIndex(b => b.title === title);
    if (idx >= 0) {
      all[idx].blockerType = blockerType;
      all[idx].aiSuggestion = aiSuggestion;
    } else {
      all.push({
        title,
        category: 'personal',
        skipDays: 1,
        lastSkipDate: getTodayKey(),
        blockerType,
        aiSuggestion,
      });
    }
    await apiPut('/api/data/blocked-tasks', all);
  } catch (e) {
    console.error('Failed to save blocker answer:', e);
  }
}

export async function getCarryoverTasks(): Promise<Task[]> {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    const result = await apiGet(`/api/data/plans/${yKey}`);
    const yPlan = result.data as DayPlan | null;
    if (!yPlan) return [];
    return yPlan.tasks.filter(t => !t.completed && t.category !== 'calendar' && !t.isSubtask);
  } catch {
    return [];
  }
}

export { generateId, getTodayKey, getGreeting };
