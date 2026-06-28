#!/usr/bin/env node
// Dev supervisor — run this INSTEAD of `npm run dev` on the 9p/WSL mount where
// inotify is dead and Next never sees file changes. It owns a `next dev` child
// and restarts it when the source tree changes, detected two ways:
//   1. POLLING — it stats app/components/lib/types every POLL_MS and restarts on
//      any change. inotify-free, so it catches edits from ANYONE: the main Claude
//      session, a fork, or your own editor. This is the reliable path.
//   2. SIGHUP — the post-edit hook / `npm run reload` can still nudge it.
// Restarts drop in-browser HMR state by design.
//
//   node scripts/dev-supervisor.mjs            # default port 3000
//   node scripts/dev-supervisor.mjs -p 3001    # extra args pass through to next
import { spawn } from "node:child_process";
import { writeFileSync, unlinkSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pidFile = path.join(projectDir, ".dev-supervisor.pid");
const nextBin = path.join(projectDir, "node_modules", ".bin", "next");
const passthrough = process.argv.slice(2);

let child = null;
let restarting = false;
let debounce = null;

const log = (msg) => process.stdout.write(`\x1b[35m[dev-supervisor]\x1b[0m ${msg}\n`);

function start() {
  child = spawn(nextBin, ["dev", ...passthrough], {
    cwd: projectDir,
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code, signal) => {
    if (restarting) return; // we killed it on purpose; respawn handled below
    log(`next dev exited (code=${code}, signal=${signal}); stopping supervisor.`);
    cleanup();
    process.exit(code ?? 0);
  });
}

function restart() {
  if (!child || restarting) return;
  restarting = true;
  log("source changed — restarting next dev …");
  const old = child;
  old.once("exit", () => {
    restarting = false;
    start();
  });
  old.kill("SIGTERM");
  setTimeout(() => {
    if (restarting) old.kill("SIGKILL"); // hard stop if it ignores SIGTERM
  }, 4000);
}

function onHup() {
  clearTimeout(debounce);
  debounce = setTimeout(restart, 300); // coalesce bursts of edits into one restart
}

// --- polling watcher -------------------------------------------------------
// Every POLL_MS, stat the source tree and restart when its signature (file count
// + newest mtime) changes. inotify-free, so it catches edits from anyone.
const WATCH_DIRS = ["app", "components", "lib", "types"];
const WATCH_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css"]);
const POLL_MS = 1000;

function scanSignature() {
  let count = 0;
  let newest = 0;
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // dir may not exist yet
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name === ".next" || e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (WATCH_EXT.has(path.extname(e.name))) {
        try {
          const m = statSync(full).mtimeMs;
          count++;
          if (m > newest) newest = m;
        } catch {}
      }
    }
  };
  for (const d of WATCH_DIRS) walk(path.join(projectDir, d));
  return `${count}:${newest}`;
}

let lastSig = scanSignature();
function poll() {
  const sig = scanSignature();
  if (sig !== lastSig) {
    lastSig = sig;
    log("source change detected (poll) — reloading");
    onHup(); // debounced restart
  }
}

function cleanup() {
  try {
    unlinkSync(pidFile);
  } catch {}
}

process.on("SIGHUP", onHup);
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    cleanup();
    if (child && !child.killed) child.kill("SIGTERM");
    process.exit(0);
  });
}

writeFileSync(pidFile, String(process.pid));
setInterval(poll, POLL_MS);
log(`pid ${process.pid} → ${path.relative(projectDir, pidFile)}`);
log(`running; polling ${WATCH_DIRS.join("/")} every ${POLL_MS}ms + SIGHUP (Ctrl+C to stop)`);
start();
