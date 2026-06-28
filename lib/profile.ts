// Steam profile loader + carry-over store. The profile picture and basic info
// come from the same public steamcommunity.com account that owns the trade
// inventory (the keyless `?xml=1` endpoint the avatar route already uses), so a
// profile resolves even when the inventory itself is private. Fetched profiles
// are persisted to the `profiles` table in loader.db (see lib/steam.ts) so a
// previously-viewed profile carries over across restarts.

import { getDb, getSnapshot, SteamError } from "@/lib/steam";

// What the community XML gives us, normalized.
export interface ProfileInfo {
  steamid: string;
  persona: string | null;
  avatar: string | null; // full-size avatar URL
  profileUrl: string;
  onlineState: string | null; // "online" | "offline" | "in-game"
  memberSince: string | null; // e.g. "March 5, 2011" (absent on bare profiles)
}

// A persisted profile + the times we first/last saw it.
export interface StoredProfile extends ProfileInfo {
  firstSeen: number;
  lastSeen: number;
}

// Profile enriched with a one-glance inventory summary from the latest snapshot.
export interface ProfileWithInventory extends StoredProfile {
  inventory: { count: number; syncedAt: number } | null;
}

// Pull one tag's text, handling both `<t><![CDATA[x]]></t>` and `<t>x</t>`.
function tag(xml: string, name: string): string | null {
  const m =
    xml.match(new RegExp(`<${name}>\\s*<!\\[CDATA\\[(.*?)\\]\\]>\\s*</${name}>`, "s")) ??
    xml.match(new RegExp(`<${name}>(.*?)</${name}>`, "s"));
  const v = m?.[1]?.trim();
  return v ? v : null;
}

// Fetch + parse the public community profile XML. Throws SteamError on transport
// or parse failure so routes can fall back to the stored copy.
export async function fetchSteamProfile(steamid: string): Promise<ProfileInfo> {
  let r: Response;
  try {
    r = await fetch(`https://steamcommunity.com/profiles/${steamid}?xml=1`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
  } catch (e) {
    throw new SteamError("UPSTREAM", (e as Error).message);
  }
  if (!r.ok) throw new SteamError("UPSTREAM", `profile xml http ${r.status}`);
  const xml = await r.text();
  const id = tag(xml, "steamID64") ?? steamid;
  return {
    steamid: id,
    persona: tag(xml, "steamID"),
    avatar: tag(xml, "avatarFull") ?? tag(xml, "avatarMedium") ?? tag(xml, "avatarIcon"),
    profileUrl: `https://steamcommunity.com/profiles/${id}`,
    onlineState: tag(xml, "onlineState"),
    memberSince: tag(xml, "memberSince"),
  };
}

// Persist (carry over) a fetched profile: stamp last_seen now, keep first_seen.
export function upsertProfile(p: ProfileInfo): StoredProfile {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO profiles(steamid, persona, avatar, profile_url, online_state, member_since, first_seen, last_seen)
       VALUES(@steamid, @persona, @avatar, @profileUrl, @onlineState, @memberSince, @now, @now)
     ON CONFLICT(steamid) DO UPDATE SET
       persona=excluded.persona,
       avatar=excluded.avatar,
       profile_url=excluded.profile_url,
       online_state=excluded.online_state,
       member_since=COALESCE(excluded.member_since, profiles.member_since),
       last_seen=excluded.last_seen`,
  ).run({ ...p, now });
  return getProfile(p.steamid)!;
}

function rowToStored(r: ProfileRow): StoredProfile {
  return {
    steamid: r.steamid,
    persona: r.persona,
    avatar: r.avatar,
    profileUrl: r.profile_url,
    onlineState: r.online_state,
    memberSince: r.member_since,
    firstSeen: r.first_seen,
    lastSeen: r.last_seen,
  };
}

interface ProfileRow {
  steamid: string;
  persona: string | null;
  avatar: string | null;
  profile_url: string;
  online_state: string | null;
  member_since: string | null;
  first_seen: number;
  last_seen: number;
}

export function getProfile(steamid: string): StoredProfile | null {
  const row = getDb().prepare("SELECT * FROM profiles WHERE steamid=?").get(steamid) as
    | ProfileRow
    | undefined;
  return row ? rowToStored(row) : null;
}

// All carried-over profiles, most-recently-seen first, each with its inventory
// summary so the picker can show item counts without a second round-trip.
export function listProfiles(): ProfileWithInventory[] {
  const rows = getDb()
    .prepare("SELECT * FROM profiles ORDER BY last_seen DESC")
    .all() as ProfileRow[];
  return rows.map((r) => withInventory(rowToStored(r)));
}

// Attach the latest inventory snapshot summary (count + sync time) if one exists.
export function withInventory(p: StoredProfile): ProfileWithInventory {
  const snap = getSnapshot(p.steamid);
  return {
    ...p,
    inventory: snap ? { count: snap.count, syncedAt: snap.fetchedAt } : null,
  };
}
