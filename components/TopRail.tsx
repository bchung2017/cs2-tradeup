"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useTradeup } from "@/lib/tradeup-context";
import { useBadge } from "@/lib/venture-store";

const VENTURE_MENU = [
  { href: "/venture/market", label: "Market Ventures", sub: "what's out there now" },
  { href: "/venture/mine", label: "My Ventures", sub: "what your inventory starts" },
];

function SurfaceLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link href={href} className={`rail-link${active ? " is-active" : ""}`} aria-current={active ? "page" : undefined}>
      {label}
    </Link>
  );
}

// VENTURE opens its submenu on hover (pointer devices, via CSS) and on tap
// (touch: the first tap opens, a link inside navigates).
function VentureMenu({ pathname, badge }: { pathname: string; badge: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = pathname.startsWith("/venture");

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div ref={ref} className={`rail-menu${open ? " is-open" : ""}`} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <button
        type="button"
        className={`rail-link${active ? " is-active" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        VENTURE
        {badge ? <span className="rail-badge" aria-label={`${badge} new`}>{badge}</span> : null}
        <span className="rail-caret" aria-hidden>▾</span>
      </button>
      <div className="rail-drop" role="menu">
        {VENTURE_MENU.map((m) => (
          <Link key={m.href} href={m.href} role="menuitem" className={pathname.startsWith(m.href) ? "is-active" : ""} aria-current={pathname.startsWith(m.href) ? "page" : undefined}>
            <span>
              {m.label}
              {m.href === "/venture/mine" && badge ? <span className="rail-badge">{badge}</span> : null}
            </span>
            <small>{m.sub}</small>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function TopRail() {
  const pathname = usePathname();
  const { steamid } = useTradeup();
  const ventureBadge = useBadge();
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
    <nav className="rail">
      <Link href="/venture/market" className="rail-brand">
        <span className="rail-brand__prompt">$</span> journeyman
      </Link>

      <div className="rail-links">
        <VentureMenu pathname={pathname} badge={ventureBadge} />
        <SurfaceLink href="/console" label="CONSOLE" active={pathname === "/console"} />
        <SurfaceLink href="/inventory" label="INVENTORY" active={pathname === "/inventory"} />
      </div>

      <Link href="/profile" className={`rail-link rail-profile${onProfile ? " is-active" : ""}`} aria-current={onProfile ? "page" : undefined}>
        {avatar && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt="" width={26} height={26} />
        )}
        PROFILE
      </Link>
    </nav>
  );
}
