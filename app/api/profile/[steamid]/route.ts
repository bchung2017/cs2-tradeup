import { NextResponse } from "next/server";
import { fetchSteamProfile, upsertProfile, getProfile, withInventory } from "@/lib/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Fetch a fresh profile from Steam and carry it over (persist). If Steam is
// unreachable, fall back to the last stored copy so a known profile still
// renders offline. 404 only when we have neither.
export async function GET(_req: Request, ctx: { params: Promise<{ steamid: string }> }) {
  const { steamid } = await ctx.params;
  if (!/^\d{17}$/.test(steamid)) {
    return NextResponse.json({ error: "bad steamid" }, { status: 400 });
  }
  try {
    const info = await fetchSteamProfile(steamid);
    const stored = upsertProfile(info);
    console.log(`[profile] steamid=${steamid} persona=${JSON.stringify(stored.persona)} (fresh)`);
    return NextResponse.json({ profile: withInventory(stored), stale: false });
  } catch (e) {
    const stored = getProfile(steamid);
    if (stored) {
      console.warn(`[profile] steamid=${steamid} steam fetch failed; serving stored copy`);
      return NextResponse.json({ profile: withInventory(stored), stale: true });
    }
    console.warn(`[profile] steamid=${steamid} FAILED: ${(e as Error).message}`);
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
