import { deepSyncInventory, SteamError } from "@/lib/steam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SSE stream: kicks off (or resumes) a deep sync and emits one event per item.
// The request's AbortSignal fires when the client disconnects, halting cleanly.
// Lives under /run (not on the [steamid] segment itself) so the sibling
// status/control route handlers register correctly.
export async function POST(req: Request, ctx: { params: Promise<{ steamid: string }> }) {
  const { steamid } = await ctx.params;
  if (!/^\d{17}$/.test(steamid)) {
    return new Response(JSON.stringify({ code: "RESOLVE", error: "bad steamid" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        for await (const ev of deepSyncInventory(steamid, req.signal)) {
          send(ev);
        }
      } catch (e) {
        const err = e as SteamError;
        send({ type: "error", code: err.code || "UPSTREAM", error: err.message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
