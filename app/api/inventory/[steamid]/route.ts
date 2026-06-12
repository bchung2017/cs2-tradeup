import { NextResponse } from "next/server";
import { getSnapshot } from "@/lib/steam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ steamid: string }> }) {
  const { steamid } = await ctx.params;
  const snap = getSnapshot(steamid);
  if (!snap) {
    return NextResponse.json({ error: "no snapshot" }, { status: 404 });
  }
  return NextResponse.json({
    steamid,
    count: snap.count,
    items: snap.items,
    age_ms: Date.now() - snap.fetchedAt,
  });
}
