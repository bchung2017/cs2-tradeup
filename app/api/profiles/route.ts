import { NextResponse } from "next/server";
import { listProfiles } from "@/lib/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// All carried-over profiles, most-recently-viewed first, each with its inventory
// summary. Powers the profile switcher.
export async function GET() {
  const profiles = listProfiles();
  console.log(`[profiles] -> ${profiles.length} carried-over`);
  return NextResponse.json({ profiles });
}
