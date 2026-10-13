import { CITIES, City, cityLabel, findCity, haversineKm, metroPop, nearestCity } from "./geo";
import { Region, regionWkt } from "./regions";
import * as mock from "./mock";

const BASE = process.env.QLOO_BASE_URL ?? "https://hackathon.api.qloo.com";
const KEY = process.env.QLOO_API_KEY;

export const qlooMode = (): "live" | "sample" => (KEY ? "live" : "sample");

/** Every Qloo request is logged so the UI can show exactly which calls drove a decision. */
export type QlooCall = { path: string; params: Record<string, string>; ms: number; count: number; mode: string };

type Params = Record<string, string | number | boolean | undefined>;

const cache = new Map<string, { at: number; data: unknown }>();

// The hackathon key rate-limits bursts, and the agent likes to scout several cities at once.
// Keep a few requests in flight and queue the rest.
const MAX_IN_FLIGHT = Number(process.env.QLOO_CONCURRENCY ?? 3);
let inFlight = 0;
const waiting: (() => void)[] = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((r) => waiting.push(r));
  inFlight++;
  try {
    return await fn();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}
const TTL = 1000 * 60 * 60 * 6;
const METRO_RADIUS_M = 30000;
export const LIVE_MUSIC_VENUE = "urn:tag:category:place:live_music_venue";

export class Qloo {
  calls: QlooCall[] = [];

