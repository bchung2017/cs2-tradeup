# IGL-9000 — Mix Levers: Anchors, Fillers and Float

> How we got from "every trade-up in the catalog is −EV" to a working method for
> finding +EV contracts: mix two collections, steer the output float with
> cheap low-float inputs, and refuse to trust any price the market doesn't
> corroborate. Code: `scripts/igl9000-mix.ts` (`npm run igl9000-mix`).
> Companion: `context/igl9000-engine-spec.md` (the engine this sits on).
>
> Snapshot: prices synced 2026-09-28. Every number below is from that sync and
> will drift. The method, not the recipes, is the durable part.

---

## 1. What didn't work, and why

| Attempt | Result | What it taught us |
|---|---|---|
| Single-collection catalog sweep (`igl9000-gamble.ts`): cheapest input ×10, mid-bracket float | 70 rankable contracts, all −EV (rake 18–35%) | The search space was wrong, not the market. It never mixed collections and threw away float by buying mid-bracket. |
| Revolution Covert ×5 (gloves) | "+$30 edge" | The edge was buying on Skinport and selling on Steam, a venue markup present on *every* item. Priced like-for-like it lost $44.89. **Always compare a trade-up against simply flipping its inputs.** |
| First mixed-collection run | Top results at 400–500% RTP | Almost all fake: single stale Skinport listings (P90 Fallout Warning FT at $334.61 vs Steam $11.96; PP-Bizon Rust Coat MW at $941.77 vs $19.22). The quote's dispersion guard excludes Steam, so with one other venue it never fires. |
| Inputs at float ≤0.000 | "Cheap" low-float inputs | Unbuyable. The bottom of a wear bracket is collector territory, not filler. |

The turn came from reverse-engineering a YouTube budget trade-up video: all
five of its contracts mixed two collections and specified float caps. Pricing
them in our engine at those exact floats showed all five as +EV before fees,
which proved the blind spot was ours.

---

## 2. The three levers

### Lever 1: collection mix sets the odds

Each input's collection gets a share of the odds equal to its share of the
inputs, split evenly across that collection's outcomes one tier up:

```
P(outcome o in collection C) = (inputs from C / N) / (distinct outcomes in C)
N = 10 (5 for Covert)
```

Collections with **few** outcomes concentrate probability. Radiant has three
Restricted outcomes, so 7 Radiant inputs give each one 70% / 3 = 23.3%.

### Lever 2: input floats set the output wear

The output float is set by the **average normalized input float** T:

```
T              = mean over inputs of (f − skin.min) / (skin.max − skin.min)
outcome float  = o.min + T · (o.max − o.min)
```

Wear grade is a step function of float (FN < 0.07 ≤ MW < 0.15 ≤ FT < 0.38 ≤
WW < 0.45 ≤ BS), and prices jump across grades. So buying inputs just low
enough lands outcomes one grade up, often worth several times more.

### Lever 3: price data quality decides what is real

A contract is only as real as its least-trustworthy price. Picking the best of
23,000 candidates **selects for pricing errors**: any overpriced outcome or
underpriced input floats to the top. Guards in §5.

---

## 3. Anchors and fillers

Every good two-collection contract is one of each.

**Terminology used in this doc:**
- **Anchor**: the *value* collection whose outcomes carry the EV.
- **Filler**: the cheap collection that controls the float.

(Earlier discussion sometimes called the filler a "float anchor". In this doc
and in code comments, *anchor = value, filler = float control*.)

### Slot economics (recipe A, 2026-09-28)

| Slot | Cost | Buys | Its outcomes average | EV bought |
|---|---|---|---|---|
| Anchor: P250 Red Tide FT (Radiant) | $0.16 | 10% of a Radiant roll | $3.54 net | **$0.35** |
| Filler: MAG-7 Resupply MW (Fever) | $0.14 | 10% of a Fever roll | $0.50 net | **$0.05** |

An anchor slot returns about 2× its cost. **A filler slot loses money on its
own.** You'd want all anchors, except the anchor is the high-float input.
The filler is a cheap *low-float* skin whose job is to pull T down so the anchor's
outcomes land in the valuable grade. The filler's own outcomes are the price
of that float control.

### What makes a good anchor
- **Few outcomes, all worth more than the contract cost.** Radiant: 3 of 3 win.
- Anchor inputs are cheap in a *high* float grade (FT, WW), because that's
  where the anchor collection's inputs are cheapest.

