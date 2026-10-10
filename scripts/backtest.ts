/**
 * Backtest: did Qloo's taste heatmap point at the cities bands actually went on to play?
 *
 * For each artist we take their real shows from setlist.fm, split into a "before" window (cities already
 * played) and an "after" window. Each method then names 10 cities the band has not played yet, and we count
 * how many of those the band really played in the after window.
 *
 * The after window starts after the model's training cutoff, so the no-Qloo model can't just remember tours.
 *
 *   SETLISTFM_API_KEY=... QLOO_API_KEY=... ANTHROPIC_API_KEY=... npx tsx scripts/backtest.ts [artists.txt]
 *
 * Writes public/backtest.json, which the /backtest page reads.
 */
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import {
  CITIES,
  City,
  cityLabel,
  findCity,
  metroOf,
  metroPop,
  nearestCity,
} from "../src/lib/geo";
import { Qloo } from "../src/lib/qloo";
import { regionById } from "../src/lib/regions";
import { MODEL } from "../src/lib/agent";

const BEFORE_FROM = process.env.BT_BEFORE_FROM ?? "2025-07-01";
const AFTER_FROM = process.env.BT_AFTER_FROM ?? "2026-07-01"; // after the model's training cutoff
const K = 10;
const MIN_NEW = Number(process.env.BT_MIN_NEW ?? 2); // artists with fewer new cities in the after window tell us nothing
const COUNTRIES = ["US", "CA"];

const SL_KEY = process.env.SETLISTFM_API_KEY;
if (!SL_KEY) throw new Error("SETLISTFM_API_KEY is not set");

const cacheDir = path.join(__dirname, ".cache");
fs.mkdirSync(cacheDir, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function setlistGet(p: string) {
  const file = path.join(cacheDir, p.replace(/[^a-z0-9]+/gi, "_") + ".json");
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(600); // setlist.fm allows about 2 requests a second
    const res = await fetch(`https://api.setlist.fm/rest/1.0${p}`, {
      headers: { "x-api-key": SL_KEY!, Accept: "application/json" },
    });
    if (res.status === 429) {
      await sleep(3000);
      continue;
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`setlist.fm ${p} ${res.status}`);
    const data = await res.json();
    fs.writeFileSync(file, JSON.stringify(data));
    return data;
  }
  throw new Error(`setlist.fm ${p} kept returning 429`);
}

const iso = (d: string) => d.split("-").reverse().join("-"); // dd-MM-yyyy -> yyyy-MM-dd

/** Metros where the artist played, split by window. Festivals count: a band still has to route through them. */
async function shows(artist: string) {
  const found = await setlistGet(
    `/search/artists?artistName=${encodeURIComponent(artist)}&sort=relevance`,
  );
  const a =
    (found?.artist ?? []).find(
      (x: any) => x.name.toLowerCase() === artist.toLowerCase(),
    ) ?? found?.artist?.[0];
  if (!a) return null;
  const before = new Set<string>();
  const after = new Set<string>();
  for (let p = 1; p <= 20; p++) {
    const d = await setlistGet(`/artist/${a.mbid}/setlists?p=${p}`);
    const list: any[] = d?.setlist ?? [];
    for (const s of list) {
      const date = iso(s.eventDate);
      const c = s.venue?.city;
      if (!c || !COUNTRIES.includes(c.country?.code)) continue;
      const city =
        (c.coords?.lat != null &&
          nearestCity(c.coords.lat, c.coords.long, 50)) ||
        findCity(`${c.name}, ${c.stateCode ?? c.country.code}`);
      if (!city) continue;
      const label = cityLabel(metroOf(city));
      if (date >= AFTER_FROM) after.add(label);
      else if (date >= BEFORE_FROM) before.add(label);
    }
    const oldest = list.length ? iso(list[list.length - 1].eventDate) : "0000";
    if (list.length < 20 || oldest < BEFORE_FROM) break;
  }
  return { name: a.name as string, before, after };
}

const byLabel = new Map<string, City>();
for (const c of CITIES)
  if (COUNTRIES.includes(c.cc)) byLabel.set(cityLabel(metroOf(c)), metroOf(c));

function byPopulation(played: Set<string>) {
  return [...byLabel.entries()]
    .filter(([l]) => !played.has(l))
    .sort((a, b) => metroPop(b[1]) - metroPop(a[1]))
    .slice(0, K)
    .map(([l]) => l);
}

