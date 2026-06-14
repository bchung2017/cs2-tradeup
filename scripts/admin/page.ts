/**
 * Renders the admin dashboard HTML. The control buttons are generated from
 * the ROUTES table so the UI and the server can never drift apart.
 *
 * A live "Price data" panel sits at the top: it auto-loads /api/pricing/status
 * on page load (and after every action / on a timer), so last-sync, coverage,
 * and source are always visible without clicking the status button or scrolling
 * to the console. Running a sync shows a loading bar — indeterminate while the
 * synchronous market-average request is in flight, determinate (polled) for the
 * background steam-direct job.
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
    display: flex; justify-content: space-between; align-items: center;
  }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 4px; padding: 4px; }
  .ctl { padding: 12px 14px; }
  button {
    font-family: var(--mono); font-size: 12px; cursor: pointer;
    background: transparent; border: 1px solid var(--green-dim); color: var(--green);
    padding: 8px 14px; width: 100%; text-align: left; transition: background 0.12s;
  }
  button:hover { background: #11221580; }
  button:disabled { cursor: progress; }
  button.danger { border-color: var(--loss); color: var(--loss); }
  button.danger:hover { background: #2a111180; }
  .hint { color: var(--cream-dim); font-size: 11px; margin: 8px 0 0; line-height: 1.5; }

  /* ── live price-data panel ── */
  #status { margin-top: 24px; }
  .status-body { padding: 14px; }
  .stat-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 14px; }
  .stat .hud { color: var(--cream-dim); }
  .stat-v { font-size: 16px; color: var(--cream); margin-top: 4px; }
  .bar-wrap { height: 10px; background: #060906; border: 1px solid var(--line); overflow: hidden; margin-top: 12px; }
  .bar-fill { height: 100%; width: 0%; background: var(--green); transition: width .4s ease; }
  .bar-fill.prog { background: var(--amber); }
  .bar-cap { font-size: 10px; color: var(--cream-dim); margin-top: 5px; letter-spacing: 0.1em; text-transform: uppercase; }
  #st-progress { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); }
  .bar-fill.indet { width: 35% !important; transition: none; animation: indet 1.1s ease-in-out infinite; }
  @keyframes indet { 0% { margin-left: -35%; } 100% { margin-left: 100%; } }
  .badge { font-size: 10px; padding: 2px 9px; border: 1px solid var(--green-dim); color: var(--green); letter-spacing: 0.12em; }
  .badge.run { color: var(--amber); border-color: var(--amber); }
  .badge.err { color: var(--loss); border-color: var(--loss); }

  #log {
    margin-top: 32px; border: 1px solid var(--line); background: #060906;
    padding: 12px 14px; min-height: 60px; max-height: 200px; overflow-y: auto;
    white-space: pre-wrap; font-size: 12px; color: var(--cream-dim);
  }
  #log .ok { color: var(--green); }
  #log .err { color: var(--loss); }
</style>
</head>
<body>
<main>
  <span class="hud">restricted // localhost only</span>
  <h1><span class="p">$ </span>ctl<span class="f"> --admin</span></h1>
  <div class="meta">cs2-tradeup control panel · pricing controls are live · status auto-refreshes</div>

  <section id="status">
    <h2>Price data <span id="st-badge" class="badge">loading…</span></h2>
    <div class="status-body">
      <div class="stat-row">
        <div class="stat"><div class="hud">Source</div><div id="st-source" class="stat-v">—</div></div>
        <div class="stat"><div class="hud">Last sync</div><div id="st-lastsync" class="stat-v">—</div></div>
        <div class="stat"><div class="hud">Coverage</div><div id="st-coverage" class="stat-v">—</div></div>
        <div class="stat"><div class="hud">File</div><div id="st-file" class="stat-v">—</div></div>
      </div>
      <div class="bar-wrap" title="real-priced coverage of the catalog"><div id="st-cov-bar" class="bar-fill"></div></div>
      <div class="bar-cap" id="st-cov-cap">coverage</div>

      <div id="st-progress" style="display:none">
        <div class="hud" id="st-progress-label" style="color:var(--amber)">syncing…</div>
        <div class="bar-wrap"><div id="st-progress-bar" class="bar-fill prog"></div></div>
      </div>
    </div>
  </section>

  ${SECTIONS.map(section).join("")}

  <div id="log">› ready. Status above refreshes on its own — run "Sync all prices" to populate the catalog.</div>
