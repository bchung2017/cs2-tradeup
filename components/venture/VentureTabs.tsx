"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useBadge } from "@/lib/venture-store";

export default function VentureTabs() {
  const pathname = usePathname();
  const badge = useBadge();
  const tab = (href: string, label: string, count?: number) => (
    <Link href={href} className={`vx-tab hud${pathname.startsWith(href) ? " is-active" : ""}`} aria-current={pathname.startsWith(href) ? "page" : undefined}>
      {label}
      {count ? <span className="vx-badge">{count}</span> : null}
    </Link>
  );
  return (
    <nav className="vx-tabs" aria-label="Venture">
      {tab("/venture/market", "Market Ventures")}
      {tab("/venture/mine", "My Ventures", badge)}
    </nav>
  );
}
