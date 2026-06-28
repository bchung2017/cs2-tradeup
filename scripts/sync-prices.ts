/**
 * One-off price sync (no admin server): pulls the CSGOTrader bulk dumps for the
 * configured providers, market-averages them, and writes public/data/prices.json.
 * force:true refreshes the whole table with current prices.
 *
 * Run: npm run sync-prices
 */
import { BULK_PROVIDERS } from "./admin/services/price-sources";
import { syncMarketAverage } from "./admin/services/pricing";

async function main() {
  const res = await syncMarketAverage({ providers: BULK_PROVIDERS, force: true, dryRun: false });
  console.log(JSON.stringify(res, null, 2));
  if (!res.ok) process.exit(1);
}
main();
