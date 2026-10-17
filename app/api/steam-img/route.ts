import { NextResponse } from "next/server";

export const runtime = "nodejs";

// A same-origin copy of a Steam item picture. The homepage intro reads knife
// pictures' pixels in WebGL (to trace their outlines), and Steam's image CDN
// sends no CORS headers. Only economy item images, by their hash; cached
// hard, since a hash never changes what it points at.
export async function GET(req: Request) {
  const h = new URL(req.url).searchParams.get("h") ?? "";
  if (!/^[A-Za-z0-9_-]{20,600}$/.test(h)) return NextResponse.json({ error: "bad image" }, { status: 400 });
  try {
    const r = await fetch(`https://community.akamai.steamstatic.com/economy/image/${h}/512fx384f`);
    if (!r.ok) return NextResponse.json({ error: `http ${r.status}` }, { status: 502 });
    return new NextResponse(await r.arrayBuffer(), {
      headers: {
        "Content-Type": r.headers.get("content-type") ?? "image/png",
        "Cache-Control": "public, max-age=604800, immutable",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
