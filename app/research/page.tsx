// Server Component shell for the Research Lab. Two subtabs (Inventory | Market)
// live in the ResearchTabs client island; keep this file free of "use client".
import AppShell from "@/components/AppShell";
import ResearchTabs from "@/components/ResearchTabs";

export default function ResearchPage() {
  return (
    <AppShell>
      <ResearchTabs />
    </AppShell>
  );
}
