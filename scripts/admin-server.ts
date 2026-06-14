/**
 * Standalone admin control server for cs2-tradeup.
 *
 * Deliberately NOT part of the Next.js app and NOT easily accessible:
 *   1. Binds to 127.0.0.1 only — never reachable from the network.
 *   2. Requires a token (ADMIN_TOKEN env, else one is generated at boot and
 *      printed to this console). Wrong/absent token → 404, so the server
 *      never advertises that it exists.
 *   3. Mounted under an obscure base path (ADMIN_BASE, default "/_ctl"),
 *      not "/admin".
 *
 * This is SCAFFOLDING: the route handlers in scripts/admin/routes.ts are all
 * stubs. The server (auth, routing, JSON envelope) is real so wiring a
 * control later is a single-function change.
 *
 * Run: npm run admin
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { renderDashboard } from "./admin/page";
import { ROUTES } from "./admin/routes";
import type { AdminResult } from "./admin/types";

const PORT = Number(process.env.ADMIN_PORT ?? 4100);
const HOST = "127.0.0.1"; // localhost only — do not change to 0.0.0.0
const BASE = process.env.ADMIN_BASE ?? "/_ctl";

// Token: explicit env wins; otherwise mint an ephemeral one for this run.
const TOKEN = process.env.ADMIN_TOKEN ?? randomBytes(16).toString("hex");
const TOKEN_IS_EPHEMERAL = !process.env.ADMIN_TOKEN;

function send(res: ServerResponse, status: number, body: string, type = "application/json") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

const json = (res: ServerResponse, status: number, payload: AdminResult) =>
  send(res, status, JSON.stringify(payload));

/** Read and JSON-parse a request body (tolerates empty). */
function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(undefined);
      }
    });
  });
}

/** Token may arrive as a header (API calls) or `?token=` (initial page load). */
function authorized(req: IncomingMessage, url: URL): boolean {
  const header = req.headers["x-admin-token"];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  return fromHeader === TOKEN || url.searchParams.get("token") === TOKEN;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);

  // Everything lives under BASE. Anything else simply doesn't exist.
  if (!url.pathname.startsWith(BASE)) return send(res, 404, "not found", "text/plain");

  // Unauthorized requests get an indistinguishable 404 — no auth challenge.
  if (!authorized(req, url)) return send(res, 404, "not found", "text/plain");

  const sub = url.pathname.slice(BASE.length) || "/";

  // Dashboard page.
  if (sub === "/" && req.method === "GET") {
    return send(res, 200, renderDashboard(BASE, TOKEN), "text/html; charset=utf-8");
  }

  // API routes from the table.
  const route = ROUTES.find((r) => r.path === sub);
  if (route) {
    if (req.method !== route.method) return json(res, 405, { ok: false, error: "method not allowed" });
    const body = req.method === "POST" ? await readBody(req) : undefined;
    try {
      const result = await route.handler({ query: url.searchParams, body });
      return json(res, result.ok ? 200 : 501, result);
    } catch (e) {
      return json(res, 500, { ok: false, error: (e as Error).message });
    }
  }

  return json(res, 404, { ok: false, error: "no such control" });
});

server.listen(PORT, HOST, () => {
  const link = `http://${HOST}:${PORT}${BASE}/?token=${TOKEN}`;
  console.log("\n  cs2-tradeup admin control panel (scaffold)");
  console.log("  ─────────────────────────────────────────");
  console.log(`  listening   ${HOST}:${PORT}  (localhost only)`);
  console.log(`  base path   ${BASE}`);
  if (TOKEN_IS_EPHEMERAL) {
    console.log(`  token       ${TOKEN}  (ephemeral — set ADMIN_TOKEN to pin it)`);
  } else {
    console.log("  token       (from ADMIN_TOKEN)");
  }
  console.log(`\n  open  →  ${link}\n`);
});
