/**
 * Catalog service — controls over the ByMykel skin catalog (public/data/
 * skins.json). Stubs for now; the refetch handler will run the same pull as
 * scripts/fetch-data.ts.
 */
import { notImplemented } from "../http";
import type { AdminRequest, AdminResult } from "../types";

export function catalogRefetch(_req: AdminRequest): AdminResult {
  return notImplemented("catalog refetch");
}

export function catalogStats(_req: AdminRequest): AdminResult {
  return notImplemented("catalog stats");
}
