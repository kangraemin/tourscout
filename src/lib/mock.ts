// Sample responses shaped like Qloo's, used only when QLOO_API_KEY is not set.
// The UI shows a "sample data" banner in this mode; nothing here is presented as real.
import { CITIES } from "./geo";

function seed(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const SAMPLE_ARTISTS = [
  "Wednesday", "MJ Lenderman", "Waxahatchee", "Hurray for the Riff Raff", "Big Thief", "Adrianne Lenker",
  "Florist", "Indigo De Souza", "Squirrel Flower", "Hovvdy", "Lomelda", "Pinegrove", "Hand Habits",
  "Snail Mail", "Julia Jacklin", "Kevin Morby",
];

export function respond(path: string, p: Record<string, string>): any {
  if (path === "/search") {
    const q = p.query ?? "";
    return {
      results: [
        {
          entity_id: `sample-${q.toLowerCase().replace(/\W+/g, "-")}`,
          name: q,
          types: ["urn:entity:artist"],
          popularity: 0.82,
          tags: [{ name: "Indie Rock", type: "urn:tag:genre:music" }],
        },
      ],
    };
  }
  if (path === "/v2/tags") return { results: { tags: [{ id: "sample:music_venue", name: "Music Venue" }] } };

  const type = p["filter.type"];
  const sig = p["signal.interests.entities"] ?? "";
  const city = p["signal.location.query"] ?? p["filter.location.query"] ?? "";
  const rnd = seed(sig + city + type);

  if (type === "urn:demographics") {
    return {
      results: {
        demographics: [
          {
            query: {
              age: { "24_and_younger": 0.21, "25_to_29": 0.34, "30_to_34": 0.18, "35_to_44": -0.05, "45_to_54": -0.31, "55_and_older": -0.44 },
              gender: { male: 0.04, female: -0.03 },
            },
          },
        ],
      },
    };
  }
  if (type === "urn:heatmap") {
    const m = /POLYGON\(\(([-\d.]+) ([-\d.]+), ([-\d.]+) [-\d.]+, [-\d.]+ ([-\d.]+)/.exec(p["filter.location"] ?? "");
    const [x1, y1, x2, y2] = m ? [m[1], m[2], m[3], m[4]].map(Number) : [-125, 24, -66, 50];
    const inBox = CITIES.filter((c) => c.lon >= x1 && c.lon <= x2 && c.lat >= y1 && c.lat <= y2);
    // Like the real API: sorted by affinity, paged by take/page.
    const cells = inBox
      .map((c) => ({
        location: { latitude: c.lat + (rnd() - 0.5) * 0.05, longitude: c.lon + (rnd() - 0.5) * 0.05 },
        query: { affinity: Math.round(rnd() ** 1.6 * 1000) / 1000, popularity: Math.min(1, Math.log10(c.pop) / 7.2) },
      }))
      .sort((a, b) => b.query.affinity - a.query.affinity)
      .map((c, i, all) => ({ ...c, query: { ...c.query, affinity_rank: Math.round((1 - i / all.length) * 1000) / 1000 } }));
    const take = Number(p.take ?? 20);
    const page = Number(p.page ?? 1);
    return { results: { heatmap: cells.slice((page - 1) * take, page * take) } };
  }
  if (type === "urn:entity:artist") {
    const names = [...SAMPLE_ARTISTS].sort(() => rnd() - 0.5).slice(0, Number(p.take ?? 8));
    return {
      results: {
        entities: names.map((n, i) => ({
          entity_id: `sample-${n}`,
          name: n,
          popularity: (0.5 + rnd() * 0.4) * Number(p["filter.popularity.max"] ?? 1),
          query: { affinity: Math.round((0.95 - i * 0.06) * 1000) / 1000 },
          tags: [{ name: "Indie Rock", type: "urn:tag:genre:music" }],
        })),
      },
    };
  }
  const take = Number(p.take ?? 5);
  const label = type.split(":").pop();
  return {
    results: {
      entities: Array.from({ length: take }, (_, i) => ({
        entity_id: `sample-${label}-${city}-${i}`,
        name: `Sample ${label} ${i + 1}${city ? ` (${city.split(",")[0]})` : ""}`,
        popularity: rnd(),
        query: { affinity: Math.round((0.9 - i * 0.08) * 1000) / 1000 },
        properties: { address: city || undefined },
        tags: [],
      })),
    },
  };
}
