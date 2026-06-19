"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTradeup, isStatTrakName, inventoryInputEligibility } from "@/lib/tradeup-context";
import { rarityHex, usd } from "@/lib/display";
import type { InventoryItem } from "@/lib/steam";

type StatusClass = "ok" | "warn" | "err" | "dim";

interface SnapshotMeta {
  steamid: string;
  count: number;
}

// Trade-up grades first (in tier order), then anything else (knives/gloves/etc.)
// alphabetically. Used to order the rarity dropdown.
const RARITY_RANK: Record<string, number> = {
  "Consumer Grade": 0,
  "Industrial Grade": 1,
  "Mil-Spec Grade": 2,
  Restricted: 3,
  Classified: 4,
  Covert: 5,
  Contraband: 6,
  Extraordinary: 7,
};

// Grid sort options surfaced in the SORT dropdown. The sink-sort that keeps
// ineligible items at the bottom is always applied first (see `filtered`); the
// chosen key here only orders items *within* the eligible/ineligible groups.
type SortKey =
  | "default"
  | "rarity-desc"
  | "rarity-asc"
  | "price-desc"
  | "price-asc"
  | "float-desc"
  | "float-asc";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "default", label: "Default order" },
  { key: "rarity-desc", label: "Rarity: high → low" },
  { key: "rarity-asc", label: "Rarity: low → high" },
  { key: "price-desc", label: "Price: high → low" },
  { key: "price-asc", label: "Price: low → high" },
  { key: "float-desc", label: "Float: high → low" },
  { key: "float-asc", label: "Float: low → high" },
];

// Numeric compare with a fixed direction; null/undefined always sink last
// regardless of direction (an unpriced / floatless / unranked item has no
// meaningful position in the ordering, so it trails either way).
function numCompare(a: number | null | undefined, b: number | null | undefined, dir: 1 | -1): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return (a - b) * dir;
}

function sortComparator(key: SortKey): (a: InventoryItem, b: InventoryItem) => number {
  switch (key) {
    case "rarity-desc":
      return (a, b) => numCompare(RARITY_RANK[a.rarity ?? ""], RARITY_RANK[b.rarity ?? ""], -1);
    case "rarity-asc":
      return (a, b) => numCompare(RARITY_RANK[a.rarity ?? ""], RARITY_RANK[b.rarity ?? ""], 1);
    case "price-desc":
      return (a, b) => numCompare(a.price, b.price, -1);
    case "price-asc":
      return (a, b) => numCompare(a.price, b.price, 1);
    case "float-desc":
      return (a, b) => numCompare(a.float, b.float, -1);
    case "float-asc":
      return (a, b) => numCompare(a.float, b.float, 1);
    default:
      return () => 0;
  }
}

const STATUS_COLOR: Record<StatusClass, string> = {
  ok: "var(--profit)",
  warn: "var(--amber)",
  err: "var(--loss)",
  dim: "var(--fg-dim)",
};

interface ApiResult<T = any> {
  ok: boolean;
  status: number;
  body: T | null;
}

async function api<T = any>(path: string, opts?: RequestInit): Promise<ApiResult<T>> {
  const r = await fetch(path, opts);
  let body: T | null;
  try {
    body = (await r.json()) as T;
  } catch {
    body = null;
  }
  return { ok: r.ok, status: r.status, body };
}

// Compact relative age: "12s ago" / "5m ago" / "3h ago" / "2d ago".
function relativeAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// A snapshot older than the 60s sync floor is considered stale.
const STALE_MS = 60_000;