</main>
<script>
  var BASE = ${JSON.stringify(base)};
  var TOKEN = ${JSON.stringify(token)};
  var log = document.getElementById("log");
  function line(msg, cls) {
    var at = new Date().toISOString().slice(11, 19);
    log.innerHTML += "\\n› [" + at + "] " + (cls ? '<span class="' + cls + '">' + msg + "</span>" : msg);
    log.scrollTop = log.scrollHeight;
  }
  function H(id) { return document.getElementById(id); }

  function fmtAge(sec) {
    if (sec == null) return "never";
    if (sec < 60) return sec + "s ago";
    var m = Math.floor(sec / 60); if (m < 60) return m + "m ago";
    var h = Math.floor(m / 60); if (h < 24) return h + "h ago";
    return Math.floor(h / 24) + "d ago";
  }
  function fmtBytes(n) {
    if (n == null) return "—";
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    return (n / 1048576).toFixed(1) + " MB";
  }
  function badge(label, cls) {
    var el = H("st-badge");
    el.textContent = label;
    el.className = "badge" + (cls ? " " + cls : "");
  }
  function num(n) { return (n == null ? 0 : n).toLocaleString(); }

  // ── live status panel ──────────────────────────────────────────────────
  function renderStatus(d) {
    if (!d || !d.exists) {
      H("st-source").textContent = "no prices.json";
      H("st-lastsync").textContent = "never";
      H("st-coverage").textContent = "—";
      H("st-file").textContent = "—";
      H("st-cov-bar").style.width = "0%";
      H("st-cov-cap").textContent = "no price file — run a sync";
    } else {
      H("st-source").textContent = d.source;
      H("st-lastsync").textContent = fmtAge(d.lastSyncAgeSec);
      H("st-lastsync").title = d.lastSync ? new Date(d.lastSync).toLocaleString() : "never synced";
      H("st-coverage").textContent = d.coveragePercent + "%";
      H("st-file").textContent = fmtBytes(d.fileBytes);
      H("st-cov-bar").style.width = d.coveragePercent + "%";
      H("st-cov-cap").textContent =
        num(d.realKeys) + " priced / " + num(d.totalKeys) + " keys" +
        (d.multiSourceKeys ? " · " + num(d.multiSourceKeys) + " blended" : "");
    }
    var job = (d && d.job) || {};
    if (job.status === "running") { badge("SYNCING", "run"); progressDeterminate(job); }
    else if (job.status === "error") { badge("ERROR", "err"); hideProgress(); }
    else { badge(d && d.exists ? "IDLE" : "EMPTY", ""); hideProgress(); }
  }

  async function refreshStatus() {
    try {
      var res = await fetch(BASE + "/api/pricing/status", { headers: { "x-admin-token": TOKEN } });
      var j = await res.json();
      if (j && j.ok && j.data) { renderStatus(j.data); return j.data; }
    } catch (e) { /* keep last good render */ }
    return null;
  }

  // ── loading bar ────────────────────────────────────────────────────────
  function progressIndeterminate(label) {
    H("st-progress").style.display = "block";
    H("st-progress-label").textContent = label || "syncing…";
    var bar = H("st-progress-bar");
    bar.classList.add("indet");
    bar.style.width = "";
  }
  function progressDeterminate(job) {
    H("st-progress").style.display = "block";
    var bar = H("st-progress-bar");
    bar.classList.remove("indet");
    bar.style.width = (job.percent || 0) + "%";
    var eta = job.etaSeconds ? " · ~" + Math.ceil(job.etaSeconds / 60) + "m left" : "";
    var rl = job.rateLimitHits ? " · " + job.rateLimitHits + " backoffs" : "";
    H("st-progress-label").textContent =
      "syncing — " + num(job.updated) + " priced / " + num(job.attempted) + " of " + num(job.total) +
      " (" + job.percent + "%)" + rl + eta;
  }
  function hideProgress() {
    H("st-progress").style.display = "none";
    H("st-progress-bar").classList.remove("indet");
  }

  function syncButtons() {
    return Array.prototype.slice.call(document.querySelectorAll('button[data-path*="/pricing/sync"]'));
  }
  function lockSync(on) {
    syncButtons().forEach(function (b) { b.disabled = on; b.style.opacity = on ? "0.5" : ""; });
  }

  // Poll the background (steam-direct) job until it finishes.
  var polling = false;
  async function pollPrices() {
    if (polling) return;
    polling = true;
    var tick = async function () {
      var d = await refreshStatus();
      var job = d && d.job;
      if (job && job.status === "running") { setTimeout(tick, 3000); }
      else {
        polling = false; lockSync(false); hideProgress();
        line("sync " + (job ? job.status : "done") + (job ? " — " + num(job.updated) + " priced" : ""), "ok");
      }
    };
    tick();
  }

  document.querySelectorAll("button[data-path]").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      if (btn.dataset.danger && !confirm("Destructive action. Continue?")) return;
      var method = btn.dataset.method;
      var path = btn.dataset.path;
      var isSync = path.indexOf("/pricing/sync") >= 0;
      line(method + " " + path + " …");
      if (isSync) { lockSync(true); badge("SYNCING", "run"); progressIndeterminate("pulling feeds & blending…"); }
      try {
        var res = await fetch(BASE + path, {
          method: method,
          headers: { "x-admin-token": TOKEN, "content-type": "application/json" },
          body: method === "POST" ? "{}" : undefined,
        });
        var json = await res.json();
        line(JSON.stringify(json), json.ok ? "ok" : "err");
        if (isSync) {
          if (json.ok && json.data && json.data.started) {
            pollPrices(); // background job — determinate bar from here
          } else {
            await refreshStatus(); // synchronous market-avg finished
            lockSync(false); hideProgress();
          }
        } else if (path.indexOf("/pricing/") >= 0) {
          refreshStatus(); // stop / status / etc. — keep the panel current
        }
      } catch (e) {
        line(String(e), "err");
        if (isSync) { lockSync(false); hideProgress(); badge("ERROR", "err"); }
      }
    });
  });

  // Auto-load status now, resume polling if a sync is already in flight, and
  // keep the "last sync" age fresh on a slow timer.
  refreshStatus().then(function (d) { if (d && d.job && d.job.status === "running") pollPrices(); });
  setInterval(function () { if (!polling) refreshStatus(); }, 20000);
</script>
</body>
</html>`;
}
