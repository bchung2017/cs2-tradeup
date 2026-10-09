import MyVentures from "@/components/venture/MyVentures";
import { loadSkins } from "@/lib/data";
import { buildPools } from "@/lib/igl9000-knife";
import { imagesById, imagesByName, loadLonglist, loadVentures } from "@/lib/ventures-data";
import { prizeKey, topOutcomes } from "@/lib/ventures";

export default function MyVenturesPage() {
  const market = loadVentures();
  // market rows key pictures by skin id; longlist rows (owned red + filler) by
  // name, and any Covert that can enter a knife contract may show up there
  const knifeInputs = [...buildPools(loadSkins()).values()].flatMap((p) => p.inputs.map((s) => s.name));
  const images = {
    ...imagesById(market.ventures.flatMap((v) => [...v.inputs.map((i) => i.skinId), ...topOutcomes(v).map((o) => o.skinId)])),
    ...imagesByName([...knifeInputs, ...loadLonglist().rows.flatMap((r) => r.top.map((t) => prizeKey(t.name)))]),
  };
  return <MyVentures market={market} images={images} />;
}
