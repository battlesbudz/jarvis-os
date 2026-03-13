import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { Task, Goal, getTodayKey, type Commitment } from './storage';
import AsyncStorage from '@react-native-async-storage/async-storage';

const NOTIFICATIONS_ENABLED_KEY = 'gameplan_notifications_enabled';

export async function requestNotificationPermissions() {
  if (Platform.OS === 'web') return false;
  
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  return finalStatus === 'granted';
}

export async function setNotificationsEnabled(enabled: boolean) {
  await AsyncStorage.setItem(NOTIFICATIONS_ENABLED_KEY, JSON.stringify(enabled));
  if (!enabled) {
    await cancelAllTaskReminders();
  }
}

export async function areNotificationsEnabled() {
  const val = await AsyncStorage.getItem(NOTIFICATIONS_ENABLED_KEY);
  return val ? JSON.parse(val) : true; // Default to true
}

export async function scheduleTaskReminder(task: Task) {
  if (Platform.OS === 'web' || !task.time) return;
  
  const enabled = await areNotificationsEnabled();
  if (!enabled) return;

  // Parse task time (e.g., "9:30 AM")
  const [time, modifier] = task.time.split(' ');
  let [hours, minutes] = time.split(':').map(Number);
  
  if (modifier === 'PM' && hours < 12) hours += 12;
  if (modifier === 'AM' && hours === 12) hours = 0;

  const scheduledTime = new Date();
  scheduledTime.setHours(hours, minutes, 0, 0);
  
  // Schedule for 10 minutes before
  const reminderTime = new Date(scheduledTime.getTime() - 10 * 60000);

  // If reminder time is in the past, don't schedule
  if (reminderTime.getTime() <= Date.now()) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Upcoming Task',
      body: `Coming up: ${task.title} in 10 minutes`,
      data: { taskId: task.id },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: reminderTime,
    },
    identifier: `task-reminder-${task.id}`,
  });
}

export async function cancelTaskReminder(taskId: string) {
  if (Platform.OS === 'web') return;
  await Notifications.cancelScheduledNotificationAsync(`task-reminder-${taskId}`);
}

export async function cancelAllTaskReminders() {
  if (Platform.OS === 'web') return;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const notification of scheduled) {
    if (notification.identifier.startsWith('task-reminder-')) {
      await Notifications.cancelScheduledNotificationAsync(notification.identifier);
    }
  }
}

export async function scheduleAllTaskReminders(tasks: Task[]) {
  if (Platform.OS === 'web') return;
  
  await cancelAllTaskReminders();
  
  const enabled = await areNotificationsEnabled();
  if (!enabled) return;

  for (const task of tasks) {
    if (task.time && !task.completed) {
      await scheduleTaskReminder(task);
    }
  }
}

export async function scheduleNudge(taskTitle: string) {
  if (Platform.OS === 'web') return;
  
  const enabled = await areNotificationsEnabled();
  if (!enabled) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Time to wrap up',
      body: `Focus session complete! Time to wrap up ${taskTitle}.`,
    },
    trigger: null,
  });
}

export async function scheduleTimerNotification(title: string, body: string) {
  if (Platform.OS === 'web') return;

  const enabled = await areNotificationsEnabled();
  if (!enabled) return;

  await Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: null,
  });
}

export async function scheduleMorningBriefing() {
  if (Platform.OS === 'web') return;

  const enabled = await areNotificationsEnabled();
  if (!enabled) return;

  await Notifications.cancelScheduledNotificationAsync('morning-briefing').catch(() => {});

  const now = new Date();
  const target = new Date();
  target.setHours(8, 0, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }

  await Notifications.scheduleNotificationAsync({
    identifier: 'morning-briefing',
    content: {
      title: 'Good morning! \uD83C\uDFAF',
      body: 'Set your energy level and plan your day.',
      data: { screen: 'today' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: target,
    },
  });
}

export async function scheduleStreakProtection(streak: number) {
  if (Platform.OS === 'web') return;
  await Notifications.cancelScheduledNotificationAsync('streak-protection').catch(() => {});
  const trigger = new Date();
  trigger.setHours(19, 0, 0, 0);
  if (trigger <= new Date()) return;
  const emoji = streak > 0 ? `\u26A1 ${streak}-day streak at risk!` : '\u26A1 Start your streak today!';
  await Notifications.scheduleNotificationAsync({
    identifier: 'streak-protection',
    content: {
      title: emoji,
      body: 'Complete a task before midnight to keep it going.',
      data: { screen: 'today' },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: trigger },
  });
}

export async function cancelStreakProtection() {
  if (Platform.OS === 'web') return;
  await Notifications.cancelScheduledNotificationAsync('streak-protection').catch(() => {});
}

export async function scheduleGoalNudges(goals: Goal[]) {
  if (Platform.OS === 'web') return;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of scheduled) {
    if (n.identifier.startsWith('goal-nudge-')) {
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
    }
  }
  const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
  for (const goal of goals) {
    const lastUpdated = goal.updatedAt ? new Date(goal.updatedAt).getTime() : 0;
    if (lastUpdated < threeDaysAgo) {
      const days = Math.floor((Date.now() - lastUpdated) / 86400000);
      const trigger = new Date();
      trigger.setDate(trigger.getDate() + 1);
      trigger.setHours(9, 0, 0, 0);
      await Notifications.scheduleNotificationAsync({
        identifier: `goal-nudge-${goal.id}`,
        content: {
          title: `Your ${goal.category} goal needs attention`,
          body: `No progress in ${days} days \u2014 even a small step counts.`,
          data: { screen: 'goals' },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: trigger },
      });
    }
  }
}

