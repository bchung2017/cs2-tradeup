import { NextResponse } from "next/server";
import { controlJob, type JobControl } from "@/lib/steam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS: JobControl[] = ["pause", "stop", "resume"];

// Writes control intent (pause/stop/resume) onto the job row. The engine loop
// re-reads status each iteration and reacts; this endpoint only sets the flag.
export async function POST(req: Request, ctx: { params: Promise<{ steamid: string }> }) {
  const { steamid } = await ctx.params;
  if (!/^\d{17}$/.test(steamid)) {
    return NextResponse.json({ code: "RESOLVE", error: "bad steamid" }, { status: 400 });
  }
  let body: { action?: string };
  try {
    body = (await req.json()) as { action?: string };
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!body.action || !ACTIONS.includes(body.action as JobControl)) {
    return NextResponse.json({ error: `action must be one of ${ACTIONS.join("|")}` }, { status: 400 });
  }
  const job = controlJob(steamid, body.action as JobControl);
  if (!job) {
    return NextResponse.json({ error: "no job" }, { status: 404 });
  }
  return NextResponse.json({ job });
}
