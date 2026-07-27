# CS2 Journeyman · Trade-Up Console

Next.js (App Router) + TypeScript. A two-column console:

- **Left — trade-up visualizer.** Stage same-rarity inputs, set per-slot floats,
  execute, and read outcome probabilities, output floats, EV, and per-outcome
  P/L. Supports both the standard **×10** contract and the special Covert→knife
  **×5** contract (the grid auto-resizes when a Covert leads).
- **Right — Steam inventory loader.** Paste a profile URL/vanity/steamid64, sync
  the CS2 (730/2) inventory, and drag real items — with their real floats and
  market prices — straight into the contract. Backed by an on-disk SQLite
  snapshot cache with a 60s anti-rate-limit floor.

## Run

```bash
npm install
npm run dev          # http://localhost:3000
npm run fetch-data   # optional: pull the full ByMykel catalog over the seed
npm run build        # production build (Turbopack)
npm run start        # serve the production build
npm run typecheck    # tsc --noEmit
npm run migrate-db   # one-shot copy loader.db -> Postgres (see Persistent storage)
npm run admin        # standalone localhost-only admin scaffold (see below)
```

Boots on seed data immediately. `fetch-data` overwrites
`public/data/{skins,prices}.json` with the full ByMykel set + deterministic mock
prices. All data reads happen server-side from `public/data/`.

### Environment variables

See `.env.example` for a copyable list.

| Var             | Used by                    | Effect                                                             |
| --------------- | -------------------------- | ------------------------------------------------------------------ |
| `STEAM_API_KEY` | `resolveSteamId`           | Enables vanity-URL lookup. Without it, use a steamid64 / profile URL. |
| `DATABASE_URL`  | `lib/store-postgres.ts`    | Set -> Postgres/Supabase cache backend; unset -> on-disk SQLite.   |
| `DB_SCHEMA`     | `lib/store-postgres.ts`    | Postgres schema for this app's tables (default `public`).           |
| `DATABASE_SSL`  | `lib/store-postgres.ts`    | `disable` for a local plaintext Postgres (Supabase needs TLS).     |
| `PGPOOL_MAX`    | `lib/store-postgres.ts`    | Max Postgres pool connections (default 3).                          |
| `ADMIN_TOKEN`   | `scripts/admin-server.ts`  | Pins the admin token (else an ephemeral one is printed at boot).   |
| `ADMIN_BASE`    | `scripts/admin-server.ts`  | Admin base path (default `/_ctl`).                                  |
| `ADMIN_PORT`    | `scripts/admin-server.ts`  | Admin port (default `4100`, localhost only).                       |

## Pages & API

```
app/page.tsx                     Console shell: trade-up visualizer + inventory (client islands).
app/cache/page.tsx               /cache — read-only integrity report over loader.db.

app/api/skins/route.ts           GET  ?q=&rarity=&limit=  — search/filter, feeds the picker.
app/api/tradeup/route.ts         POST {inputs[10|5], isStatTrak} -> TradeupResult.
app/api/sync/[steamid]/route.ts  POST ?force=1 — fetch + snapshot a Steam inventory.
app/api/inventory/[steamid]/...  GET  — the cached snapshot, each item priced.
app/api/resolve/route.ts         POST {input} -> {steamid} (vanity/url/id -> steamid64).
app/api/avatar/[steamid]/route.ts GET — profile avatar via the keyless ?xml=1 endpoint.
app/api/cache/route.ts           GET report / DELETE (?steamid= clears one, else wipes all).
```

## Architecture

```
types/cs2.ts             Shared types (skin, rarity, wear, tradeup result, price table).
lib/tradeup.ts           Pure trade-up math. computeTradeup() is the entry point.
lib/data.ts              Server-side JSON loader (skins/prices) + name/price resolution.
lib/steam.ts             Steam inventory loader: fetch, decode floats, sync guards.
lib/store.ts             Snapshot-store interface + backend selection (SQLite | Postgres).
lib/store-sqlite.ts      SQLite backend (better-sqlite3, loader.db) — the default.
lib/store-postgres.ts    Postgres/Supabase backend — used when DATABASE_URL is set.
lib/display.ts           Client formatting (odds, currency, rarity colors).
lib/util.ts              Shared pure helpers (lerp, null-sinking numeric compare).
lib/tradeup-context.tsx  Client state: the contract grid, inventory→slot staging, eligibility.
components/TradeUpConsole.tsx  The contract grid + execute + outcomes table.
components/InventoryPanel.tsx  The right-side synced inventory grid.
components/SkinPicker.tsx      Modal, rarity-locked catalog search.
components/PriceModal.tsx      Per-marketplace price breakdown + listing links.
components/CacheInspector.tsx  The /cache dashboard UI.
components/CircuitBoard.tsx    Animated PCB backdrop (canvas).
scripts/fetch-data.ts    Pulls ByMykel skins.json, slims it, seeds mock prices.
scripts/migrate-sqlite-to-pg.ts  One-shot loader.db -> Postgres copy.
scripts/admin-server.ts  Standalone admin control scaffold (see below).
db/schema.sql            Postgres schema (single source of truth for both backends).
public/data/             skins.json + prices.json (+ prices.meta.json).
```

