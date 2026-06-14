import { NextResponse } from "next/server";
import { getSnapshot } from "@/lib/steam";
import { priceForMarketName } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ steamid: string }> }) {
  const { steamid } = await ctx.params;
  const snap = getSnapshot(steamid);
  if (!snap) {
    console.log(`[inventory] steamid=${steamid} -> no snapshot (sync first)`);
    return NextResponse.json({ error: "no snapshot" }, { status: 404 });
  }
  const withFloat = snap.items.filter((i) => i.float != null).length;
  console.log(
    `[inventory] steamid=${steamid} -> ${snap.count} items, ${withFloat} with float (age ${Math.round((Date.now() - snap.fetchedAt) / 1000)}s)`,
  );
  // Attach a median market price per item (resolved from the price table by
  // market name + wear) so the inventory cards can show float AND price.
  const items = snap.items.map((it) => ({ ...it, price: priceForMarketName(it.name) }));
  const priced = items.filter((i) => i.price != null).length;
  console.log(`[inventory] ${priced}/${snap.count} items priced`);
  return NextResponse.json({
    steamid,
    count: snap.count,
    items,
    age_ms: Date.now() - snap.fetchedAt,
  });
}
