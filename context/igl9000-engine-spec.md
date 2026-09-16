# IGL-9000 — Engine Spec

> The route model behind the Venture surface. This spec defines **one engine**:
> a single deterministic function that turns your inventory + the catalog + a
> price feed into a `Route`. Live market data is the *only* real-time input, and
> it enters through one injected seam (`quote`). Everything else is pure.
>
> Companion docs: `context/modeltechnicalbreakdown.md` (the original
> pseudocode), `context/modelUIdesignlanguage.md` (naming + IGL-9000's voice +
> the Venture UI). Current code: `lib/igl9000.ts` (types + voice + a preview
> `demoRoute()`), `lib/tradeup.ts` (the single-contract math this builds on).

---

## 0. The one-engine framing

There is not a "real-time component" and a "static component." There is one
engine and one live input:

```
route = IGL9000(inventory, catalog, cash, quote, seed)
                                        └─ quote is the only real-time input
```

`quote` is a function, not a component. The engine never knows or cares whether
`quote` reads a fixed test fixture, the mock `PriceTable`, or a live venue
average — swap the feed and the engine is byte-for-byte unchanged. This is why
the engine is buildable and fully testable **now**, against a price fixture,
before any live pricing or float-sync work exists.

The engine's output is the existing `Route` model (`lib/igl9000.ts`), so wiring
it in is a one-line swap: replace `demoRoute()` with `IGL9000(...)`. Every
consumer (VenturePanel, the voice layer) keeps working untouched.

---

## 1. The seam: `Quote` and `PriceProvider`

The single boundary between the engine and live data.

```ts
interface Quote {
  ask: number;      // avg of asks across venues, liquidity-filtered — the BUY side
  bid_net: number;  // avg of (bid − venue seller fee) across venues — the SELL side
  listings?: { venue: string; price: number; float: number; url: string }[];
}

// The injected feed. Pure from the engine's perspective: same args → same Quote
// within a single engine run (the engine snapshots prices once per run so a
// route is internally consistent).
type PriceProvider = (skinId: string, wear: Wear, stattrak: boolean) => Quote | null;
```

Rules the engine relies on (carried from `modeltechnicalbreakdown.md §1–2`):

- **`ask` feeds BUY costs (completions); `bid_net` feeds SELL baselines. Never
  blend the two into one number.**
- A `null` quote means "no liquid market" — the engine treats that outcome/slot
  as unpriced and flags the route (it never invents a price).
- The engine calls `quote` only in the valuation step (§4). Enumeration, odds,
  and floats (§2–3) never touch it.

Today `quote` is backed by the mock `PriceTable` (`lib/data.ts:loadPrices`,
keyed `${skinId}|${wear}|${st|norm}`), adapted to the `ask`/`bid_net` shape.
The mock has a single `median` per key, so the adapter sets `ask = bid_net =
median` until real venue spreads land. Nothing else changes when they do.

---

## 2. Inputs and output

```ts
interface IGL9000Args {
  holdings: Holding[];        // your inventory, normalized (see §3.1)
  skinById: Map<string, Skin>; // the catalog (lib/data.ts:loadSkinById) — STATIC
  cash: number;                // budget available for completion buys
  quote: PriceProvider;        // the only real-time input
  horizon?: number;            // max hops to plan (default 4)
  trials?: number;             // Monte-Carlo trials for the spread (default 2000)
  seed?: number;               // RNG seed — makes the whole run reproducible
}

function IGL9000(args: IGL9000Args): Route;   // Route is lib/igl9000.ts
```

`Route` (already defined) = `{ label, stash, hops[], destination, stats }`. The
engine fills it; the UI renders it. `IS_PREVIEW_ROUTE` flips to `false` once the
engine, not `demoRoute()`, produces it.

---

## 3. Pipeline

Five stages. Stages 3.1–3.3 are **pure and static** (no `quote`); 3.4–3.5 price
and rank (the only `quote` callers).

### 3.1 Normalize holdings  *(static)*

Map raw inventory items to a uniform `Holding`:

