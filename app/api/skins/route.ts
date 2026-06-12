import { NextResponse } from "next/server";
import { loadSkins } from "@/lib/data";
import type { Rarity } from "@/types/cs2";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim().toLowerCase();
  const rarity = searchParams.get("rarity") as Rarity | null;
  const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);

  let skins = loadSkins().filter((s) => !s.souvenir);

  if (rarity) {
    skins = skins.filter((s) => s.rarity.name === rarity);
  }
  if (q) {
    skins = skins.filter((s) => s.name.toLowerCase().includes(q));
  }

  return NextResponse.json({ skins: skins.slice(0, limit), total: skins.length });
}
