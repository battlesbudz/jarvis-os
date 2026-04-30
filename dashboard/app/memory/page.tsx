"use client";

import { useEffect, useState, useMemo } from "react";

type Memory = {
  id: string;
  content: string;
  category: string | null;
  memory_type: string | null;
  tier: string | null;
  confidence: number | null;
  extracted_at: string;
  source?: string | null;
};

const CATEGORIES = ["All", "fact", "preference", "skill", "goal", "relationship", "event", "other"];
const TIER_COLORS: Record<string, string> = {
  core: "#22c55e",
  working: "#a855f7",
  fading: "#6b7280",
};
const CATEGORY_COLORS: Record<string, string> = {
  fact: "#22c55e",
  preference: "#a855f7",
  skill: "#eab308",
  goal: "#f97316",
  relationship: "#06b6d4",
  event: "#ec4899",
  other: "#6b7280",
};

export default function MemoryPage() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [selected, setSelected] = useState<Memory | null>(null);

  const load = () => {
    setLoading(true);
    fetch("/api/proxy/memories")
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data.memories) ? data.memories : [];
        setMemories(list);
        if (list.length > 0 && !selected) setSelected(list[0]);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    return memories.filter((m) => {
      const matchCat = category === "All" || m.category === category;
      const matchSearch =
        !search ||
        m.content.toLowerCase().includes(search.toLowerCase()) ||
        (m.category || "").toLowerCase().includes(search.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [memories, search, category]);

  if (loading)
    return (
      <div style={centerStyle}>
        <Spinner />
      </div>
    );

  return (
    <div style={{ padding: 28, display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
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
            KNOWLEDGE BASE
          </h1>
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
            {memories.length.toLocaleString()} memories stored
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

      {/* Search */}
      <div style={{ marginBottom: 14 }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search memories..."
          style={{
            width: "100%",
            backgroundColor: "#111219",
            border: "1px solid #1e2035",
            borderRadius: 6,
            padding: "8px 14px",
            fontSize: 11,
            color: "#e8eaed",
            outline: "none",
            fontFamily: "inherit",
          }}
        />
      </div>

      {/* Category filter */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {CATEGORIES.map((cat) => {
          const color = cat === "All" ? "#6b7280" : CATEGORY_COLORS[cat] || "#6b7280";
          const active = category === cat;
          return (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              style={{
                fontSize: 9,
                padding: "3px 10px",
                borderRadius: 20,
                border: `1px solid ${active ? color : "#1e2035"}`,
                backgroundColor: active ? `${color}20` : "transparent",
                color: active ? color : "#6b7280",
                cursor: "pointer",
                letterSpacing: "0.08em",
                fontFamily: "inherit",
              }}
            >
              {cat.toUpperCase()}
            </button>
          );
        })}
      </div>

      {/* Main content: list + viewer */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "320px 1fr",
          gap: 16,
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        {/* Memory list */}
        <div
          style={{
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {filtered.slice(0, 100).map((m) => (
            <MemoryListItem
              key={m.id}
              memory={m}
              selected={selected?.id === m.id}
              onClick={() => setSelected(m)}
            />
          ))}
          {filtered.length === 0 && (
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
              No memories found
            </div>
          )}
          {filtered.length > 100 && (
            <div style={{ fontSize: 9, color: "#2a2d40", textAlign: "center", padding: 8 }}>
              Showing 100 of {filtered.length}
            </div>
          )}
        </div>

        {/* Memory viewer */}
        <div
          style={{
            backgroundColor: "#111219",
            border: "1px solid #1e2035",
            borderRadius: 10,
            padding: 20,
            overflowY: "auto",
          }}
        >
          {selected ? (
            <MemoryDetail memory={selected} />
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                fontSize: 11,
                color: "#2a2d40",
              }}
            >
              Select a memory to view
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MemoryListItem({
  memory,
  selected,
  onClick,
}: {
  memory: Memory;
  selected: boolean;
  onClick: () => void;
}) {
  const catColor = CATEGORY_COLORS[memory.category || ""] || "#6b7280";
  const tierColor = TIER_COLORS[memory.tier || ""] || "#2a2d40";

  return (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "10px 12px",
        borderRadius: 7,
        border: `1px solid ${selected ? "#a855f7" : "#1e2035"}`,
        backgroundColor: selected ? "#a855f712" : "#111219",
        cursor: "pointer",
        fontFamily: "inherit",
        transition: "all 0.1s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <div
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            backgroundColor: catColor,
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 8, letterSpacing: "0.1em", color: catColor }}>
          {(memory.category || "other").toUpperCase()}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 8, color: tierColor }}>
          {memory.tier || ""}
        </span>
      </div>
      <div
        style={{
          fontSize: 11,
          color: "#e8eaed",
          lineHeight: 1.4,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {memory.content}
      </div>
      <div style={{ fontSize: 9, color: "#2a2d40", marginTop: 5 }}>
        {new Date(memory.extracted_at).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </div>
    </button>
  );
}

function MemoryDetail({ memory }: { memory: Memory }) {
  const catColor = CATEGORY_COLORS[memory.category || ""] || "#6b7280";
  const tierColor = TIER_COLORS[memory.tier || ""] || "#2a2d40";

  return (
    <div>
      {/* Badges row */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {memory.category && (
          <span
            style={{
              fontSize: 8,
              padding: "2px 8px",
              borderRadius: 4,
              backgroundColor: `${catColor}18`,
              color: catColor,
              border: `1px solid ${catColor}30`,
              letterSpacing: "0.1em",
            }}
          >
            {memory.category.toUpperCase()}
          </span>
        )}
        {memory.memory_type && (
          <span
            style={{
              fontSize: 8,
              padding: "2px 8px",
              borderRadius: 4,
              backgroundColor: "#a855f718",
              color: "#a855f7",
              border: "1px solid #a855f730",
              letterSpacing: "0.1em",
            }}
          >
            {memory.memory_type.toUpperCase()}
          </span>
        )}
        {memory.tier && (
          <span
            style={{
              fontSize: 8,
              padding: "2px 8px",
              borderRadius: 4,
              backgroundColor: `${tierColor}18`,
              color: tierColor,
              border: `1px solid ${tierColor}30`,
              letterSpacing: "0.1em",
            }}
          >
            {memory.tier.toUpperCase()}
          </span>
        )}
        {memory.confidence != null && (
          <span
            style={{
              fontSize: 8,
              padding: "2px 8px",
              borderRadius: 4,
              backgroundColor: "#22c55e18",
              color: "#22c55e",
              border: "1px solid #22c55e30",
              letterSpacing: "0.1em",
            }}
          >
            {Math.round(memory.confidence * 100)}% CONFIDENCE
          </span>
        )}
      </div>

      {/* Content */}
      <div
        style={{
          fontSize: 13,
          color: "#e8eaed",
          lineHeight: 1.7,
          marginBottom: 20,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {memory.content}
      </div>

      {/* Meta */}
      <div
        style={{
          borderTop: "1px solid #1e2035",
          paddingTop: 12,
          fontSize: 9,
          color: "#2a2d40",
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <span>
          Extracted:{" "}
          {new Date(memory.extracted_at).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        {memory.source && <span>Source: {memory.source}</span>}
        <span style={{ marginLeft: "auto", color: "#1e2035" }}>{memory.id}</span>
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
