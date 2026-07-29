import { NextResponse } from "next/server";
import { syncInventory, SteamError } from "@/lib/steam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CODE_STATUS: Record<string, number> = {
  FLOOR: 429,
  INFLIGHT: 409,
  RATELIMIT: 429,
  PRIVATE: 403,
  UPSTREAM: 502,
};

export async function POST(req: Request, ctx: { params: Promise<{ steamid: string }> }) {
  const { steamid } = await ctx.params;
  if (!/^\d{17}$/.test(steamid)) {
    return NextResponse.json({ code: "RESOLVE", error: "bad steamid" }, { status: 400 });
  }
  const force = new URL(req.url).searchParams.get("force") === "1";
  console.log(`[sync] steamid=${steamid} force=${force} — fetching from Steam…`);
  try {
    const { count, changed } = await syncInventory(steamid, { force });
    console.log(`[sync] steamid=${steamid} -> ${count} items (${changed ? "updated" : "unchanged"})`);
    return NextResponse.json({ count, changed });
  } catch (e) {
    const err = e as SteamError;
    console.warn(`[sync] steamid=${steamid} FAILED code=${err.code} msg=${err.message}`);
    // FLOOR (our own courtesy gate) and RATELIMIT (Steam throttling our IP) both
    // carry a wait, so hand the client retry_ms to drive an honest countdown.
    if (err.code === "FLOOR" || err.code === "RATELIMIT") {
      return NextResponse.json(
        { code: err.code, retry_ms: err.retryMs ?? 0, error: err.message },
        { status: 429 },
      );
    }
    const status = CODE_STATUS[err.code] || 500;
    return NextResponse.json({ code: err.code || "UPSTREAM", error: err.message }, { status });
  }
}
