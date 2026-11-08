"use client";

// The homepage's controls for the tour into the Venture Studios headquarters
// (the camera work is in components/circuit/lounge3d.ts). It sends
// "lounge:go" with a stop and follows "lounge:tour" for where the camera is:
//   at the pool's edge   Next →
//   in the lobby         Take the elevator · ← Back outside
//   on floor 1           Take the elevator (down to the lobby)
// The elevator panel lists all 34 floors; only floor 1 is open.
import { useEffect, useState } from "react";

type Stop = "plaza" | "lobby" | "floor1";
type Tour = { stop: Stop; busy: boolean; ready: boolean; ride?: { from: string; to: string } };

const FLOORS = 34;
const go = (stop: Stop) => dispatchEvent(new CustomEvent("lounge:go", { detail: stop }));

export default function LoungeTour() {
  const [tour, setTour] = useState<Tour | null>(null);
  const [panel, setPanel] = useState(false);
  const [rideAt, setRideAt] = useState<string | null>(null);

  useEffect(() => {
    const last = (window as unknown as { __loungeTour?: Tour }).__loungeTour;
    if (last) setTour(last);
    const on = (e: Event) => setTour((e as CustomEvent<Tour>).detail);
    addEventListener("lounge:tour", on);
    return () => removeEventListener("lounge:tour", on);
  }, []);

  // the floor indicator during a ride: the floor you left, then where you're going
  useEffect(() => {
    if (!tour?.busy || !tour.ride) { setRideAt(null); return; }
    const { from, to } = tour.ride;
    setRideAt(from);
    const a = setTimeout(() => setRideAt(to), 7400);
    const b = setTimeout(() => setRideAt(null), 10500);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [tour]);

  if (!tour?.ready) return null;
  const here = tour.stop;
  const choose = (stop: Stop) => { setPanel(false); go(stop); };
  const up = tour.ride ? tour.ride.to !== "L" : true;

  return (
    <div className="tour" aria-live="polite">
      {rideAt && (
        <div className="tour-indicator hud">
          <span>{up ? "▲" : "▼"}</span> {rideAt}
        </div>
      )}
      {!tour.busy && here !== "plaza" && (
        <div className="tour-where hud">
          {here === "lobby" ? "LOBBY · VENTURE STUDIOS HQ" : "FLOOR 1 · VENTURE STUDIOS · CS2 DEPARTMENT"}
        </div>
      )}
      {!tour.busy && (
        <div className="tour-actions">
          {here === "plaza" && <button className="tour-btn tour-btn--main" onClick={() => go("lobby")}>Next →</button>}
          {here === "lobby" && <button className="tour-btn" onClick={() => go("plaza")}>← Back outside</button>}
          {here !== "plaza" && <button className="tour-btn tour-btn--main" onClick={() => setPanel(true)}>Take the elevator</button>}
        </div>
      )}
      {panel && !tour.busy && (
        <div className="tour-panel" role="dialog" aria-label="Elevator">
          <div className="tour-panel__head">
            <span className="hud">VENTURE STUDIOS HQ</span>
            <button className="tour-panel__x" onClick={() => setPanel(false)} aria-label="Close">×</button>
          </div>
          <div className="tour-floors">
            {Array.from({ length: FLOORS }, (_, i) => FLOORS - i).map((n) => {
              const open = n === 1;
              const current = here === "floor1" && n === 1;
              return (
                <button key={n} className={`tour-floor${open ? " is-open" : ""}${current ? " is-here" : ""}`}
                  disabled={!open || current} title={open ? "Venture Studios · CS2 Department" : "Not open yet"}
                  onClick={() => choose("floor1")}>{n}</button>
              );
            })}
            <button className={`tour-floor tour-floor--lobby is-open${here === "lobby" ? " is-here" : ""}`}
              disabled={here === "lobby"} title="Lobby" onClick={() => choose("lobby")}>L</button>
          </div>
          <ul className="tour-legend">
            <li><b>1</b> Venture Studios · CS2 Department</li>
            <li><b>L</b> Lobby</li>
            <li className="dim">Floors 2 – 34 aren&apos;t open yet</li>
          </ul>
        </div>
      )}
    </div>
  );
}
