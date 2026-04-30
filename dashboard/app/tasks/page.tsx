"use client";

import { useEffect, useState } from "react";

type Task = {
  id: string;
  title: string;
  description: string | null;
  scheduledAt: string;
  recurrence: string | null;
  completedAt: string | null;
  inProgressAt: string | null;
  active: boolean;
};

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetch("/api/proxy/jarvis/scheduled-tasks")
      .then((r) => r.json())
      .then((data) => {
        setTasks(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  };

  useEffect(() => {
    load();
  }, []);

  const complete = async (id: string) => {
    await fetch(`/api/proxy/jarvis/scheduled-tasks/${id}/complete`, { method: "PATCH" });
    load();
  };

  if (loading) return <LoadingState label="LOADING TASK QUEUE" />;
  if (error) return <ErrorState msg={error} />;

  const backlog = tasks.filter((t) => t.active && !t.completedAt && !t.inProgressAt);
  const active = tasks.filter((t) => t.active && !t.completedAt && t.inProgressAt);
  const done = tasks.filter((t) => t.completedAt).slice(-8).reverse();

  return (
    <div style={{ padding: 28, minHeight: "100%" }}>
      <PageHeader
        title="TASK QUEUE"
        subtitle="Jarvis scheduled operations"
        badge={`${tasks.filter((t) => t.active && !t.completedAt).length} active`}
        onRefresh={load}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 20,
          marginTop: 24,
        }}
      >
        <Column title="BACKLOG" count={backlog.length} color="#6b7280">
          {backlog.map((t) => (
            <TaskCard key={t.id} task={t} onComplete={() => complete(t.id)} />
          ))}
        </Column>
        <Column title="IN PROGRESS" count={active.length} color="#22c55e">
          {active.map((t) => (
            <TaskCard key={t.id} task={t} variant="active" onComplete={() => complete(t.id)} />
          ))}
        </Column>
        <Column title="COMPLETED" count={done.length} color="#a855f7">
          {done.map((t) => (
            <TaskCard key={t.id} task={t} variant="done" />
          ))}
        </Column>
      </div>
    </div>
  );
}

function Column({
  title,
  count,
  color,
  children,
}: {
  title: string;
  count: number;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
          paddingBottom: 10,
          borderBottom: `1px solid ${color}22`,
        }}
      >
        <div style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: color }} />
        <span style={{ fontSize: 10, letterSpacing: "0.15em", color, fontWeight: 600 }}>
          {title}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 10,
            color: "#2a2d40",
            backgroundColor: "#16171f",
            padding: "1px 7px",
            borderRadius: 10,
          }}
        >
          {count}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {children}
        {count === 0 && (
          <div
            style={{
              padding: 16,
              textAlign: "center",
              fontSize: 11,
              color: "#2a2d40",
              border: "1px dashed #1e2035",
              borderRadius: 8,
            }}
          >
            — empty —
          </div>
        )}
      </div>
    </div>
  );
}

function TaskCard({
  task,
  variant = "default",
  onComplete,
}: {
  task: Task;
  variant?: "default" | "active" | "done";
  onComplete?: () => void;
}) {
  const borderColor =
    variant === "active" ? "#22c55e33" : variant === "done" ? "#a855f733" : "#1e2035";
  const dotColor =
    variant === "active" ? "#22c55e" : variant === "done" ? "#a855f7" : "#6b7280";

  const scheduled = new Date(task.scheduledAt);
  const dateStr = scheduled.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const timeStr = scheduled.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  return (
    <div
      style={{
        backgroundColor: "#111219",
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        padding: "12px 14px",
        position: "relative",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            backgroundColor: dotColor,
            marginTop: 4,
            flexShrink: 0,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 12,
              color: variant === "done" ? "#6b7280" : "#e8eaed",
              lineHeight: 1.4,
              textDecoration: variant === "done" ? "line-through" : "none",
              marginBottom: 6,
              wordBreak: "break-word",
            }}
          >
            {task.title}
          </div>

          {task.description && variant !== "done" && (
            <div
              style={{
                fontSize: 10,
                color: "#6b7280",
                lineHeight: 1.4,
                marginBottom: 8,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {task.description}
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {task.recurrence && (
              <Badge label={task.recurrence} color="#22c55e" />
            )}
            <span style={{ fontSize: 9, color: "#2a2d40", letterSpacing: "0.05em" }}>
              {dateStr} · {timeStr}
            </span>
          </div>
        </div>
      </div>

      {onComplete && variant !== "done" && (
        <button
          onClick={onComplete}
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            width: 20,
            height: 20,
            borderRadius: 4,
            border: "1px solid #1e2035",
            backgroundColor: "transparent",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#2a2d40",
            fontSize: 10,
          }}
          title="Mark complete"
        >
          ✓
        </button>
      )}
    </div>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        fontSize: 9,
        padding: "2px 6px",
        borderRadius: 4,
        backgroundColor: `${color}18`,
        color,
        border: `1px solid ${color}30`,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      {label}
    </span>
  );
}

function PageHeader({
  title,
  subtitle,
  badge,
  onRefresh,
}: {
  title: string;
  subtitle: string;
  badge?: string;
  onRefresh?: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
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
          {badge && (
            <span
              style={{
                fontSize: 9,
                padding: "2px 8px",
                borderRadius: 10,
                backgroundColor: "#22c55e18",
                color: "#22c55e",
                border: "1px solid #22c55e30",
                letterSpacing: "0.1em",
              }}
            >
              {badge}
            </span>
          )}
        </div>
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

function LoadingState({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        minHeight: 400,
        flexDirection: "column",
        gap: 12,
      }}
    >
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
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <span style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.15em" }}>{label}</span>
    </div>
  );
}

function ErrorState({ msg }: { msg: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        minHeight: 400,
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ fontSize: 10, color: "#ef4444", letterSpacing: "0.1em" }}>
        ⚠ CONNECTION ERROR
      </div>
      <div style={{ fontSize: 10, color: "#6b7280" }}>{msg}</div>
    </div>
  );
}
