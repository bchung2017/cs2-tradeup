/**
 * IGL-9000 — rank contracts as GAMBLES rather than as investments.
 *
 *   npx tsx scripts/igl9000-gamble.ts [--inventory path.json] [--top 15]
 *                                     [--jackpot 2] [--min-cost 5] [--st]
 *
 * With --inventory, ranks the contracts reachable from those holdings (the
 * engine's own enumeration, so assignment optimisation and mixed-collection
 * candidates all apply). Without it, sweeps the whole catalog for pure-buy
 * gambles: for every (collection, tier, wear bracket), the cheapest legal input
 * bought 10× (or 5× at Covert).
 *
 * The ranking key is `robustScore` from lib/igl9000-gamble.ts — jackpot exposure
 * per dollar of house edge, after shocking the top outcome −30%. It is NOT
 * delta. Every row prints its rake, because that is what the gamble costs.
 */
import { readFileSync } from "node:fs";
import { WEAR_RANGES, type PriceTable, type Rarity, type Skin } from "@/types/cs2";
import { loadPrices, loadSkins } from "@/lib/data";
import { marketAvgPriceProvider, type PriceProvider } from "@/lib/igl9000-quote";
import {
  enumerateContracts,
  valueContract,
  type CandidateContract,
  type Holding,
  type ValuedContract,
} from "@/lib/igl9000-engine";
import { rankGambles, type RankedGamble } from "@/lib/igl9000-gamble";

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (k: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const INVENTORY = arg("inventory");
const TOP = Number(arg("top") ?? 15);
const JACKPOT = Number(arg("jackpot") ?? 2);
const MIN_COST = Number(arg("min-cost") ?? 0);
const MAX_COST = Number(arg("max-cost") ?? Infinity);
const STATTRAK = argv.includes("--st");

const EXCLUDED = new Set(["Limited Edition Item"]);
const TRADEABLE: Rarity[] = [
  "Consumer Grade", "Industrial Grade", "Mil-Spec Grade", "Restricted", "Classified", "Covert",
];

// ── catalog sweep: the cheapest pure-buy gamble in every collection/tier/wear ──
function catalogGambles(
  skins: Skin[],
  skinById: Map<string, Skin>,
  quote: PriceProvider,
): CandidateContract[] {
  // group by (collection, tier)
  const groups = new Map<string, { colId: string; colName: string; tier: Rarity; skins: Skin[] }>();
  for (const s of skins) {
    if (!TRADEABLE.includes(s.rarity.name)) continue;
    const col = s.collections.find((c) => !EXCLUDED.has(c.name));
    if (!col) continue;
    const key = `${col.id}|${s.rarity.name}`;
    const g = groups.get(key) ?? { colId: col.id, colName: col.name, tier: s.rarity.name, skins: [] };
    g.skins.push(s);
    groups.set(key, g);
  }

  const out: CandidateContract[] = [];
  for (const g of groups.values()) {
    const size = g.tier === "Covert" ? 5 : 10;
    for (const wr of WEAR_RANGES) {
      // cheapest input in this group that actually exists at this wear bracket
      let best: { skin: Skin; float: number; ask: number } | null = null;
      for (const s of g.skins) {
        // a skin only reaches a bracket if its own float range overlaps it
        const lo = Math.max(wr.min, s.min_float);
        const hi = Math.min(wr.max, s.max_float);
        if (hi <= lo) continue;
        const float = (lo + hi) / 2;
        const q = quote(s.id, wr.wear, STATTRAK, float);
        if (!q) continue;
        if (!best || q.ask < best.ask) best = { skin: s, float, ask: q.ask };
      }
      if (!best) continue;
      out.push({
        tier: g.tier,
        size,
        collectionId: g.colId,
        collectionName: g.colName,
        slots: [...Array(size)].map(() => ({ skinId: best!.skin.id, float: best!.float, owned: false })),
        buys: size,
      });
    }
  }
  return out;
}

// ── inventory loader (lenient about field names) ──────────────────────────────
function stripName(n: string): string {
  return n
    .replace(/^StatTrak™\s*/, "")
    .replace(/^★\s*/, "")
    .replace(/\s*\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/, "")
    .trim();
}

function loadHoldings(path: string, skins: Skin[]): { holdings: Holding[]; unresolved: string[] } {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const rows: any[] = Array.isArray(raw) ? raw : (raw.items ?? raw.holdings ?? raw.inventory ?? []);
  const byName = new Map(skins.map((s) => [stripName(s.name).toLowerCase(), s]));
  const byId = new Map(skins.map((s) => [s.id, s]));

  const holdings: Holding[] = [];
  const unresolved: string[] = [];
  for (const r of rows) {
    const id = r.skinId ?? r.id;
    const name: string | undefined = r.name ?? r.market_hash_name ?? r.marketName;
    const skin = (id && byId.get(id)) || (name && byName.get(stripName(name).toLowerCase()));
    if (!skin) {
      unresolved.push(String(name ?? id ?? "?"));
      continue;
    }
    const float = Number(r.float ?? r.floatvalue ?? r.paint_wear ?? r.wearValue ?? NaN);
    holdings.push({
      skinId: skin.id,
      float: Number.isFinite(float) ? float : (skin.min_float + skin.max_float) / 2,
      stattrak: Boolean(r.stattrak ?? r.isStatTrak ?? /StatTrak/.test(name ?? "")),
    });
  }
  return { holdings, unresolved };
}

// ── run ──────────────────────────────────────────────────────────────────────
const skins = loadSkins();
const prices: PriceTable = loadPrices();
const skinById = new Map(skins.map((s) => [s.id, s]));
const quote = marketAvgPriceProvider(prices);

let candidates: CandidateContract[];
let mode: string;
if (INVENTORY) {
  const { holdings, unresolved } = loadHoldings(INVENTORY, skins);
  mode = `inventory (${holdings.length} resolved holdings${unresolved.length ? `, ${unresolved.length} unresolved` : ""})`;
  candidates = enumerateContracts(holdings, skinById, quote, STATTRAK);
} else {
  mode = "catalog sweep (pure-buy gambles)";
  candidates = catalogGambles(skins, skinById, quote);
}

const valued: ValuedContract[] = [];
for (const c of candidates) {
  const v = valueContract(c, skinById, quote, STATTRAK);
  if (v) valued.push(v);
}

const { ranked, suspects, rejected } = rankGambles(
  valued.filter((v) => v.cost <= MAX_COST),
  { jackpotMultiple: JACKPOT, minCost: MIN_COST },
);

// ── report ───────────────────────────────────────────────────────────────────
const money = (n: number) => `$${n.toFixed(2)}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

console.log(`\nIGL-9000 · gambling rank — ${mode}`);
console.log(`  candidates ${candidates.length} → valued ${valued.length} → rankable ${ranked.length}`);
console.log(`  jackpot bar: payout ≥ ${JACKPOT}× stake · ranked by robustScore (top outcome shocked −30%)\n`);

if (!ranked.length) {
  console.log("  nothing rankable — every candidate was unpriced, jackpot-less, or over the rake cap.\n");
} else {
  const show = ranked.slice(0, TOP);
  for (let i = 0; i < show.length; i++) {
    const { contract: v, profile: g } = show[i];
    const c = v.contract;
    const inputName = skinById.get(c.slots[0].skinId)?.name ?? c.slots[0].skinId;
    console.log(
      `${String(i + 1).padStart(2)}. ${c.collectionName} · ${c.tier} ×${c.size}` +
        `  stake ${money(v.cost)}  rake ${pct(g.rake)}  (RTP ${pct(g.rtp)})`,
    );
    console.log(
      `    input   ${inputName} @ ${c.slots[0].float.toFixed(3)}` +
        `   owned ${v.usesOwned}/${c.size}   buy now ${money(v.buyCost)}`,
    );
    console.log(
      `    dream   ${g.topMultiple.toFixed(1)}× → ${g.topName}` +
        `   1 in ${g.oneIn ? g.oneIn.toFixed(0) : "—"}   skew ${g.skew.toFixed(1)}`,
    );
    console.log(
      `    floor   keep ${pct(g.floorRatio)} on a miss   hit ${pct(g.hitRate)}` +
        `   bleed ${money(g.bleed)}/pull   chase to 50% ≈ ${g.chaseCost != null ? money(g.chaseCost) : "—"}`,
    );
    console.log(
      `    score   ${g.dreamSurvivesShock ? g.robustScore.toFixed(2) : "0.00 — dream does NOT survive a −30% price shock"}` +
        `   (unshocked ${g.score.toFixed(2)})` +
        `   delta ${money(v.delta)}${v.approx ? "  [approx]" : ""}`,
    );
    console.log("");
  }

  // Contrast: what ranking by delta would have picked instead. The two lists
  // disagreeing is the whole point of this module.
  const byDelta = [...valued].sort((a, b) => b.delta - a.delta)[0];
  if (byDelta) {
    const gd = ranked.find((r) => r.contract === byDelta)?.profile;
    console.log(
      `  for contrast — best by DELTA: ${byDelta.contract.collectionName} · ${byDelta.contract.tier}` +
        ` stake ${money(byDelta.cost)} delta ${money(byDelta.delta)}` +
        (gd ? ` · as a gamble it scores ${gd.robustScore.toFixed(2)}` : " · unrankable as a gamble (quarantined or filtered)"),
    );
  }
  console.log("");
}

// ── quarantine + audit ───────────────────────────────────────────────────────
console.log(`  rejections: ${Object.entries(rejected).map(([k, n]) => `${k} ${n}`).join(", ") || "none"}`);
if (suspects.length) {
  console.log(
    `\n  QUARANTINE — ${suspects.length} contract(s) too good to be true. Not opportunities:` +
      ` a claimed profit in this market is a price to go verify, not an edge to take.`,
  );
  for (const s of suspects.slice(0, 8)) {
    const inputName = skinById.get(s.contract.contract.slots[0].skinId)?.name ?? "?";
    console.log(
      `    · ${s.contract.contract.collectionName} · ${s.contract.contract.tier}` +
        `  RTP ${pct(s.profile.rtp)}  floor ${pct(s.profile.floorRatio)}  [${s.reason}]` +
        `  suspect price: ${inputName} or ${s.profile.topName}`,
    );
  }
}
console.log("");
