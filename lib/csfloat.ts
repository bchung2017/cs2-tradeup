// CSFloat client — the only source with FLOAT-INDEXED listing prices, which is
// what the spam solver needs to price the "steering" inputs (cheapest skin UNDER
// a float ceiling). Sequential + rate-limited so we stay polite to the API.
//
// The key lives in .env.local (gitignored). Next loads it for routes; for
// standalone scripts we fall back to parsing the file directly.
import { readFileSync } from "node:fs";
import { join } from "node:path";

let cachedKey: string | null | undefined;
function apiKey(): string | null {
  if (cachedKey !== undefined) return cachedKey;
  let k = process.env.CSFLOAT_API_KEY ?? null;
  if (!k) {
    try {
      const m = readFileSync(join(process.cwd(), ".env.local"), "utf8").match(/^CSFLOAT_API_KEY=(.+)$/m);
      if (m) k = m[1].trim();
    } catch {}
  }
  cachedKey = k;
  return k;
}

export function hasCsfloatKey(): boolean {
  return !!apiKey();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// global sequential queue with a min gap between calls (CSFloat is strict — a
// generous gap + 429 backoff keeps a full sync from getting throttled to nulls).
let chain: Promise<unknown> = Promise.resolve();
let gapMs = 500;
function throttle<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(() => sleep(gapMs)).then(fn);
  chain = run.catch(() => {});
  return run as Promise<T>;
}

/** Cheapest buy-now listing (USD) for a market name at/under maxFloat — null if
 *  none / no key / error. Backs off (and slows the whole queue) on 429. */
export async function cheapestUnderFloat(marketHashName: string, maxFloat: number): Promise<number | null> {
  const k = apiKey();
  if (!k) return null;
  const url =
    `https://csfloat.com/api/v1/listings?market_hash_name=${encodeURIComponent(marketHashName)}` +
    `&max_float=${maxFloat}&sort_by=lowest_price&limit=1&type=buy_now`;
  return throttle(async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(url, { headers: { Authorization: k } });
        if (res.status === 429) {
          gapMs = Math.min(gapMs * 1.5, 4000); // permanently slow down
          await sleep(2000 * (attempt + 1));
          continue;
        }
        if (!res.ok) return null;
        const j = (await res.json()) as unknown;
        const arr = Array.isArray(j) ? j : ((j as { data?: unknown[] }).data ?? []);
        const cents = (arr[0] as { price?: number } | undefined)?.price;
        return typeof cents === "number" ? cents / 100 : null;
      } catch {
        await sleep(500);
      }
    }
    return null;
  });
}
