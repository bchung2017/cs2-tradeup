#!/usr/bin/env node
// Claude Code PostToolUse hook (Edit|Write). After a source-file edit it sends
// SIGHUP to the dev supervisor (scripts/dev-supervisor.mjs) so `next dev`
// restarts and the 9p mount's dead inotify is bypassed. No-op — and never an
// error — when the supervisor isn't running or the edit isn't app source, so it
// stays out of the way during plain `npm run dev` or non-source edits.
import { readFileSync } from "node:fs";
import path from "node:path";

const PROJECT = "/workspace/main";
const PID_FILE = path.join(PROJECT, ".dev-supervisor.pid");
const WATCH_DIRS = ["app", "components", "lib"].map((d) => path.join(PROJECT, d));
const WATCH_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css"]);

function done(msg) {
  if (msg) console.log(`[dev-reload] ${msg}`);
  process.exit(0); // always succeed — a hook must never block the edit
}

let payload;
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  done();
}

const file = payload?.tool_input?.file_path;
if (!file) done();

const abs = path.resolve(file);
if (abs.includes(`${path.sep}node_modules${path.sep}`) || abs.includes(`${path.sep}.next${path.sep}`)) done();
const inWatched = WATCH_DIRS.some((d) => abs === d || abs.startsWith(d + path.sep));
if (!inWatched || !WATCH_EXT.has(path.extname(abs))) done();

let pid;
try {
  pid = parseInt(readFileSync(PID_FILE, "utf8").trim(), 10);
} catch {
  done(); // supervisor not running
}
if (!pid) done();

// Never SIGHUP a recycled pid: confirm it's our supervisor first (Linux/WSL via
// /proc). If /proc is unavailable we can't check, so fall through and rely on
// process.kill throwing for a dead pid.
try {
  const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8");
  if (!cmdline.replace(/\0/g, " ").includes("dev-supervisor")) done(); // stale
} catch {
  // /proc missing or pid gone — handled by the kill below
}

try {
  process.kill(pid, "SIGHUP");
  done(`restarting dev server for ${path.relative(PROJECT, abs)}`);
} catch {
  done(); // stale pidfile — supervisor gone
}
