import { NextResponse } from "next/server";
import { loadPrices, loadSkinById } from "@/lib/data";
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
    const result = computeTradeup({
      inputs: body.inputs,
      skinById: loadSkinById(),
      prices: loadPrices(),
      isStatTrak: Boolean(body.isStatTrak),
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
