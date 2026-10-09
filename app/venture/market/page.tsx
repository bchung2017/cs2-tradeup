import { Suspense } from "react";
import MarketList from "@/components/venture/MarketList";
import { imagesById, loadExpired, loadVentures } from "@/lib/ventures-data";

// Reads the committed data files; a new sync commit redeploys the site.
export default function MarketVenturesPage() {
  const data = loadVentures();
  const expired = loadExpired();
  const images = imagesById(data.ventures.flatMap((v) => v.inputs.map((i) => i.skinId)));
  return (
    // useSearchParams (filters live in the URL) needs a Suspense boundary
    <Suspense fallback={<p className="vx-empty">Loading contracts…</p>}>
      <MarketList data={data} expired={expired} images={images} />
    </Suspense>
  );
}
