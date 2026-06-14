import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Steam community profile avatar via the keyless `?xml=1` endpoint — returns the
// full-size avatar URL. No STEAM_API_KEY needed (mirrors the inventory fetch,
// which also hits steamcommunity.com directly).
export async function GET(_req: Request, ctx: { params: Promise<{ steamid: string }> }) {
  const { steamid } = await ctx.params;
  if (!/^\d{17}$/.test(steamid)) {
    return NextResponse.json({ error: "bad steamid" }, { status: 400 });
  }
  try {
    const r = await fetch(`https://steamcommunity.com/profiles/${steamid}?xml=1`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!r.ok) return NextResponse.json({ error: `http ${r.status}` }, { status: 502 });
    const xml = await r.text();
    // <avatarFull><![CDATA[ https://.../xxxx_full.jpg ]]></avatarFull>
    const m =
      xml.match(/<avatarFull>\s*<!\[CDATA\[(.*?)\]\]>\s*<\/avatarFull>/) ??
      xml.match(/<avatarFull>(.*?)<\/avatarFull>/);
    const avatar = m?.[1]?.trim() || null;
    if (!avatar) return NextResponse.json({ error: "no avatar" }, { status: 404 });
    return NextResponse.json({ steamid, avatar });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
