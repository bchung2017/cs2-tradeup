// Server-side reads of the Venture data files (see lib/ventures.ts). Missing
// files read as empty: the surface renders, with a line saying no run has
// happened yet.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExpiredFile, VenturesFile } from "@/lib/ventures";

const DATA_DIR = join(/*turbopackIgnore: true*/ process.cwd(), "public", "data");

function read<T>(file: string, fallback: T): T {
  const p = join(DATA_DIR, file);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : fallback;
}

export const loadVentures = (): VenturesFile => read<VenturesFile>("ventures.json", { generatedAt: "", ventures: [] });
export const loadExpired = (): ExpiredFile => read<ExpiredFile>("ventures-expired.json", { rows: [] });