`better-sqlite3` is marked as a `serverExternalPackages` entry in
`next.config.mjs` — it's a native addon and must not be bundled.

## Trade-up math (Valve spec)

10 inputs (or 5 for the knife contract), all same rarity; output rarity = next
tier up.

For each collection C present in inputs:
- `n_C` = inputs from C (a skin in multiple collections splits its weight evenly)
- `k_C` = distinct skins in C at the output rarity
- each output skin in C gets probability `n_C / (N * k_C)` where `N` is the input count

Output float per outcome:
- `f_norm = mean over inputs of (input_float - min) / (max - min)` (each normalized to its own skin range)
- `output_float = output.min_float + f_norm * (output.max_float - output.min_float)`

Inputs whose collection has no next-tier output are **rejected** (they can't be
traded up at all), and the `Limited Edition Item` pseudo-collection is excluded.
Probabilities sum to 1 for both single- and mixed-collection inputs.

## Steam inventory sync

`lib/steam.ts` fetches `steamcommunity.com/inventory/<id>/730/2` with
`raw_asset_properties=1`, so per-item floats/seeds come straight from Steam (no
inspect bot, no auth). Snapshots are written through to the snapshot store (see
below) keyed by steamid; a 60s floor + inflight guard keep syncs off Steam's 429
path (`?force=1` skips only the floor). Prices are attached at read time from the
price table by market name + wear.

## Persistent storage (Supabase Postgres)

The inventory cache (`snapshots` + `item_meta`) sits behind one async interface,
`SnapshotStore` (`lib/store.ts`), with two interchangeable backends selected by
env at first use:

- **SQLite** (`lib/store-sqlite.ts`, on-disk `loader.db`) — the zero-config
  default. Resets on hosts with an ephemeral filesystem (e.g. Render's free tier).
- **Postgres** (`lib/store-postgres.ts`) — used when `DATABASE_URL` is set, so
  the cache survives restarts/deploys. This is a **direct Postgres connection**
  (via `pg`), not the Supabase SDK — there is no `SUPABASE_URL` / anon key, just
  the connection string. Point `DATABASE_URL` at a Supabase **Session pooler**
  URI (port 5432 on `*.pooler.supabase.com`, the IPv4 host).

The schema lives in `db/schema.sql` (single source of truth, mirrors the SQLite
tables). The Postgres backend applies it idempotently on first use, so no manual
step is required — but you can also paste it into the Supabase SQL editor. The
cache inspector at `/cache` shows which backend is live (`sqlite (ephemeral)` vs
`postgres (persistent)`) and, on Postgres, which schema.

### Sharing one Supabase project (DB_SCHEMA)

To reuse an existing Supabase project instead of creating a new one, set
`DB_SCHEMA` (e.g. `cs2`). cs2-tradeup then creates and uses `snapshots` /
`item_meta` inside that schema, isolated from anything else in the database — it
never reads, writes, drops, or truncates tables outside its schema. The backend
pins `search_path` on every pooled connection (via the libpq startup `options`),
so it needs a session-mode connection — the Supabase **Session pooler** (:5432),
which is what we require anyway. `DB_SCHEMA` unset -> `public` (unchanged).

Migrate an existing `loader.db` into Postgres once:

```bash
DATABASE_URL='postgresql://...pooler.supabase.com:5432/postgres' \
  npm run migrate-db -- [path/to/loader.db]
```

It applies the schema, refuses to run if the target tables already hold rows,
then copies `snapshots` + `item_meta` verbatim.

## Swapping in real Steam prices (STEAMPROXY)

`prices.json` key format: `${skinId}|${wear}|${"st"|"norm"}`, value
`{median, lowest, volume, sources?}`. Point your STEAMPROXY pipeline at that
file, or replace `loadPrices()` in `lib/data.ts` with a DB/Redis fetch. No other
code changes needed.

## Admin scaffold

`npm run admin` starts a standalone control server (**not** part of the Next.js
app): bound to `127.0.0.1` only, token-gated (wrong/absent token → 404), and
mounted under an obscure base path. The route handlers in `scripts/admin/` are
stubs — the server (auth, routing, JSON envelope) is real so wiring a control
later is a single-function change.

## Known gaps / next adds

- Auto-pick-cheapest-floats helper (next obvious add; not built).
- Souvenir skins filtered at fetch level (no trade-up support).
- StatTrak: assumed available unless `stattrak: false`; ByMykel sometimes omits — treated as available.
- No collection dropdown in picker yet (search-by-name only).
- No slot persistence; refresh clears the grid (synced inventory is cached in the snapshot store).
- Admin control handlers are scaffolding stubs.

## Deploy (Render + Supabase)

`render.yaml` defines a free Node web service. One-time setup: create a Supabase
project, grab its Session-pooler URI, and in Render do **New → Blueprint** on this
repo, then set `DATABASE_URL` (and optionally `STEAM_API_KEY`) in the dashboard
(`sync:false` keeps them out of git). Pushes then auto-deploy; the cache persists
in Supabase across deploys. Without `DATABASE_URL` the service still runs on
ephemeral SQLite.
