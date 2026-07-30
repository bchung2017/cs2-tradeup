"use client";

import { useCallback, useEffect, useState } from "react";
import { useTradeup } from "@/lib/tradeup-context";
import type { CacheReport } from "@/lib/steam";

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

const th: React.CSSProperties = { textAlign: "left", padding: "8px 10px" };
const td: React.CSSProperties = { padding: "8px 10px", borderTop: "1px solid var(--surface-line)" };

export default function Profile() {
  const { steamid } = useTradeup();
  const [report, setReport] = useState<CacheReport | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/cache", { cache: "no-store" });
      if (!r.ok) throw new Error(`http ${r.status}`);
      setReport((await r.json()) as CacheReport);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(
    async (id?: string) => {
      setClearing(id ?? "all");
      setError(null);
      try {
        const qs = id ? `?steamid=${encodeURIComponent(id)}` : "";
        const r = await fetch(`/api/cache${qs}`, { method: "DELETE" });
        if (!r.ok) throw new Error(`http ${r.status}`);
        setConfirmAll(false);
        await load();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setClearing(null);
      }
    },
    [load],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!steamid) {
      setAvatar(null);
      return;
    }
    let live = true;
    fetch(`/api/avatar/${steamid}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (live && d?.avatar) setAvatar(d.avatar);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [steamid]);

  const profiles = report?.snapshots ?? [];
  const active = steamid ? profiles.find((p) => p.steamid === steamid) : undefined;

  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: "40px 24px 80px", position: "relative", zIndex: 1 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <span className="hud hud-ember">PROFILE</span>
          <h1
            className="glow"
            style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 28, margin: "4px 0 0", color: "var(--green)" }}
          >
            <span style={{ color: "var(--green-dim)" }}>$ </span>
            profile
          </h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={load}
            disabled={loading}
            className="hud"
            style={{ background: "transparent", border: "1px solid var(--surface-line)", color: loading ? "var(--cream-dim)" : "var(--green)", padding: "8px 16px" }}
          >
            {loading ? "REFRESHING…" : "REFRESH"}
          </button>
          {confirmAll && (
            <button
              onClick={() => setConfirmAll(false)}
              className="hud"
              style={{ background: "transparent", border: "1px solid var(--surface-line)", color: "var(--cream-dim)", padding: "8px 16px" }}
            >
              CANCEL
            </button>
          )}
          <button
            onClick={() => (confirmAll ? clear() : setConfirmAll(true))}
            disabled={clearing !== null || profiles.length === 0}
            className="hud"
            title="Forget every synced profile"
            style={{ background: confirmAll ? "var(--loss)" : "transparent", border: "1px solid var(--loss)", color: confirmAll ? "var(--void)" : "var(--loss)", padding: "8px 16px" }}
          >
            {clearing === "all" ? "CLEARING…" : confirmAll ? "CONFIRM" : "FORGET ALL"}
          </button>
        </div>
      </header>

      <section
        style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 16, padding: "16px 18px", border: "1px solid var(--surface-line)", background: "var(--surface)" }}
      >
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt="" width={64} height={64} style={{ width: 64, height: 64, borderRadius: "50%", border: "1px solid var(--surface-line)", objectFit: "cover" }} />
        ) : (
          <div style={{ width: 64, height: 64, borderRadius: "50%", border: "1px dashed var(--surface-line)" }} />
        )}
        <div style={{ minWidth: 0 }}>
          {steamid ? (
            <>
              <div className="hud">STEAM PROFILE</div>
              <a
                href={`https://steamcommunity.com/profiles/${steamid}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--cream)", fontSize: 15, textDecoration: "none" }}
              >
                {steamid}
              </a>
              <div className="hud" style={{ marginTop: 6, color: "var(--fg-dim)" }}>
                {active ? `${active.actualCount ?? active.storedCount ?? 0} items · synced ${ago(active.fetchedAt)}` : "not synced yet"}
              </div>
            </>
          ) : (
            <div style={{ color: "var(--fg-dim)", fontSize: 14 }}>No profile loaded — load one from the console.</div>
          )}
        </div>
      </section>

      {error && (
        <div style={{ marginTop: 16, border: "1px solid var(--loss)", color: "var(--loss)", padding: "12px 14px", fontSize: 12 }}>{error}</div>
      )}

      <section style={{ marginTop: 24, border: "1px solid var(--surface-line)", background: "var(--surface)" }}>
        <div className="hud hud-ember" style={{ padding: "10px 12px", borderBottom: "1px solid var(--surface-line)" }}>
          SYNCED PROFILES
        </div>
        {profiles.length === 0 ? (
          <div className="hud" style={{ padding: "14px 12px" }}>none yet — load a profile from the console</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr className="hud">
                <th style={th}>PROFILE</th>
                <th style={th}>ITEMS</th>
                <th style={th}>LAST SYNCED</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.steamid}>
                  <td style={td}>
                    {p.steamid}
                    {p.steamid === steamid && <span style={{ color: "var(--green-dim)" }}> · you</span>}
                  </td>
                  <td style={td}>{p.actualCount ?? p.storedCount ?? "—"}</td>
                  <td style={td}>{ago(p.fetchedAt)}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <button
                      onClick={() => clear(p.steamid)}
                      disabled={clearing !== null}
                      className="hud"
                      style={{ background: "transparent", border: "1px solid var(--loss)", color: "var(--loss)", padding: "4px 10px" }}
                    >
                      {clearing === p.steamid ? "…" : "FORGET"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
