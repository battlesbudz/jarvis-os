import { Task } from './storage';

export async function requestNotificationPermissions(): Promise<boolean> {
  return false;
}

export async function setNotificationsEnabled(_enabled: boolean): Promise<void> {}

export async function areNotificationsEnabled(): Promise<boolean> {
  return false;
}

export async function scheduleTaskReminder(_task: Task): Promise<void> {}

export async function cancelTaskReminder(_taskId: string): Promise<void> {}

export async function cancelAllTaskReminders(): Promise<void> {}

export async function scheduleAllTaskReminders(_tasks: Task[]): Promise<void> {}

export async function scheduleNudge(_taskTitle: string): Promise<void> {}

export async function scheduleTimerNotification(_title: string, _body: string): Promise<void> {}
