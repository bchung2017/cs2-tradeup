/**
 * Cache service — controls over loader.db (snapshots, item floats, deep-sync
 * jobs). Stubs for now; fill these in to wire the real cache operations
 * (the app already has lib/steam.ts clearCache / cache report logic to reuse).
 */
import { notImplemented } from "../http";
import type { AdminRequest, AdminResult } from "../types";

export function cacheReport(_req: AdminRequest): AdminResult {
  return notImplemented("cache report");
}

export function cacheClear(_req: AdminRequest): AdminResult {
  return notImplemented("cache clear");
}
