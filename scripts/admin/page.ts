/**
 * Renders the admin dashboard HTML. The control buttons are generated from
 * the ROUTES table so the UI and the server can never drift apart.
 *
 * Styling mirrors the app's terminal/HUD aesthetic (green + amber on void)
 * but is fully self-contained — the admin server serves no other assets.
 */
import { ROUTES } from "./routes";
import { SECTIONS, type AdminRoute } from "./types";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function button(r: AdminRoute): string {
  return `
    <div class="ctl">
      <button
        class="${r.danger ? "danger" : ""}"
        data-method="${r.method}"
        data-path="${esc(r.path)}"
        ${r.danger ? 'data-danger="1"' : ""}
      >${esc(r.label)}</button>
      <p class="hint">${esc(r.hint)}</p>
    </div>`;
}

function section(name: string): string {
  const rows = ROUTES.filter((r) => r.section === name).map(button).join("");
  return `
    <section>
      <h2>${esc(name)}</h2>
      <div class="grid">${rows}</div>
    </section>`;
}

/** `base` is the obscure mount path; `token` is injected so fetches authorize. */
export function renderDashboard(base: string, token: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>ctl</title>
<style>
  :root {
    --void: #0a0e0a; --surface: #11161180; --line: #1e2a1e;
    --green: #5af78e; --green-dim: #2f6b43; --amber: #ffb454;
    --loss: #ff5a5a; --cream: #d8e0d8; --cream-dim: #6b7a6b;
    --mono: ui-monospace, "SF Mono", Menlo, monospace;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--void); color: var(--cream);
    font-family: var(--mono); font-size: 13px; padding: 40px 24px 80px;
  }
  main { max-width: 920px; margin: 0 auto; }
  .hud { font-size: 11px; letter-spacing: 0.15em; text-transform: uppercase; color: var(--amber); }
  h1 { font-size: 26px; margin: 4px 0 2px; color: var(--green); font-weight: 700; }
  h1 .p { color: var(--green-dim); }
  h1 .f { color: var(--green-dim); font-weight: 400; }
  .meta { color: var(--cream-dim); font-size: 11px; margin-top: 8px; }
  section { margin-top: 32px; border: 1px solid var(--line); background: var(--surface); }
  section h2 {
    font-size: 11px; letter-spacing: 0.15em; text-transform: uppercase;
    color: var(--amber); margin: 0; padding: 10px 14px; border-bottom: 1px solid var(--line);
  }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 4px; padding: 4px; }
  .ctl { padding: 12px 14px; }
  button {
    font-family: var(--mono); font-size: 12px; cursor: pointer;
    background: transparent; border: 1px solid var(--green-dim); color: var(--green);
    padding: 8px 14px; width: 100%; text-align: left; transition: background 0.12s;
  }
  button:hover { background: #11221580; }
  button.danger { border-color: var(--loss); color: var(--loss); }
  button.danger:hover { background: #2a111180; }
  .hint { color: var(--cream-dim); font-size: 11px; margin: 8px 0 0; line-height: 1.5; }
  #log {
    margin-top: 32px; border: 1px solid var(--line); background: #060906;
    padding: 12px 14px; min-height: 80px; white-space: pre-wrap; font-size: 12px;
    color: var(--cream-dim);
  }
  #log .ok { color: var(--green); }
  #log .err { color: var(--loss); }
</style>
</head>
<body>
<main>
  <span class="hud">restricted // localhost only</span>
  <h1><span class="p">$ </span>ctl<span class="f"> --admin</span></h1>
  <div class="meta">cs2-tradeup control panel · scaffold (no controls wired) · all actions return “not implemented”</div>

  ${SECTIONS.map(section).join("")}

  <div id="log">› ready. Pricing controls are live; others are stubs. Click “Sync all prices” to pull the full catalog in the background.</div>
</main>
<script>
  const BASE = ${JSON.stringify(base)};
  const TOKEN = ${JSON.stringify(token)};
  const log = document.getElementById("log");
  function line(msg, cls) {
    const at = new Date().toISOString().slice(11, 19);
    log.innerHTML += "\\n› [" + at + "] " + (cls ? '<span class="' + cls + '">' + msg + "</span>" : msg);
  }
  document.querySelectorAll("button[data-path]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (btn.dataset.danger && !confirm("Destructive action. Continue?")) return;
      const method = btn.dataset.method;
      const path = btn.dataset.path;
      line(method + " " + path + " …");
      try {
        const res = await fetch(BASE + path, {
          method,
          headers: { "x-admin-token": TOKEN, "content-type": "application/json" },
          body: method === "POST" ? "{}" : undefined,
        });
        const json = await res.json();
        line(JSON.stringify(json), json.ok ? "ok" : "err");
        // Only the steam-direct sync runs in the background — poll its progress.
        // The default market-average sync returns its full result synchronously.
        if (path.indexOf("/pricing/sync") >= 0 && json.ok && json.data && json.data.started) pollPrices();
      } catch (e) {
        line(String(e), "err");
      }
    });
  });

  // Poll price-sync job progress until it finishes; logs a compact line each tick.
  let polling = false;
  async function pollPrices() {
    if (polling) return;
    polling = true;
    const tick = async () => {
      try {
        const res = await fetch(BASE + "/api/pricing/status", { headers: { "x-admin-token": TOKEN } });
        const j = await res.json();
        const job = j.data && j.data.job;
        const cov = j.data && j.data.coveragePercent;
        if (job && job.status !== "idle") {
          const eta = job.status === "running" ? " · ~" + Math.ceil(job.etaSeconds / 60) + "m left" : "";
          const rl = job.rateLimitHits ? " · " + job.rateLimitHits + " backoffs" : "";
          line(
            "sync " + job.status + " — " + job.updated + " priced / " + job.attempted + " of " + job.total +
              " (" + job.percent + "%) · coverage " + cov + "%" + rl + eta,
            job.status === "running" ? null : "ok",
          );
        }
        if (job && job.status === "running") {
          setTimeout(tick, 5000);
        } else {
          polling = false;
        }
      } catch (e) {
        line(String(e), "err");
        polling = false;
      }
    };
    tick();
  }
</script>
</body>
</html>`;
}
