import { CITIES, City, cityLabel, findCity, haversineKm, nearestCity } from "./geo";
import { Region, regionWkt } from "./regions";
import * as mock from "./mock";

const BASE = process.env.QLOO_BASE_URL ?? "https://hackathon.api.qloo.com";
const KEY = process.env.QLOO_API_KEY;

export const qlooMode = (): "live" | "sample" => (KEY ? "live" : "sample");

/** Every Qloo request is logged so the UI can show exactly which calls drove a decision. */
export type QlooCall = { path: string; params: Record<string, string>; ms: number; count: number; mode: string };

type Params = Record<string, string | number | boolean | undefined>;

const cache = new Map<string, { at: number; data: unknown }>();
const TTL = 1000 * 60 * 60 * 6;

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
      const res = await fetch(`${BASE}${path}?${qs}`, { headers: { "X-Api-Key": KEY } });
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

  async searchArtist(query: string) {
    const d = await this.get("/search", { query, types: "urn:entity:artist", take: 5 });
    const list: any[] = d?.results ?? [];
    return list.map(toEntity);
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
    const d = await this.get("/v2/insights", {
      "filter.type": "urn:heatmap",
      "signal.interests.entities": artistId,
      "filter.location": regionWkt(region),
      take: 50,
    });
    const cells: any[] = d?.results?.heatmap ?? [];
    const byCity = new Map<string, { city: City; aff: number[]; pop: number[] }>();
    for (const cell of cells) {
      const lat = cell.location?.latitude ?? cell.location?.lat;
      const lon = cell.location?.longitude ?? cell.location?.lon;
      if (lat == null || lon == null) continue;
      const city = nearestCity(lat, lon);
      if (!city || !region.countries.includes(city.cc)) continue;
      const k = cityLabel(city);
      const row = byCity.get(k) ?? { city, aff: [], pop: [] };
      row.aff.push(Number(cell.query?.affinity ?? cell.query?.affinity_rank ?? 0));
      row.pop.push(Number(cell.query?.popularity ?? 0));
      byCity.set(k, row);
    }
    const max = (xs: number[]) => xs.reduce((a, b) => Math.max(a, b), 0);
    return [...byCity.values()]
      .map(({ city, aff, pop }) => ({
        city: cityLabel(city),
        lat: city.lat,
        lon: city.lon,
        population: city.pop,
        affinity: round(max(aff)) ?? 0,
        popularity: round(max(pop)) ?? 0,
        cells: aff.length,
      }))
      .sort((a, b) => b.affinity - a.affinity);
  }

  /** Artists that share this artist's audience, optionally the ones that over-index in one city. */
  async similarArtists(artistId: string, city?: string, take = 8) {
    const d = await this.get("/v2/insights", {
      "filter.type": "urn:entity:artist",
      "signal.interests.entities": artistId,
      "signal.location.query": city,
      "filter.exclude.entities": artistId,
      take,
    });
    return (d?.results?.entities ?? []).map(toEntity);
  }

  async findTag(query: string, tagType?: string) {
    const d = await this.get("/v2/tags", { "filter.query": query, "filter.tag.types": tagType, take: 5 });
    return (d?.results?.tags ?? []).map((t: any) => ({ id: t.id ?? t.tag_id, name: t.name, type: t.type }));
  }

  /** Music venues in a city ranked by how well their crowd matches the artist's audience. */
  async venues(artistId: string, city: string, venueTagId?: string, take = 8) {
    const d = await this.get("/v2/insights", {
      "filter.type": "urn:entity:place",
      "filter.location.query": city,
      "filter.tags": venueTagId,
      "signal.interests.entities": artistId,
      take,
    });
    return (d?.results?.entities ?? []).map(toEntity);
  }

  /** What else this artist's fans in a given city love: used for promo partners and copy. */
  async localTaste(artistId: string, city: string, type: string, take = 5) {
    const d = await this.get("/v2/insights", {
      "filter.type": type,
      "signal.interests.entities": artistId,
      "signal.location.query": type === "urn:entity:place" ? undefined : city,
      "filter.location.query": type === "urn:entity:place" ? city : undefined,
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
    image: p.image?.url,
    url: p.website ?? p.external?.website,
  };
}

const round = (x: unknown) => (typeof x === "number" ? Math.round(x * 1000) / 1000 : undefined);

export { CITIES, findCity, haversineKm };