export default function InventoryPanel() {
  const [input, setInput] = useState("https://steamcommunity.com/profiles/76561198059693930");
  const [steamid, setSteamid] = useState<string | null>(null);
  const [status, setStatus] = useState<{ msg: string; cls: StatusClass } | null>(null);
  const [meta, setMeta] = useState<SnapshotMeta | null>(null);
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  // Epoch ms of the snapshot currently shown, + a ticking clock so the
  // "last synced …" label and its stale styling update on their own.
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // The input string of the currently loaded profile. The action button shows
  // SYNC while `input` matches this, and reverts to LOAD once the text is edited.
  const [loadedInput, setLoadedInput] = useState<string | null>(null);
  const [rarityFilter, setRarityFilter] = useState<string>("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("default");
  // Item whose price breakdown modal is open (null = closed). Set by clicking a
  // priced inventory card's price; cleared by the modal's backdrop/close.
  const [priceModalItem, setPriceModalItem] = useState<InventoryItem | null>(null);

  const steamidRef = useRef<string | null>(null);
  steamidRef.current = steamid;

  const { slots, addFromInventory, setSteamid: setSharedSteamid } = useTradeup();
  const setMsg = useCallback((msg: string, cls: StatusClass = "dim") => setStatus({ msg, cls }), []);

  // Mirror the resolved profile to shared context so the trade-up header (left
  // side) can load this profile's avatar.
  useEffect(() => {
    setSharedSteamid(steamid);
  }, [steamid, setSharedSteamid]);

  // Tick every 10s so the relative "synced …" label stays current and flips to
  // stale on its own without needing another render to be triggered.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  // Asset IDs currently staged on the trade side. An item lives in exactly one
  // place: moving it to a slot hides it here; clearing the slot brings it back.
  // Slot skin ids are minted as `inv-<assetid>` in tradeup-context.
  const consumed = useMemo(() => {
    const set = new Set<string>();
    for (const s of slots) {
      const id = s.skin?.id;
      if (id?.startsWith("inv-")) set.add(id.slice(4));
    }
    return set;
  }, [slots]);

  // Click an item to move it into the next trade-up slot (it then leaves the grid).
  const onItemClick = useCallback(
    (it: InventoryItem) => {
      // Fundamentally ineligible items (medals, cases, agents, Covert, …) are
      // rendered disabled below; a click here is a no-op beyond a quiet,
      // non-alarming reconfirmation of why it can't go into a contract.
      const elig = inventoryInputEligibility(it);
      if (!elig.eligible) {
        setMsg(elig.reason ?? "not a trade-up input", "dim");
        return;
      }
      const r = addFromInventory(it);
      if (!r.ok) setMsg(r.reason ?? "could not add", "warn");
    },
    [addFromInventory, setMsg],
  );

  const loadAndRender = useCallback(async () => {
    const id = steamidRef.current;
    if (!id) return;
    const r = await api(`/api/inventory/${id}`);
    if (!r.ok) {
      setItems([]);
      setMeta(null);
      setSyncedAt(null);
      return;
    }
    const s = r.body as { steamid: string; count: number; items: InventoryItem[]; age_ms?: number };
    setMeta({ steamid: s.steamid, count: s.count });
    setItems(s.items);
    setSyncedAt(Date.now() - (s.age_ms ?? 0));
  }, []);

  // On mount: resolve the default profile -> steamid, then render the last
  // persisted snapshot from SQLite (no Steam sync). Items appear automatically.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const raw = input.trim();
      if (!raw) return;
      setLoading(true);
      try {
        const r = await api<{ steamid: string }>("/api/resolve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ input: raw }),
        });
        if (cancelled || !r.ok || !r.body?.steamid) return;
        setSteamid(r.body.steamid);
        steamidRef.current = r.body.steamid;
        setLoadedInput(raw);
        await loadAndRender();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Single FORCE path: always bypasses the server's 60s floor. The inflight
  // guard + Steam's own 429 remain the backstop, so no client-side cooldown
  // timer is needed (and none runs in the background).
  const doSync = useCallback(async () => {
    if (!steamidRef.current) return;
    setSyncing(true);
    const r = await api(`/api/sync/${steamidRef.current}?force=1`, { method: "POST" });
    if (!r.ok) {
      const code = r.body?.code;
      if (code === "RATELIMIT") setMsg("steam 429 // rate limited", "err");
      else if (code === "PRIVATE") setMsg("inventory private", "err");
      else if (code === "INFLIGHT") setMsg("sync in progress", "warn");
      else setMsg(`sync error // ${r.body?.error || r.status}`, "err");
      setSyncing(false);
      await loadAndRender();
      return;
    }
    setMsg(`${r.body.count} items // ${r.body.changed ? "updated" : "unchanged"}`, "ok");
    await loadAndRender();
    setSyncing(false);
  }, [loadAndRender, setMsg]);

  const doResolveAndSync = useCallback(async () => {
    const raw = input.trim();
    if (!raw) {
      setMsg("enter a profile / vanity / steamid64", "warn");
      return;
    }
    setLoading(true);
    setMsg("resolving...", "dim");
    const r = await api<{ steamid: string; code?: string; error?: string }>("/api/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: raw }),
    });
    if (!r.ok) {
      setLoading(false);
      if (r.body?.code === "RESOLVE") setMsg(`resolve failed // ${r.body.error}`, "err");
      else setMsg(`upstream error // ${r.body?.error || r.status}`, "err");
      return;
    }
    setSteamid(r.body!.steamid);
    steamidRef.current = r.body!.steamid;
    setLoadedInput(raw);
    setMsg("resolved // syncing...", "dim");
    await doSync();
    setLoading(false);
  }, [input, doSync, setMsg]);

  // Single action button. It re-syncs the loaded profile only while the input
  // still matches what was loaded; any edit to the text reverts it to LOAD.
  const trimmedInput = input.trim();
  const syncMode = !!steamid && trimmedInput !== "" && trimmedInput === loadedInput;
  const actionDisabled = syncing || loading;
  const actionLabel = syncMode
    ? syncing
      ? "SYNCING…"
      : "SYNC"
    : loading
      ? "LOADING…"
      : "LOAD";

  // Any backend activity touching this inventory view -> show the loader panel.
  const busy = loading || syncing;

  // Inventory minus whatever is currently staged on the trade side.
  const available = useMemo(
    () => (items ?? []).filter((it) => !consumed.has(it.assetid)),
    [items, consumed],
  );

  // Distinct rarities present in the inventory, ordered for the dropdown.
  const rarities = useMemo(() => {
    const set = new Set<string>();
    for (const it of available) if (it.rarity) set.add(it.rarity);
    return [...set].sort(
      (a, b) => (RARITY_RANK[a] ?? 99) - (RARITY_RANK[b] ?? 99) || a.localeCompare(b),
    );
  }, [available]);

  // Once any item is staged, the contract locks to that item's rarity AND its
  // StatTrak state, so the grid collapses to only eligible items (the manual
  // rarity dropdown is overridden while locked).
  const lock = useMemo(() => {
    for (const s of slots) if (s.skin) return { rarity: s.skin.rarity.name, stattrak: s.stattrak };
    return null;
  }, [slots]);
  const lockedRarity = lock?.rarity ?? null;
  const effectiveRarity = lockedRarity ?? rarityFilter;

  // Items shown in the grid, narrowed by the locked/selected rarity and (when
  // locked) the StatTrak state of the staged contract. Ineligible items (medals,
  // ★ knives/gloves, etc.) sink to the bottom so the selectable items lead; the
  // sort is stable, preserving the original order within each group.
  const filtered = useMemo(() => {
    let out = available;
    if (effectiveRarity !== "ALL") out = out.filter((it) => it.rarity === effectiveRarity);
    if (lock) out = out.filter((it) => isStatTrakName(it.name) === lock.stattrak);
    const cmp = sortComparator(sortKey);
    return [...out].sort(
      (a, b) =>
        // Primary: ineligible items sink to the bottom. Secondary: the chosen
        // sort orders items within each group (stable for "default").
        Number(!inventoryInputEligibility(a).eligible) -
          Number(!inventoryInputEligibility(b).eligible) || cmp(a, b),
    );
  }, [available, effectiveRarity, lock, sortKey]);

  return (
    <>
      <main
        style={{
          maxWidth: 980,
          margin: "0 auto",
          padding: "10px 24px 60px",
          position: "relative",
          zIndex: 1,
        }}
      >
        <div
          style={{
            position: "relative",
            overflow: "hidden",
            background: "var(--surface)",
            border: "1px solid var(--surface-line)",
            padding: "16px 22px 18px",
            boxShadow: "0 0 0 1px rgba(0,0,0,0.6), 0 8px 40px rgba(0,0,0,0.7)",
          }}
        >
          {/* lerped fill pinned to the very top of the header, runs during any sync */}
          <SyncFill active={loading || syncing} />
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14 }}>
            <div>
              <span className="hud hud-ember">STEAM INVENTORY LOADER</span>
              <h1
                className="glow"
                style={{
                  fontFamily: "var(--mono)",
                  fontWeight: 700,
                  fontSize: 22,
                  margin: "4px 0 0",
                  letterSpacing: "-0.01em",
                  color: "var(--green)",
                }}
              >
                <span style={{ color: "var(--green-dim)" }}>$ </span>
                loader
                <span style={{ color: "var(--green-faint)", fontWeight: 400 }}> --cs2</span>
                <sup style={{ fontSize: 14, fontWeight: 400, color: "var(--green-dim)" }}> 730:2</sup>
              </h1>
            </div>
            {/* The loaded profile's avatar lives here — this is the user's side
                (their owned items); the left panel is the algorithm interface. */}
            <ProfilePic />
          </header>

          {/* resolve + sync bar */}
          <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") doResolveAndSync();
              }}
              placeholder="profile url / vanity / steamid64"
              style={{
                flex: 1,
                background: "var(--void)",
                border: "1px solid var(--surface-line)",
                color: "var(--amber)",
                padding: "10px 12px",
                fontSize: 14,
                outline: "none",
              }}
            />
            <button
              onClick={() => (syncMode ? doSync() : doResolveAndSync())}
              disabled={actionDisabled}
              title={syncMode ? "Re-fetch from Steam now" : "Resolve + load this profile"}
              style={{
                background: actionDisabled ? "var(--line)" : "var(--ember)",
                color: actionDisabled ? "var(--cream-dim)" : "var(--void)",
                border: "none",
                padding: "10px 22px",
                fontSize: 12,
                letterSpacing: "0.18em",
                fontWeight: 700,
              }}
            >
              {actionLabel}
            </button>
          </div>

          {status && (
            <div
              style={{
                minHeight: 18,
                marginTop: 12,
                fontSize: 12,
                color: STATUS_COLOR[status.cls],
              }}
            >
              {status.msg}
            </div>
          )}

          {meta && (
            <div className="hud" style={{ marginTop: 4 }}>
              {meta.steamid} // {meta.count} ITEMS
            </div>
          )}

          {/* rarity filter — color-coded chips; clicking a grade narrows the grid
              to that rarity. Overridden (and disabled) while a contract locks the
              rarity. */}
          {items && items.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                <span className="hud">RARITY</span>
                <span className="hud">
                  {lockedRarity ? "LOCKED // " : ""}
                  {filtered.length} SHOWN
                </span>
                <span className="hud" style={{ marginLeft: "auto" }}>
                  SORT
                </span>
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as SortKey)}
                  title="Order the inventory grid"
                  style={{
                    background: "var(--void)",
                    color: "var(--amber)",
                    border: "1px solid var(--surface-line)",
                    padding: "4px 8px",
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    letterSpacing: "0.08em",
                    outline: "none",
                    cursor: "pointer",
                  }}
                >
                  {SORT_OPTIONS.map((o) => (
                    <option
                      key={o.key}
                      value={o.key}
                      style={{ background: "var(--void)", color: "var(--amber)" }}
                    >
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              {/* Tooltip lives on the wrapper because a disabled <button>
                  suppresses its own title on hover — so the locked message
                  would never show on the chips themselves. */}
              <div
                style={{ display: "flex", flexWrap: "wrap", gap: 6 }}
                title={lockedRarity ? "Locked by selected item" : undefined}
              >
                {[
                  { key: "ALL", label: "ALL", count: available.length, color: "var(--green)" },
                  ...rarities.map((r) => ({
                    key: r,
                    label: r,
                    count: available.filter((it) => it.rarity === r).length,
                    color: rarityHex(r),
                  })),
                ].map((chip) => {
                  const active = effectiveRarity === chip.key;
                  return (
                    <button
                      key={chip.key}
                      onClick={() => setRarityFilter(chip.key)}
                      disabled={!!lockedRarity}
                      title={lockedRarity ? "Locked by selected item" : `Show ${chip.label}`}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        background: active ? chip.color : "transparent",
                        color: active ? "var(--void)" : "var(--cream-dim)",
                        // Longhand (not the `border` shorthand) so it doesn't
                        // conflict with the accent borderLeft on re-render.
                        borderTop: `1px solid ${active ? chip.color : "var(--surface-line)"}`,
                        borderRight: `1px solid ${active ? chip.color : "var(--surface-line)"}`,
                        borderBottom: `1px solid ${active ? chip.color : "var(--surface-line)"}`,
                        borderLeft: `3px solid ${chip.color}`,
                        padding: "5px 10px",
                        fontFamily: "var(--mono)",
                        fontSize: 11,
                        letterSpacing: "0.08em",
                        cursor: lockedRarity ? "not-allowed" : "pointer",
                        opacity: lockedRarity && !active ? 0.4 : 1,
                      }}
                    >
                      <span>{chip.label}</span>
                      <span style={{ opacity: active ? 0.8 : 0.6 }}>{chip.count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* loader panel — shown during any backend activity on this view */}
        {busy && <InventoryLoader />}

        {/* item grid */}
        {!busy && items && items.length > 0 && (
          <div
            style={{
              marginTop: 12,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
              gap: 10,
            }}
          >
            {filtered.map((it) => {
              const elig = inventoryInputEligibility(it);
              const ineligible = !elig.eligible;
              return (
              <div
                key={it.assetid}
                onClick={() => onItemClick(it)}
                title={ineligible ? elig.reason : "Click to add to trade-up"}
                aria-disabled={ineligible}
                style={{
                  position: "relative",
                  background: "var(--surface)",
                  // Ineligible tiles drop their rarity accent for a muted line,
                  // a subtle visual demotion from the selectable items.
                  border: `4px solid ${ineligible ? "var(--surface-line)" : rarityHex(it.rarity)}`,
                  padding: 12,
                  cursor: ineligible ? "not-allowed" : "pointer",
                  opacity: ineligible ? 0.45 : 1,
                }}
              >
                {ineligible && (
                  <span
                    className="hud"
                    title={elig.reason}
                    style={{
                      position: "absolute",
                      top: 6,
                      right: 6,
                      padding: "1px 5px",
                      letterSpacing: "0.12em",
                      color: "var(--cream-dim)",
                      border: "1px solid var(--surface-line)",
                      background: "var(--void)",
                    }}
                  >
                    N/A
                  </span>
                )}
                {it.icon_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={it.icon_url}
                    alt={it.name ?? "item"}
                    style={{
                      width: "100%",
                      height: 90,
                      objectFit: "contain",
                      // Desaturate ineligible items so the grid reads selectable
                      // vs not at a glance, without hiding anything.
                      filter: ineligible ? "grayscale(1)" : "none",
                    }}
                  />
                ) : (
                  <div style={{ height: 90 }} />
                )}
                <div style={{ fontSize: 12, lineHeight: 1.3, margin: "8px 0 4px" }}>
                  {it.name ?? "(unnamed)"}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  {/* Grade: an uppercase, wide-tracked amber HUD label. */}
                  <span className="hud hud-amber">{it.rarity ?? "—"}</span>
                  {/* Float: deliberately NOT a HUD label — a tight, tabular green
                      number so the precise wear value reads distinctly from the
                      grade category beside it. */}
                  {it.float != null && (
                    <span
                      title="Float (wear value)"
                      style={{
                        fontFamily: "var(--mono)",
                        fontVariantNumeric: "tabular-nums",
                        fontSize: 12,
                        letterSpacing: "0.01em",
                        color: "var(--green)",
                      }}
                    >
                      {it.float.toFixed(4)}
                    </span>
                  )}
                </div>
                {/* Median market price. When priced, it's a button: clicking it
                    (without staging the item) opens a per-marketplace breakdown.
                    stopPropagation keeps the tile's add-to-trade-up from firing. */}
                {it.price != null ? (
                  <button
                    type="button"
                    className="hud"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPriceModalItem(it);
                    }}
                    title="Compare prices across marketplaces"
                    style={{
                      display: "block",
                      width: "100%",
                      marginTop: 4,
                      padding: 0,
                      background: "transparent",
                      border: "none",
                      textAlign: "right",
                      color: "var(--green)",
                      cursor: "pointer",
                      textDecoration: "underline",
                      textDecorationStyle: "dotted",
                      textUnderlineOffset: 3,
                      textDecorationColor: "var(--green-dim)",
                      font: "inherit",
                      letterSpacing: "inherit",
                    }}
                  >
                    {usd(it.price)}
                  </button>
                ) : (
                  <div
                    className="hud"
                    style={{ marginTop: 4, textAlign: "right", color: "var(--cream-dim)" }}
                    title="No market price for this item"
                  >
                    no price
                  </div>
                )}
              </div>
              );
            })}
          </div>
        )}

        {!busy && items && items.length === 0 && (
          <div className="hud" style={{ marginTop: 24 }}>
            NO SNAPSHOT — LOAD A PROFILE FIRST
          </div>
        )}

        {/* freshness — a quiet footer line, never an alarm. Fresh reads
            green-dim; past the 60s floor it just softens to amber (a gentle
            nudge to re-sync, not a warning). Lives at the bottom, out of the way. */}
        {syncedAt != null &&
          (() => {
            const stale = now - syncedAt >= STALE_MS;
            const tone = stale ? "var(--amber)" : "var(--green-dim)";
            return (
              <div
                className="hud"
                style={{
                  marginTop: 22,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 7,
                  fontSize: 11,
                  color: "var(--cream-dim)",
                  opacity: 0.7,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: tone,
                    boxShadow: `0 0 5px ${tone}`,
                    flexShrink: 0,
                  }}
                />
                last synced {relativeAge(now - syncedAt)}
                {stale && <span>· hit SYNC to refresh</span>}
              </div>
            );
          })()}
      </main>

      {priceModalItem && (
        <PriceModal item={priceModalItem} onClose={() => setPriceModalItem(null)} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Price breakdown modal — opens from an inventory card's price. Lists Steam +
// third-party marketplaces, each with the price we have on file (Steam /
// Skinport / Buff163 come from the synced sources; the rest are link-only) and
// a click-through to that marketplace's listing for this exact item (the full
// market_hash_name already encodes the skin, wear, and StatTrak/Souvenir tag).
// ---------------------------------------------------------------------------

interface Marketplace {
  key: string;
  label: string;
  color: string;
  // Builds the listing URL for a raw inventory market_hash_name.
  url: (marketHashName: string) => string;
}

const MARKETPLACES: Marketplace[] = [
  {
    key: "steam",
    label: "Steam",
    color: "#66c0f4",
    url: (n) => `https://steamcommunity.com/market/listings/730/${encodeURIComponent(n)}`,
  },
  {
    key: "buff163",
    label: "Buff163",
    color: "#f0a500",
    url: (n) =>
      `https://buff.163.com/market/csgo#tab=selling&page_num=1&search=${encodeURIComponent(n)}`,
  },
  {
    key: "skinport",
    label: "Skinport",
    color: "#fa490a",
    url: (n) => `https://skinport.com/market?search=${encodeURIComponent(stripTags(n))}`,
  },
  {
    key: "csfloat",
    label: "CSFloat",
    color: "#a78bfa",
    url: (n) => `https://csfloat.com/search?market_hash_name=${encodeURIComponent(n)}`,
  },
  {
    key: "dmarket",
    label: "DMarket",
    color: "#27c281",
    url: (n) => `https://dmarket.com/ingame-items/item-list/csgo-skins?title=${encodeURIComponent(stripTags(n))}`,
  },
];

// Strip ★ / StatTrak™ / Souvenir / "(Wear)" for marketplaces whose search reads
// a plain skin name rather than the full Steam market_hash_name.
function stripTags(name: string): string {
  return name
    .replace(/^★\s*/, "")
    .replace(/^StatTrak™?\s*/i, "")
    .replace(/^Souvenir\s*/i, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
}

function PriceModal({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  // Esc closes; restore nothing else (the grid stays mounted behind the scrim).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const name = item.name ?? "";
  const sources = item.priceSources ?? {};

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(0,0,0,0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(440px, 100%)",
          background: "var(--surface)",
          border: "1px solid var(--surface-line)",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.6), 0 16px 60px rgba(0,0,0,0.8)",
          padding: "18px 20px 20px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <span className="hud hud-ember">MARKET PRICES</span>
            <div style={{ fontSize: 14, marginTop: 6, color: "var(--cream)", lineHeight: 1.35 }}>
              {name || "(unnamed)"}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "1px solid var(--surface-line)",
              color: "var(--cream-dim)",
              cursor: "pointer",
              padding: "2px 9px",
              fontFamily: "var(--mono)",
              fontSize: 14,
              lineHeight: 1.2,
            }}
          >
            ✕
          </button>
        </div>

        <div
          style={{
            marginTop: 16,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(118px, 1fr))",
            gap: 10,
          }}
        >
          {MARKETPLACES.map((m) => {
            const price = sources[m.key];
            return (
              <a
                key={m.key}
                href={m.url(name)}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open ${m.label} listing in a new tab`}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                  textDecoration: "none",
                  padding: "12px 8px",
                  background: "var(--void)",
                  border: "1px solid var(--surface-line)",
                  borderTop: `3px solid ${m.color}`,
                  color: "var(--cream)",
                }}
              >
                {/* Lettermark "icon" — brand-tinted disc, no external assets. */}
                <span
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: "50%",
                    background: m.color,
                    color: "var(--void)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: "var(--mono)",
                    fontWeight: 700,
                    fontSize: 15,
                  }}
                >
                  {m.label[0]}
                </span>
                <span className="hud" style={{ color: "var(--cream-dim)" }}>{m.label}</span>
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontVariantNumeric: "tabular-nums",
                    fontSize: 13,
                    color: price != null ? "var(--green)" : "var(--cream-dim)",
                  }}
                >
                  {price != null ? usd(price) : "view →"}
                </span>
              </a>
            );
          })}
        </div>

        <div style={{ marginTop: 14, fontSize: 11, color: "var(--cream-dim)", opacity: 0.7, lineHeight: 1.4 }}>
          Prices shown are the last synced values; icons open the live listing for this
          exact wear in a new tab.
        </div>
      </div>
    </div>
  );
}

// Profile-picture loader pinned to the inventory header (the user's side: this
// is whose owned items the grid shows). Pulls the loaded profile's Steam avatar
// from shared context and shows a phosphor pulse while it resolves, the avatar
// once loaded, and a dim placeholder when there's no profile or the lookup fails.
function ProfilePic() {
  const { steamid } = useTradeup();
  const [avatar, setAvatar] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    if (!steamid) {
      setAvatar(null);
      setState("idle");
      return;
    }
    let cancelled = false;
    setState("loading");
    setAvatar(null);
    fetch(`/api/avatar/${steamid}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { avatar?: string }) => {
        if (cancelled) return;
        if (d.avatar) {
          setAvatar(d.avatar);
          setState("idle");
        } else {
          setState("error");
        }
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [steamid]);

  const SIZE = 54;
  return (
    <div
      title={steamid ? `steam profile ${steamid}` : "no profile loaded"}
      style={{
        width: SIZE,
        height: SIZE,
        flexShrink: 0,
        position: "relative",
        overflow: "hidden",
        border: `1px solid ${avatar ? "var(--green)" : "var(--green-faint)"}`,
        background: "var(--void)",
        boxShadow: avatar ? "0 0 8px rgba(51,255,51,0.35)" : "none",
      }}
    >
      <style>{`@keyframes pp-pulse{0%,100%{opacity:.25}50%{opacity:.7}}`}</style>
      {avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatar}
          alt="profile"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : state === "loading" ? (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(135deg, rgba(51,255,51,0.05), rgba(51,255,51,0.28), rgba(51,255,51,0.05))",
            animation: "pp-pulse 1.1s ease-in-out infinite",
          }}
        />
      ) : (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: state === "error" ? "var(--loss)" : "var(--green-faint)",
            fontFamily: "var(--mono)",
            fontSize: 18,
          }}
        >
          {state === "error" ? "✕" : "☻"}
        </div>
      )}
    </div>
  );
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Phosphor progress fill pinned to the top edge of the header. While `active`,
 * a "trickle" target creeps toward 0.9 and the rendered width lerps toward it
 * each frame (never completing, since the sync duration is unknown). When the
 * sync ends, the target snaps to 1.0 so the bar eases full, then resets/fades.
 * Driven straight off rAF + the same lerp the CircuitBoard uses — no React
 * re-renders per frame.
 */
function SyncFill({ active }: { active: boolean }) {
  const barRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    let raf = 0;
    let current = 0;
    let trickle = 0;
    let visible = false;

    const frame = () => {
      const on = activeRef.current;
      let target: number;
      if (on) {
        visible = true;
        trickle = Math.min(0.9, trickle + 0.004); // ease toward, never reach, 90%
        target = trickle;
      } else {
        target = visible ? 1 : 0; // ending: fill to full, then reset below
      }
      current = lerp(current, target, 0.08);

      const el = barRef.current;
      if (el) {
        el.style.width = `${Math.max(0, Math.min(1, current)) * 100}%`;
        el.style.opacity = visible ? "1" : "0";
      }

      if (!on && visible && current > 0.99) {
        visible = false;
        current = 0;
        trickle = 0;
      }
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 2,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      <div
        ref={barRef}
        style={{
          height: "100%",
          width: "0%",
          background: "var(--green)",
          boxShadow: "0 0 6px var(--green), 0 0 2px var(--green-hot)",
          opacity: 0,
          transition: "opacity 0.25s ease",
        }}
      />
    </div>
  );
}

// Sleek phosphor loader shown while the inventory view is doing backend work.
// A green typewriter cycles the Matrix wake-up lines under a sweeping scanline.
// Everything is driven off a single rAF loop writing to refs — no per-frame
// React re-renders, no intervals.
const LOADER_LINES = [
  "Negotiating TLS 1.3 handshake...",
  "Establishing secure uplink...",
  "Completing the TCP three-way handshake...",
  "Sending SYN, awaiting SYN-ACK...",
  "Exchanging IKEv2 SA proposals...",
  "Rekeying the IPsec ESP tunnel...",
  "Bringing up the WireGuard interface...",
  "Resolving A/AAAA records over DNS...",
  "Renewing the DHCP lease...",
  "Broadcasting ARP who-has...",
  "Establishing SSH transport (curve25519-sha256)...",
  "Authenticating via SSH publickey...",
  "Routing through the bastion (ProxyJump)...",
  "Negotiating ALPN to h2...",
  "Resuming TLS from a session ticket...",
  "Stapling the OCSP response...",
  "Validating the X.509 chain to the root CA...",
  "Reconverging the BGP route table...",
  "Withdrawing the flapping prefix...",
  "Flushing the OSPF link-state DB...",
  "Issuing a Kerberos TGT...",
  "Binding LDAP over StartTLS...",
  "Validating the SAML assertion...",
  "Refreshing the OAuth2 bearer token...",
  "Brokering mutual-TLS between sidecars...",
  "Opening a gRPC stream over HTTP/2...",
  "Draining the AMQP delivery queue...",
  "Committing the Kafka consumer offset...",
  "Disciplining the clock over NTP...",
  "Mounting the NFSv4 export...",
  "Logging into the iSCSI target...",
  "Unsealing the LUKS volume...",
  "Unsealing the Vault transit engine...",
  "Rotating the signing keys...",
  "Reaping stale conntrack entries...",
  "Reloading the nftables ruleset...",
  "Committing iptables-restore atomically...",
  "Arming epoll on the listen fd...",
  "Submitting io_uring SQEs...",
  "Calling fsync() on the write-ahead log...",
  "Replaying the Postgres redo log...",
  "Promoting the Patroni standby...",
  "Acquiring the etcd lease...",
  "Extending the Raft leadership term...",
  "Gossiping SWIM membership...",
  "Sending TCP keepalive probes...",
  "Coalescing GRO segments...",
  "Offloading TSO to the NIC...",
  "Draining the qdisc backlog...",
  "Shaping egress via tc HTB...",
  "Attaching the XDP program...",
  "Loading eBPF into the kernel...",
  "Walking /proc for the PID...",
  "Sending SIGTERM to the daemon...",
  "clone(CLONE_NEWNET) for the namespace...",
  "Entering the network namespace...",
  "Pivoting root into the container...",
  "Mapping the cgroup v2 controllers...",
  "Throttling via cgroup cpu.max...",
  "mmap()-ing the shared segment...",
  "Forcing a TLB shootdown...",
  "Reclaiming the page cache...",
  "Dodging the OOM killer...",
  "Compacting transparent hugepages...",
  "Issuing fstrim on the SSD...",
  "Scrubbing the ZFS pool...",
  "Resilvering the RAID-Z vdev...",
  "Rebuilding the mdadm array...",
  "Replaying the ext4 journal...",
  "Stacking the overlayfs upperdir...",
  "Flushing dirty pages to disk...",
  "Rotating logs via logrotate...",
  "Shipping syslog over RFC 5424...",
  "Seeking the journald cursor...",
  "Scraping the Prometheus /metrics...",
  "Firing an Alertmanager route...",
  "Reloading nginx workers (SIGHUP)...",
  "Draining the HAProxy backends...",
  "Probing /healthz...",
  "Rolling the Kubernetes deployment...",
  "Cordoning and draining the node...",
  "Rescheduling the evicted pods...",
  "Renewing the kubelet client cert...",
  "Reconciling the desired ReplicaSet...",
  "Pulling the OCI image layers...",
  "Verifying the image digest (sha256)...",
  "Negotiating SOCKS5...",
  "Opening the QUIC connection...",
  "Attempting 0-RTT over QUIC...",
  "Discovering the path MTU...",
  "Sending an ICMP echo request...",
  "Tracing the next hop (TTL=1)...",
  "Claiming the floating IP via VRRP...",
  "Electing the keepalived master...",
  "Sending a gratuitous ARP...",
  "Syncing conntrackd state...",
  "Reprogramming the FIB...",
  "Failing over to the secondary VIP...",
  "Reaping zombie processes...",
  "Bringing the node online...",
];

function InventoryLoader() {
  const textRef = useRef<HTMLSpanElement>(null);
  const cursorRef = useRef<HTMLSpanElement>(null);
  const scanRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<number | null>(null);
  // Shuffle the phrase order once per mount so short loads vary each time.
  const linesRef = useRef<string[] | null>(null);
  if (linesRef.current === null) {
    const arr = [...LOADER_LINES];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    linesRef.current = arr;
  }
  const LINES = linesRef.current;

  useEffect(() => {
    const CPS = 20; // characters per second
    const HOLD = 1200; // ms a finished line lingers before the next
    const totals = LINES.map((l) => (l.length / CPS) * 1000 + HOLD);
    const grand = totals.reduce((a, b) => a + b, 0);

    let raf = 0;
    const frame = (now: number) => {
      if (startRef.current == null) startRef.current = now;
      let t = now - startRef.current;
      if (t >= grand) {
        startRef.current = now;
        t = 0;
      }
      let acc = 0;
      let shown = "";
      for (let i = 0; i < LINES.length; i++) {
        if (t < acc + totals[i]) {
          const local = t - acc;
          const chars = Math.min(LINES[i].length, Math.floor((local / 1000) * CPS));
          shown = LINES[i].slice(0, chars);
          break;
        }
        acc += totals[i];
      }
      if (textRef.current) textRef.current.textContent = shown;
      if (cursorRef.current) cursorRef.current.style.opacity = Math.floor(now / 450) % 2 === 0 ? "1" : "0.06";
      if (scanRef.current) scanRef.current.style.top = `${((now / 2600) % 1) * 100}%`;
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      style={{
        marginTop: 12,
        position: "relative",
        overflow: "hidden",
        minHeight: 280,
        display: "flex",
        alignItems: "center",
        padding: "0 28px",
        background: "var(--void)",
        border: "1px solid var(--surface-line)",
      }}
    >
      <div
        ref={scanRef}
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: "0%",
          height: 2,
          background: "linear-gradient(90deg, transparent, rgba(51,255,51,0.5), transparent)",
          boxShadow: "0 0 10px rgba(51,255,51,0.35)",
          pointerEvents: "none",
        }}
      />
      <div
        className="glow"
        style={{ fontFamily: "var(--mono)", fontSize: 20, color: "var(--green)", letterSpacing: "0.02em" }}
      >
        <span style={{ color: "var(--green-dim)" }}>&gt; </span>
        <span ref={textRef} />
        <span
          ref={cursorRef}
          aria-hidden
          style={{
            display: "inline-block",
            width: 10,
            height: 20,
            marginLeft: 3,
            background: "var(--green)",
            verticalAlign: "text-bottom",
            boxShadow: "0 0 8px var(--green)",
          }}
        />
      </div>
    </div>
  );
}
