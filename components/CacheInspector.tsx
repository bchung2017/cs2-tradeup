"use client";

import { useCallback, useEffect, useState } from "react";
import type { CacheReport, JobReport, SnapshotReport } from "@/lib/steam";

const DOT: Record<string, string> = {
  ok: "var(--profit)",
  warn: "var(--amber)",
  corrupt: "var(--loss)",
};

function Dot({ health }: { health: string }) {
  return (
    <span
      title={health}
      style={{
        display: "inline-block",
        width: 9,
        height: 9,
        borderRadius: "50%",
        background: DOT[health] ?? "var(--cream-dim)",
        boxShadow: `0 0 6px ${DOT[health] ?? "transparent"}`,
      }}
    />
  );
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function age(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

const th: React.CSSProperties = { textAlign: "left", padding: "8px 10px" };
const td: React.CSSProperties = { padding: "8px 10px", borderTop: "1px solid var(--surface-line)" };

export default function CacheInspector() {
  const [report, setReport] = useState<CacheReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // `clearing` holds the scope mid-request ("all" or a steamid); `confirmAll`
  // gates the wipe behind a second click so it can't fire by accident.
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

  // Force-clear: no steamid wipes everything, otherwise just that snapshot.
  const clear = useCallback(
    async (steamid?: string) => {
      setClearing(steamid ?? "all");
      setError(null);
      try {
        const qs = steamid ? `?steamid=${encodeURIComponent(steamid)}` : "";
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

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: "40px 24px 80px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <span className="hud hud-ember">CACHE INSPECTOR</span>
          <h1
            className="glow"
            style={{
              fontFamily: "var(--mono)",
              fontWeight: 700,
              fontSize: 28,
              margin: "4px 0 0",
              color: "var(--green)",
            }}
          >
            <span style={{ color: "var(--green-dim)" }}>$ </span>
            cache
            <span style={{ color: "var(--green-faint)", fontWeight: 400 }}> --inspect</span>
          </h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={load}
            disabled={loading}
            className="hud"
            style={{
              background: "transparent",
              border: "1px solid var(--surface-line)",
              color: loading ? "var(--cream-dim)" : "var(--green)",
              padding: "8px 16px",
            }}
          >
            {loading ? "READING…" : "REFRESH"}
          </button>
          {confirmAll && (
            <button
              onClick={() => setConfirmAll(false)}
              className="hud"
              style={{
                background: "transparent",
                border: "1px solid var(--surface-line)",
                color: "var(--cream-dim)",
                padding: "8px 16px",
              }}
            >
              CANCEL
            </button>
          )}
          <button
            onClick={() => (confirmAll ? clear() : setConfirmAll(true))}
            disabled={clearing !== null}
            className="hud"
            title="Delete all snapshots, item floats, and deep-sync jobs from loader.db"
            style={{
              background: confirmAll ? "var(--loss)" : "transparent",
              border: "1px solid var(--loss)",
              color: confirmAll ? "var(--void)" : "var(--loss)",
              padding: "8px 16px",
            }}
          >
            {clearing === "all" ? "CLEARING…" : confirmAll ? "CONFIRM WIPE" : "CLEAR ALL"}
          </button>
        </div>
      </header>

      {report && (
        <div className="hud" style={{ marginTop: 12 }}>
          loader.db // {bytes(report.db.bytes)} //{" "}
          {report.db.files.map((f) => `${f.name.replace("loader.db", "db")}:${bytes(f.bytes)}`).join("  ")}
        </div>
      )}

      {error && (
        <div style={{ marginTop: 20, border: "1px solid var(--loss)", color: "var(--loss)", padding: "12px 14px", fontSize: 12 }}>
          ERROR · {error}
        </div>
      )}

      {report && (
        <>
          <Section title="SNAPSHOTS">
            {report.snapshots.length === 0 ? (
              <Empty>no snapshots cached</Empty>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr className="hud">
                    <th style={th}></th>
                    <th style={th}>STEAMID</th>
                    <th style={th}>AGE</th>
                    <th style={th}>SIZE</th>
                    <th style={th}>COUNT</th>
                    <th style={th}>FLOAT COVERAGE</th>
                    <th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {report.snapshots.map((s: SnapshotReport) => (
                    <tr key={s.steamid}>
                      <td style={td}>
                        <Dot health={s.health} />
                      </td>
                      <td style={td}>{s.steamid}</td>
                      <td style={td}>{age(s.fetchedAt)} ago</td>
                      <td style={td}>{bytes(s.bytes)}</td>
                      <td style={{ ...td, color: s.storedCount !== s.actualCount ? "var(--amber)" : undefined }}>
                        {s.parseOk ? `${s.actualCount}${s.storedCount !== s.actualCount ? ` / ${s.storedCount}?` : ""}` : "—"}
                      </td>
                      <td style={td}>
                        {s.parseOk ? `${s.covered} / ${s.inspectable} inspectable` : <span style={{ color: "var(--loss)" }}>CORRUPT — won&apos;t parse</span>}
                      </td>
                      <td style={{ ...td, textAlign: "right" }}>
                        <button
                          onClick={() => clear(s.steamid)}
                          disabled={clearing !== null}
                          title="Clear this profile's snapshot, floats, and job"
                          className="hud"
                          style={{
                            background: "transparent",
                            border: "1px solid var(--loss)",
                            color: "var(--loss)",
                            padding: "4px 10px",
                          }}
                        >
                          {clearing === s.steamid ? "…" : "CLEAR"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title="INTEGRITY">
            <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
              <Stat label="ITEM_META ROWS" value={String(report.meta.total)} />
              <Stat
                label="ORPHAN META"
                value={String(report.meta.orphans)}
                warn={report.meta.orphans > 0}
              />
              <Stat
                label="FLOAT OUT-OF-RANGE"
                value={String(report.meta.outOfRange)}
                warn={report.meta.outOfRange > 0}
              />
            </div>
          </Section>

          <Section title="DEEP SYNC JOBS">
            {report.jobs.length === 0 ? (
              <Empty>no jobs (deep sync not run yet)</Empty>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr className="hud">
                    <th style={th}></th>
                    <th style={th}>STEAMID</th>
                    <th style={th}>STATUS</th>
                    <th style={th}>PROGRESS</th>
                    <th style={th}>HEARTBEAT</th>
                  </tr>
                </thead>
                <tbody>
                  {report.jobs.map((j: JobReport) => (
                    <tr key={j.steamid}>
                      <td style={td}>
                        <Dot health={j.health} />
                      </td>
                      <td style={td}>{j.steamid}</td>
                      <td style={td}>{j.status}</td>
                      <td style={td}>
                        {j.done} / {j.total}
                      </td>
                      <td style={td}>{age(j.updated_at)} ago</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        </>
      )}
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 28, border: "1px solid var(--surface-line)", background: "var(--surface)" }}>
      <div className="hud hud-ember" style={{ padding: "10px 12px", borderBottom: "1px solid var(--surface-line)" }}>
        {title}
      </div>
      <div style={{ padding: 4 }}>{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="hud" style={{ padding: "14px 10px" }}>
      {children}
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={{ padding: "12px 10px" }}>
      <div className="hud">{label}</div>
      <div style={{ fontSize: 22, marginTop: 2, color: warn ? "var(--amber)" : "var(--cream)" }}>{value}</div>
    </div>
  );
}
