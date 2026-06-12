# Context Pile — Force Sync + Cache Inspector

> Reference dump for implementing two upcoming changes against the cs2-tradeup app.
> Everything below is current as of this writing. Line numbers are real; verify before editing
> since files shift. **No feature code for these two changes exists yet** — this is groundwork context.

---

## 0. Terminology note (resolve before coding)

"Force sync" is overloaded in this repo. Two distinct things:

1. **Existing FORCE/`force=1` refresh** — already implemented. Bypasses the 60s anti-429 floor and
   re-pulls the *community inventory* (names/icons/rarity). No per-item work.
2. **Per-item metadata sync** (previously called "deep sync" in design discussion) — NOT implemented.
   Queries each item's inspect link individually to get **float / paint seed / pattern**, which the
   community endpoint does not return. This is the heavy, long-running, rate-limited one that needs a
   warning toast + persistent resume/pause/stop.

This doc covers **both**, since "force sync" most likely refers to feature #2 (the substantive new work)
built on the foundation of #1. Confirm which scope is intended before implementing.

---

## 1. Repo facts

- **Framework:** Next.js `^16.2.6` (App Router), React, TypeScript. Node runtime routes (never Edge).
- **DB:** SQLite via `better-sqlite3` `^12.10.0` (synchronous `.exec/.prepare/.run/.get/.all`).
  File: `loader.db` in `process.cwd()`, **WAL mode** (`loader.db`, `-wal`, `-shm` on disk).
- **Scripts:** `dev`, `build`, `start`, `fetch-data` (`tsx scripts/fetch-data.ts`), `typecheck` (`tsc --noEmit`).
- **Path alias:** `@/` → repo root (e.g. `@/lib/steam`).
- Always run `npm run typecheck` after edits.

---

## 2. Current architecture (file:line)

### `lib/steam.ts` — the entire Steam/SQLite backend
- `InventoryItem` interface — **`:17-23`**. Fields today: `assetid, classid, name, icon_url, rarity`.
  **No float/inspect fields yet.**
- `SnapshotPayload` `{items, count}` — `:25-28`. Stored as JSON text in the `snapshots.payload` column.
- `Snapshot` `{fetchedAt, items, count}` — `:30-34`. Read-model returned by `getSnapshot`.
- `FLOOR_MS = 60_000` — `:36`. The 60s anti-429 floor.
- `SteamStore` interface — `:38-44`: `{ db, upsertSnap, getSnap, lastSync:Map, inflight:Set }`.
- `initStore()` — `:51-68`. Opens DB, sets `PRAGMA journal_mode=WAL`, creates `snapshots` table
  (`steamid PK, fetched_at INTEGER, payload TEXT`), prepares `upsertSnap` / `getSnap`.
- `getStore()` — `:73-75`. **Lazy singleton pinned on `globalThis.__steamStore`** so dev HMR + parallel
  `next build` workers don't open the DB twice. **All new tables/statements go in `initStore`; all new
  guard state (Sets/Maps) goes on the `SteamStore` struct so it shares the singleton.**
- `SteamError extends Error` — `:79-87`. Carries `code` + optional `retryMs`. Route handlers map `code`→HTTP.
- `resolveSteamId(raw)` — `:90-108`. steamid64 / vanity / profile URL → steamid64. Needs `STEAM_API_KEY` for vanity.
- `fetchInventory(steamid)` — `:110-139`. Hits `https://steamcommunity.com/inventory/{id}/730/2?l=english&count=2000`.
  Maps assets+descriptions. **Throws `RATELIMIT`(429)/`PRIVATE`(403)/`UPSTREAM`.** `descByKey` keyed by `classid_instanceid`.
  **This is where the inspect link should be captured for free** (see §4.2) — `d.actions[]` is available here but currently ignored.
- `syncInventory(steamid, {force})` — `:145-174`. Enforces 60s floor (unless `force`) + `inflight` guard,
  fetches, computes `changed` by comparing sorted assetid lists vs previous payload, **write-through** `upsertSnap`.