### What makes a good filler
- Cheap in a **low** grade (MW, FN) relative to its float contribution.
- A wide float range helps: the same raw float normalizes lower.
- Ideally its own outcomes aren't pure junk, since they still take probability.
  Usually they are junk, and that's acceptable.

### The split is the optimization

- **More anchors:** better odds, but T rises, so every anchor must be lower
  float (more expensive) to keep outcomes in grade.
- **More fillers:** cheap float control, but more probability on losing outcomes.

The YouTube 5/5 splits give half the odds to junk. The sweep's optimum for
the same anchor:

| | Video #5 (5/5, Red Tide ≤0.22) | Recipe A (7/3, Red Tide ≤0.173) | Recipe A′ (9/1, Red Tide ≤0.173) |
|---|---|---|---|
| RTP | 132% | **170%** | 124% |
| P(profit) | 50% | 70% | **100%** |

The tighter cap is **not** where the return comes from. It's the cost of the
split: 7 Red Tides at ≤0.22 would push the Mulberry to about 0.17 (FT). The
break-even check while shopping is whether Red Tide ≤0.173 costs under about
$0.22, above which the looser 5/5 version is the better contract.

---

## 4. The search (`scripts/igl9000-mix.ts`)

For each input tier, Consumer through Covert:

1. **Collections**: every ordered pair (A, B) with inputs at the tier and
   outcomes one up, plus each collection alone. That's 23,093 in total.
   Multi-collection input skins are excluded to keep the probability model exact.
