import { Suspense } from "react";
import MyVentures from "@/components/venture/MyVentures";
import { imagesById, loadLonglist, loadVentures } from "@/lib/ventures-data";

export default function MyVenturesPage() {
  const market = loadVentures();
  const long = loadLonglist();
  // pictures for every skin a row could show: market inputs and outcomes, and
  // for knife contracts your reds start, the reds, fillers and every knife
  const images = imagesById([
    ...market.ventures.flatMap((v) => [...v.inputs.map((i) => i.skinId), ...v.outcomes.map((o) => o.skinId)]),
    ...long.rows.flatMap((r) => [r.ownedId, r.fillerId].filter((x): x is string => !!x)),
    ...Object.values(long.pools ?? {}).flatMap((p) => p.knives.map((k) => k.skinId)),
  ]);
  return (
    // the list's filters live in the URL (useSearchParams), which needs a Suspense boundary
    <Suspense fallback={<p className="vx-empty">Loading contracts…</p>}>
      <MyVentures market={market} images={images} />
    </Suspense>
  );
}
