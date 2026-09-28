/**
 * Headless market-average price sync.
 *
 *   npx tsx scripts/sync-prices.ts [--force] [--dry-run]
 *                                  [--providers steam,skinport] [--tag st] [--wear "Factory New"]
 *
 * Same code path as the admin server's "Sync all prices" control — it calls
 * syncMarketAverage() directly instead of going through HTTP. That matters
 * because the admin server binds to 127.0.0.1 and exists only on a developer's
 * machine, so it cannot be driven from CI or from a phone. This can.
 *
 * --force re-prices keys that already carry a `source`. Without it the sync
 * skips them (services/pricing.ts), which is why an un-forced run reports
 * `lastSyncUpdated: 0` while still moving `lastSync`.
 *
 * Writes public/data/prices.json + prices.meta.json. Exits non-zero if every
 * provider feed failed, so CI surfaces a dead upstream instead of silently
 * committing nothing. See .github/workflows/sync-prices.yml.
 */
import { syncMarketAverage } from "./admin/services/pricing";
import { BULK_PROVIDERS, type BulkProvider } from "./admin/services/price-sources";

const argv = process.argv.slice(2);
const flag = (k: string) => argv.includes(`--${k}`);
const val = (k: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const requested = (val("providers") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter((s): s is BulkProvider => (BULK_PROVIDERS as readonly string[]).includes(s));

async function main() {
  const res = await syncMarketAverage({
    providers: requested, // [] -> all bulk providers
    tag: val("tag"),
    wear: val("wear"),
    force: flag("force"),
    dryRun: flag("dry-run"),
  });
  console.log(JSON.stringify(res, null, 2));
  process.exit(res.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
