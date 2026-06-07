"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import VisionSprite from "./VisionSprite";

const NAV = [
  { href: "/tasks", label: "Tasks", icon: "grid" },
  { href: "/calendar", label: "Calendar", icon: "calendar" },
  { href: "/projects", label: "Projects", icon: "target" },
  { href: "/memory", label: "Memory", icon: "brain" },
  { href: "/visual", label: "Visual Office", icon: "hex" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      style={{
        width: 220,
        flexShrink: 0,
        backgroundColor: "#111219",
        borderRight: "1px solid #1e2035",
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      {/* Logo */}
      <div
        style={{
          padding: "16px 16px 14px",
          borderBottom: "1px solid #1e2035",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <VisionSprite size={40} />
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.2em",
              color: "#e8eaed",
              lineHeight: 1,
            }}
          >
            JARVIS
          </div>
          <div
            style={{
              fontSize: 9,
              letterSpacing: "0.25em",
              color: "#22c55e",
              lineHeight: 1,
              marginTop: 3,
            }}
          >
            COMMAND
          </div>
        </div>
      </div>

      {/* Status */}
      <div
        style={{
          padding: "10px 16px",
          borderBottom: "1px solid #1e2035",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div
          className="animate-blink"
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            backgroundColor: "#22c55e",
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: 9,
            letterSpacing: "0.18em",
            color: "#6b7280",
          }}
        >
          PRIME ONLINE
        </span>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "12px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              data-testid={`dashboard-nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
              aria-current={active ? "page" : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 12px",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 500,
                textDecoration: "none",
                transition: "all 0.15s",
                backgroundColor: active ? "rgba(168, 85, 247, 0.12)" : "transparent",
                color: active ? "#a855f7" : "#6b7280",
                border: active ? "1px solid rgba(168, 85, 247, 0.25)" : "1px solid transparent",
              }}
            >
              <NavIcon name={item.icon} active={active} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div
        style={{
          padding: "12px 16px",
          borderTop: "1px solid #1e2035",
          fontSize: 9,
          letterSpacing: "0.15em",
          color: "#1e2035",
        }}
      >
        MISSION CONTROL v2.0
      </div>
    </aside>
  );
}

function NavIcon({ name, active }: { name: string; active: boolean }) {
  const color = active ? "#a855f7" : "#6b7280";
  const s = 15;

  if (name === "grid") {
    return (
      <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
        <rect x="1" y="1" width="6" height="6" rx="1" stroke={color} strokeWidth="1.5" />
        <rect x="9" y="1" width="6" height="6" rx="1" stroke={color} strokeWidth="1.5" />
        <rect x="1" y="9" width="6" height="6" rx="1" stroke={color} strokeWidth="1.5" />
        <rect x="9" y="9" width="6" height="6" rx="1" stroke={color} strokeWidth="1.5" />
      </svg>
    );
  }
  if (name === "calendar") {
    return (
      <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
        <rect x="1" y="3" width="14" height="12" rx="1.5" stroke={color} strokeWidth="1.5" />
        <path d="M1 7h14" stroke={color} strokeWidth="1.2" />
        <path d="M5 1v4M11 1v4" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <rect x="4" y="9.5" width="2" height="2" rx="0.4" fill={color} />
        <rect x="7" y="9.5" width="2" height="2" rx="0.4" fill={color} />
        <rect x="10" y="9.5" width="2" height="2" rx="0.4" fill={color} />
      </svg>
    );
  }
  if (name === "target") {
    return (
      <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6.5" stroke={color} strokeWidth="1.5" />
        <circle cx="8" cy="8" r="3.5" stroke={color} strokeWidth="1.5" />
        <circle cx="8" cy="8" r="1" fill={color} />
      </svg>
    );
  }
  if (name === "brain") {
    return (
      <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
        <path
          d="M8 3C6 3 4 4 4 6c-1 0-2.5 1-2.5 3S3 12 4.5 12.5M8 3c2 0 4 1 4 3 1 0 2.5 1 2.5 3S11 12 9.5 12.5"
          stroke={color}
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <path d="M8 3v10" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
        <path
          d="M5 6.5c1 .5 2 .5 3 .5s2 0 3-.5M5 10c1-.5 2-.5 3-.5s2 0 3 .5"
          stroke={color}
          strokeWidth="1"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (name === "hex") {
    return (
      <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
        <polygon
          points="8,1.5 13,4.5 13,10.5 8,13.5 3,10.5 3,4.5"
          stroke={color}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <polygon
          points="8,5 10.5,6.5 10.5,9.5 8,11 5.5,9.5 5.5,6.5"
          stroke={color}
          strokeWidth="1"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return null;
}
