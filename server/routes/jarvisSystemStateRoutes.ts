import type { Express, Request, Response } from "express";

export function registerJarvisSystemStateRoutes(app: Express): void {
  app.get("/api/jarvis/system-schedule", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const DAYS: Record<number, string> = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };
    const LABELS: Record<string, string> = {
      morning: 'Morning Brief → Telegram',
      commitment_check: 'Commitment Check → Telegram',
      followup_check: 'Follow-Up Check → Telegram',
      momentum_nudge: 'Momentum Nudge → Telegram',
      weekly_planning: 'Weekly Planning Brief → Telegram',
      morning_plan_build: 'Build Today\'s Task Plan',
      email_scan: 'Email Alert Scan',
      weekly_pattern: 'Weekly Pattern Analysis',
    };
    const ICONS: Record<string, string> = {
      morning: 'sunny-outline',
      commitment_check: 'checkmark-circle-outline',
      followup_check: 'refresh-circle-outline',
      momentum_nudge: 'flash-outline',
      weekly_planning: 'calendar-outline',
      morning_plan_build: 'construct-outline',
      email_scan: 'mail-outline',
      weekly_pattern: 'analytics-outline',
    };
    const recurring = [
      { id: 'sys_morning_plan', type: 'morning_plan_build', hour: 7, minute: 0, recurrence: 'daily', dayOfWeek: null },
      { id: 'sys_morning',      type: 'morning',            hour: 8, minute: 0, recurrence: 'daily', dayOfWeek: null },
      { id: 'sys_commit',       type: 'commitment_check',   hour: 10, minute: 0, recurrence: 'daily', dayOfWeek: null },
      { id: 'sys_followup',     type: 'followup_check',     hour: 12, minute: 0, recurrence: 'daily', dayOfWeek: null },
      { id: 'sys_nudge',        type: 'momentum_nudge',     hour: 14, minute: 0, recurrence: 'daily', dayOfWeek: null },
      { id: 'sys_email_scan',   type: 'email_scan',         hour: -1, minute: -1, recurrence: 'every 30 min', dayOfWeek: null },
      { id: 'sys_weekly_plan',  type: 'weekly_planning',    hour: 19, minute: 0, recurrence: 'weekly', dayOfWeek: 0 },
      { id: 'sys_weekly_pat',   type: 'weekly_pattern',     hour: 3,  minute: 0, recurrence: 'weekly', dayOfWeek: 0 },
    ].map(t => ({
      ...t,
      label: LABELS[t.type] ?? t.type,
      icon: ICONS[t.type] ?? 'time-outline',
      timeLabel: t.hour < 0 ? 'Continuous' : `${t.hour === 0 ? 12 : t.hour > 12 ? t.hour - 12 : t.hour}:${String(t.minute).padStart(2, '0')} ${t.hour < 12 ? 'AM' : 'PM'}`,
      dayLabel: t.recurrence === 'weekly' && t.dayOfWeek !== null ? DAYS[t.dayOfWeek] : 'Every day',
      isSystem: true,
    }));
    res.json(recurring);
  });

  app.get("/api/jarvis/emotional-state", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    try {
      const { getEmotionalState } = await import("../intelligence/emotional-state");
      const state = await getEmotionalState(userId);
      res.json(state ?? null);
    } catch (err) {
      console.error("[emotional-state] GET failed:", err);
      res.status(500).json({ error: "Failed to load emotional state" });
    }
  });

  app.post("/api/jarvis/emotional-state/override", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const { override } = req.body;
    const validOverrides = ["calm", "focused", "in flow", "stressed", "overwhelmed"];
    if (!override || !validOverrides.includes(override)) {
      return res.status(400).json({ error: `override must be one of: ${validOverrides.join(", ")}` });
    }
    try {
      const { setManualStateOverride } = await import("../intelligence/emotional-state");
      await setManualStateOverride(userId, override, new Date());
      res.json({ ok: true, override });
    } catch (err) {
      console.error("[emotional-state] override failed:", err);
      res.status(500).json({ error: "Failed to set override" });
    }
  });
}
