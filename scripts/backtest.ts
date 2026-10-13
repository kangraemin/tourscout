/**
 * Backtest: did Qloo's taste heatmap point at the cities bands actually went on to play?
 *
 * For each artist we take their real shows from setlist.fm, split into a "before" window (cities already
 * played) and an "after" window. Each method then names 10 cities the band has not played yet, and we count
 * how many of those the band really played in the after window.
 *
 * Caveat: most shows in the after window were announced months ahead, possibly before the model's training
 * cutoff, so the model may remember some of them. Model vs model + Qloo is the fair comparison: both runs
 * share that knowledge, and the only difference is the Qloo shortlist.
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
const AFTER_FROM = process.env.BT_AFTER_FROM ?? "2026-07-01";
const K = 10;
const MIN_NEW = Number(process.env.BT_MIN_NEW ?? 2); // artists with fewer new cities in the after window tell us nothing
const COUNTRIES = ["US", "CA"];
// BT_NO_MODEL=1 runs only the Qloo and population methods (no Anthropic calls) and writes BT_OUT instead.
const NO_MODEL = process.env.BT_NO_MODEL === "1";
const OUT = process.env.BT_OUT ?? path.join(__dirname, "../public/backtest.json");

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
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const hit = (await q.searchArtist(artist))[0];
  // A near-miss ("Greg Freeman" -> Greg Laswell) would score another act's fans, so treat it as no data.
  if (!hit?.id || norm(hit.name) !== norm(artist)) return { taste: [], tasteAndSize: [], shortlist: [] as any[] };
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
    // Same list the app's scan_region tool hands the agent: the first 30 metros in heatmap order
    // (minus ones already played), with the same taste-vs-size "opportunity" score.
    shortlist: (() => {
      const n = rows.length || 1;
      const tk = (r: (typeof rows)[number]) => r.affinityRank ?? r.affinity;
      const affRank = new Map([...rows].sort((a, b) => tk(b) - tk(a)).map((r, i) => [r.city, 1 - i / n]));
      const sizeRank = new Map([...rows].sort((a, b) => b.population - a.population).map((r, i) => [r.city, 1 - i / n]));
      return rows.slice(0, 30).map((r) => ({
        city: r.city,
        affinity: r.affinity,
        qloo_affinity_rank: r.affinityRank,
        population: r.population,
        opportunity: Math.round(((affRank.get(r.city) ?? 0) - (sizeRank.get(r.city) ?? 0)) * 100) / 100,
      }));
    })(),
  };
}

const claude = new Anthropic();

// Same model, same prompt. The only difference between the two runs is whether Qloo's shortlist is in it.
async function byModel(artist: string, played: Set<string>, qlooShortlist?: object[]) {
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
        content: `Name ${K} different cities in the US or Canada where ${artist} is most likely to play a show in the second half of 2026, leaving out cities they already played since ${BEFORE_FROM}: ${[...played].join("; ") || "none"}. Return names as "City, ST".${
          qlooShortlist?.length
            ? `\n\nQloo taste data for ${artist}, the same list TourScout's agent gets: metros where people with matching taste over-index (affinity is a 0-1 percentile; higher means a stronger match), metro population, and opportunity (taste rank minus size rank; positive means the metro punches above its size). Use it alongside what you know.\n${JSON.stringify(qlooShortlist)}`
            : ""
        }`,
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
    const qloo = await byQloo(q, s.name, s.before);
    const picks: Record<string, string[]> = { population: byPopulation(s.before), qloo: qloo.taste, qlooSized: qloo.tasteAndSize };
    if (!NO_MODEL) {
      picks.model = await byModel(s.name, s.before);
      picks.modelQloo = qloo.shortlist.length ? await byModel(s.name, s.before, qloo.shortlist) : [];
    }
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
  const methods = NO_MODEL
    ? ["population", "qloo", "qlooSized"]
    : ["population", "qloo", "qlooSized", "model", "modelQloo"];
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
  // Head to head per artist, and hits outside the 25 biggest metros (the cities a "play the big ones" habit skips).
  const big = new Set(
    [...byLabel.entries()].sort((a, b) => metroPop(b[1]) - metroPop(a[1])).slice(0, 25).map(([l]) => l),
  );
  const h2h = (a: string, b: string) => {
    let win = 0, loss = 0, tie = 0;
    for (const r of rows) {
      const x = r.hits[a].length, y = r.hits[b].length;
      if (x > y) win++;
      else if (x < y) loss++;
      else tie++;
    }
    return { win, loss, tie };
  };
  const discovery = Object.fromEntries(
    methods.map((m) => {
      const picks = rows.flatMap((r) => r.picks[m].filter((c: string) => !big.has(c)));
      const hits = rows.flatMap((r) => r.hits[m].filter((c: string) => !big.has(c)));
      return [m, { picks: picks.length, hits: hits.length, hitRate: picks.length ? hits.length / picks.length : 0 }];
    }),
  );
  const headToHead = {
    qlooSized_vs_population: h2h("qlooSized", "population"),
    ...(NO_MODEL ? {} : { modelQloo_vs_model: h2h("modelQloo", "model") }),
  };
  const out = {
    generatedAt: new Date().toISOString(),
    before: { from: BEFORE_FROM, to: AFTER_FROM },
    after: { from: AFTER_FROM },
    k: K,
    qlooMode: process.env.QLOO_API_KEY ? "live" : "sample",
    artists: rows.length,
    summary,
    discovery,
    headToHead,
    rows,
  };
  fs.writeFileSync(
    OUT,
    JSON.stringify(out, null, 2),
  );
  console.log(JSON.stringify({ summary, discovery, headToHead }, null, 2));
}

main();
