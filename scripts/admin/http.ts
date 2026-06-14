/**
 * Transport-level helpers shared by the domain services: query-param coercion
 * and the standard "not built yet" result. These keep param parsing out of the
 * route table and out of the core service logic.
 */
import type { AdminRequest, AdminResult } from "./types";

/** Non-negative integer query param, falling back to a default. */
export function intParam(req: AdminRequest, key: string, fallback: number): number {
  const raw = req.query.get(key);
  // Guard: Number(null) and Number("") are both 0, which would silently
  // override the fallback (e.g. an absent ?limit syncing 0 items).
  if (raw === null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Non-negative integer query param, or undefined when absent/invalid. */
export function intParamOpt(req: AdminRequest, key: string): number | undefined {
  const raw = req.query.get(key);
  if (raw === null || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** String query param, or undefined when absent/empty. */
export function strParam(req: AdminRequest, key: string): string | undefined {
  const v = req.query.get(key);
  return v ? v : undefined;
}

/** Boolean query param: present and "1" → true. */
export function boolParam(req: AdminRequest, key: string): boolean {
  return req.query.get(key) === "1";
}

/** Standard "wired up but not built yet" response for stub handlers. */
export const notImplemented = (what: string): AdminResult => ({
  ok: false,
  error: `not implemented: ${what}`,
});
