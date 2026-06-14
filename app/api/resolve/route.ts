import { NextResponse } from "next/server";
import { resolveSteamId, SteamError } from "@/lib/steam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  input?: string;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  console.log(`[resolve] input=${JSON.stringify(body.input ?? "")}`);
  try {
    const steamid = await resolveSteamId(body.input || "");
    console.log(`[resolve] -> steamid=${steamid}`);
    return NextResponse.json({ steamid });
  } catch (e) {
    const err = e as SteamError;
    const status = err.code === "RESOLVE" ? 404 : 502;
    console.warn(`[resolve] FAILED code=${err.code} msg=${err.message}`);
    return NextResponse.json({ code: err.code || "UPSTREAM", error: err.message }, { status });
  }
}
