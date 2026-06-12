# Context Pile — Inventory Tabs (ALL / VALID eligibility)

> Reference dump for implementing a two-tab inventory: a holistic **ALL** view and a reactive **VALID**
> view showing only items still eligible for the contract currently in the trade-up visualizer.
> Current as of this writing; verify line numbers before editing. **No feature code exists yet** — groundwork context.
> Sibling doc: `CONTEXT-force-sync-cache-inspector.md` (shares the `InventoryItem` enrichment in §4).

---

## 1. Goal

Split `components/InventoryPanel.tsx`'s single grid into two tabs:

1. **ALL** — every item in the snapshot (today's grid, unchanged).
2. **VALID** — only items eligible to drop into the trade-up *right now*, derived reactively from what's
   already in the visualizer (`slots` + `isStatTrak`). As the contract fills/locks/clears, VALID updates live.

This is **contract eligibility only** — it depends on rarity / StatTrak / souvenir / item-type, NOT on float.
So it works fully *before* any force sync; it just needs cheap description tags, not the expensive per-item float.

---

## 2. The rules that define "valid" (source: `lib/tradeup.ts`)

The VALID predicate must mirror the rules the compute step enforces:

| Rule | Code | Implication for eligibility |
|---|---|---|
| Exactly 10 inputs | `tradeup.ts:48` | contract full (10/10) → nothing valid |
| All inputs same rarity | `tradeup.ts:59-63` | first placed item **locks** the rarity |
| Input rarity must trade up | `nextRarity` `tradeup.ts:13-17` returns `null` for top two tiers | **Covert & Contraband can't be inputs**; eligible tiers = Consumer, Industrial, Mil-Spec, Restricted, Classified |
| StatTrak is contract-wide | `isStatTrak` (`TradeUpConsole.tsx:12`), priced in `tradeup.ts:116,146` | can't mix StatTrak with non-StatTrak |
| No souvenir | outputs use `!s.souvenir` `tradeup.ts:101` | souvenirs aren't valid inputs in-game |
| Normal weapon skins only | (implicit) | exclude knives/gloves/cases/stickers/agents/graffiti/keys |

`RARITY_ORDER` (`types/cs2.ts:12-20`): Consumer, Industrial, Mil-Spec, Restricted, Classified, Covert, Contraband.
`nextRarity` cutoff `i >= length-2` ⇒ indices 5 (Covert) & 6 (Contraband) return null ⇒ **TRADEABLE_INPUT_TIERS = indices 0–4**.

---

## 3. Current state & data the predicate needs

### Where contract state lives
- **`slots`** — shared `useTradeup` context (`lib/tradeup-context.tsx:14-19,75`): `{ slots, setSlots, addFromInventory }`.
  `InventoryPanel` already imports the context (`:88`) but only destructures `addFromInventory` — it CAN also read `slots`.
- **`lockedRarity`** — derived from first filled slot (`TradeUpConsole.tsx:24-27`). Re-derive the same way in InventoryPanel.
- **`filled`** — `slots.filter(s => s.skin).length` (`TradeUpConsole.tsx:23`).
- **`isStatTrak`** — ⚠ lives in **`TradeUpConsole` local state** (`TradeUpConsole.tsx:12`), **NOT shared**. See blocker §4.

### Where inventory data lives
- `InventoryItem` (`lib/steam.ts:17-23`): only `assetid, classid, name, icon_url, rarity`.
  **No `stattrak` / `souvenir` / item-type fields.** See blocker §4.
- `fetchInventory` (`lib/steam.ts:110-139`) extracts only the **Rarity** tag (`:128`). The Steam description `tags[]`
  also carry `category:"Quality"` (Normal / StatTrak™ / Souvenir) and `category:"Type"` (Rifle/Pistol/Knife/Gloves/Container…) — currently ignored.
- `skinFromInventory` (`lib/tradeup-context.tsx:33-53`) **strips** "★ / StatTrak™ / Souvenir / (Wear)" from the name
  (`:36-39`) but discards those facts; defaults missing rarity to "Mil-Spec Grade" (`:47`); `collections: []` (`:50`).

---

## 4. Two real blockers (both compose with the force-sync work)

### Blocker A — `isStatTrak` is not shared
The VALID filter needs it, but it's local to `TradeUpConsole`. **Lift `isStatTrak` into the `useTradeup` context**
(`lib/tradeup-context.tsx`) next to `slots`; have `TradeUpConsole` read it from context instead of `useState`.
Side benefit: the StatTrak lock becomes consistent across both panels.

### Blocker B — `InventoryItem` lacks `stattrak` / `souvenir` / type
**Capture the Quality + Type tags in `fetchInventory`** and add fields to `InventoryItem`:
```ts
stattrak?: boolean;     // Quality tag internal_name === "strange"  (or localized "StatTrak™")
souvenir?: boolean;     // Quality tag internal_name === "tournament" (localized "Souvenir")
item_type?: string;     // Type tag localized_tag_name: "Rifle"|"Pistol"|"Knife"|"Gloves"|"Container"|...
```
In the `fetchInventory` map (`lib/steam.ts:125`), alongside the existing rarity extraction:
```ts
const quality = tags.find((t:any) => t.category === "Quality");
const typeTag = tags.find((t:any) => t.category === "Type");
const stattrak = quality?.internal_name === "strange";
const souvenir = quality?.internal_name === "tournament";
const item_type = typeTag?.localized_tag_name ?? null;
```
**This is the same description-tag pass the force-sync doc adds (`CONTEXT-force-sync-cache-inspector.md` §4.1–4.2).**
Do it once, share it. Until done, VALID runs in **degraded mode**: rarity + already-used + full only (skip StatTrak/souvenir/type gates).

A weapon-vs-not check from `item_type`: treat as weapon unless `item_type` ∈ {Knife, Gloves, Container, Sticker,
Agent, Graffiti, Collectible, Key, Pass, Gift, Tag, Tool, Music Kit, Patch}. (Inverse allowlist is safer than guessing.)

---

## 5. The eligibility predicate (single source of truth)

Put this in `lib/tradeup-context.tsx` so BOTH the VALID filter and `addFromInventory` use it — preventing the UI from
showing an item as valid that the add-handler then rejects.

```ts
const TRADEABLE_INPUT_TIERS = new Set<Rarity>([
  "Consumer Grade","Industrial Grade","Mil-Spec Grade","Restricted","Classified",
]);
const NON_WEAPON_TYPES = new Set([
  "Knife","Gloves","Container","Sticker","Agent","Graffiti","Collectible","Key","Pass","Gift","Tag","Tool","Music Kit","Patch",
]);

export type EligReason =
  | "ok" | "contract-full" | "already-used" | "souvenir" | "not-a-weapon"
  | "untradeable-rarity" | "stattrak-mismatch" | "wrong-rarity";

export interface ContractState {
  filled: number;
  lockedRarity: Rarity | null;
  lockedStatTrak: boolean | null;   // null until decided (see §4-A: contract-wide toggle)
  usedAssetIds: Set<string>;
}

export function deriveContractState(slots: Slot[], isStatTrak: boolean): ContractState {
  const used = new Set<string>();
  for (const s of slots) if (s.skin?.id?.startsWith("inv-")) used.add(s.skin.id.slice(4)); // inv-<assetid>
  const first = slots.find(s => s.skin);
  return {
    filled: slots.filter(s => s.skin).length,
    lockedRarity: first?.skin?.rarity.name ?? null,
    lockedStatTrak: first ? isStatTrak : null,
    usedAssetIds: used,
  };
}

export function evaluate(item: InventoryItem, c: ContractState): { valid: boolean; reason: EligReason } {
  if (c.filled >= 10)                                       return { valid:false, reason:"contract-full" };
  if (c.usedAssetIds.has(item.assetid))                     return { valid:false, reason:"already-used" };
  if (item.souvenir)                                        return { valid:false, reason:"souvenir" };
  if (item.item_type && NON_WEAPON_TYPES.has(item.item_type)) return { valid:false, reason:"not-a-weapon" };
  if (item.rarity && !TRADEABLE_INPUT_TIERS.has(item.rarity as Rarity)) return { valid:false, reason:"untradeable-rarity" };
  if (c.lockedStatTrak != null && !!item.stattrak !== c.lockedStatTrak) return { valid:false, reason:"stattrak-mismatch" };
  if (c.lockedRarity && item.rarity !== c.lockedRarity)     return { valid:false, reason:"wrong-rarity" };
  return { valid:true, reason:"ok" };
}
```
Then `addFromInventory` (`tradeup-context.tsx:60-73`) calls `evaluate(item, deriveContractState(slots, isStatTrak))` and
returns the human-readable reason on failure (it currently only checks rarity-lock + empty slot).

**Empty-contract behavior:** with no slots filled, `lockedRarity`/`lockedStatTrak` are null, so only the type/tier/souvenir
gates apply ⇒ VALID = "everything you could *start* a contract with." Once one item is placed, rarity + StatTrak lock in.

**`usedAssetIds` mapping:** inventory items become skins with id `inv-${assetid}` (`tradeup-context.tsx:45`), so the assetid
is recoverable by stripping the `inv-` prefix. (If a slot was filled from the catalog SkinPicker instead, it has no `inv-`
prefix and simply won't match any inventory assetid — correct.)

---

## 6. UI design (`components/InventoryPanel.tsx`)

Current grid region: tab-less. Items render at `:359-397`; rarity dropdown at `:326-352`; `busy` gate at `:208,356`.

- Add **`activeTab: "all" | "valid"`** state. Tab strip in the panel header (above the rarity dropdown), HUD-styled:
  ```
  [ ALL  312 ]  [ VALID  46 ]            RARITY ▾   46 SHOWN
  ```
  Counts: ALL = `items.length`; VALID = `validItems.length`.
- **VALID set** = `useMemo(() => items.filter(it => evaluate(it, contractState).valid), [items, slots, isStatTrak])`.
  Recomputes whenever the visualizer changes — this reactivity is the feature.
- The existing **rarity dropdown** composes on top of the active tab (filter within VALID).
- **Contextual VALID header** so the constraint is legible:
  - empty contract → `"ANY · pick a rarity to start — 5 tiers eligible"` (optionally group/sort by rarity).
  - locked → `"MIL-SPEC GRADE · NON-STATTRAK · 6 SLOTS LEFT"`.
  - full → empty state `"CONTRACT FULL (10/10) — clear a slot to add more"`.
- **Optional ALL enhancement:** dim items where `evaluate(...).valid === false` and show `reason` on hover — turns the
  holistic view into a "why can't I use this?" teaching tool with no extra click.
- Palette/classes to match: `--surface, --surface-line, --void, --ember, --amber, --green, --green-dim, --cream-dim,
  --profit, --loss, --mono`; HUD classes `hud`, `hud-ember`, `hud-amber`.

---

## 7. Touch list

| File | Change |
|---|---|
| `lib/tradeup-context.tsx` | lift `isStatTrak` into context; add `ContractState`/`deriveContractState`/`evaluate`/`EligReason`; route `addFromInventory` through `evaluate`; use captured `stattrak`/`souvenir` in `skinFromInventory` |
| `lib/steam.ts` | capture `Quality`→`stattrak`/`souvenir` + `Type`→`item_type` in `fetchInventory`; add fields to `InventoryItem` (**shared with force-sync §4.1**) |
| `components/InventoryPanel.tsx` | `activeTab` state + tab strip; VALID `useMemo`; contextual VALID header; optional dim-invalid-in-ALL |
| `components/TradeUpConsole.tsx` | read `isStatTrak` from context instead of local `useState` (`:12`) |

---

## 8. Phasing / notes

1. **Degraded VALID first** — ship tabs using only rarity + already-used + full gates (no data changes needed). Immediately useful.
2. **Lift `isStatTrak`** into context (Blocker A) — enables StatTrak gate.
3. **Capture Quality/Type tags** in `fetchInventory` (Blocker B) — enables souvenir + type + StatTrak gates fully. Do alongside force-sync §4.2.
4. **Optional polish** — dim-invalid-in-ALL with reason tooltips; group VALID by rarity when contract is empty.

**Invariants / gotchas**
- `evaluate` must be the ONLY place eligibility is decided (VALID filter + `addFromInventory` both call it) — no divergence.
- Eligibility is float-independent: VALID does not require force sync, only the cheap Quality/Type tags.
- Inventory skins use synthetic ids `inv-<assetid>` and `collections: []` — fine for eligibility; the empty-collection limitation
  only affects *outcome* math (`tradeup.ts:81-84` warns), not validity.
- Keep `lib/steam.ts` route imports on Node runtime. Run `npm run typecheck` after edits.
- Two-Claude-session caution: `InventoryPanel.tsx`, `tradeup-context.tsx`, and `lib/steam.ts` are hot for this work — coordinate to avoid clobbering.
