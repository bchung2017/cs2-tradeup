/**
 * Doppler / Gamma Doppler per-phase prices into public/data/prices.json, from
 * the CSGOTrader Buff163 + CSFloat feeds (lib/phase-prices.ts). The full
 * market-average sync runs this too; this is the standalone pass.
 *
 *   npx tsx scripts/sync-phase-prices.ts [--dry-run]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PriceTable, Skin } from "@/types/cs2";
import { FEEDS, loadFeed } from "@/lib/third-party-feeds";
import { applyPhasePrices } from "@/lib/phase-prices";

const DATA = join(process.cwd(), "public", "data");
const skins = JSON.parse(readFileSync(join(DATA, "skins.json"), "utf8")) as Skin[];
const prices = JSON.parse(readFileSync(join(DATA, "prices.json"), "utf8")) as PriceTable;
const res = applyPhasePrices(prices, skins, FEEDS.map(loadFeed));
if (!process.argv.includes("--dry-run")) writeFileSync(join(DATA, "prices.json"), JSON.stringify(prices));
console.log(JSON.stringify(res));
if (!res.updated) process.exit(1);
