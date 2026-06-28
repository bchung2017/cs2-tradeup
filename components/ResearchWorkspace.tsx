"use client";

// Research workspace — master/detail. The existing research scanner sits on the
// RIGHT (drives selection); a ContractInspector on the LEFT starts empty and
// fills with whatever you click — a contract OR a near-miss candidate. Selection
// lives here so the two panes stay in sync.
import { useState } from "react";
import ResearchView from "@/components/ResearchView";
import ContractInspector, { type InspectorSelection } from "@/components/ContractInspector";

export default function ResearchWorkspace() {
  const [selected, setSelected] = useState<InspectorSelection | null>(null);

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 0 }}>
      {/* left: inspector — sticky below the 48px top bar, independently scrollable */}
      <div
        style={{
          flex: "1 1 0",
          minWidth: 0,
          position: "sticky",
          top: 48,
          height: "calc(100vh - 48px)",
          overflowY: "auto",
          borderRight: "1px solid var(--surface-line)",
        }}
      >
        <ContractInspector selection={selected} />
      </div>

      {/* right: the research scanner, as-is — clicking a contract/candidate selects it */}
      <div style={{ flex: "1 1 0", minWidth: 0 }}>
        <ResearchView
          onInspect={(c) => setSelected({ kind: "contract", contract: c })}
          selectedId={selected?.kind === "contract" ? selected.contract.id : undefined}
          onInspectNear={(n) => setSelected({ kind: "near", miss: n })}
          selectedNearId={selected?.kind === "near" ? selected.miss.id : undefined}
        />
      </div>
    </div>
  );
}
