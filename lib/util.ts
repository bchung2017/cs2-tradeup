// Small pure helpers shared across client islands. No DOM/Node/type-catalog
// deps, so this is safe to import from anywhere (canvas components included).

/** Linear interpolation between a and b at t∈[0,1]. */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Numeric compare with a fixed direction; null/undefined always sink last
 * regardless of direction (an unpriced / floatless / unranked item has no
 * meaningful position in the ordering, so it trails either way).
 */
export function numCompare(
  a: number | null | undefined,
  b: number | null | undefined,
  dir: 1 | -1,
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return (a - b) * dir;
}
