"use client";

// Client island: top-bar with a hamburger toggle + a left slide-out drawer that
// acts as the app's main menu. The drawer is intentionally empty for now (just a
// header) — menu entries get populated later. Keep this self-contained so the
// page shell (app/page.tsx) stays a server component.
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const DRAWER_WIDTH = 280;

// Main-menu entries. Add new views here — the active one is derived from the
// current path, and the top-bar title follows suit.
const MENU = [
  { href: "/", label: "Trade Up Simulator" },
  { href: "/research", label: "Research Lab" },
  { href: "/profile", label: "Profile" },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const title = MENU.find((m) => m.href === pathname)?.label ?? "Trade Up Simulator";

  // close on Escape for keyboard users
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div style={{ minHeight: "100vh" }}>
      {/* top bar: hamburger + current-view title */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 30,
          display: "flex",
          alignItems: "center",
          gap: 14,
          height: 48,
          padding: "0 14px",
          background: "var(--surface)",
          borderBottom: "1px solid var(--surface-line)",
        }}
      >
        <button
          type="button"
          aria-label="Open main menu"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          style={hamburgerStyle}
        >
          <span style={barStyle} />
          <span style={barStyle} />
          <span style={barStyle} />
        </button>

        <span
          className="hud hud-ember glow"
          style={{ fontSize: 12, letterSpacing: "0.22em" }}
        >
          {title}
        </span>
      </header>

      {/* backdrop */}
      <div
        onClick={() => setOpen(false)}
        aria-hidden={!open}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 40,
          background: "rgba(0, 0, 0, 0.6)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.2s ease",
        }}
      />

      {/* slide-out drawer / main menu */}
      <nav
        aria-label="Main menu"
        aria-hidden={!open}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          bottom: 0,
          width: DRAWER_WIDTH,
          zIndex: 50,
          background: "var(--surface)",
          borderRight: "1px solid var(--surface-line)",
          boxShadow: open ? "0 0 40px rgba(51, 255, 51, 0.12)" : "none",
          transform: open ? "translateX(0)" : `translateX(-${DRAWER_WIDTH}px)`,
          transition: "transform 0.22s ease",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: 48,
            padding: "0 14px",
            borderBottom: "1px solid var(--surface-line)",
          }}
        >
          <span
            className="hud hud-ember glow"
            style={{ fontSize: 12, letterSpacing: "0.22em" }}
          >
            Menu
          </span>
          <button
            type="button"
            aria-label="Close main menu"
            onClick={() => setOpen(false)}
            style={{
              background: "transparent",
              border: "1px solid var(--surface-line)",
              color: "var(--fg-dim)",
              width: 26,
              height: 26,
              lineHeight: 1,
              fontSize: 14,
            }}
          >
            ×
          </button>
        </div>

        {/* navigation entries */}
        <div style={{ display: "flex", flexDirection: "column", padding: 8, gap: 4 }}>
          {MENU.map((item) => {
            const active = item.href === pathname;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                style={{
                  display: "block",
                  padding: "10px 12px",
                  textDecoration: "none",
                  fontSize: 13,
                  letterSpacing: "0.04em",
                  color: active ? "var(--green-hot)" : "var(--fg-dim)",
                  background: active ? "var(--surface-2)" : "transparent",
                  borderLeft: `2px solid ${active ? "var(--green)" : "transparent"}`,
                  textShadow: active ? "0 0 4px rgba(51, 255, 51, 0.55)" : "none",
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* page content */}
      <main>{children}</main>
    </div>
  );
}

const hamburgerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  gap: 4,
  width: 32,
  height: 30,
  padding: "0 6px",
  background: "transparent",
  border: "1px solid var(--surface-line)",
};

const barStyle: React.CSSProperties = {
  display: "block",
  height: 2,
  width: "100%",
  background: "var(--green)",
  boxShadow: "0 0 4px rgba(51, 255, 51, 0.55)",
};
