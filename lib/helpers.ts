export function getCategoryColor(category: string): string {
  const map: Record<string, string> = {
    calendar: '#6366F1',
    fitness: '#10B981',
    finance: '#F59E0B',
    career: '#8B5CF6',
    personal: '#EC4899',
    social: '#3B82F6',
    activity: '#10B981',
    date_night: '#EC4899',
    wellness: '#14B8A6',
  };
  return map[category] || '#6366F1';
}

export function getCategoryIcon(category: string): string {
  const map: Record<string, string> = {
    calendar: 'calendar-outline',
    fitness: 'fitness-outline',
    finance: 'cash-outline',
    career: 'briefcase-outline',
    personal: 'person-outline',
    social: 'people-outline',
  };
  return map[category] || 'ellipse-outline';
}

export function getCategoryLabel(category: string): string {
  const map: Record<string, string> = {
    calendar: 'Calendar',
    fitness: 'Fitness',
    finance: 'Finance',
    career: 'Career',
    personal: 'Personal',
    social: 'Social',
    activity: 'Activity',
    date_night: 'Date Night',
    wellness: 'Wellness',
  };
  return map[category] || category;
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  };
  return date.toLocaleDateString('en-US', options);
}

export function getProgressPercentage(current: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(Math.round((current / target) * 100), 100);
}
