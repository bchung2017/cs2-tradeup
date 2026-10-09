// Server-side reads of the Venture data files (see lib/ventures.ts). Missing
// files read as empty: the surface renders, with a line saying no run has
// happened yet.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExpiredFile, VenturesFile } from "@/lib/ventures";
import { loadSkinById, loadSkins } from "@/lib/data";

const DATA_DIR = join(/*turbopackIgnore: true*/ process.cwd(), "public", "data");

function read<T>(file: string, fallback: T): T {
  const p = join(DATA_DIR, file);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : fallback;
}

export const loadVentures = (): VenturesFile => read<VenturesFile>("ventures.json", { generatedAt: "", ventures: [] });
export const loadExpired = (): ExpiredFile => read<ExpiredFile>("ventures-expired.json", { rows: [] });

// Catalog images for the skins a page shows, keyed by skin id (market rows) or
// by skin name (longlist rows, which carry names). Only the skins on the page,
// so the client gets a few dozen URLs, not the 2,000-skin catalog.
export function imagesById(ids: Iterable<string>): Record<string, string> {
  const byId = loadSkinById();
  const out: Record<string, string> = {};
  for (const id of ids) {
    const img = byId.get(id)?.image;
    if (img) out[id] = img;
  }
  return out;
}

export function imagesByName(names: Iterable<string>): Record<string, string> {
  const want = new Set(names);
  const out: Record<string, string> = {};
  for (const s of loadSkins()) if (want.has(s.name) && s.image && !out[s.name]) out[s.name] = s.image;
  return out;
}
