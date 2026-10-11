// Outcome-donut pieces shared by the Simulator's results and Venture rows, so
// both draw the same chart: slice colors, slice geometry, and the ROI color
// spectrum.

// Distinct hues for pie slices (output skins share one rarity, so we can't color
// by rarity — use a fixed high-contrast palette instead).
export const PIE_COLORS = [
  "#4b69ff", "#eb4b4b", "#2ecc71", "#e4ae39", "#d32ce6", "#1abc9c",
  "#8847ff", "#5e98d9", "#f39c12", "#16a085", "#e74c3c", "#9b59b6",
];

function polar(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

// A pie wedge from startDeg to endDeg (0 = 12 o'clock, clockwise). A full
// circle can't be one arc, so callers draw a <circle> for a single outcome.
export function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const [sx, sy] = polar(cx, cy, r, endDeg);
  const [ex, ey] = polar(cx, cy, r, startDeg);
  const large = endDeg - startDeg <= 180 ? 0 : 1;
  return `M ${cx} ${cy} L ${sx} ${sy} A ${r} ${r} 0 ${large} 0 ${ex} ${ey} Z`;
}

// Map an outcome's ROI to a red→yellow→green spectrum, yellow at break-even.
// −100% (wipeout) → red, 0% → yellow, +100% or better → green; clamped past ±100%.
export function roiColor(roi: number | null): string {
  if (roi == null) return "var(--cream-dim)";
  const t = Math.max(-1, Math.min(1, roi / 100));
  const hue = 60 + t * 60; // 0 red · 60 yellow · 120 green
  return `hsl(${Math.round(hue)}, 85%, 58%)`;
}