- `getSnapshot(steamid)` — `:176-181`. Reads row, `JSON.parse(payload)`, returns `Snapshot`.
  **This is the merge point for per-item metadata (see §4.3).**

### API routes
- `app/api/sync/[steamid]/route.ts` — `POST`. Validates `/^\d{17}$/`. Reads `?force=1` (**`:20`**).
  `CODE_STATUS` map (`:7-13`): FLOOR/RATELIMIT→429, INFLIGHT→409, PRIVATE→403, UPSTREAM→502. Returns `{count, changed}`.
- `app/api/inventory/[steamid]/route.ts` — `GET`. `getSnapshot` → `{steamid, count, items, age_ms}` or 404 `{error:"no snapshot"}`.
- `app/api/resolve/route.ts` — `POST {input}` → `{steamid}` (or `{code:"RESOLVE", error}`).
- `app/api/skins/route.ts`, `app/api/tradeup/route.ts` — trade-up calc; not relevant here.

### `components/InventoryPanel.tsx` — the loader UI (client component)
- Default input is a hardcoded profile URL — `:73` (`https://steamcommunity.com/profiles/76561198059693930`).
- State: `input, steamid, status, meta, items, loading, syncing, loadedInput, rarityFilter`.
  `steamidRef` mirrors `steamid` for use in callbacks.
- `loadAndRender()` — `:101-113`. GETs `/api/inventory/{id}`, sets `meta` + `items`. **The instant-load path.**
- **Mount `useEffect`** — `:117-138`. Resolves the default profile → steamid, then `loadAndRender()` (no Steam sync).
  Shows the last persisted snapshot immediately. **Good place to also rehydrate a persisted force-sync job (see §4.4).**
- `doSync()` — `:143-160`. POSTs `/api/sync/{id}?force=1` (always force from UI), maps error codes to `status` msgs,
  then `loadAndRender()`.
- `doResolveAndSync()` — `:162-187`. Resolve → set steamid + `loadedInput` → `doSync()`.
- Single dynamic action button (recently consolidated from LOAD+FORCE):
  - `trimmedInput`, `syncMode = !!steamid && trimmedInput!=="" && trimmedInput===loadedInput`, `actionDisabled = syncing||loading` — around `:191-200`.
  - `actionLabel`: syncMode ? (syncing?"SYNCING…":"SYNC") : (loading?"LOADING…":"LOAD").
  - Button JSX `:289-304`: `onClick={() => syncMode ? doSync() : doResolveAndSync()}`.
- `busy = loading || syncing` — `:208`. Grid hidden while busy; `<InventoryLoader/>` shown.
- Status line uses `STATUS_COLOR` (ok/warn/err/dim → CSS vars). **There is no toast layer today** — only this inline status line.
- Helpers at bottom: `SyncFill` (rAF progress bar, `:409+`), `InventoryLoader` (`:595+`).
- **Palette / styling conventions:** CSS vars `--surface, --surface-line, --void, --ember, --amber, --green,
  --green-dim, --green-faint, --cream-dim, --profit, --loss, --mono`. HUD classes: `hud`, `hud-ember`, `hud-amber`. Match these.

### `lib/tradeup-context.tsx` — trade-up slot state (where float actually matters)
- `Slot {skin, float}` — `:7-10`. `EMPTY_SLOTS` = 10 empty.
- `skinFromInventory(item)` — `:33-53`. Parses "Weapon | Paint (Wear)". **Float is synthetic: `min_float:0, max_float:1`**
  with a comment (`:30-32`) noting the basic endpoint carries no float. **This is the consumer that should use real
  float once force sync populates it** — change `next[idx] = { skin, float: skin.min_float }` (`:70`) to use `item.float`.
- `addFromInventory(item)` — `:60-73`. Rarity-locks the contract to the first added item's rarity.

