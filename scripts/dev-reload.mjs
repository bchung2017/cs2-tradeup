#!/usr/bin/env node
// Manual reload nudge — SIGHUP the dev supervisor (scripts/dev-supervisor.mjs)
// to restart `next dev`. Run this after an out-of-band change the post-edit hook
// can't see: a worktree fork resolving/merging back, a `git pull`/`git merge`,
// or any edit made outside Claude's Edit/Write tools.
//
//   npm run reload
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pidFile = path.join(projectDir, ".dev-supervisor.pid");

// Confirm the pid actually belongs to our supervisor before signaling — a stale
// pidfile whose pid got recycled must never receive a stray SIGHUP. On Linux/WSL
// we check /proc/<pid>/cmdline; where /proc is absent we can't verify, so skip.
function isSupervisor(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ").includes("dev-supervisor");
  } catch {
    return null; // /proc unavailable — unknown
  }
}

let pid;
try {
  pid = parseInt(readFileSync(pidFile, "utf8").trim(), 10);
} catch {
  console.error("[reload] no supervisor running (start it with `npm run dev:watch`)");
  process.exit(1);
}

if (isSupervisor(pid) === false) {
  console.error(`[reload] stale pidfile — pid ${pid} is not the supervisor; restart \`npm run dev:watch\``);
  process.exit(1);
}

try {
  process.kill(pid, "SIGHUP");
  console.log(`[reload] restart signal sent to supervisor (pid ${pid})`);
} catch {
  console.error(`[reload] supervisor pid ${pid} is gone; restart \`npm run dev:watch\``);
  process.exit(1);
}
