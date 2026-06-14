import { NextResponse } from "next/server";
import { loadPrices, loadSkinById, loadSkinByName, normalizeSkinName } from "@/lib/data";
import { computeTradeup } from "@/lib/tradeup";
import type { TradeupInput } from "@/types/cs2";

interface Body {
  inputs: TradeupInput[];
  isStatTrak: boolean;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.inputs) || (body.inputs.length !== 10 && body.inputs.length !== 5)) {
    return NextResponse.json({ error: "Requires 10 (standard) or 5 (knife) inputs" }, { status: 400 });
  }

  try {
    const skinById = loadSkinById();
    const byName = loadSkinByName();

    // Inventory items carry a synthetic `inv-<assetid>` id that isn't in the
    // catalog (and no real collections / float range). Resolve each to a real
    // catalog skin by its market name so the engine has collections + ranges.
    const resolved: TradeupInput[] = body.inputs.map((i) => {
      if (skinById.has(i.skinId)) return i;
      if (i.marketName) {
        const match = byName.get(normalizeSkinName(i.marketName));
        if (match) return { ...i, skinId: match.id };
        throw new Error(
          `"${i.marketName}" isn't in the catalog. Run \`npm run fetch-data\` to pull the full skin catalog, or pick a catalog skin.`,
        );
      }
      throw new Error(`Unknown skin id: ${i.skinId}`);
    });

    const result = computeTradeup({
      inputs: resolved,
      skinById,
      prices: loadPrices(),
      isStatTrak: Boolean(body.isStatTrak),
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
