// Server Component shell for the Profile view. The interactive part is a
// self-contained "use client" island (ProfileView) — keep this file free of
// "use client"/hooks; AppShell supplies the menu/top-bar.
import AppShell from "@/components/AppShell";
import ProfileView from "@/components/ProfileView";

export default function ProfilePage() {
  return (
    <AppShell>
      <ProfileView />
    </AppShell>
  );
}