### `types/cs2.ts`
- `Skin {min_float, max_float, ...}` — `:36-48`. `WEAR_RANGES` (Valve float→wear constants) — `:58-64`.
  Float→wear mapping needed if UI shows wear from real float.

### `lib/data.ts`
- Static skin/price catalog loaders (`loadSkins`, `loadSkinById`, `loadPrices`) reading `public/data/*.json`. Cached in-module. Not DB-backed. Unrelated to loader.db.

---

## 3. The hard external dependency (force sync only)

Steam's community inventory endpoint returns **no float**. Real per-item metadata comes from the **inspect link**
(`d.actions[]`, the "Inspect in Game" entry: `steam://rungame/730/.../+csgo_econ_action_preview ...S<steamid>A<assetid>D<d>`).
Resolving it requires one of:

| Option | Mechanism | Trade-off |
|---|---|---|
| **CSFloat API** (simplest) | `GET https://api.csfloat.com/?url=<inspect link>` → `{iteminfo:{floatvalue, paintseed, paintindex}}` | Zero infra; third-party rate limit; needs `CSFLOAT_API_KEY` env |
| **Self-hosted inspect bot** | `node-globaloffensive` + throwaway Steam account speaks CS2 GC | No third-party limit; you run/maintain a bot process + GC backpressure |

`resolveFloat(inspectUrl)` is the single abstraction to write. **This choice is the main open decision** and is the
*only* thing blocking the force-sync engine. The schema, persistence, and cache inspector do NOT depend on it.

---

## 4. Force Sync — design

### 4.1 Extend `InventoryItem` (`lib/steam.ts:17`)
Add optional, backward-compatible fields:
```ts
inspect_url?: string | null;   // captured for free during fetchInventory
float?: number | null;         // filled by force sync
paint_seed?: number | null;
paint_index?: number | null;
meta_fetched_at?: number | null;
```

### 4.2 Capture inspect link for free (`fetchInventory`, `:125` map body)
```ts
const action = (d.actions || []).find((x: any) => /Inspect/i.test(x.name));
const inspect_url = action?.link?.replace("%owner_steamid%", steamid).replace("%assetid%", a.assetid) ?? null;
// add inspect_url to the returned object
```

### 4.3 Two-layer storage — float lives OUTSIDE the snapshot blob
**Why:** float never changes for a given `assetid`, but a normal SYNC rewrites the whole `snapshots.payload`.
Keeping float in a separate `item_meta` table keyed by `assetid` means: (a) SYNC never clobbers floats,
(b) it's cached forever, (c) instant-load shows floats with zero route/client change, (d) partial progress survives.

New table (in `initStore`):
```sql
CREATE TABLE IF NOT EXISTS item_meta (
  assetid TEXT PRIMARY KEY, float REAL, paint_seed INTEGER, paint_index INTEGER, fetched_at INTEGER NOT NULL
);
```
New statements on `SteamStore`: `upsertMeta`, `getMetaMany` (`... WHERE assetid IN (?,?,...)`).

**Merge at read time in `getSnapshot` (`:176`):** after parsing payload, fetch meta rows for all assetids,
build `Map<assetid, meta>`, return `items.map(i => ({...i, ...(byId.get(i.assetid) ?? {})}))`.
Empty meta → behaves exactly like today (graceful degrade). Floats only appear AFTER a force sync; coverage is incremental.

### 4.4 Persistent job (resume / pause / stop / start across sessions)
**Progress is already durable** — `item_meta` (written per item) IS the ledger. Remaining = snapshot items with
`inspect_url != null AND float == null`. So the job table only stores **control intent + display counters**, never
the source of truth. Even if the job row is lost, resume recomputes from `item_meta`.

New table:
```sql
CREATE TABLE IF NOT EXISTS deep_sync_jobs (
  steamid TEXT PRIMARY KEY,
  status TEXT NOT NULL,        -- 'running'|'paused'|'stopped'|'done'|'error'
  total INTEGER NOT NULL, done INTEGER NOT NULL, error TEXT,
  started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL  -- updated_at = heartbeat
);
```
Statements: `upsertJob, getJob, bumpJob (done+heartbeat), touchJob (status+heartbeat), finishJob`. Add `deepInflight:Set<string>` to `SteamStore`.

