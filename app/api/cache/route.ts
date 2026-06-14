import { NextResponse } from "next/server";
import { clearCache, getCacheReport } from "@/lib/steam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read-only integrity report over loader.db (snapshots / item_meta / jobs).
export async function GET() {
  return NextResponse.json(getCacheReport());
}

// Force-clear the persistent cache. `?steamid=<id>` clears one profile;
// no param wipes everything. The loader.db file is kept — only rows are deleted.
export async function DELETE(req: Request) {
  const steamid = new URL(req.url).searchParams.get("steamid") || undefined;
  const cleared = clearCache(steamid);
  return NextResponse.json({ ok: true, cleared, scope: steamid ?? "all" });
}