function parseEventTime(timeStr: string): Date {
  const [time, modifier] = timeStr.split(' ');
  let [hours, minutes] = time.split(':').map(Number);
  if (modifier === 'PM' && hours < 12) hours += 12;
  if (modifier === 'AM' && hours === 12) hours = 0;
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  return d;
}

export interface CalendarEvent {
  title: string;
  time?: string;
}

export async function scheduleEveningAccountability(incompleteTasks: Task[], commitments: Commitment[]) {
  if (Platform.OS === 'web') return;
  const enabled = await areNotificationsEnabled();
  if (!enabled) return;

  await Notifications.cancelScheduledNotificationAsync('evening-accountability').catch(() => {});

  const hasIncomplete = incompleteTasks.some(t => !t.completed);
  if (!hasIncomplete && commitments.length === 0) return;

  const trigger = new Date();
  trigger.setHours(20, 0, 0, 0);
  if (trigger <= new Date()) return;

  await Notifications.scheduleNotificationAsync({
    identifier: 'evening-accountability',
    content: {
      title: "Jarvis checking in \uD83D\uDC41\uFE0F",
      body: hasIncomplete
        ? `You still have ${incompleteTasks.filter(t => !t.completed).length} tasks open. Did you get to them?`
        : `How did you do on your commitments today?`,
      data: { screen: 'coach' },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: trigger },
  });
}

export async function scheduleMidDayNudge() {
  if (Platform.OS === 'web') return;
  const enabled = await areNotificationsEnabled();
  if (!enabled) return;

  await Notifications.cancelScheduledNotificationAsync('midday-nudge').catch(() => {});

  const trigger = new Date();
  trigger.setHours(13, 0, 0, 0);
  if (trigger <= new Date()) return;

  await Notifications.scheduleNotificationAsync({
    identifier: 'midday-nudge',
    content: {
      title: "Still nothing done? \uD83D\uDD25",
      body: "Jarvis says it's time to start. One thing. Right now.",
      data: { screen: 'today' },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: trigger },
  });
}

export async function cancelMidDayNudge() {
  if (Platform.OS === 'web') return;
  await Notifications.cancelScheduledNotificationAsync('midday-nudge').catch(() => {});
}

export async function scheduleCommitmentDueDateReminder(commitments: Commitment[]) {
  if (Platform.OS === 'web') return;
  const enabled = await areNotificationsEnabled();
  if (!enabled) return;

  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of scheduled) {
    if (n.identifier.startsWith('commitment-due-')) {
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
    }
  }

  const today = getTodayKey();
  const dueToday = commitments.filter(c => c.dueDate === today && c.status === 'pending');

  for (const c of dueToday) {
    const trigger = new Date();
    trigger.setHours(10, 0, 0, 0);
    if (trigger <= new Date()) continue;

    await Notifications.scheduleNotificationAsync({
      identifier: `commitment-due-${c.id}`,
      content: {
        title: "Commitment due today \u23F0",
        body: `You said you'd: "${c.content}"`,
        data: { screen: 'coach' },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: trigger },
    });
  }
}

export async function scheduleWeeklyReview() {
  if (Platform.OS === 'web') return;
  const enabled = await areNotificationsEnabled();
  if (!enabled) return;

  await Notifications.cancelScheduledNotificationAsync('weekly-review').catch(() => {});

  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const trigger = new Date();
  trigger.setDate(trigger.getDate() + daysUntilSunday);
  trigger.setHours(19, 0, 0, 0);
  if (trigger <= now) {
    trigger.setDate(trigger.getDate() + 7);
  }

  await Notifications.scheduleNotificationAsync({
    identifier: 'weekly-review',
    content: {
      title: "Time for your weekly review \uD83D\uDCCB",
      body: "Let's look at what you accomplished this week with Jarvis.",
      data: { screen: 'coach' },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: trigger },
  });
}

export async function scheduleMeetingPrepAlerts(events: CalendarEvent[]) {
  if (Platform.OS === 'web') return;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of scheduled) {
    if (n.identifier.startsWith('meeting-prep-')) {
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
    }
  }
  for (const event of events) {
    if (!event.time) continue;
    try {
      const eventTime = parseEventTime(event.time);
      const alertTime = new Date(eventTime.getTime() - 15 * 60000);
      if (alertTime <= new Date()) continue;
      await Notifications.scheduleNotificationAsync({
        identifier: `meeting-prep-${event.title}-${event.time}`,
        content: {
          title: `\uD83D\uDCC5 ${event.title} in 15 min`,
          body: 'Anything to prep before you jump on?',
          data: { screen: 'today' },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: alertTime },
      });
    } catch {}
  }
}
