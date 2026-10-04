"use client";

import { ago } from "@/lib/venture-copy";
import { useNow } from "@/lib/venture-store";

// "3m ago", rendered after mount only (see useNow).
export default function Ago({ iso }: { iso: string | null }) {
  const now = useNow();
  return <>{now == null ? "…" : ago(iso, now)}</>;
}
