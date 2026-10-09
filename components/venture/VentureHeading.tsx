"use client";

// Which Venture submenu page this is; switching lives in the top rail's menu.
import { usePathname } from "next/navigation";

export default function VentureHeading() {
  const mine = usePathname().startsWith("/venture/mine");
  return <h1 className="vx-title">{mine ? "My Ventures" : "Market Ventures"}</h1>;
}
