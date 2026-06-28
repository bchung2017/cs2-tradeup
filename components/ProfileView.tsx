"use client";

// Profile view: resolve a Steam account, show its basic profile info + the
// profile picture sourced from the same community account as the trade
// inventory, and carry over previously-viewed profiles (persisted server-side,
// listed here as a switcher). Self-contained client island; the /profile page
// stays a server shell.
import { useCallback, useEffect, useState } from "react";

const LAST_KEY = "cs2:lastProfile";
const DEFAULT_INPUT = "https://steamcommunity.com/profiles/76561198059693930";

interface ProfileData {
  steamid: string;
  persona: string | null;
  avatar: string | null;
  profileUrl: string;
  onlineState: string | null;
  memberSince: string | null;
  firstSeen: number;
  lastSeen: number;
  inventory: { count: number; syncedAt: number } | null;
}

function ago(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export default function ProfileView() {
  const [input, setInput] = useState(DEFAULT_INPUT);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [list, setList] = useState<ProfileData[]>([]);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadProfile = useCallback(async (steamid: string) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/profile/${steamid}`);
      const j = await r.json();
      if (!r.ok) {
        setErr(j.error || `error ${r.status}`);
        return;
      }
      setProfile(j.profile);
      setStale(Boolean(j.stale));
      try {
        localStorage.setItem(LAST_KEY, steamid);
      } catch {}
      // refresh the carry-over list so the just-viewed profile floats to top
      void refreshList();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  const refreshList = useCallback(async () => {
    try {
      const r = await fetch("/api/profiles");
      const j = await r.json();
      if (r.ok) setList(j.profiles ?? []);
    } catch {}
  }, []);

  const resolveAndLoad = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
      const j = await r.json();
      if (!r.ok || !j.steamid) {
        setErr(j.error || "could not resolve");
        return;
      }
      await loadProfile(j.steamid);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [input, loadProfile]);

  // On mount: load carried-over profiles, then open the last-viewed one (or the
  // most recently seen) so the page shows something immediately.
  useEffect(() => {
    (async () => {
      const r = await fetch("/api/profiles").catch(() => null);
      const j = r && r.ok ? await r.json() : null;
      const profiles: ProfileData[] = j?.profiles ?? [];
      setList(profiles);
      let last: string | null = null;
      try {
        last = localStorage.getItem(LAST_KEY);
      } catch {}
      const pick = last ?? profiles[0]?.steamid ?? null;
      if (pick) void loadProfile(pick);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ padding: 24, maxWidth: 760 }}>
      <h1
        className="hud hud-ember glow"
        style={{ fontSize: 16, letterSpacing: "0.22em", margin: "0 0 16px" }}
      >
        Profile
      </h1>

      {/* resolver */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && resolveAndLoad()}
          placeholder="steamid64, vanity, or profile URL"
          spellCheck={false}
          style={{
            flex: 1,
            background: "var(--surface-2)",
            border: "1px solid var(--surface-line)",
            color: "var(--fg)",
            padding: "8px 10px",
            fontSize: 13,
          }}
        />
        <button
          type="button"
          onClick={resolveAndLoad}
          disabled={busy}
          style={btnStyle}
        >
          {busy ? "…" : "Load"}
        </button>
      </div>

      {err && (
        <div className="hud" style={{ color: "var(--loss)", marginBottom: 14 }}>
          {err}
        </div>
      )}

      {/* selected profile card */}
      {profile && (
        <div
          className="bracket"
          style={{
            display: "flex",
            gap: 18,
            padding: 18,
            background: "var(--surface)",
            border: "1px solid var(--surface-line)",
            marginBottom: 22,
          }}
        >
          {/* profile picture (from the trade-inventory account) */}
          <div style={{ flex: "0 0 auto" }}>
            {profile.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.avatar}
                alt={profile.persona ?? profile.steamid}
                width={96}
                height={96}
                style={{ border: "1px solid var(--surface-line)", display: "block" }}
              />
            ) : (
              <div
                className="hud"
                style={{
                  width: 96,
                  height: 96,
                  display: "grid",
                  placeItems: "center",
                  background: "var(--surface-2)",
                  border: "1px solid var(--surface-line)",
                  color: "var(--fg-faint)",
                }}
              >
                no pic
              </div>
            )}
          </div>

          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              className="glow"
              style={{ fontSize: 18, color: "var(--green-hot)", marginBottom: 4 }}
            >
              {profile.persona ?? "(unknown persona)"}
              {profile.onlineState && (
                <span
                  className="hud"
                  style={{
                    marginLeft: 10,
                    color:
                      profile.onlineState === "in-game"
                        ? "var(--green)"
                        : profile.onlineState === "online"
                          ? "var(--green-dim)"
                          : "var(--fg-faint)",
                  }}
                >
                  ● {profile.onlineState}
                </span>
              )}
            </div>

            <Row label="SteamID64" value={profile.steamid} />
            <Row
              label="Profile"
              value={
                <a href={profile.profileUrl} target="_blank" rel="noreferrer" style={{ color: "var(--green)" }}>
                  {profile.profileUrl.replace("https://", "")}
                </a>
              }
            />
            {profile.memberSince && <Row label="Member since" value={profile.memberSince} />}
            <Row
              label="Inventory"
              value={
                profile.inventory
                  ? `${profile.inventory.count} items · synced ${ago(profile.inventory.syncedAt)}`
                  : "not synced yet"
              }
            />
            <Row label="First seen" value={ago(profile.firstSeen)} />
            {stale && (
              <div className="hud" style={{ color: "var(--amber)", marginTop: 8 }}>
                Steam unreachable — showing carried-over copy
              </div>
            )}
          </div>
        </div>
      )}

      {/* carry-over switcher */}
      {list.length > 0 && (
        <>
          <div className="hud" style={{ marginBottom: 8 }}>
            Carried-over profiles ({list.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {list.map((p) => {
              const active = profile?.steamid === p.steamid;
              return (
                <button
                  key={p.steamid}
                  type="button"
                  className="card-hover"
                  onClick={() => loadProfile(p.steamid)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: 8,
                    textAlign: "left",
                    background: active ? "var(--surface-2)" : "var(--surface)",
                    border: `1px solid ${active ? "var(--green-dim)" : "var(--surface-line)"}`,
                    color: "var(--fg)",
                  }}
                >
                  {p.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.avatar} alt="" width={32} height={32} style={{ display: "block" }} />
                  ) : (
                    <div style={{ width: 32, height: 32, background: "var(--surface-2)" }} />
                  )}
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.persona ?? p.steamid}
                  </span>
                  <span className="hud" style={{ color: "var(--fg-faint)" }}>
                    {p.inventory ? `${p.inventory.count} items` : "—"}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 10, padding: "2px 0", fontSize: 13 }}>
      <span className="hud" style={{ flex: "0 0 110px", color: "var(--fg-dim)" }}>
        {label}
      </span>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{value}</span>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: "var(--surface-2)",
  border: "1px solid var(--surface-line)",
  color: "var(--green-hot)",
  padding: "8px 16px",
  fontSize: 13,
};