  private async get(path: string, params: Params): Promise<any> {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") clean[k] = String(v);
    const qs = new URLSearchParams(clean).toString();
    const key = `${path}?${qs}`;
    const t0 = Date.now();
    const hit = cache.get(key);
    let data: any;
    if (hit && Date.now() - hit.at < TTL) {
      data = hit.data;
    } else if (!KEY) {
      data = mock.respond(path, clean);
    } else {
      const call = () => limited(() => fetch(`${BASE}${path}?${qs}`, { headers: { "X-Api-Key": KEY } }));
      let res = await call();
      // The hackathon gateway returns the odd 502/429 under load; backing off usually clears it.
      for (let i = 1; i <= 4 && (res.status === 429 || res.status >= 500); i++) {
        await new Promise((r) => setTimeout(r, 1500 * i));
        res = await call();
      }
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Qloo ${path} ${res.status}: ${body.slice(0, 200)}`);
      }
      data = await res.json();
      cache.set(key, { at: Date.now(), data });
    }
    const count =
      data?.results?.entities?.length ??
      data?.results?.heatmap?.length ??
      data?.results?.length ??
      data?.results?.tags?.length ??
      0;
    this.calls.push({ path, params: clean, ms: Date.now() - t0, count, mode: qlooMode() });
    return data;
  }

  /**
   * Qloo resolves free-text places loosely ("Richmond, VA" came back as Richmond Valley, Staten Island),
   * so known cities go in as a point from our own table plus a metro-sized radius.
   */
  private where(prefix: "signal.location" | "filter.location", city?: string): Params {
    if (!city) return {};
    const c = findCity(city);
    if (!c) return { [`${prefix}.query`]: city };
    return { [prefix]: `POINT(${c.lon} ${c.lat})`, [`${prefix}.radius`]: METRO_RADIUS_M };
  }

  async searchArtist(query: string) {
    const d = await this.get("/search", { query, types: "urn:entity:artist", take: 5 });
    const list: any[] = d?.results ?? [];
    // Search ranks famous near-matches first ("Greg Freeman" -> Greg Laswell); put exact names on top.
    const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const exact = (e: any) => norm(e.name ?? "") === norm(query);
    return [...list.filter(exact), ...list.filter((e) => !exact(e))].map(toEntity);
  }

  /** Audience age/gender skew for an artist's fans. */
  async audience(artistId: string) {
    const d = await this.get("/v2/insights", {
      "filter.type": "urn:demographics",
      "signal.interests.entities": artistId,
    });
    const row = d?.results?.demographics?.[0]?.query ?? {};
    return { age: row.age ?? {}, gender: row.gender ?? {} };
  }

  /**
   * Taste heatmap: where people whose taste matches this artist live, relative to everyone else.
   * Geohash cells are rolled up to the nearest city in our table.
   */
  async heatmap(artistId: string, region: Region) {
    // The live heatmap ignores take/page and returns every geohash cell in the polygon (~800 for the US) in one call.
    // affinity and popularity come back as percentiles across those cells.
    const d = await this.get("/v2/insights", {
      "filter.type": "urn:heatmap",
      "signal.interests.entities": artistId,
      "filter.location": regionWkt(region),
    });
    const cells: any[] = d?.results?.heatmap ?? [];
    const byCity = new Map<string, { city: City; aff: number[]; rank: number[]; pop: number[] }>();
    for (const cell of cells) {
      const lat = cell.location?.latitude ?? cell.location?.lat;
      const lon = cell.location?.longitude ?? cell.location?.lon;
      if (lat == null || lon == null) continue;
      const city = nearestCity(lat, lon);
      if (!city || !region.countries.includes(city.cc)) continue;
      const k = cityLabel(city);
      const row = byCity.get(k) ?? { city, aff: [], rank: [], pop: [] };
      row.aff.push(Number(cell.query?.affinity ?? 0));
      if (cell.query?.affinity_rank != null) row.rank.push(Number(cell.query.affinity_rank));
      row.pop.push(Number(cell.query?.popularity ?? 0));
      byCity.set(k, row);
    }
    const max = (xs: number[]) => xs.reduce((a, b) => Math.max(a, b), 0);
    return [...byCity.values()]
      .map(({ city, aff, rank, pop }) => ({
        city: cityLabel(city),
        lat: city.lat,
        lon: city.lon,
        population: metroPop(city),
        affinity: round(max(aff)) ?? 0,
        affinityRank: rank.length ? round(max(rank)) : undefined,
        popularity: round(max(pop)) ?? 0,
        cells: aff.length,
      }))
      .sort((a, b) => b.affinity - a.affinity);
  }

  /** Artists that share this artist's audience, optionally the ones that over-index in one city. */
  async similarArtists(artistId: string, city?: string, take = 8, maxPopularity?: number) {
    const d = await this.get("/v2/insights", {
      "filter.type": "urn:entity:artist",
      "signal.interests.entities": artistId,
      ...this.where("signal.location", city),
      "filter.exclude.entities": artistId,
      "filter.popularity.max": maxPopularity,
      take,
    });
    return (d?.results?.entities ?? []).map(toEntity);
  }

  /** Search takes the venue name alone; adding the city to the query text pulls in look-alikes from other countries. */
  async searchPlace(query: string, city?: string) {
    const c = city ? findCity(city) : undefined;
    const d = await this.get("/search", {
      query,
      types: "urn:entity:place",
      "filter.location": c ? `${c.lat},${c.lon}` : undefined,
      "filter.radius": c ? 30 : undefined,
      take: 3,
    });
    return ((d?.results ?? []) as any[]).map(toEntity);
  }

  /**
   * Acts whose audience is concentrated in a city (or in one venue's crowd), within a popularity band.
   * This is the promoter's side of the same data: who to book here next.
   */
  async artistsForCity(city: string, opts: { venueIds?: string[]; popMin?: number; popMax?: number; take?: number }) {
    // With rooms to go on, their crowds are the signal. A bare location signal drifts toward celebrities
    // who happen to be popular there (athletes, reality TV) rather than acts that tour.
    const venues = opts.venueIds?.filter(Boolean) ?? [];
    const d = await this.get("/v2/insights", {
      "filter.type": "urn:entity:artist",
      ...(venues.length ? {} : this.where("signal.location", city)),
      "signal.interests.entities": venues.join(",") || undefined,
      "filter.popularity.min": opts.popMin,
      "filter.popularity.max": opts.popMax,
      take: opts.take ?? 20,
    });
    return (d?.results?.entities ?? []).map(toEntity);
  }

  /** The city's live music rooms, by Qloo popularity. */
  async liveRooms(city: string, take = 5) {
    const d = await this.get("/v2/insights", {
      "filter.type": "urn:entity:place",
      ...this.where("filter.location", city),
      "filter.tags": LIVE_MUSIC_VENUE,
      take,
    });
    return (d?.results?.entities ?? []).map(toEntity);
  }

  async findTag(query: string, tagType?: string) {
    const d = await this.get("/v2/tags", { "filter.query": query, "filter.tag.types": tagType, take: 5 });
    return (d?.results?.tags ?? []).map((t: any) => ({ id: t.id ?? t.tag_id, name: t.name, type: t.type }));
  }

  /** Music venues in a city ranked by how well their crowd matches the artist's audience. */
  async venues(artistId: string, city: string, venueTagId?: string, take = 8, fanAge?: string) {
    const d = await this.get("/v2/insights", {
      "filter.type": "urn:entity:place",
      ...this.where("filter.location", city),
      "filter.tags": venueTagId,
      "signal.interests.entities": artistId,
      "signal.demographics.age": fanAge,
      take,
    });
    return (d?.results?.entities ?? []).map(toEntity);
  }

  /** What else this artist's fans in a given city love: used for promo partners and copy. */
  async localTaste(artistId: string, city: string, type: string, take = 5) {
    const d = await this.get("/v2/insights", {
      "filter.type": type,
      "signal.interests.entities": artistId,
      ...this.where(type === "urn:entity:place" ? "filter.location" : "signal.location", city),
      take,
    });
    return (d?.results?.entities ?? []).map(toEntity);
  }
}

export type QEntity = ReturnType<typeof toEntity>;

function toEntity(e: any) {
  const p = e?.properties ?? {};
  const tags: any[] = e?.tags ?? [];
  return {
    id: e?.entity_id ?? e?.id,
    name: e?.name,
    affinity: round(e?.query?.affinity),
    popularity: round(e?.popularity),
    genres: tags
      .filter((t) => String(t.type ?? t.tag_type ?? "").includes("genre"))
      .map((t) => t.name)
      .slice(0, 4),
    tags: tags.map((t) => t.name).filter(Boolean).slice(0, 6),
    address: p.address,
    lat: e?.location?.lat ?? p.geocode?.latitude,
    lon: e?.location?.lon ?? p.geocode?.longitude,
    image: p.image?.url ?? p.images?.[0]?.url,
    url: p.website ?? p.external?.website,
    mbid: p.external?.musicbrainz?.id as string | undefined,
  };
}

const round = (x: unknown) => (typeof x === "number" ? Math.round(x * 1000) / 1000 : undefined);

export { CITIES, findCity, haversineKm };
