/**
 * IGL-9000 engine — deterministic fixture check (slice 1).
 *
 * Not a framework test (the repo has no runner); a self-contained, asserted
 * smoke test runnable with `npx tsx scripts/igl9000-check.ts` (or
 * `npm run igl9000-check`). Builds a tiny synthetic catalog + price fixture and
 * asserts valueContract / bestMove behavior, including the ask/bid_net seam,
 * delta reconciliation, cash gating, and determinism.
 *
 * Exits non-zero on the first failed assertion.
 */
import type { Collection, PriceTable, Rarity, Skin } from "@/types/cs2";
import { mockPriceProvider } from "@/lib/igl9000-quote";
import { bestMove, valueContract, enumerateContracts, type Holding } from "@/lib/igl9000-engine";

// ── fixture ──────────────────────────────────────────────────────────────────
const colA: Collection = { id: "colA", name: "Collection A" };
const colB: Collection = { id: "colB", name: "Collection B" };

function skin(id: string, name: string, rarity: Rarity, col: Collection): Skin {
  return {
    id,
    name,
    weapon: { id: "w", name: "W" },
    rarity: { id: rarity, name: rarity },
    min_float: 0,
    max_float: 1,
    collections: [col],
  };
}

const skins: Skin[] = [
  skin("msA1", "MS A1", "Mil-Spec Grade", colA),
  skin("msA2", "MS A2", "Mil-Spec Grade", colA),
  skin("resA", "RES A", "Restricted", colA), // high-value colA output
  skin("msB1", "MS B1", "Mil-Spec Grade", colB),
  skin("resB", "RES B", "Restricted", colB), // mid-value colB output
];
const skinById = new Map(skins.map((s) => [s.id, s]));

// prices keyed `${id}|${wear}|norm`; all inputs land Field-Tested at float 0.2.
const prices: PriceTable = {
  "resA|Field-Tested|norm": { median: 5.0, lowest: 5.0, volume: 1 },
  "resB|Field-Tested|norm": { median: 2.0, lowest: 2.0, volume: 1 },
  "msA1|Field-Tested|norm": { median: 0.1, lowest: 0.1, volume: 1 },
  "msA2|Field-Tested|norm": { median: 0.1, lowest: 0.1, volume: 1 },
  "msB1|Field-Tested|norm": { median: 0.05, lowest: 0.05, volume: 1 },
};
const quote = mockPriceProvider(prices);

// ── assert helpers ───────────────────────────────────────────────────────────
let failures = 0;
function ok(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? "  ok " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

function ownedA(): Holding[] {
  // 10 owned Mil-Spec in colA, all float 0.2
  return [...Array(5)].flatMap(() => [
    { skinId: "msA1", float: 0.2, stattrak: false },
    { skinId: "msA2", float: 0.2, stattrak: false },
  ]);
}
function ownedB(n: number): Holding[] {
  return [...Array(n)].map(() => ({ skinId: "msB1", float: 0.2, stattrak: false }) as Holding);
}

// ── 1. the price seam is two-sided (mock: ask === bid_net) ───────────────────
const qA = quote("resA", "Field-Tested", false)!;
ok("seam: quote returns a two-sided Quote", !!qA && qA.ask === 5.0 && qA.bid_net === 5.0);
ok("seam: unpriced key -> null", quote("nope", "Field-Tested", false) === null);

// ── 2. value a single all-owned colA contract ────────────────────────────────
{
  const [c] = enumerateContracts(ownedA(), skinById, quote, false);
  const v = valueContract(c, skinById, quote, false)!;
  ok("colA: single outcome resA @ p=1", v.outcomes.length === 1 && near(v.outcomes[0].probability, 1));
  ok("colA: EV = 5.00 (1.0 · bid_net)", near(v.ev, 5.0), `ev=${v.ev}`);
  ok("colA: cost = 1.00 (10 owned · 0.10 bid_net)", near(v.cost, 1.0), `cost=${v.cost}`);
  ok("colA: delta = +4.00", near(v.delta, 4.0), `delta=${v.delta}`);
  ok("reconciliation: delta === ev − cost", near(v.delta, v.ev - v.cost));
  ok("colA: no buys, buyCost 0", v.contract.buys === 0 && near(v.buyCost, 0));
  ok("colA: fully priced (not approx)", v.approx === false);
}

// ── 3. bestMove picks the higher-delta collection when both are present ──────
{
  const best = bestMove([...ownedA(), ...ownedB(8)], skinById, quote, 100, false)!;
  ok("bestMove: chose colA (delta 4.0 > colB 1.5)", best.contract.collectionId === "colA", best?.contract.collectionId);
  ok("bestMove: delta = +4.00", near(best.delta, 4.0), `delta=${best.delta}`);
}

// ── 4. colB requires 2 completion buys; ask feeds buyCost ────────────────────
{
  const best = bestMove(ownedB(8), skinById, quote, 100, false)!;
  ok("colB: chosen when it's the only stash", best?.contract.collectionId === "colB");
  ok("colB: 2 buys", best.contract.buys === 2, `buys=${best.contract.buys}`);
  ok("colB: buyCost = 0.10 (2 · 0.05 ask)", near(best.buyCost, 0.1), `buyCost=${best.buyCost}`);
  ok("colB: delta = +1.50 (EV 2.0 − cost 0.5)", near(best.delta, 1.5), `delta=${best.delta}`);
}

// ── 5. cash gating: can't afford the buys -> no move ─────────────────────────
{
  const best = bestMove(ownedB(8), skinById, quote, 0.05, false); // buyCost 0.10 > 0.05
  ok("cash gate: null when buyCost exceeds cash", best === null);
}

// ── 6. determinism: identical result across runs ─────────────────────────────
{
  const a = bestMove([...ownedA(), ...ownedB(8)], skinById, quote, 100, false);
  const b = bestMove([...ownedA(), ...ownedB(8)], skinById, quote, 100, false);
  ok("determinism: two runs are byte-identical", JSON.stringify(a) === JSON.stringify(b));
}

// ── summary ──────────────────────────────────────────────────────────────────
console.log(
  failures === 0 ? "\nALL PASS ✓" : `\n${failures} FAILURE(S) ✗`,
);
process.exit(failures === 0 ? 0 : 1);