2. **Cost curve per collection**: `c(n)` = cheapest ask to own an input with
   normalized float ≤ n, over every skin and wear grade, on a 1,001-point grid,
   carried forward as a running minimum (a step function). Asks are linear in
   float within a grade (the quote's `floatMultiplier`), so two quotes per grade
   suffice. The **frontier** is the set of points where cost drops.
3. **Breakpoints only**: outcome wear changes only when T crosses
   `(boundary − o.min)/(o.max − o.min)` for some outcome, so we test T just under
   each such value (plus T = 1) instead of a continuous range.
4. **Cheapest inputs per (A, B, k, T)**: minimize `k·cA(nA) + (N−k)·cB(nB)`
   subject to `k·nA + (N−k)·nB ≤ N·T`. Scan A's frontier and B's float follows,
   exact on the grid.
5. **EV formula**: `EV = (k·avgA(T) + (N−k)·avgB(T)) / N`, with each
   collection's average outcome value cached per T.
6. **Verify**: finalists are re-valued by the engine's `valueContract` with the
   actual chosen skins and floats, then deduplicated by their **set of winning
   outcomes** (one row per opportunity, not one per interchangeable filler).

Runtime is about 15 s for the whole catalog.

### Reporting
- Each input is shown as `lo–cap`: the bottom of its wear grade up to the cap.
  A real fill lands anywhere in that range.
- Each outcome's float range follows from the range of T, labelled `MW/FT` when
  it crosses a grade. **Payout is valued at the worst end**, so a lower fill is
  pure upside.
- Every outcome is listed with its collection and `WIN` if its net value
  exceeds cost. The robustness check shocks *every* winner −30%, not just the top one.

---

## 5. Guards

| Guard | Default | Why |
|---|---|---|
| Steam corroboration: reject a price when venues disagree by more than `--max-spread` | 2× | Stops single stale Skinport listings from posing as jackpots (§1). |
| Minimum float depth: inputs not bought in the bottom `--min-depth` of a wear grade | 10% | The lowest floats in a grade are collector-priced or don't exist. |
| Float premium: the quote's `floatSkew` | 0.2 (±10% across a grade) | A model, not listing data. **Don't** stress-test by raising it: it is symmetric, so high-float inputs get *cheaper* and the search just shifts to them. Use RTP as the margin instead: RTP 158% means inputs can cost 58% more before break-even. |
| Like-for-like venue | Third-party both sides | Buy at the third-party ask, sell at third-party average × (1 − 18% fee). No Steam markup in the math (§1). |
| Flip comparison | Per recipe | Flipping inputs on the same venue loses the fee (about −18%), so a +EV trade-up here is a real transformation gain, not arbitrage. |

---

## 6. Validation so far

- **Independent rediscovery**: without being told, the sweep found the anchor collections of
  the video's #1 (Ascent) and #5 (Radiant) contracts, then improved both
  (splits 6/4 and 7/3, better fillers, tighter caps).
- **Listings check**: the user checked live listings for several recipes, and
  input prices lined up with the model, including the low-float inputs, which
  were the least trusted part.
- **Not yet verified**: realized *sale* prices (listed vs actually sold, and
  whether you have to undercut), listing depth, and trade-hold effects on the
  capital cycle. Recipe D below exists mainly to measure the sale discount.

### Recipes at the 2026-09-28 snapshot (third-party, 18% fee)

| | Contract | Cost | EV | RTP | P(profit) | Source |
|---|---|---|---|---|---|---|
| A | 7× P250 Red Tide FT 0.150–0.173 [Radiant] + 3× MAG-7 Resupply MW 0.070–0.086 [Fever] | $1.55 | $2.63 | 170% | 70% | Video #5, tuned |
| B | 2× PP-Bizon Traitor FN 0.000–0.037 [Arabesque] + 8× MP7 Base-2 MW 0.070–0.078 [Spy Tech] | $1.69 | $2.72 | 161% | 75% | Ours |
| C | 6× FAMAS Yeti Camo FT 0.150–0.174 [Ascent] + 4× P2000 Sure Grip MW 0.070–0.087 [Fever] | $1.80 | $2.85 | 158% | 60% | Video #1, tuned |
| D | 9× Sawed-Off Lunar Wyrm BS 0.450–0.505 [Arabesque] + 1× Galil AR Metallic Squeezer WW 0.380–0.449 [Overpass 2024] | $1.10 | $1.54 | 140% | 100% | Ours, calibration |

Recipes with outside corroboration (A, C) deserve more trust than ones found
from our data alone (B, D).

---

## 7. Next: three or more collections

The two-collection search generalizes cleanly, because at a fixed T both EV
and cost are **separable per collection**:

```
maximize   Σ_i  k_i · ( avg_i(T) / N  −  c_i(n_i) )
subject to Σ_i k_i = N
           Σ_i k_i · n_i ≤ N · T
```

This is a knapsack with two constraints (slots, float budget). Solve it with
dynamic programming over collections, with state (slots used, float budget
used), float discretized on the existing grid. Each collection contributes
`k_i` slots at its cost-curve frontier points.

Shapes this opens up:
- **One anchor + two fillers**: a second filler that is a better float anchor
  per dollar at a different float, or one whose outcomes aren't junk.
- **Two anchors + one filler**: two strong value collections sharing one float
  budget.
- **Mixed skins within one collection**: e.g. 4 cheap high-float + 3 expensive
  low-float inputs to hit the same average for less. The same DP handles this
  if skins, not collections, are the items.

Watch for:
- **Search size**: the number of collection combinations grows fast. Prune to
  collections that appear in top two-collection results, or that have a
  strong anchor profile (few outcomes, all above cost), before running the DP.
- **Consistent objective**: the pair search currently keeps each pair's best
  version by profit (delta) but sorts the final list by RTP. Pick one objective
  (or a bankroll-aware one) before scaling.
- **Selection bias grows with the search space**: more combinations means more
  chances for a pricing error to rank first. The §5 guards matter more, not less.

---

## 8. Toward a rolling pipeline

The combinatorics alone are not a moat: they are 15 s of compute that anyone can
reproduce. The durable advantages are data quality (float-level listing prices
to replace the `floatSkew` model; corroboration guards), speed (sync → sweep →
alert before a recipe goes public), and execution.

Planned stages: price sync (exists; move from weekly to more frequent) →
sweep emits machine-readable **buy specs** with *contract-level* max prices →
listing sniper via official marketplace APIs → assembly via the engine's
inventory mode (recombines leftover inputs from half-bought contracts) → manual
in-game execution → sell and reprice → **ledger** of actual vs model, feeding
sale discount, fee and float premium back into the quote.

Keep Steam/CS2-side actions manual: automating them risks the account that
holds the inventory.

---

## Commands

```bash
npm run igl9000-mix -- --max-cost 20                 # best by RTP
npm run igl9000-mix -- --max-cost 20 --sort pwin     # most reliable
npm run igl9000-mix -- --tier "Mil-Spec Grade" --top 40
# knobs: --min-cost --max-spread 2 --min-depth 0.1 --float-skew 0.2
```
