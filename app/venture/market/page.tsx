import { Suspense } from "react";
import MarketList from "@/components/venture/MarketList";
import { loadExpired, loadVentures } from "@/lib/ventures-data";

// Reads the committed data files; a new sync commit redeploys the site.
export default function MarketVenturesPage() {
  const data = loadVentures();
  const expired = loadExpired();
  return (
    // useSearchParams (filters live in the URL) needs a Suspense boundary
    <Suspense fallback={<p className="vx-empty">Loading contracts…</p>}>
      <MarketList data={data} expired={expired} />
    </Suspense>
  );
}
