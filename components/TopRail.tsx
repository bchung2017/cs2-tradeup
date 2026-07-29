"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useTradeup } from "@/lib/tradeup-context";

// Persistent top navigation rail. It is chrome, not a panel: no shadow, no
// brackets, no glow. Lives in the root layout so it renders on every surface and
// never remounts on navigation, and sits ABOVE the fixed CircuitBoard backdrop
// via z-index (the backdrop is position:fixed; inset:0; z-index:0 — any sibling
// without its own stacking context disappears underneath it).
//
// Only routes that exist today are linked (CONSOLE `/`, and the operator entry
// `/cache`). VENTURE / LORE are UNSPECIFIED surfaces per the design doc; their
// links slot into the surface row once those pages exist.

interface BackendInfo {
  backend: "sqlite" | "postgres";
  schema?: string;
}

function SurfaceLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className="hud"
      aria-current={active ? "page" : undefined}
      style={{
        textDecoration: "none",
        color: active ? "var(--green)" : "var(--fg-dim)",
        transition: "color 120ms",
      }}
    >
      {label}
    </Link>
  );
}

export default function TopRail() {
  const pathname = usePathname();
  const { steamid } = useTradeup();
  const [backend, setBackend] = useState<BackendInfo | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);

  // Which persistence backend is live, for the operator indicator. The backend
  // is fixed at boot, so fetch once. Best-effort — silent on failure.
  useEffect(() => {
    let live = true;
    fetch("/api/cache", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (live && d) setBackend({ backend: d.backend, schema: d.schema });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // Profile avatar once a Steam profile is loaded (identity marker). Mirrors the
  // steamid the inventory side resolves, via the shared trade-up context.
  useEffect(() => {
    if (!steamid) {
      setAvatar(null);
      return;
    }
    let live = true;
    fetch(`/api/avatar/${steamid}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (live && d?.avatar) setAvatar(d.avatar);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [steamid]);

  const onCache = pathname === "/cache";
  // Operator indicator color: amber flags the ephemeral SQLite backend (a soft
  // "not persistent" warning, per the design doc's staleness cue); green when
  // persistent Postgres is live; full green while you're on /cache itself.
  const backendColor = onCache
    ? "var(--green)"
    : backend?.backend === "postgres"
      ? "var(--profit)"
      : "var(--amber)";

  return (
    <nav
      style={{
        position: "sticky",
        top: 0,
        zIndex: 20,
        height: "var(--rail-h)",
        display: "flex",
        alignItems: "center",
        gap: 18,
        padding: "0 14px",
        background: "var(--surface)",
        borderBottom: "1px solid var(--surface-line)",
        fontFamily: "var(--mono)",
      }}
    >
      {/* prompt prefix — the one place the shell metaphor appears in chrome.
          Non-interactive; .glow stays reserved for the surface title. */}
      <span style={{ fontSize: 12, whiteSpace: "nowrap" }}>
        <span style={{ color: "var(--green-dim)" }}>$ </span>
        <span style={{ color: "var(--fg-dim)", letterSpacing: "0.04em" }}>journeyman</span>
      </span>

      <div style={{ display: "flex", gap: 16 }}>
        <SurfaceLink href="/" label="CONSOLE" active={pathname === "/"} />
        {/* VENTURE / LORE go here when those surfaces are built */}
      </div>

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
        <Link
          href="/cache"
          className="hud"
          title="Cache inspector — storage backend & integrity"
          style={{
            textDecoration: "none",
            color: backendColor,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            transition: "color 120ms",
          }}
        >
          ◇ {backend?.backend ?? "backend"}
          {backend?.schema ? ` · ${backend.schema}` : ""}
        </Link>
        {avatar && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatar}
            alt=""
            title={steamid ?? undefined}
            width={22}
            height={22}
            style={{
              width: 22,
              height: 22,
              borderRadius: "50%",
              border: "1px solid var(--surface-line)",
              objectFit: "cover",
            }}
          />
        )}
      </div>
    </nav>
  );
}
