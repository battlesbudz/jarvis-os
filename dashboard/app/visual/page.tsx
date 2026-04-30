"use client";

import { useEffect, useState } from "react";
import VisionSprite from "@/components/VisionSprite";

type Agent = {
  id: string;
  name: string;
  role: string;
  isActive: number;
  loopEnabled: number;
  loopIntervalMinutes: number | null;
  lastHeartbeatAt: string | null;
  stuckSince: string | null;
  heartbeatFailCount: number;
  channelName: string | null;
  persona: string | null;
  platforms: string[];
  preferredModel: string | null;
};

const ROLE_COLORS: Record<string, string> = {
  orchestrator: "#a855f7",
  research: "#22c55e",
  comms: "#06b6d4",
  planning: "#eab308",
  monitoring: "#f97316",
  coding: "#22c55e",
  content: "#ec4899",
  custom: "#6b7280",
};

const ROLE_TINTS: Record<string, string> = {
  orchestrator: "#7c3aed",
  research: "#16a34a",
  comms: "#0891b2",
  planning: "#ca8a04",
  monitoring: "#ea580c",
  coding: "#16a34a",
  content: "#db2777",
  custom: "#374151",
};

export default function VisualOfficePage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch("/api/proxy/agents")
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : Array.isArray(data.agents) ? data.agents : [];
        setAgents(list);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading)
    return (
      <div style={centerStyle}>
        <Spinner />
      </div>
    );

  const online = agents.filter((a) => a.isActive && !a.stuckSince);
  const stuck = agents.filter((a) => a.stuckSince);
  const offline = agents.filter((a) => !a.isActive && !a.stuckSince);

  return (
    <div style={{ padding: 28 }}>
      {/* Header */}
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
            VISUAL OFFICE
          </h1>
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
            PRIME crew · {online.length} online · {stuck.length} stuck · {offline.length} offline
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <StatusTicker agents={agents} />
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
      </div>

      {agents.length === 0 ? (
        <EmptyState />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: 16,
          }}
        >
          {agents.map((agent) => (
            <AgentRoom key={agent.id} agent={agent} />
          ))}
        </div>
      )}
    </div>
  );
}

function AgentRoom({ agent }: { agent: Agent }) {
  const isOnline = agent.isActive === 1;
  const isStuck = !!agent.stuckSince;
  const isLooping = agent.loopEnabled === 1;

  const role = (agent.role || "custom").toLowerCase();
  const color = ROLE_COLORS[role] || ROLE_COLORS.custom;
  const tint = ROLE_TINTS[role] || ROLE_TINTS.custom;

  const statusColor = isStuck ? "#ef4444" : isOnline ? "#22c55e" : "#6b7280";
  const statusLabel = isStuck ? "STUCK" : isOnline ? "ONLINE" : "OFFLINE";

  const lastSeen = agent.lastHeartbeatAt
    ? timeAgo(new Date(agent.lastHeartbeatAt))
    : "never";

  return (
    <div
      style={{
        backgroundColor: "#111219",
        border: `1px solid ${isStuck ? "#ef4444" : isOnline ? color + "30" : "#1e2035"}`,
        borderRadius: 12,
        padding: "20px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Top glow line */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          backgroundColor: statusColor,
          opacity: isOnline ? 0.8 : 0.2,
        }}
      />

      {/* Vision sprite + name */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            position: "relative",
            opacity: isOnline ? 1 : 0.4,
          }}
        >
          <VisionSprite size={48} tint={tint} />
          {isLooping && (
            <div
              style={{
                position: "absolute",
                bottom: 0,
                right: 0,
                width: 10,
                height: 10,
                borderRadius: "50%",
                backgroundColor: "#22c55e",
                border: "2px solid #09090f",
              }}
            />
          )}
        </div>
        <div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: isOnline ? "#e8eaed" : "#6b7280",
              letterSpacing: "0.05em",
            }}
          >
            {agent.name}
          </div>
          <div
            style={{
              fontSize: 9,
              color,
              letterSpacing: "0.12em",
              marginTop: 2,
            }}
          >
            {role.toUpperCase()}
          </div>
        </div>
      </div>

      {/* Status badge */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            backgroundColor: statusColor,
          }}
        />
        <span style={{ fontSize: 9, color: statusColor, letterSpacing: "0.12em", fontWeight: 600 }}>
          {statusLabel}
        </span>
        {isLooping && agent.loopIntervalMinutes && (
          <span style={{ fontSize: 8, color: "#6b7280", marginLeft: "auto" }}>
            ↺ every {agent.loopIntervalMinutes}m
          </span>
        )}
      </div>

      {/* Meta */}
      <div
        style={{
          borderTop: "1px solid #1e2035",
          paddingTop: 10,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {agent.channelName && (
          <MetaRow label="Channel" value={`#${agent.channelName}`} />
        )}
        {agent.platforms && agent.platforms.length > 0 && (
          <MetaRow label="Platform" value={agent.platforms.join(", ")} />
        )}
        {agent.preferredModel && (
          <MetaRow label="Model" value={agent.preferredModel.replace("claude-", "")} />
        )}
        <MetaRow label="Last seen" value={lastSeen} dim />
        {agent.heartbeatFailCount > 0 && (
          <MetaRow label="Failures" value={String(agent.heartbeatFailCount)} color="#ef4444" />
        )}
      </div>

      {/* Persona preview */}
      {agent.persona && (
        <div
          style={{
            fontSize: 9,
            color: "#2a2d40",
            lineHeight: 1.5,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            fontStyle: "italic",
          }}
        >
          "{agent.persona.slice(0, 120)}{agent.persona.length > 120 ? "…" : ""}"
        </div>
      )}
    </div>
  );
}

function MetaRow({
  label,
  value,
  dim,
  color,
}: {
  label: string;
  value: string;
  dim?: boolean;
  color?: string;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
      <span style={{ fontSize: 9, color: "#2a2d40" }}>{label}</span>
      <span
        style={{
          fontSize: 9,
          color: color || (dim ? "#2a2d40" : "#6b7280"),
          textAlign: "right",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function StatusTicker({ agents }: { agents: Agent[] }) {
  const online = agents.filter((a) => a.isActive).length;
  const stuck = agents.filter((a) => a.stuckSince).length;

  return (
    <div
      style={{
        backgroundColor: "#111219",
        border: "1px solid #1e2035",
        borderRadius: 6,
        padding: "4px 12px",
        fontSize: 9,
        letterSpacing: "0.1em",
        color: "#6b7280",
        display: "flex",
        gap: 12,
      }}
    >
      <span>
        <span style={{ color: "#22c55e" }}>{online}</span> ONLINE
      </span>
      {stuck > 0 && (
        <span>
          <span style={{ color: "#ef4444" }}>{stuck}</span> STUCK
        </span>
      )}
      <span>{agents.length} TOTAL</span>
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
        gap: 16,
        border: "1px dashed #1e2035",
        borderRadius: 12,
      }}
    >
      <VisionSprite size={64} />
      <div style={{ fontSize: 12, color: "#6b7280", textAlign: "center" }}>
        No agents in the crew
      </div>
      <div style={{ fontSize: 10, color: "#2a2d40", textAlign: "center" }}>
        Create agents via the Agents tab in the Jarvis app
      </div>
    </div>
  );
}

function timeAgo(date: Date): string {
  const now = new Date();
  const diffS = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diffS < 60) return `${diffS}s ago`;
  if (diffS < 3600) return `${Math.floor(diffS / 60)}m ago`;
  if (diffS < 86400) return `${Math.floor(diffS / 3600)}h ago`;
  return `${Math.floor(diffS / 86400)}d ago`;
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
