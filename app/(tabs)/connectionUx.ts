export type ConnectionAppId =
  | 'gmail'
  | 'google-calendar'
  | 'outlook-mail'
  | 'outlook-calendar'
  | 'slack'
  | 'google-drive'
  | 'google-tasks';

export type ConnectionState = 'connected' | 'disconnected' | 'needs_reauth' | 'error' | 'testing' | string;

export interface ConnectionAppDefinition {
  id: ConnectionAppId;
  label: string;
  description: string;
  icon: string;
  color: string;
}

export interface ConnectionAppStatus {
  id: ConnectionAppId;
  state: ConnectionState;
  connected: boolean;
  accountLabel: string | null;
  error: string | null;
  updatedAt: string | null;
}

export interface ConnectionsStatus {
  apps: Record<ConnectionAppId, ConnectionAppStatus>;
  nextSteps: string[];
  error: string | null;
  updatedAt: string | null;
}

export interface ConnectionTestResult {
  ok: boolean | null;
  summary: string;
  error: string | null;
}

export const CONNECTION_APPS: ConnectionAppDefinition[] = [
  { id: 'gmail', label: 'Gmail', description: 'Email, drafts, labels, and inbox triage', icon: 'mail-outline', color: '#EA4335' },
  { id: 'google-calendar', label: 'Google Calendar', description: 'Events, availability, scheduling context', icon: 'calendar-outline', color: '#4285F4' },
  { id: 'outlook-mail', label: 'Outlook Mail', description: 'Microsoft inbox, replies, and follow-ups', icon: 'mail-open-outline', color: '#0078D4' },
  { id: 'outlook-calendar', label: 'Outlook Calendar', description: 'Microsoft calendar events and availability', icon: 'calendar-number-outline', color: '#2563EB' },
  { id: 'slack', label: 'Slack', description: 'Workspace messages, channels, and team context', icon: 'chatbubbles-outline', color: '#4A154B' },
  { id: 'google-drive', label: 'Google Drive', description: 'Docs, files, and saved workspace context', icon: 'folder-open-outline', color: '#34A853' },
  { id: 'google-tasks', label: 'Google Tasks', description: 'Task lists, reminders, and follow-through', icon: 'checkbox-outline', color: '#F9AB00' },
];

const APP_ID_ALIASES: Record<string, ConnectionAppId> = {
  gmail: 'gmail',
  googlemail: 'gmail',
  google_mail: 'gmail',
  'google-mail': 'gmail',
  googlecalendar: 'google-calendar',
  google_calendar: 'google-calendar',
  'google-calendar': 'google-calendar',
  calendar: 'google-calendar',
  outlookmail: 'outlook-mail',
  outlook_mail: 'outlook-mail',
  'outlook-mail': 'outlook-mail',
  microsoftmail: 'outlook-mail',
  microsoft_mail: 'outlook-mail',
  outlookcalendar: 'outlook-calendar',
  outlook_calendar: 'outlook-calendar',
  'outlook-calendar': 'outlook-calendar',
  microsoftcalendar: 'outlook-calendar',
  microsoft_calendar: 'outlook-calendar',
  slack: 'slack',
  googledrive: 'google-drive',
  google_drive: 'google-drive',
  'google-drive': 'google-drive',
  drive: 'google-drive',
  googletasks: 'google-tasks',
  google_tasks: 'google-tasks',
  'google-tasks': 'google-tasks',
  tasks: 'google-tasks',
};

const READY_STATES = new Set(['connected', 'operational', 'ready', 'healthy', 'ok', 'active']);
const REAUTH_STATES = new Set(['needs_reauth', 'needs-reauth', 'reauth', 'expired', 'attention', 'broken']);

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

export function normalizeConnectionAppId(value: unknown): ConnectionAppId | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, '-').replace(/_/g, '-').toLowerCase();
  return APP_ID_ALIASES[normalized] ?? APP_ID_ALIASES[normalized.replace(/-/g, '')] ?? null;
}

