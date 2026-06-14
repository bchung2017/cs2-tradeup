"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTradeup, isStatTrakName } from "@/lib/tradeup-context";
import { rarityHex } from "@/lib/display";
import type { InventoryItem } from "@/lib/steam";

type StatusClass = "ok" | "warn" | "err" | "dim";

type DeepToast =
  | { kind: "confirm" }
  | { kind: "progress"; done: number; total: number; status: string };

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

export default function InventoryPanel() {
  const [input, setInput] = useState("https://steamcommunity.com/profiles/76561198059693930");
  const [steamid, setSteamid] = useState<string | null>(null);
  const [status, setStatus] = useState<{ msg: string; cls: StatusClass } | null>(null);
  const [meta, setMeta] = useState<SnapshotMeta | null>(null);
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  // The input string of the currently loaded profile. The action button shows
  // SYNC while `input` matches this, and reverts to LOAD once the text is edited.
  const [loadedInput, setLoadedInput] = useState<string | null>(null);
  const [rarityFilter, setRarityFilter] = useState<string>("ALL");
  const [toast, setToast] = useState<DeepToast | null>(null);

  const steamidRef = useRef<string | null>(null);
  steamidRef.current = steamid;
  const deepAbort = useRef<AbortController | null>(null);

  const { slots, addFromInventory, setSteamid: setSharedSteamid } = useTradeup();
  const setMsg = useCallback((msg: string, cls: StatusClass = "dim") => setStatus({ msg, cls }), []);

  // Mirror the resolved profile to shared context so the trade-up header (left
  // side) can load this profile's avatar.
  useEffect(() => {
    setSharedSteamid(steamid);
  }, [steamid, setSharedSteamid]);

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
      const r = addFromInventory(it);
      if (r.ok) setMsg(`added // ${it.name ?? "item"}`, "ok");
      else setMsg(r.reason ?? "could not add", "warn");
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
      return;
    }
    const s = r.body as { steamid: string; count: number; items: InventoryItem[] };
    setMeta({ steamid: s.steamid, count: s.count });
    setItems(s.items);
  }, []);

  // Open the SSE deep-sync stream and drive the progress toast off its events.
  // Used for both a fresh start and resume (the engine skips already-cached floats).
  const runDeepSync = useCallback(async () => {
    const id = steamidRef.current;
    if (!id) return;
    setToast({ kind: "progress", done: 0, total: 0, status: "running" });
    const ac = new AbortController();
    deepAbort.current = ac;
    let last = { done: 0, total: 0 };
    try {
      const res = await fetch(`/api/deep-sync/${id}/run`, { method: "POST", signal: ac.signal });
      if (!res.ok || !res.body) {
        setMsg(`deep sync failed // ${res.status}`, "err");
        setToast(null);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          const ev = JSON.parse(line.slice(5).trim());
          if (ev.type === "start") {
            last = { done: 0, total: ev.total };
            setToast({ kind: "progress", done: 0, total: ev.total, status: "running" });
          } else if (ev.type === "item") {
            last = { done: ev.done, total: ev.total };
            setToast({ kind: "progress", done: ev.done, total: ev.total, status: "running" });
          } else if (ev.type === "halted") {
            setToast({ kind: "progress", done: last.done, total: last.total, status: ev.status });
            setMsg(`deep sync ${ev.status} // ${last.done}/${last.total}`, "warn");
          } else if (ev.type === "error") {
            setMsg(`deep sync error // ${ev.error}`, "err");
            setToast(null);
          } else if (ev.type === "done") {
            setMsg(`deep sync complete // ${ev.done}/${ev.total} floats`, "ok");
            setToast(null);
            await loadAndRender();
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setMsg(`deep sync error // ${(e as Error).message}`, "err");
    } finally {
      deepAbort.current = null;
    }
  }, [loadAndRender, setMsg]);

  // Control: pause/stop write the job status (engine halts next iteration);
  // stop also aborts the local stream and clears the toast.
  const controlDeep = useCallback(
    async (action: "pause" | "stop") => {
      const id = steamidRef.current;
      if (!id) return;
      await fetch(`/api/deep-sync/${id}/control`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      }).catch(() => {});
      if (action === "stop") {
        deepAbort.current?.abort();
        setToast(null);
        setMsg("deep sync stopped", "warn");
      }
    },
    [setMsg],
  );

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
        // No auto-toast on mount: the deep-sync toast only appears when the
        // user starts it (or while a run they started is active).
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
  // locked) the StatTrak state of the staged contract.
  const filtered = useMemo(() => {
    let out = available;
    if (effectiveRarity !== "ALL") out = out.filter((it) => it.rarity === effectiveRarity);
    if (lock) out = out.filter((it) => isStatTrakName(it.name) === lock.stattrak);
    return out;
  }, [available, effectiveRarity, lock]);

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
          <header>
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
            <button
              onClick={() => setToast({ kind: "confirm" })}
              disabled={!steamid || toast !== null}
              title="Resolve per-item float / paint via inspect links (slow, rate-limited)"
              className="hud"
              style={{
                background: "transparent",
                border: "1px solid var(--green-faint)",
                color: !steamid || toast !== null ? "var(--cream-dim)" : "var(--green-dim)",
                padding: "10px 14px",
                opacity: !steamid || toast !== null ? 0.5 : 1,
                cursor: !steamid || toast !== null ? "not-allowed" : "pointer",
                pointerEvents: !steamid || toast !== null ? "none" : "auto",
              }}
            >
              GET FLOATS
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
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
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
                      title={lockedRarity ? "Rarity locked by the staged contract" : `Show ${chip.label}`}
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
            {filtered.map((it) => (
              <div
                key={it.assetid}
                onClick={() => onItemClick(it)}
                title="Click to add to trade-up"
                style={{
                  background: "var(--surface)",
                  border: `4px solid ${rarityHex(it.rarity)}`,
                  padding: 12,
                  cursor: "pointer",
                }}
              >
                {it.icon_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={it.icon_url}
                    alt={it.name ?? "item"}
                    style={{ width: "100%", height: 90, objectFit: "contain" }}
                  />
                ) : (
                  <div style={{ height: 90 }} />
                )}
                <div style={{ fontSize: 12, lineHeight: 1.3, margin: "8px 0 4px" }}>
                  {it.name ?? "(unnamed)"}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <span className="hud hud-amber">{it.rarity ?? "—"}</span>
                  {/* Float is only known once a deep sync has resolved it. */}
                  {it.float != null && (
                    <span className="hud" style={{ color: "var(--amber)" }} title="Float (wear value)">
                      {it.float.toFixed(4)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {!busy && items && items.length === 0 && (
          <div className="hud" style={{ marginTop: 24 }}>
            NO SNAPSHOT — LOAD A PROFILE FIRST
          </div>
        )}
      </main>

      <DeepSyncToast
        toast={toast}
        onConfirm={() => runDeepSync()}
        onCancel={() => setToast(null)}
        onPause={() => controlDeep("pause")}
        onStop={() => controlDeep("stop")}
        onResume={() => runDeepSync()}
      />
    </>
  );
}

// Fixed-position deep-sync toast: a ⚠ confirm gate, then a live progress card
// with pause/stop while running and resume/stop once paused or interrupted.
function DeepSyncToast({
  toast,
  onConfirm,
  onCancel,
  onPause,
  onStop,
  onResume,
}: {
  toast: DeepToast | null;
  onConfirm: () => void;
  onCancel: () => void;
  onPause: () => void;
  onStop: () => void;
  onResume: () => void;
}) {
  if (!toast) return null;
  const running = toast.kind === "progress" && toast.status === "running";
  const pct = toast.kind === "progress" && toast.total > 0 ? (toast.done / toast.total) * 100 : 0;

  const btn = (label: string, onClick: () => void, accent: string): React.ReactNode => (
    <button
      onClick={onClick}
      className="hud"
      style={{
        background: "transparent",
        border: `1px solid ${accent}`,
        color: accent,
        padding: "7px 14px",
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      style={{
        position: "fixed",
        right: 24,
        bottom: 24,
        zIndex: 50,
        width: 320,
        background: "var(--surface)",
        border: "1px solid var(--surface-line)",
        boxShadow: "0 0 0 1px rgba(0,0,0,0.6), 0 10px 40px rgba(0,0,0,0.8)",
        padding: 16,
      }}
    >
      {toast.kind === "confirm" ? (
        <>
          <div className="hud hud-amber">⚠ DEEP SYNC</div>
          <div style={{ fontSize: 12, color: "var(--cream-dim)", margin: "8px 0 14px", lineHeight: 1.5 }}>
            Resolves every item&apos;s float &amp; paint via inspect links. This is slow and rate-limited —
            it runs in the background and you can pause or stop anytime.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {btn("START", onConfirm, "var(--green)")}
            {btn("CANCEL", onCancel, "var(--surface-line)")}
          </div>
        </>
      ) : (
        <>
          <div className="hud hud-ember">DEEP SYNC // {toast.status.toUpperCase()}</div>
          <div style={{ fontSize: 20, margin: "6px 0 10px", color: "var(--green)" }}>
            {toast.done}
            <span style={{ color: "var(--cream-dim)", fontSize: 14 }}> / {toast.total}</span>
          </div>
          <div style={{ height: 4, background: "var(--void)", border: "1px solid var(--surface-line)" }}>
            <div
              style={{
                height: "100%",
                width: `${pct}%`,
                background: "var(--green)",
                boxShadow: "0 0 6px var(--green)",
                transition: "width 0.2s ease",
              }}
            />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            {running ? btn("PAUSE", onPause, "var(--amber)") : btn("RESUME", onResume, "var(--green)")}
            {btn("STOP", onStop, "var(--loss)")}
          </div>
        </>
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
