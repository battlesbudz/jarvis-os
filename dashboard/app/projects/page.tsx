"use client";

import { useEffect, useState } from "react";

type Goal = {
  id?: string;
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  progress?: number;
  category?: string;
  dueDate?: string;
  tags?: string[];
};

export default function ProjectsPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch("/api/proxy/goals")
      .then((r) => r.json())
      .then((data) => {
        setGoals(Array.isArray(data.goals) ? data.goals : []);
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

  const active = goals.filter((g) => g.status !== "complete" && g.status !== "completed" && g.status !== "done");
  const complete = goals.filter((g) => g.status === "complete" || g.status === "completed" || g.status === "done");

  return (
    <div style={{ padding: 28 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28 }}>
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
            MISSION OBJECTIVES
          </h1>
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
            Strategic goals · {active.length} active · {complete.length} complete
          </div>
        </div>
        <button
          onClick={load}
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
      </div>

      {goals.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {active.length > 0 && (
            <div style={{ marginBottom: 32 }}>
              <div
                style={{
                  fontSize: 9,
                  letterSpacing: "0.18em",
                  color: "#22c55e",
                  marginBottom: 14,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <div style={{ width: 4, height: 4, borderRadius: "50%", backgroundColor: "#22c55e" }} />
                ACTIVE OBJECTIVES
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                  gap: 16,
                }}
              >
                {active.map((g, i) => (
                  <GoalCard key={g.id || i} goal={g} />
                ))}
              </div>
            </div>
          )}

          {complete.length > 0 && (
            <div>
              <div
                style={{
                  fontSize: 9,
                  letterSpacing: "0.18em",
                  color: "#6b7280",
                  marginBottom: 14,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <div style={{ width: 4, height: 4, borderRadius: "50%", backgroundColor: "#6b7280" }} />
                COMPLETED
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                  gap: 16,
                }}
              >
                {complete.map((g, i) => (
                  <GoalCard key={g.id || i} goal={g} done />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function GoalCard({ goal, done = false }: { goal: Goal; done?: boolean }) {
  const progress = goal.progress ?? 0;
  const priority = goal.priority?.toLowerCase() ?? "medium";
  const priorityColor =
    priority === "high" || priority === "critical"
      ? "#ef4444"
      : priority === "medium"
      ? "#eab308"
      : "#6b7280";

  const category = goal.category ?? "General";

  return (
    <div
      style={{
        backgroundColor: "#111219",
        border: done ? "1px solid #1e2035" : "1px solid #1e2035",
        borderRadius: 10,
        padding: "16px 18px",
        opacity: done ? 0.6 : 1,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Top accent line */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          backgroundColor: done ? "#6b7280" : "#22c55e",
          opacity: 0.6,
        }}
      />

      {/* Category */}
      <div
        style={{
          fontSize: 8,
          letterSpacing: "0.15em",
          color: "#6b7280",
          marginBottom: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span>{category.toUpperCase()}</span>
        {goal.priority && (
          <span
            style={{
              fontSize: 8,
              padding: "1px 5px",
              borderRadius: 3,
              backgroundColor: `${priorityColor}18`,
              color: priorityColor,
              letterSpacing: "0.06em",
            }}
          >
            {goal.priority.toUpperCase()}
          </span>
        )}
      </div>

      {/* Title */}
      <div
        style={{
          fontSize: 13,
          color: done ? "#6b7280" : "#e8eaed",
          fontWeight: 600,
          lineHeight: 1.4,
          marginBottom: 8,
          textDecoration: done ? "line-through" : "none",
        }}
      >
        {goal.title || "Untitled Goal"}
      </div>

      {/* Description */}
      {goal.description && (
        <div
          style={{
            fontSize: 10,
            color: "#6b7280",
            lineHeight: 1.5,
            marginBottom: 12,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {goal.description}
        </div>
      )}

      {/* Progress bar */}
      {progress > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 9,
              color: "#6b7280",
              marginBottom: 4,
            }}
          >
            <span>Progress</span>
            <span style={{ color: "#22c55e" }}>{progress}%</span>
          </div>
          <div
            style={{
              height: 3,
              backgroundColor: "#1e2035",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${progress}%`,
                height: "100%",
                backgroundColor: done ? "#6b7280" : "#22c55e",
                borderRadius: 2,
              }}
            />
          </div>
        </div>
      )}

      {/* Tags */}
      {goal.tags && goal.tags.length > 0 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {goal.tags.slice(0, 3).map((tag, i) => (
            <span
              key={i}
              style={{
                fontSize: 8,
                padding: "1px 5px",
                borderRadius: 3,
                backgroundColor: "#a855f718",
                color: "#a855f7",
                letterSpacing: "0.04em",
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Due date */}
      {goal.dueDate && (
        <div style={{ fontSize: 9, color: "#2a2d40", marginTop: 8 }}>
          Due: {new Date(goal.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 60,
        gap: 12,
        border: "1px dashed #1e2035",
        borderRadius: 12,
        marginTop: 20,
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: "50%",
          border: "2px solid #1e2035",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 18,
          color: "#2a2d40",
        }}
      >
        ◈
      </div>
      <div style={{ fontSize: 12, color: "#6b7280", textAlign: "center" }}>
        No mission objectives loaded
      </div>
      <div style={{ fontSize: 10, color: "#2a2d40", textAlign: "center" }}>
        Ask Jarvis to set goals or objectives to see them here
      </div>
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
