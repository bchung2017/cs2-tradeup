# CS2 Journeyman · Single Trade-Up Console

Next.js (App Router) + TypeScript. Single-page console: pick 10 same-rarity inputs, set per-slot floats, execute, see outcome probabilities, output floats, EV, and per-outcome P/L.

## Run

```bash
npm install
npm run dev          # http://localhost:3000
npm run fetch-data   # optional: pull real ByMykel data over the seed
npm run build        # production
```

Boots on seed data immediately. `fetch-data` overwrites `public/data/{skins,prices}.json` with the full ByMykel set + deterministic mock prices.

## Architecture

```
types/cs2.ts            Shared types (skin, rarity, wear, tradeup result, price table)
lib/tradeup.ts          Pure math. computeTradeup() is the only fn callers need.
lib/data.ts             Server-side JSON loader, module-scoped cache.
lib/display.ts          Client formatting (odds, currency, rarity colors).
app/api/skins/route.ts  GET search/filter (q, rarity, limit) — feeds the picker.
app/api/tradeup/route.ts POST {inputs[10], isStatTrak} -> full TradeupResult.
app/page.tsx            The console: 10-slot grid + execute + outcomes table.
components/SkinPicker.tsx Modal, rarity-locked search.
scripts/fetch-data.ts   Pulls ByMykel skins.json, slims it, seeds mock prices.
public/data/            skins.json + prices.json.
```

## Trade-up math (Valve spec)

10 inputs, all same rarity, output rarity = next tier up.

For each collection C present in inputs:
- `n_C` = inputs from C (a skin in multiple collections splits its weight evenly)
- `k_C` = distinct skins in C at the output rarity
- each output skin in C gets probability `n_C / (10 * k_C)`

Output float per outcome:
- `f_norm = mean over inputs of (input_float - min) / (max - min)` (each normalized to its own skin range)
- `output_float = output.min_float + f_norm * (output.max_float - output.min_float)`

Verified: probabilities sum to 1 for both single- and mixed-collection inputs.

## Swapping in real Steam prices (STEAMPROXY)

`prices.json` key format: `${skinId}|${wear}|${"st"|"norm"}`, value `{median, lowest, volume}`.
Point your STEAMPROXY pipeline at that file, or replace `loadPrices()` in `lib/data.ts`
with a DB/Redis fetch. No other code changes needed.

## Known gaps / next adds

- Auto-pick-cheapest-floats helper (README'd as next obvious add; not built).
- Souvenir skins filtered at fetch level (no trade-up support).
- StatTrak: assumed available unless `stattrak: false`; ByMykel sometimes omits — treated as available.
- No collection dropdown in picker yet (search-by-name only).
- No persistence; refresh clears slots. localStorage is a ~5-line add.
- `FILL ×10 FROM SLOT 01` button is a dev convenience for fast testing — drop it for prod.
```