**Engine** = async generator `deepSyncInventory(steamid, signal)`:
- guard via `deepInflight` (one worker per process); throw `INFLIGHT` if busy.
- `todo = snapshot items where inspect_url && float==null` (skip-cached = auto-resume).
- per item: **re-read `getJob` each iteration** → if `signal.aborted || status!=='running'`, mark `paused`, halt clean.
  Else `resolveFloat` → `upsertMeta.run(...)` (durable now) → `bumpJob` → `yield {type:'item', ...}` → `sleep(THROTTLE_MS)`.
- finish → `finishJob('done')`.

**Control semantics:**
| Action | Effect | Resumes from |
|---|---|---|
| start | insert job `running`, open SSE | item_meta (empty) |
| pause | write status `paused`; loop exits next iter | item_meta (float==null) |
| resume | status `running`, client reopens stream | float==null only |
| stop | status `stopped`; loop exits | explicit end |
| tab close / crash | `signal.aborted` (clean) or stale heartbeat (`updated_at` > ~30s while `running`) = orphaned → UI offers resume | item_meta |

### 4.5 New routes
- `app/api/deep-sync/[steamid]/route.ts` — `POST`, **SSE stream** (`ReadableStream`, `content-type: text/event-stream`).
  Iterate the generator, `enqueue` `data: {json}\n\n` per event (`start|item|skip|halted|done|error`). `runtime="nodejs"`, `dynamic="force-dynamic"`.
- `app/api/deep-sync/[steamid]/control/route.ts` — `POST {action:'pause'|'stop'|'resume'}` → writes status row.
- `app/api/deep-sync/[steamid]/status/route.ts` — `GET` → job row, for cross-session rehydrate on mount.

### 4.6 UI (`InventoryPanel.tsx`)
- New **toast layer** (fixed-position portal-ish element, styled with HUD palette) — distinct from the inline status line.
  Two states: `confirm` (⚠ warning + DEEP/FORCE SYNC + CANCEL) and `progress` (`done/total` + PAUSE/STOP/RESUME).
- Tertiary trigger button (enabled once `steamid` set). On click → confirm toast. On confirm → `fetch` SSE, read stream,
  update progress toast; on `done` → `setToast(null)` + `loadAndRender()` (re-pull merged snapshot with floats).
- On mount (extend `:117` effect): call `.../status`; if `paused`/orphaned, surface a RESUME affordance instead of starting cold.

### 4.7 Wire real float into trade-up
`lib/tradeup-context.tsx:70` → use `item.float ?? skin.min_float`. Optionally derive wear from float via `WEAR_RANGES`.

---

## 5. Cache Inspector — design

Read-only visualization of everything in `loader.db` so users see what's saved / working / corrupted.

### 5.1 Persisted data to surface
```
loader.db (+ -wal, -shm)
├─ snapshots       steamid → {fetched_at, payload:JSON{items[],count}}
├─ item_meta       assetid → {float, paint_seed, paint_index, fetched_at}   (new w/ force sync)
└─ deep_sync_jobs  steamid → {status, total, done, heartbeat}               (new w/ force sync)
```

### 5.2 Health rules
| Entity | OK | WARN | CORRUPT |
|---|---|---|---|
| snapshot | parses & `count===items.length` | very old; count mismatch | payload won't `JSON.parse` |
| item_meta row | float in `[0,1]`, has matching snapshot asset | float null w/ fetched_at set; out of range | — |
| meta vs snapshot | full coverage | partial (X/Y) | — |
| orphan meta | — | assetid not in any snapshot (stale, owns disk) | — |
| job | `done`/`stopped` | `paused`; `running` w/ stale heartbeat | counters > total |

