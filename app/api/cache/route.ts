import { NextResponse } from "next/server";
import { clearCache, getCacheReport } from "@/lib/steam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read-only integrity report over the snapshot store (snapshots / item_meta).
export async function GET() {
  return NextResponse.json(await getCacheReport());
}

// Force-clear the persistent cache. `?steamid=<id>` clears one profile;
// no param wipes everything. The database is kept — only rows are deleted.
export async function DELETE(req: Request) {
  const steamid = new URL(req.url).searchParams.get("steamid") || undefined;
  const cleared = await clearCache(steamid);
  return NextResponse.json({ ok: true, cleared, scope: steamid ?? "all" });
}
