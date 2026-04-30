"use client";

import { useEffect, useState } from "react";

type Task = {
  id: string;
  title: string;
  description: string | null;
  scheduledAt: string;
  recurrence: string | null;
  completedAt: string | null;
  active: boolean;
};

type SystemJob = {
  id: string;
  type: string;
  label: string;
  timeLabel: string;
  dayLabel: string;
  recurrence: string;
  hour: number;
  minute: number;
};

export default function CalendarPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sysJobs, setSysJobs] = useState<SystemJob[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    Promise.all([
      fetch("/api/proxy/jarvis/scheduled-tasks").then((r) => r.json()),
      fetch("/api/proxy/jarvis/system-schedule").then((r) => r.json()),
    ])
      .then(([t, s]) => {
        setTasks(Array.isArray(t) ? t : []);
        setSysJobs(Array.isArray(s) ? s : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  if (loading)
    return (
      <div style={centerStyle}>
        <Spinner />
      </div>
    );

  const now = new Date();
  const upcoming = tasks
    .filter((t) => t.active && !t.completedAt)
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

  const groupByDay = (items: Task[]) => {
    const groups: Record<string, Task[]> = {};
    items.forEach((t) => {
      const d = new Date(t.scheduledAt);
      const key = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });
    return groups;
  };

  const groups = groupByDay(upcoming);

  return (
    <div style={{ padding: 28 }}>
      <PageHeader title="SYSTEM SCHEDULE" subtitle="Upcoming tasks & recurring operations" onRefresh={load} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginTop: 24 }}>
        {/* User Tasks */}
        <div>
          <SectionHeader label="SCHEDULED TASKS" count={upcoming.length} color="#22c55e" />
          <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 16 }}>
            {Object.entries(groups).map(([day, dayTasks]) => (
              <div key={day}>
                <div
                  style={{
                    fontSize: 9,
                    letterSpacing: "0.15em",
                    color: "#a855f7",
                    marginBottom: 8,
                    paddingBottom: 6,
                    borderBottom: "1px solid #a855f720",
                  }}
                >
                  {day.toUpperCase()}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {dayTasks.map((t) => (
                    <UserTaskRow key={t.id} task={t} now={now} />
                  ))}
                </div>
              </div>
            ))}
            {upcoming.length === 0 && (
              <EmptySlot label="No upcoming tasks scheduled" />
            )}
          </div>
        </div>

        {/* System Jobs */}
        <div>
          <SectionHeader label="SYSTEM CRON JOBS" count={sysJobs.length} color="#6b7280" />
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 16 }}>
            {sysJobs.map((job) => (
              <SystemJobRow key={job.id} job={job} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function UserTaskRow({ task, now }: { task: Task; now: Date }) {
  const scheduled = new Date(task.scheduledAt);
  const diffMs = scheduled.getTime() - now.getTime();
  const diffH = Math.floor(diffMs / 3600000);
  const diffM = Math.floor((diffMs % 3600000) / 60000);
  const isOverdue = diffMs < 0;
  const countdown = isOverdue
    ? "OVERDUE"
    : diffH > 0
    ? `in ${diffH}h ${diffM}m`
    : diffM > 0
    ? `in ${diffM}m`
    : "NOW";

  return (
    <div
      style={{
        backgroundColor: "#111219",
        border: "1px solid #1e2035",
        borderRadius: 8,
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "#e8eaed",
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {task.title}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        {task.recurrence && (
          <span
            style={{
              fontSize: 8,
              padding: "1px 5px",
              borderRadius: 3,
              backgroundColor: "#22c55e18",
              color: "#22c55e",
              letterSpacing: "0.08em",
            }}
          >
            {task.recurrence}
          </span>
        )}
        <span
          style={{
            fontSize: 9,
            color: isOverdue ? "#ef4444" : "#6b7280",
            fontWeight: isOverdue ? 600 : 400,
          }}
        >
          {scheduled.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
        </span>
        <span
          style={{
            fontSize: 9,
            color: isOverdue ? "#ef444480" : "#2a2d40",
          }}
        >
          {countdown}
        </span>
      </div>
    </div>
  );
}

function SystemJobRow({ job }: { job: SystemJob }) {
  const isDaily = job.recurrence === "daily";
  const isContinuous = job.hour < 0;

  return (
    <div
      style={{
        backgroundColor: "#111219",
        border: "1px solid #1e2035",
        borderRadius: 8,
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          backgroundColor: isContinuous ? "#22c55e" : "#6b7280",
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            color: "#e8eaed",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {job.label}
        </div>
        <div style={{ fontSize: 9, color: "#6b7280", marginTop: 2 }}>
          {job.dayLabel}
        </div>
      </div>
      <div
        style={{
          fontSize: 10,
          color: "#a855f7",
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        {job.timeLabel}
      </div>
      <span
        style={{
          fontSize: 8,
          padding: "1px 5px",
          borderRadius: 3,
          backgroundColor: isDaily ? "#22c55e18" : "#a855f718",
          color: isDaily ? "#22c55e" : "#a855f7",
          letterSpacing: "0.06em",
          flexShrink: 0,
        }}
      >
        {job.recurrence}
      </span>
    </div>
  );
}

function SectionHeader({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        paddingBottom: 10,
        borderBottom: `1px solid ${color}22`,
      }}
    >
      <div style={{ width: 5, height: 5, borderRadius: "50%", backgroundColor: color }} />
      <span style={{ fontSize: 9, letterSpacing: "0.15em", color, fontWeight: 600 }}>{label}</span>
      <span
        style={{
          marginLeft: "auto",
          fontSize: 9,
          color: "#2a2d40",
          backgroundColor: "#16171f",
          padding: "1px 6px",
          borderRadius: 8,
        }}
      >
        {count}
      </span>
    </div>
  );
}

function EmptySlot({ label }: { label: string }) {
  return (
    <div
      style={{
        padding: 20,
        textAlign: "center",
        fontSize: 11,
        color: "#2a2d40",
        border: "1px dashed #1e2035",
        borderRadius: 8,
      }}
    >
      {label}
    </div>
  );
}

function PageHeader({
  title,
  subtitle,
  onRefresh,
}: {
  title: string;
  subtitle: string;
  onRefresh?: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
      <div>
        <h1
          style={{
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: "0.12em",
            color: "#e8eaed",
            margin: 0,
          }}
        >
          {title}
        </h1>
        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>{subtitle}</div>
      </div>
      {onRefresh && (
        <button
          onClick={onRefresh}
          style={{
            fontSize: 10,
            padding: "6px 14px",
            borderRadius: 6,
            border: "1px solid #1e2035",
            backgroundColor: "transparent",
            color: "#6b7280",
            cursor: "pointer",
            letterSpacing: "0.08em",
          }}
        >
          ↺ REFRESH
        </button>
      )}
    </div>
  );
}

const centerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  minHeight: 400,
};

function Spinner() {
  return (
    <>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div
        style={{
          width: 24,
          height: 24,
          border: "2px solid #1e2035",
          borderTop: "2px solid #22c55e",
          borderRadius: "50%",
          animation: "spin 1s linear infinite",
        }}
      />
    </>
  );
}