### 5.3 Route `app/api/cache/route.ts` — `GET`, read-only report
- For each `snapshots` row: `length(payload)` bytes, try-parse (corrupt flag), `count` vs actual item count,
  float coverage = `SELECT count(*) FROM item_meta WHERE assetid IN (...)`.
- Orphan meta + out-of-range float counts. Uses SQLite **JSON1** (`json_each`/`json_extract`) — compiled into
  `better-sqlite3` — to query payload assetids without loading every blob into JS.
- All `deep_sync_jobs` rows. DB byte size via `fs.statSync` on `loader.db` + `-wal` + `-shm`.
- Optional `DELETE /api/cache?scope=orphans|meta:<id>|snapshot:<id>` for one-click purge (writes → confirm-gated).

### 5.4 UI — `app/cache/page.tsx` + `components/CacheInspector.tsx`
HUD-styled tables: SNAPSHOTS / DEEP SYNC JOBS / INTEGRITY. Colored health dot per row (●OK `--profit`, ⚠WARN `--amber`,
●CORRUPT `--loss`). CORRUPT/WARN rows expose purge/resume actions. The `INTERRUPTED` job row is the same persisted
state from §4.4, so the inspector doubles as the cross-session resume entry point.

---

## 6. Combined touch list

| File | Change |
|---|---|
| `lib/steam.ts` | `InventoryItem` fields; `item_meta` + `deep_sync_jobs` tables & statements; `deepInflight`; capture `inspect_url` in `fetchInventory`; merge meta in `getSnapshot`; `deepSyncInventory` generator + `resolveFloat` |
| `app/api/deep-sync/[steamid]/route.ts` | **new** SSE stream |
| `app/api/deep-sync/[steamid]/control/route.ts` | **new** pause/stop/resume |
| `app/api/deep-sync/[steamid]/status/route.ts` | **new** job rehydrate |
| `app/api/cache/route.ts` | **new** integrity report (+ optional DELETE) |
| `app/cache/page.tsx`, `components/CacheInspector.tsx` | **new** inspector UI |
| `components/InventoryPanel.tsx` | toast layer; force-sync trigger; SSE reader; mount rehydrate; final `loadAndRender` |
| `lib/tradeup-context.tsx` | use real `item.float` (`:70`) |
| `.env` | `CSFLOAT_API_KEY` (if CSFloat chosen) |

---

## 7. Suggested phasing (lowest risk first)

1. **Schema + inspect_url capture + getSnapshot merge** — invisible, safe, no external dep. Floats just stay empty.
2. **Cache inspector** (route + page) — fully self-contained, read-only, no external dep. Great standalone deliverable.
3. **`deep_sync_jobs` table + status/control endpoints** — no external dep; engine can be a stub.
4. **`deepSyncInventory` + `resolveFloat`** — needs the §3 float-source decision. Test via `curl` on the SSE route.
5. **Toast UI + wiring** in `InventoryPanel.tsx`.
6. **Real float into trade-up math** (`tradeup-context.tsx`).

Phases 1–3 + the inspector are buildable **right now** without resolving the CSFloat-vs-bot question.

---

## 8. Gotchas / invariants

- DB handle is a **`globalThis` singleton** — never `new Database()` outside `initStore`; never open at import time
  (breaks parallel `next build` workers). New state goes on the `SteamStore` struct.
- Route files that import `lib/steam.ts` must stay **Node runtime** (`export const runtime = "nodejs"`), never Edge — native addon.
- Keep the `SteamError.code` → `CODE_STATUS` convention for any new route errors.
- `assetid` is globally unique per item instance → correct PK for `item_meta`; float cache is valid indefinitely.
- Two-Claude-session caution: `InventoryPanel.tsx` and `lib/steam.ts` are the hot files for this work — coordinate to avoid clobbering.
- Always `npm run typecheck` before declaring done. Dev server: `npm run dev` (use `WATCHPACK_POLLING=true` on WSL).
