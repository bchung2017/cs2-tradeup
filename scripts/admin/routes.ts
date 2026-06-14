/**
 * Admin control-panel route table — declarative mapping only.
 *
 * Each row is transport + UI metadata plus a reference to a backend handler in
 * services/*. There is NO business logic or param parsing here: adding a row
 * surfaces a button on the dashboard, and the handler lives with its domain.
 *
 * Contracts (AdminRoute, AdminResult, SECTIONS) live in ./types.
 */
import { cacheClear, cacheReport } from "./services/cache";
import { catalogRefetch, catalogStats } from "./services/catalog";
import { priceStatusRoute, stopSyncRoute, syncPricesRoute } from "./services/pricing";
import { systemStatus } from "./services/system";
import type { AdminRoute } from "./types";

export const ROUTES: AdminRoute[] = [
  // ── Pricing ──────────────────────────────────────────────────────────
  {
    method: "POST",
    path: "/api/pricing/sync",
    label: "Sync all prices",
    section: "Pricing",
    hint: "Market average: pulls all CSGOTrader feeds (steam+skinport+buff163), averages each item, stores the blend + per-source breakdown. One shot, seconds. Query: ?providers=steam,skinport &force=1 &dryRun=1 &source=steam-direct (per-item fallback).",
    handler: syncPricesRoute,
  },
  {
    method: "POST",
    path: "/api/pricing/stop",
    label: "Stop sync",
    section: "Pricing",
    hint: "Cancel a running price sync after the current request. Progress so far is kept.",
    danger: true,
    handler: stopSyncRoute,
  },
  {
    method: "GET",
    path: "/api/pricing/status",
    label: "Price data status",
    section: "Pricing",
    hint: "Source, real-vs-placeholder coverage, live job progress, and age of the price table.",
    handler: priceStatusRoute,
  },
  // ── Cache ────────────────────────────────────────────────────────────
  {
    method: "GET",
    path: "/api/cache/report",
    label: "Inspect cache",
    section: "Cache",
    hint: "Snapshot/meta/job health from loader.db.",
    handler: cacheReport,
  },
  {
    method: "POST",
    path: "/api/cache/clear",
    label: "Clear all cache",
    section: "Cache",
    hint: "Wipe snapshots, floats, and deep-sync jobs.",
    danger: true,
    handler: cacheClear,
  },
  // ── Catalog ──────────────────────────────────────────────────────────
  {
    method: "POST",
    path: "/api/catalog/refetch",
    label: "Re-fetch catalog",
    section: "Catalog",
    hint: "Run the ByMykel skins pull (equivalent to npm run fetch-data).",
    handler: catalogRefetch,
  },
  {
    method: "GET",
    path: "/api/catalog/stats",
    label: "Catalog stats",
    section: "Catalog",
    hint: "Skin / price-entry counts and last write time.",
    handler: catalogStats,
  },
  // ── System ───────────────────────────────────────────────────────────
  {
    method: "GET",
    path: "/api/system/status",
    label: "Status",
    section: "System",
    hint: "Process uptime, DB size, port bindings.",
    handler: systemStatus,
  },
];
