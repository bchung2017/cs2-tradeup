import { NextResponse } from "next/server";
import { loadPrices, loadSkinById } from "@/lib/data";
import { DEFAULT_FEE, findSpamTradeups, targetForWear } from "@/lib/spam-search";
import { WEAR_RANGES, type Wear } from "@/types/cs2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WEARS = new Set(WEAR_RANGES.map((w) => w.wear));

// GET /api/spam?wear=Field-Tested&fee=0.15&limit=60
// Market-wide spam-trade-up finder: for every collection, derive the cheapest
// filler + steering recipe that lands the target wear, score it net of fee, and
// return the run economics. Not inventory-bound — this is "buy from market & spam".
export async function GET(req: Request) {
  const url = new URL(req.url);
  const feeParam = Number(url.searchParams.get("fee"));
  const fee = Number.isFinite(feeParam) && feeParam >= 0 && feeParam < 1 ? feeParam : DEFAULT_FEE;

  const wearParam = url.searchParams.get("wear");
  const targetWear: Wear = wearParam && WEARS.has(wearParam as Wear) ? (wearParam as Wear) : "Field-Tested";

  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isInteger(limitParam) && limitParam > 0 && limitParam <= 300 ? limitParam : 80;

  const contracts = findSpamTradeups({
    skinById: loadSkinById(),
    prices: loadPrices(),
    fee,
    targetAvgFloat: targetForWear(targetWear),
    limit,
  });

  return NextResponse.json({ fee, targetWear, contracts });
}
