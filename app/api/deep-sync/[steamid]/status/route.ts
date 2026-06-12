import { NextResponse } from "next/server";
import { getJob } from "@/lib/steam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cross-session rehydrate: the current deep-sync job row for a steamid (or null).
export async function GET(_req: Request, ctx: { params: Promise<{ steamid: string }> }) {
  const { steamid } = await ctx.params;
  if (!/^\d{17}$/.test(steamid)) {
    return NextResponse.json({ code: "RESOLVE", error: "bad steamid" }, { status: 400 });
  }
  return NextResponse.json({ job: getJob(steamid) ?? null });
}
