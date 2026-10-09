/**
 * IGL-9000 — build the Venture surface's data.
 *
 *   npx tsx scripts/igl9000-ventures.ts [--verify 30] [--knife-verify 20] [--steam-gap 8]
 *
 * Runs the three sweeps and merges what they found into public/data:
 *   ventures.json            mixed-collection sweep (live-checked top N) + knife sweep
 *   ventures-longlist.json   knife contracts indexed by the red you own
 *   ventures-expired.json    contracts that dropped out since the last run
 * `firstSeenAt` is carried over by key from the previous files, so the age sort
 * survives runs without a database (Render has no disk; these files are committed).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { canProfit, rowCanProfit, type ExpiredFile, type LonglistFile, type Venture, type VenturesFile } from "@/lib/ventures";

const argv = process.argv.slice(2);
const arg = (k: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const VERIFY = arg("verify") ?? "30";
const KNIFE_VERIFY = arg("knife-verify") ?? "20";
const GAP = arg("steam-gap") ?? "8";
const TMP = "node_modules/.cache/ventures";
const OUT = "public/data";
const KEEP_EXPIRED = 300;

mkdirSync(TMP, { recursive: true });
const run = (script: string, args: string[]) =>
  execFileSync("npx", ["tsx", `scripts/${script}`, ...args], { stdio: ["ignore", "inherit", "inherit"] });

run("igl9000-mix.ts", ["--venue", "steam", "--edge-mult", "2.5", "--max-cost", "400", "--min-rtp", "0.85", "--top", VERIFY, "--verify-steam", VERIFY, "--steam-gap", GAP, "--json", `${TMP}/sweep.json`]);
run("igl9000-knife.ts", ["--top", "40", "--verify-steam", KNIFE_VERIFY, "--steam-gap", GAP, "--json", `${TMP}/knife.json`]);
run("igl9000-knife-longlist.ts", ["--per", "3", "--out", `${TMP}/longlist`]);

const read = <T>(path: string, fallback: T): T => (existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback);
const now = new Date().toISOString();

// ── market ventures ─────────────────────────────────────────────────────────
const prev = read<VenturesFile>(`${OUT}/ventures.json`, { generatedAt: now, ventures: [] });
const seen = new Map(prev.ventures.map((v) => [v.key, v.firstSeenAt]));
const fresh: Venture[] = [...read<Venture[]>(`${TMP}/sweep.json`, []), ...read<Venture[]>(`${TMP}/knife.json`, [])];
const byKey = new Map<string, Venture>();
for (const v of fresh) if (canProfit(v) && !byKey.has(v.key)) byKey.set(v.key, { ...v, firstSeenAt: seen.get(v.key) ?? v.firstSeenAt });
const ventures = [...byKey.values()].sort((a, b) => b.backPerDollar - a.backPerDollar);
writeFileSync(`${OUT}/ventures.json`, JSON.stringify({ generatedAt: now, ventures } satisfies VenturesFile));

// ── longlist ────────────────────────────────────────────────────────────────
const prevLong = read<LonglistFile>(`${OUT}/ventures-longlist.json`, { generatedAt: now, rows: [] });
const seenLong = new Map(prevLong.rows.map((r) => [r.key, r.firstSeenAt]));
const long = read<LonglistFile>(`${TMP}/longlist.json`, { generatedAt: now, rows: [] });
const rows = long.rows.filter(rowCanProfit).map((r) => ({ ...r, firstSeenAt: seenLong.get(r.key) ?? r.firstSeenAt }));
writeFileSync(`${OUT}/ventures-longlist.json`, JSON.stringify({ generatedAt: now, rows } satisfies LonglistFile));

// ── expired: market ventures that were there last run and aren't now ───────
const expired = read<ExpiredFile>(`${OUT}/ventures-expired.json`, { rows: [] });
const gone = prev.ventures
  .filter((v) => !byKey.has(v.key))
  .map((v) => ({
    key: v.key,
    title: `${v.inputs.map((i) => `${i.count}× ${i.skin}`).join(" + ")} → ${v.best.name}`,
    firstSeenAt: v.firstSeenAt,
    expiredAt: now,
    backPerDollar: v.backPerDollar,
  }));
expired.rows = [...gone, ...expired.rows.filter((r) => !byKey.has(r.key))].slice(0, KEEP_EXPIRED);
writeFileSync(`${OUT}/ventures-expired.json`, JSON.stringify(expired));

const count = (verdict: string) => ventures.filter((v) => v.verdict === verdict).length;
console.log(
  `\nventures: ${ventures.length} (${count("holds")} hold, ${count("dead")} dead, ${count("unverified")} unverified, ${count("short")} short, ${count("model")} model-only)` +
    `   new ${ventures.filter((v) => !seen.has(v.key)).length}   expired ${gone.length}   longlist ${rows.length}`,
);
