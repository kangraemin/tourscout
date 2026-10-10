import citiesRaw from "@/data/cities.json";

export type City = {
  n: string; // name
  cc: string; // ISO country code
  a1: string; // admin1 code (US state abbreviation, etc.)
  lat: number;
  lon: number;
  pop: number;
};

export const CITIES = citiesRaw as City[];

const R_KM = 6371;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.sqrt(h));
}

// Road distance is usually 1.2-1.3x the great-circle distance; average van speed ~85 km/h incl. stops.
export function driveHours(km: number) {
  return (km * 1.25) / 85;
}

export function cityLabel(c: City) {
  return c.cc === "US" || c.cc === "CA" || c.cc === "AU" ? `${c.n}, ${c.a1}` : `${c.n}, ${c.cc}`;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Fuzzy city lookup: "Chicago", "Austin, TX", "Berlin" */
export function findCity(q: string): City | undefined {
  const parts = q.split(",").map((p) => norm(p));
  const name = parts[0];
  const qual = parts[1];
  const hits = CITIES.filter((c) => norm(c.n) === name);
  const pool = hits.length ? hits : CITIES.filter((c) => norm(c.n).startsWith(name));
  if (!pool.length) return undefined;
  const qualified = qual ? pool.filter((c) => norm(c.a1) === qual || norm(c.cc) === qual) : pool;
  return (qualified.length ? qualified : pool).sort((a, b) => b.pop - a.pop)[0];
}

/**
 * Name a geohash cell after the market it belongs to: the largest city within `maxKm`,
 * so a cell in a suburb rolls up to the metro a band would actually book.
 */
export function nearestCity(lat: number, lon: number, maxKm = 35): City | undefined {
  let best: City | undefined;
  for (const c of CITIES) {
    if (Math.abs(c.lat - lat) > 1 || Math.abs(c.lon - lon) > 1.5) continue;
    if (haversineKm({ lat, lon }, c) > maxKm) continue;
    if (!best || c.pop > best.pop) best = c;
  }
  return best;
}

export type Stop = { label: string; lat: number; lon: number };

/**
 * Order stops for a driving tour: nearest-neighbour from the start city, then 2-opt to remove crossings.
 * Small n (<= 12) so the simple version is fine.
 */
export function routeStops<T extends Stop>(start: Stop | undefined, stops: T[], returnHome = false): T[] {
  if (stops.length <= 1) return stops;
  const rest = [...stops];
  const order: T[] = [];
  let cur: Stop = start ?? rest[0];
  while (rest.length) {
    let bi = 0;
    let bd = Infinity;
    rest.forEach((s, i) => {
      const d = haversineKm(cur, s);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    cur = rest.splice(bi, 1)[0];
    order.push(cur as T);
  }
  const pts = (o: T[]) => [...(start ? [start] : []), ...o, ...(returnHome && start ? [start] : [])];
  const len = (o: T[]) => {
    const p = pts(o);
    let t = 0;
    for (let i = 1; i < p.length; i++) t += haversineKm(p[i - 1], p[i]);
    return t;
  };
  let improved = true;
  let best = order;
  let bestLen = len(best);
  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const cand = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
        const l = len(cand);
        if (l + 0.1 < bestLen) {
          best = cand;
          bestLen = l;
          improved = true;
        }
      }
    }
  }
  return best;
}

export const COUNTRY_NAMES: Record<string, string> = {
  US: "United States", CA: "Canada", GB: "United Kingdom", IE: "Ireland", DE: "Germany", FR: "France",
  NL: "Netherlands", BE: "Belgium", ES: "Spain", PT: "Portugal", IT: "Italy", CH: "Switzerland",
  AT: "Austria", DK: "Denmark", SE: "Sweden", NO: "Norway", FI: "Finland", PL: "Poland", CZ: "Czechia",
  AU: "Australia", NZ: "New Zealand", JP: "Japan", KR: "South Korea", MX: "Mexico", BR: "Brazil",
  AR: "Argentina", CL: "Chile", CO: "Colombia",
};
