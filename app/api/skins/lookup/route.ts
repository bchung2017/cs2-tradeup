import { NextResponse } from "next/server";
import { loadSkinById, loadSkinByName, normalizeSkinName } from "@/lib/data";
import type { Skin } from "@/types/cs2";

// Catalog records for a handful of skins, by id and by name. The Venture surface
// needs float ranges and collections for contract inputs and owned skins, and
// the full catalog is too large to ship to the browser.
export async function POST(req: Request) {
  let body: { ids?: string[]; names?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const ids = (body.ids ?? []).slice(0, 500);
  const names = (body.names ?? []).slice(0, 2000);
  const byId = loadSkinById();
  const byName = loadSkinByName();
  const skins: Record<string, Skin> = {};
  const nameToId: Record<string, string> = {};
  for (const id of ids) {
    const s = byId.get(id);
    if (s) skins[s.id] = s;
  }
  for (const n of names) {
    const s = byName.get(normalizeSkinName(n));
    if (!s) continue;
    skins[s.id] = s;
    nameToId[n] = s.id;
  }
  return NextResponse.json({ skins, nameToId });
}