async function byQloo(q: Qloo, artist: string, played: Set<string>) {
  const hit = (await q.searchArtist(artist))[0];
  if (!hit?.id) return { taste: [], tasteAndSize: [] };
  const rows = (await q.heatmap(hit.id, regionById("na"))).filter(
    (r) => !played.has(r.city),
  );
  const top = (score: (r: (typeof rows)[number]) => number) =>
    [...rows]
      .sort((a, b) => score(b) - score(a))
      .slice(0, K)
      .map((r) => r.city);
  return {
    // Pure taste: where listeners over-index, whatever the size of the city.
    taste: top((r) => r.affinityRank ?? r.affinity),
    // Taste weighted by market size, which is closer to how the agent trades the two off.
    tasteAndSize: top(
      (r) =>
        (r.affinityRank ?? r.affinity) *
        Math.log10(Math.max(r.population, 10_000)),
    ),
  };
}

const claude = new Anthropic();

async function byModel(artist: string, played: Set<string>) {
  const res = await claude.messages.create({
    model: MODEL,
    max_tokens: 1500,
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: { cities: { type: "array", items: { type: "string" } } },
          required: ["cities"],
          additionalProperties: false,
        },
      },
    },
    messages: [
      {
        role: "user",
        content: `Name ${K} different cities in the US or Canada where ${artist} is most likely to play a show in the second half of 2026, leaving out cities they already played since ${BEFORE_FROM}: ${[...played].join("; ") || "none"}. Return names as "City, ST".`,
      },
    ],
  } as any);
  const text =
    (res.content as any[]).find((b) => b.type === "text")?.text ?? "{}";
  const names: string[] = JSON.parse(text).cities ?? [];
  const out: string[] = [];
  for (const n of names) {
    const c = findCity(n);
    const l = c && cityLabel(metroOf(c));
    if (l && !played.has(l) && !out.includes(l)) out.push(l);
  }
  return out.slice(0, K);
}

async function main() {
  const listFile =
    process.argv[2] ?? path.join(__dirname, "backtest-artists.txt");
  const artists = fs
    .readFileSync(listFile, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("#"));
  const q = new Qloo();
  const rows: any[] = [];
  for (const name of artists) {
    const s = await shows(name);
    if (!s) {
      console.log(`skip ${name}: not on setlist.fm`);
      continue;
    }
    const truth = [...s.after].filter((l) => !s.before.has(l));
    if (truth.length < MIN_NEW || s.before.size === 0) {
      console.log(
        `skip ${name}: ${s.before.size} before, ${truth.length} new after`,
      );
      continue;
    }
    const base = {
      population: byPopulation(s.before),
      model: await byModel(s.name, s.before),
    };
    const qloo = await byQloo(q, s.name, s.before);
    const picks = { ...base, qloo: qloo.taste, qlooSized: qloo.tasteAndSize };
    const hits = Object.fromEntries(
      Object.entries(picks).map(([k, v]) => [
        k,
        v.filter((l) => truth.includes(l)),
      ]),
    );
    rows.push({
      artist: s.name,
      playedBefore: s.before.size,
      newCities: truth,
      picks,
      hits,
    });
    console.log(
      name,
      Object.fromEntries(Object.entries(hits).map(([k, v]) => [k, v.length])),
      `of ${truth.length}`,
    );
  }
  const methods = ["population", "qloo", "qlooSized", "model"] as const;
  const summary = Object.fromEntries(
    methods.map((m) => {
      const h = rows.reduce((a, r) => a + r.hits[m].length, 0);
      const p = rows.reduce((a, r) => a + r.picks[m].length, 0);
      const wins = rows.filter((r) => r.hits[m].length > 0).length;
      return [
        m,
        { hits: h, picks: p, hitRate: p ? h / p : 0, artistsWithAHit: wins },
      ];
    }),
  );
  const out = {
    generatedAt: new Date().toISOString(),
    before: { from: BEFORE_FROM, to: AFTER_FROM },
    after: { from: AFTER_FROM },
    k: K,
    qlooMode: process.env.QLOO_API_KEY ? "live" : "sample",
    artists: rows.length,
    summary,
    rows,
  };
  fs.writeFileSync(
    path.join(__dirname, "../public/backtest.json"),
    JSON.stringify(out, null, 2),
  );
  console.log(JSON.stringify(summary, null, 2));
}

main();