function createEmptyStatus(id: ConnectionAppId): ConnectionAppStatus {
  return {
    id,
    state: 'disconnected',
    connected: false,
    accountLabel: null,
    error: null,
    updatedAt: null,
  };
}

function inferConnected(raw: Record<string, any>, state: string): boolean {
  if (typeof raw.connected === 'boolean') return raw.connected;
  if (typeof raw.ready === 'boolean') return raw.ready;
  if (typeof raw.ok === 'boolean') return raw.ok;
  return READY_STATES.has(state);
}

function normalizeEntry(rawValue: unknown, fallbackId?: ConnectionAppId): ConnectionAppStatus | null {
  const raw = asRecord(rawValue);
  const id = normalizeConnectionAppId(raw.id ?? raw.appId ?? raw.app ?? raw.platform ?? raw.provider ?? raw.toolkit ?? fallbackId);
  if (!id) return null;

  const rawState = String(raw.state ?? raw.status ?? raw.health ?? (raw.connected === true ? 'connected' : 'disconnected')).toLowerCase();
  const state = REAUTH_STATES.has(rawState) ? 'needs_reauth' : rawState;
  const connected = inferConnected(raw, state);
  const accountLabel = raw.accountEmail ?? raw.email ?? raw.accountName ?? raw.name ?? raw.displayName ?? raw.key ?? null;
  const error = raw.error ?? raw.errorMessage ?? raw.message ?? null;

  return {
    id,
    state,
    connected,
    accountLabel: typeof accountLabel === 'string' && accountLabel.trim() ? accountLabel : null,
    error: typeof error === 'string' && error.trim() ? error : null,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : typeof raw.lastCheckedAt === 'string' ? raw.lastCheckedAt : null,
  };
}

function collectRawEntries(raw: Record<string, any>): [ConnectionAppId | undefined, unknown][] {
  const list = raw.connections ?? raw.platforms ?? raw.apps ?? raw.statuses ?? raw.items ?? raw.data?.connections ?? raw.data?.platforms ?? raw.data?.apps;
  if (Array.isArray(list)) return list.map((entry) => [undefined, entry]);
  if (list && typeof list === 'object') {
    return Object.entries(list).map(([key, value]) => [normalizeConnectionAppId(key) ?? undefined, value]);
  }
  return [];
}

export function normalizeConnectionsStatus(value: unknown): ConnectionsStatus {
  const raw = asRecord(value);
  const apps = CONNECTION_APPS.reduce((acc, app) => {
    acc[app.id] = createEmptyStatus(app.id);
    return acc;
  }, {} as Record<ConnectionAppId, ConnectionAppStatus>);

  for (const [fallbackId, entry] of collectRawEntries(raw)) {
    const normalized = normalizeEntry(entry, fallbackId);
    if (normalized) apps[normalized.id] = normalized;
  }

  const nextSteps = Array.isArray(raw.nextSteps) ? raw.nextSteps.filter((step): step is string => typeof step === 'string') : [];
  const error = typeof raw.error === 'string' ? raw.error : typeof raw.message === 'string' ? raw.message : null;
  const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : null;

  return { apps, nextSteps, error, updatedAt };
}

export function getConnectionStatusLabel(status: ConnectionAppStatus): 'Disconnect' | 'Reconnect' | 'Connect' {
  if (status.connected) return 'Disconnect';
  if (status.state === 'needs_reauth' || status.error) return 'Reconnect';
  return 'Connect';
}

export function normalizeConnectionTestResult(value: unknown): ConnectionTestResult {
  const raw = asRecord(value);
  const error = typeof raw.error === 'string' ? raw.error : typeof raw.message === 'string' && raw.ok === false ? raw.message : null;
  const summary =
    typeof raw.summary === 'string' && raw.summary.trim()
      ? raw.summary
      : error || (raw.ok === true ? 'Connection test passed.' : raw.ok === false ? 'Connection test failed.' : 'Connection test finished.');
  return {
    ok: typeof raw.ok === 'boolean' ? raw.ok : null,
    summary,
    error,
  };
}
