import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { Task, getTodayKey } from './storage';
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
