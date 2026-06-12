import { NextResponse } from "next/server";
import { getCacheReport } from "@/lib/steam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read-only integrity report over loader.db (snapshots / item_meta / jobs).
export async function GET() {
  return NextResponse.json(getCacheReport());
}