```ts
interface Holding {
  skinId: string;   // resolved against the catalog by id or normalized name
  float: number;    // real per-item float when known; else wear-bracket median (flagged approximate)
  stattrak: boolean;
  unlockAt: number; // epoch ms; 0 = tradeable now (see §6 trade locks)
}
```

Eligibility gates (mirror `lib/tradeup.ts` and the main-branch eligibility
CONTEXT pile): drop non-weapons, souvenirs, and the top two rarity tiers
(`nextRarity` returns null → Covert/Contraband can't be inputs), and exclude the
`Limited Edition Item` pseudo-collection (`EXCLUDED_COLLECTIONS`,
`lib/tradeup.ts:49`).

### 3.2 Enumerate candidate contracts  *(static)*

Over each rarity tier present in holdings, walk the **count-vector space** —
`{collection_c: n_c}` with `Σ n_c = contractSize` (10, or 5 when a Covert leads
the knife contract). This space is small because the catalog fixes the
collections. For each count-vector:

- `owned_c = min(n_c, owned_count(c, tier))`, `bought_c = n_c − owned_c`
- assign specific skins/floats to slots (owned first, chosen to **steer output
  float** toward the best wear bracket of the highest-value outcomes)

Yields a set of `CandidateContract`s — a *structural* object: which slots are
owned vs. must-buy, and the resulting outcome set with odds + output floats.
**No prices yet.**

### 3.3 Odds and output floats  *(static — already built)*

Reuse `computeTradeup` (`lib/tradeup.ts:51`) for each candidate. It already:

- computes per-outcome probability with the Valve formula
  (`p(s) = n_c / (N · k_c)`, weight split across overlapping collections),
- computes output float per outcome (per-input normalization → target range),
  and maps float → wear (`floatToWear`),
- rejects a contract whose collection has no next-tier output and names the
  offenders (`lib/tradeup.ts:82`).

`computeTradeup` takes `prices` as an argument — so it *can* run price-free for
the structural half; the engine passes prices only when it wants the valued
result (next stage). This injected-price signature is the seam, already present.

### 3.4 Value a contract → signed delta  *(uses `quote`)*

```
cost(slot)  = owned  ? quote(skin,wear,st).bid_net   // opportunity cost of consuming it
              bought ? quote(skin,wear,st).ask        // completion buy
ev          = Σ over outcomes: p(s) · quote(s, wear(f_out(s)), st).bid_net
delta       = ev − Σ cost(slot)                       // signed; the whole ranking key
```

A `null` quote in a slot or outcome → that term is a lower bound; the route
carries the corresponding warning (`hop.approx`). `ask`/`bid_net` stay separate
throughout.

### 3.5 Plan the chain — `best_move` + rollout

**Planner policy (`best_move`)** — greedy, the JourneyPlanner half:

```
best_move(holdings, cash):
  C = enumerate(holdings) for each tier present        // 3.2
  C = C priced+odds'd via 3.3–3.4, filter delta > 0, affordable (Σ bought·ask ≤ cash)
  return argmax(delta) or NONE
```

**Chain rollout (`simulate`)** — the JourneySim half, Monte-Carlo, seeded:

```
simulate(holdings, cash, horizon, trials, seed):
  for t in trials (RNG seeded by seed+t):
    inv, money, clock, log = copy(holdings), cash, now, []
    loop:
      m = best_move(inv, money) respecting unlock times
      break if m == NONE or clock > horizon
      pay completions from money; set unlockAt on buys; clock = max(clock, latest unlock)
      s = sample one outcome ~ p(·)                    // pure RNG over static odds
      inv = inv − m.inputs + Holding(s, f_out)
      log.append(waypoint(m, s))
    terminal[t] = Σ bid_net(inv) + money
    routes[t]   = log
  return percentiles(terminal) → {p10,p50,p90}, and a representative route → hops[]
```

The representative route's hops become `Route.hops`; its final skin becomes
`Route.destination`; `terminal` percentiles become `destination.spread` and
`stats.likelyEndValue`. `stats.netVsSelling = p50 − (Σ bid_net(holdings) + cash)`
(the do-nothing baseline).

---

## 4. Determinism & purity contract

- **Pure**: no I/O, no clock reads except a single `now` captured once and passed
  down, no global state. All randomness flows from `seed`.
- **Reproducible**: same `(holdings, catalog, cash, seed)` + a `quote` that
  returns the same values → identical `Route`, bit for bit. This is what makes
  fixture-based unit tests meaningful.
- **Price snapshot**: the engine reads each needed `quote` at most once per run
  and memoizes, so a route can't be internally inconsistent even if the live
  feed moves mid-computation.

---

## 5. Honesty invariants (non-negotiable, from the design docs)

1. No Steam wallet prices anywhere — 3rd-party cash venues only.
2. `ask` and `bid_net` are never blended into one number.
3. **Every displayed route delta reconciles to the per-hop deltas** —
   `Route.stats.netVsSelling` equals the sum of hop deltas against the baseline.
   Narrative may be a facade; numbers never are.
4. Locked hops still show their signed delta (`Hop.delta` is always populated).
5. Destination shows p10 alongside p50; the odds line is always present.
6. Bought-skin float is a real listing float when available, else the wear
   bracket median, flagged approximate.
7. Replan after every executed contract with the actual outcome float — no
   precomputed multi-hop plan survives a random draw (chains are emergent).

---

## 6. Trade locks

Bought skins carry `unlockAt = now + venue lock duration`. A contract requires
all slots unlocked at execution. The planner may still surface a locked-input
contract as a **future** move → a `needs-buy` hop with `unlockDays`, exactly the
state the UI already renders. `simulate` advances `clock` to the latest unlock
before sampling that hop's outcome.

---

## 7. What's static vs. injected (the whole seam, in one table)

| Concern | Source | Real-time? |
|---|---|---|
| Catalog: skins, collections, rarities, float ranges | `lib/data.ts:loadSkins` (static JSON) | No |
| Which contracts are possible (enumeration) | derived from catalog + holdings | No |
| Outcome probabilities, output floats, wear | `computeTradeup` (`lib/tradeup.ts`) | No |
| Outcome sampling in the rollout | seeded RNG | No |
| Trade-lock structure (which hops can chain) | holdings' `unlockAt` | No |
| `ask` / `bid_net` per skin@wear | **`quote` (PriceProvider)** | **Yes** |
| EV, input cost, hop delta, terminal value | derived from `quote` | **Yes** |

One row is real-time. Everything else is a pure function of static data.

---

## 8. Build phasing & tests

1. **`Quote` + `PriceProvider` seam** + a mock-backed adapter over `loadPrices`,
   and a fixed **price fixture** for tests.
2. **`enumerate` + `valueContract`** (3.2 + 3.4) on top of the existing
   `computeTradeup`. Unit-test deltas against the fixture — deterministic.
3. **`best_move`** (3.5 planner). Test: hand-built holdings + fixture →
   asserted best contract.
4. **`simulate`** (3.5 rollout), seeded. Test: fixed seed → asserted
   p10/p50/p90 and a stable representative route.
5. **`IGL9000` wrapper** assembling the `Route`. Swap `demoRoute()` →
   `IGL9000(...)`, flip `IS_PREVIEW_ROUTE = false`.

Steps 1–5 need **no** live prices and **no** float-sync — only the fixture. Live
data arrives later purely as a new `PriceProvider` implementation; real floats
arrive as better `Holding.float` values from the force-sync work. Neither
touches engine code.

---

## 9. Open decisions

- **Float source for real per-item floats** — force-sync (CSFloat vs. self-hosted
  inspect bot), speced in the main-branch `CONTEXT-force-sync…` pile. Until then
  `Holding.float` falls back to wear-bracket medians (flagged approximate); the
  engine runs fine, just coarser.
- **Venue set + liquidity filter** for the real `PriceProvider` (`MIN_LISTINGS`,
  fee schedule per venue).
- **`horizon` / `trials` defaults** — tune against runtime once real catalog
  sizes are in play (enumeration is the cost driver; the count-vector space is
  small but per-run `quote` calls dominate).
