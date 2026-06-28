// Server Component shell for the Research Lab — a master/detail workspace: the
// research scanner on the right drives a contract inspector on the left. The
// interactive parts live in the ResearchWorkspace client island; keep this file
// free of "use client"/hooks. AppShell supplies the menu/top-bar.
import AppShell from "@/components/AppShell";
import ResearchWorkspace from "@/components/ResearchWorkspace";

export default function ResearchPage() {
  return (
    <AppShell>
      <ResearchWorkspace />
    </AppShell>
  );
}
