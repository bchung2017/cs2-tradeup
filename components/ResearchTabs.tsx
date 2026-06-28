"use client";

// Research Lab subtabs: INVENTORY (the master/detail finder over YOUR synced
// inventory) vs MARKET (the market-wide spam-trade-up finder — buy & spam).
import { useState } from "react";
import ResearchWorkspace from "@/components/ResearchWorkspace";
import MarketFinder from "@/components/MarketFinder";

type Tab = "inventory" | "market";

export default function ResearchTabs() {
  const [tab, setTab] = useState<Tab>("inventory");
  return (
    <div>
      <div style={{ display: "flex", gap: 4, padding: "0 14px", background: "var(--surface)", borderBottom: "1px solid var(--surface-line)" }}>
        <TabBtn active={tab === "inventory"} onClick={() => setTab("inventory")} label="INVENTORY" />
        <TabBtn active={tab === "market"} onClick={() => setTab("market")} label="MARKET" />
      </div>
      {tab === "inventory" ? <ResearchWorkspace /> : <MarketFinder />}
    </div>
  );
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hud"
      style={{
        background: "transparent",
        border: "none",
        borderBottom: `2px solid ${active ? "var(--green)" : "transparent"}`,
        color: active ? "var(--green-hot)" : "var(--fg-dim)",
        padding: "10px 14px",
        letterSpacing: "0.16em",
        cursor: "pointer",
        textShadow: active ? "0 0 4px rgba(51,255,51,0.55)" : "none",
      }}
    >
      {label}
    </button>
  );
}
