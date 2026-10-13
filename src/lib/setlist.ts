// Recent shows from setlist.fm, so the agent knows where a band has already been and what size rooms it plays.
import { cityLabel, findCity, metroOf, nearestCity } from "./geo";

const KEY = process.env.SETLISTFM_API_KEY;
const cache = new Map<string, { at: number; shows: Show[] }>();

export type Show = { date: string; city: string; venue: string; lat?: number; lon?: number };

const toIso = (d: string) => d.split("-").reverse().join("-"); // setlist.fm dates are dd-MM-yyyy

async function get(path: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://api.setlist.fm/rest/1.0${path}`, {
      headers: { "x-api-key": KEY!, Accept: "application/json" },
    });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
      continue;
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`setlist.fm ${res.status}`);
    return res.json();
  }
  return null;
}

/** Shows since `sinceIso`, newest first, labelled with the same metro names the heatmap uses. */
export async function recentShows(mbid: string | undefined, name: string, sinceIso: string): Promise<Show[] | undefined> {
  if (!KEY) return undefined;
  const ck = `${mbid ?? name}|${sinceIso}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.shows;
  let id = mbid;
  if (!id) {
    const s = await get(`/search/artists?artistName=${encodeURIComponent(name)}&sort=relevance`);
    id = s?.artist?.[0]?.mbid;
    if (!id) return undefined;
  }
  const shows: Show[] = [];
  for (let p = 1; p <= 4; p++) {
    const d = await get(`/artist/${id}/setlists?p=${p}`);
    const list: any[] = d?.setlist ?? [];
    for (const s of list) {
      const date = toIso(s.eventDate ?? "");
      if (date < sinceIso) continue;
      const c = s.venue?.city;
      const lat = c?.coords?.lat;
      const lon = c?.coords?.long;
      const metro = lat != null && lon != null ? nearestCity(lat, lon) : undefined;
      const byName = c?.name ? findCity(`${c.name}, ${c.stateCode ?? c.country?.code ?? ""}`) : undefined;
      const city = metro ? cityLabel(metro) : byName ? cityLabel(metroOf(byName)) : [c?.name, c?.country?.code].filter(Boolean).join(", ");
      shows.push({ date, city, venue: s.venue?.name ?? "", lat, lon });
    }
    const oldest = list.length ? toIso(list[list.length - 1].eventDate) : "";
    if (list.length < 20 || oldest < sinceIso) break;
  }
  cache.set(ck, { at: Date.now(), shows });
  return shows;
}
