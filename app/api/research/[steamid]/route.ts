import { NextResponse } from "next/server";
import { getSnapshot } from "@/lib/steam";
import { loadPrices, loadSkinById, loadSkinByName, normalizeSkinName } from "@/lib/data";
import { DEFAULT_FEE, searchTradeups, type OwnedItem } from "@/lib/tradeup-search";
import type { ResearchResponse } from "@/types/research";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/research/<steamid>?fee=0.15&limit=25
// Ranks the single-collection trade-ups buildable from the synced inventory by
// P(net profit). Requires a prior inventory sync (returns 404 like /api/inventory).
export async function GET(req: Request, ctx: { params: Promise<{ steamid: string }> }) {
  const { steamid } = await ctx.params;
  const snap = getSnapshot(steamid);
  if (!snap) {
    return NextResponse.json({ error: "no snapshot (sync inventory first)" }, { status: 404 });
  }

  const url = new URL(req.url);
  const feeParam = Number(url.searchParams.get("fee"));
  const limitParam = Number(url.searchParams.get("limit"));
  const fee = Number.isFinite(feeParam) && feeParam >= 0 && feeParam < 1 ? feeParam : DEFAULT_FEE;
  const limit = Number.isInteger(limitParam) && limitParam > 0 ? limitParam : undefined;

  const skinById = loadSkinById();
  const byName = loadSkinByName();
  const prices = loadPrices();

  // Resolve raw inventory → OwnedItem[]: needs a catalog match (for collections +
  // float range) and a real float (to seed the contract). Souvenirs can't be
  // traded up, so they're dropped here. Cases/agents/knives etc. don't resolve via
  // the name map and fall away naturally.
  const owned: OwnedItem[] = [];
  let resolved = 0;
  let withFloat = 0;
  for (const it of snap.items) {
    if (!it.name) continue;
    const skin = byName.get(normalizeSkinName(it.name));
    if (!skin) continue;
    resolved++;
    if (it.float == null) continue;
    withFloat++;
    if (/Souvenir/i.test(it.name)) continue;
    owned.push({
      assetid: it.assetid,
      skin,
      float: it.float,
      isStatTrak: /StatTrak/i.test(it.name),
    });
  }

  const { contracts, nearMisses } = searchTradeups({ owned, skinById, prices, fee, limit });
  console.log(
    `[research] steamid=${steamid} -> ${snap.count} items, ${resolved} resolved, ${withFloat} w/float, ${owned.length} eligible -> ${contracts.length} contracts, ${nearMisses.length} near-misses`,
  );

  // Exactly the seam shape (types/research.ts) the Research Lab UI consumes.
  const body: ResearchResponse = {
    steamid,
    eligibleItems: owned.length,
    feeRate: fee,
    contracts,
    nearMisses,
  };
  return NextResponse.json(body);
}
