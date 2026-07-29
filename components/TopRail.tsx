"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useTradeup } from "@/lib/tradeup-context";

function SurfaceLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className="hud"
      aria-current={active ? "page" : undefined}
      style={{ textDecoration: "none", color: active ? "var(--green)" : "var(--fg-dim)", transition: "color 120ms" }}
    >
      {label}
    </Link>
  );
}

export default function TopRail() {
  const pathname = usePathname();
  const { steamid } = useTradeup();
  const [avatar, setAvatar] = useState<string | null>(null);

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

  const onProfile = pathname === "/profile";

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
      <span style={{ fontSize: 12, whiteSpace: "nowrap" }}>
        <span style={{ color: "var(--green-dim)" }}>$ </span>
        <span style={{ color: "var(--fg-dim)", letterSpacing: "0.04em" }}>journeyman</span>
      </span>

      <div style={{ display: "flex", gap: 16 }}>
        <SurfaceLink href="/" label="CONSOLE" active={pathname === "/"} />
        <SurfaceLink href="/inventory" label="INVENTORY" active={pathname === "/inventory"} />
      </div>

      <Link
        href="/profile"
        className="hud"
        aria-current={onProfile ? "page" : undefined}
        style={{
          marginLeft: "auto",
          textDecoration: "none",
          color: onProfile ? "var(--green)" : "var(--fg-dim)",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          transition: "color 120ms",
        }}
      >
        {avatar && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt="" width={20} height={20} style={{ width: 20, height: 20, borderRadius: "50%", border: "1px solid var(--surface-line)", objectFit: "cover" }} />
        )}
        PROFILE
      </Link>
    </nav>
  );
}
