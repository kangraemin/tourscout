import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { CITIES, cityLabel, driveHours, findCity, haversineKm, metroOf, metroPop, routeStops } from "./geo";
import { Qloo, qlooMode } from "./qloo";
import { REGIONS, regionById } from "./regions";

export const MODEL = process.env.TOURSCOUT_MODEL ?? "claude-opus-5-5";

export const ScoutInput = z.object({
  artist: z.string().min(1).max(80),
  region: z.string().default("na"),
  homeCity: z.string().max(60).optional(),
  playedCities: z.array(z.string().max(60)).max(30).default([]),
  dates: z.number().int().min(2).max(12).default(6),
  maxDriveHours: z.number().min(2).max(14).default(7),
  notes: z.string().max(500).optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type ScoutInput = z.infer<typeof ScoutInput>;

export type ScoutEvent =
  | { type: "status"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; name: string; input: unknown; summary: string }
  | { type: "qloo"; calls: Qloo["calls"] }
  | { type: "map"; cities: CityScore[]; home?: { label: string; lat: number; lon: number } }
  | { type: "plan"; plan: Plan }
  | { type: "error"; text: string };

export type CityScore = {
  city: string;
  lat: number;
  lon: number;
  affinity: number;
  popularity: number;
  population: number; // metro estimate
  opportunity: number;
  played: boolean;
};

// Two shows closer than this usually trip a venue's radius clause.
export const RADIUS_KM = 120;
const AGE_BUCKETS = ["24_and_younger", "25_to_29", "30_to_34", "35_to_44", "45_to_54", "55_and_older"];

export type PlanStop = {
  city: string;
  lat: number;
  lon: number;
  why: string;
  affinity: number;
  venue: { name: string; why: string; alternates: string[] };
  openers: { name: string; why: string }[];
  promo: { angle: string; partners: string[]; copy: string };
  driveHoursFromPrev: number;
  date?: string; // YYYY-MM-DD
  weekday?: string;
  evidence: { tasteRank?: number; of: number; metroPop: number; opportunity?: number; venueAffinity?: number; roomCheck?: string };
};
export type Plan = {
  artist: string;
  headline: string;
  summary: string;
  stops: PlanStop[];
  skipped: { city: string; reason: string }[];
  risks: string[];
  totalDriveHours: number;
  startDate?: string;
  checks?: { legsOver: number; radiusConflicts: number };
  mode: "live" | "sample";
  model: string;
};

const tools: Anthropic.Tool[] = [
  {
    name: "lookup_artist",
    description:
      "Resolve an artist name to a Qloo entity. Returns up to 5 candidates with ids, genres and popularity. Call this first.",
    input_schema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "fan_profile",
    description:
      "Age and gender skew of the artist's audience according to Qloo (positive = over-indexes vs. general population). Useful for promo angle and venue choice (all-ages vs. 21+ bars).",
    input_schema: {
      type: "object",
      properties: { artist_id: { type: "string" } },
      required: ["artist_id"],
      additionalProperties: false,
    },
  },
  {
    name: "scan_region",
    description:
      "Qloo taste heatmap for the artist across a tour region, rolled up to metro areas. For each metro: affinity (how strongly local taste matches this artist, 0-1), Qloo affinity_rank when available, popularity, metro population estimate, and opportunity = taste rank minus size rank (positive means the metro punches above its size for this artist). Metros the artist has already played are flagged, and so are metros within the radius-clause distance of one.",
    input_schema: {
      type: "object",
      properties: {
        artist_id: { type: "string" },
        region_id: { type: "string", enum: REGIONS.map((r) => r.id) },
      },
      required: ["artist_id", "region_id"],
      additionalProperties: false,
    },
  },
  {
    name: "scout_city",
    description:
      "Deep look at one candidate city: music venues whose crowd matches the artist's audience, artists whose fans over-index in that city (opener candidates), and the brands, bars/cafes and podcasts this artist's fans there also love (promo partners). Call once per serious candidate city.",
    input_schema: {
      type: "object",
      properties: { artist_id: { type: "string" }, city: { type: "string", description: "e.g. 'Austin, TX'" } },
      required: ["artist_id", "city"],
      additionalProperties: false,
    },
  },
  {
    name: "check_route",
    description:
      "Order a set of cities into a driving route from the home city and return each leg's distance and estimated van drive hours, plus radius-clause conflicts (two stops, or a stop and an already-played metro, closer than 120 km). Use it to test a shortlist before submitting.",
    input_schema: {
      type: "object",
      properties: { cities: { type: "array", items: { type: "string" } } },
      required: ["cities"],
      additionalProperties: false,
    },
  },
  {
    name: "submit_plan",
    description:
      "Submit the final tour plan: exactly one stop per date. Only use venues, openers and partners that appeared in tool results. Order does not matter; the route and the calendar are computed for you. The server sends the plan back if the stop count is wrong, a leg is over the drive limit, two stops are within the radius-clause distance, or a name didn't come from the tools.",
    input_schema: {
      type: "object",
      properties: {
        headline: { type: "string", description: "One line, e.g. '6 dates where the fans already are'" },
        summary: { type: "string", description: "2-4 sentences for the manager: the logic of this routing." },
        stops: {
          type: "array",
          items: {
            type: "object",
            properties: {
              city: { type: "string" },
              why: { type: "string", description: "Why this city, citing the Qloo numbers." },
              venue: { type: "string" },
              venue_why: { type: "string" },
              venue_alternates: { type: "array", items: { type: "string" } },
              openers: {
                type: "array",
                items: {
                  type: "object",
                  properties: { name: { type: "string" }, why: { type: "string" } },
                  required: ["name", "why"],
                  additionalProperties: false,
                },
              },
              promo_angle: { type: "string" },
              promo_partners: { type: "array", items: { type: "string" } },
              promo_copy: { type: "string", description: "A short social post for this date, in the artist's voice, no hashtags spam." },
            },
            required: ["city", "why", "venue", "venue_why", "venue_alternates", "openers", "promo_angle", "promo_partners", "promo_copy"],
            additionalProperties: false,
          },
        },
        skipped: {
          type: "array",
          items: {
            type: "object",
            properties: { city: { type: "string" }, reason: { type: "string" } },
            required: ["city", "reason"],
            additionalProperties: false,
          },
        },
        risks: { type: "array", items: { type: "string" } },
      },
      required: ["headline", "summary", "stops", "skipped", "risks"],
      additionalProperties: false,
    },
  },
];

const SYSTEM = `You are TourScout, a routing assistant for independent musicians and small booking agents.
Your job: pick the cities for a short headline run where this artist's audience is strongest but where they have not played yet, then hand the manager a plan they can start pitching to venues tomorrow.

How to work:
- Resolve the artist, check the fan profile, scan the region. The heatmap is your main evidence; do not fall back on "big cities are safe" thinking. A mid-size city with high affinity usually beats a giant market with average affinity for an act at this level.
- Leave out cities the artist already played unless the manager asks for them, and avoid stops within about 120 km of each other or of a played metro. Venues put radius clauses in offers, so two nearby dates can cost you both.
- Openers come back already filtered to acts smaller than the headliner. Pick ones whose fans over-index in that city.
- The calendar puts the strongest metros on Friday and Saturday, so you don't need to order the stops.
- Scout more candidates than you need (roughly dates + 3) so you can drop weak ones, then run check_route on your shortlist and respect the max drive hours per leg. If a great city breaks the routing, put it in skipped with the reason.
- Venues, openers and promo partners must come from tool results. Never invent a venue. If a city returns no venue match, say so in risks.
- Write plainly, like a booking agent talking to a band. Short sentences, real numbers, no hype words.
- Finish by calling submit_plan exactly once.`;

function shortRegionCities(regionId: string) {
  const r = regionById(regionId);
  return CITIES.filter((c) => r.countries.includes(c.cc));
}

export async function runScout(input: ScoutInput, emit: (e: ScoutEvent) => void): Promise<Plan | undefined> {
  const client = new Anthropic();
  const qloo = new Qloo();
  const region = regionById(input.region);
  const home = input.homeCity ? findCity(input.homeCity) : undefined;
  const playedMetros = input.playedCities.map((c) => findCity(c)).filter(Boolean).map((c) => metroOf(c!));
  const played = new Set(playedMetros.map((c) => cityLabel(c)));
  const nearPlayed = (p: { lat: number; lon: number }) =>
    playedMetros.find((m) => haversineKm(m, p) < RADIUS_KM && !(m.lat === p.lat && m.lon === p.lon));
  let venueTag: string | undefined | null = null;
  let artistPop: number | undefined;
  let fanAge: string | undefined;
  // Names the tools actually returned. A plan may only use these; anything else gets sent back.
  const seen = new Map<string, { affinity?: number; popularity?: number }>();
  const key = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, "");
  let rejections = 0;

  const flushQloo = () => emit({ type: "qloo", calls: [...qloo.calls] });
  const homeStop = home ? { label: cityLabel(home), lat: home.lat, lon: home.lon } : undefined;

  function locate(names: string[]) {
    return names
      .map((q) => ({ q, c: findCity(q) }))
      .filter((x) => x.c)
      .map(({ q, c }) => ({ q, label: cityLabel(c!), lat: c!.lat, lon: c!.lon }));
  }

  function legsOf<T extends { label: string; lat: number; lon: number }>(ordered: T[]) {
    let prev = homeStop ?? ordered[0];
    return ordered.map((s) => {
      const km = Math.round(haversineKm(prev, s));
      const leg = { from: prev.label, to: s.label, km, drive_hours: Math.round(driveHours(km) * 10) / 10 };
      prev = s;
      return leg;
    });
  }

  function radiusConflicts(stops: { label: string; lat: number; lon: number }[]) {
    const out: string[] = [];
    for (let i = 0; i < stops.length; i++) {
      for (let k = i + 1; k < stops.length; k++) {
        const km = haversineKm(stops[i], stops[k]);
        if (km < RADIUS_KM) out.push(`${stops[i].label} and ${stops[k].label} are ${Math.round(km)} km apart`);
      }
      const p = nearPlayed(stops[i]);
      if (p) out.push(`${stops[i].label} is ${Math.round(haversineKm(p, stops[i]))} km from ${cityLabel(p)}, which was already played`);
    }
    return out;
  }

  // Put the strongest metros on Friday and Saturday: try each start day in the week after startDate.
  function calendar(affs: number[]) {
    if (!input.startDate) return undefined;
    const base = new Date(`${input.startDate}T12:00:00Z`);
    let best = { offset: 0, score: -1 };
    for (let off = 0; off < 7; off++) {
      let sc = 0;
      affs.forEach((a, i) => {
        const wd = (base.getUTCDay() + off + i) % 7;
        if (wd === 5 || wd === 6) sc += a;
      });
      if (sc > best.score) best = { offset: off, score: sc };
    }
    return affs.map((_, i) => {
      const d = new Date(base.getTime() + (best.offset + i) * 86400000);
      return { date: d.toISOString().slice(0, 10), weekday: d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }) };
    });
  }

  async function runTool(name: string, args: any): Promise<{ result: unknown; summary: string; plan?: Plan }> {
    switch (name) {
      case "lookup_artist": {
        const r = await qloo.searchArtist(args.name);
        if (r[0]?.popularity != null) artistPop = r[0].popularity;
        return { result: r, summary: r.length ? `Found ${r[0].name}` : "No match" };
      }
      case "fan_profile": {
        const r = await qloo.audience(args.artist_id);
        const top = Object.entries(r.age as Record<string, number>)
          .filter(([k]) => AGE_BUCKETS.includes(k))
          .sort((a, b) => b[1] - a[1])[0];
        if (top && top[1] > 0) fanAge = top[0];
        return { result: r, summary: fanAge ? `Fans skew ${fanAge.replace(/_/g, " ")}` : "Fan age and gender skew" };
      }
      case "scan_region": {
        const reg = regionById(args.region_id);
        const rows = await qloo.heatmap(args.artist_id, reg);
        const n = rows.length || 1;
        // Prefer Qloo's own affinity_rank for ordering; fall back to raw affinity.
        const tasteKey = (r: (typeof rows)[number]) => r.affinityRank ?? r.affinity;
        const affRank = new Map([...rows].sort((a, b) => tasteKey(b) - tasteKey(a)).map((r, i) => [r.city, 1 - i / n]));
        const sizeRank = new Map([...rows].sort((a, b) => b.population - a.population).map((r, i) => [r.city, 1 - i / n]));
        const scored: CityScore[] = rows.map((r) => ({
          city: r.city,
          lat: r.lat,
          lon: r.lon,
          affinity: r.affinity,
          popularity: r.popularity,
          population: r.population,
          opportunity: Math.round(((affRank.get(r.city) ?? 0) - (sizeRank.get(r.city) ?? 0)) * 100) / 100,
          played: played.has(r.city),
        }));
        emit({ type: "map", cities: scored, home: homeStop });
        const top = scored.slice(0, 30).map((c) => {
          const p = c.played ? undefined : nearPlayed(c);
          return {
            ...c,
            qloo_affinity_rank: rows.find((r) => r.city === c.city)?.affinityRank,
            km_from_home: home ? Math.round(haversineKm(home, c)) : undefined,
            radius_conflict_with_played: p ? cityLabel(p) : undefined,
          };
        });
        return { result: { region: reg.label, cities_scored: rows.length, top }, summary: `Scored ${rows.length} metros in ${reg.label}` };
      }
      case "scout_city": {
        if (venueTag === null) {
          const tags = await qloo.findTag("music venue").catch(() => []);
          venueTag = tags[0]?.id;
        }
        // Openers should draw less than the headliner.
        const openerCap = artistPop != null ? Math.max(0.05, Math.round((artistPop - 0.03) * 100) / 100) : undefined;
        const [venues, openers, brands, hangouts, podcasts] = await Promise.all([
          qloo.venues(args.artist_id, args.city, venueTag ?? undefined, 8, fanAge),
          qloo.similarArtists(args.artist_id, args.city, 8, openerCap),
          qloo.localTaste(args.artist_id, args.city, "urn:entity:brand", 5),
          qloo.localTaste(args.artist_id, args.city, "urn:entity:place", 6),
          qloo.localTaste(args.artist_id, args.city, "urn:entity:podcast", 4),
        ]);
        for (const e of [...venues, ...openers]) if (e.name) seen.set(key(e.name), { affinity: e.affinity, popularity: e.popularity });
        const slim = (xs: any[]) => xs.map(({ name, affinity, popularity, address, tags }) => ({ name, affinity, popularity, address, tags }));
        return {
          result: { city: args.city, headliner_popularity: artistPop, venues: slim(venues), opener_candidates: slim(openers), brands: slim(brands), local_hangouts: slim(hangouts), podcasts: slim(podcasts) },
          summary: `${args.city}: ${venues.length} venues, ${openers.length} opener candidates`,
        };
      }
      case "check_route": {
        const ordered = routeStops(homeStop, locate(args.cities as string[]));
        const legs = legsOf(ordered);
        const over = legs.filter((l) => l.drive_hours > input.maxDriveHours);
        const radius = radiusConflicts(ordered);
        return {
          result: { legs, max_drive_hours: input.maxDriveHours, legs_over_limit: over, radius_conflicts: radius, dates_needed: input.dates },
          summary: `Route of ${ordered.length} stops, ${over.length} legs over ${input.maxDriveHours}h, ${radius.length} radius conflicts`,
        };
      }
      case "submit_plan": {
        const raw = args.stops as any[];
        const located = raw.map((s) => {
          const c = findCity(s.city);
          return { ...s, label: c ? cityLabel(c) : s.city, lat: c?.lat ?? 0, lon: c?.lon ?? 0 };
        });
        const ordered = routeStops(homeStop, located);
        const legs = legsOf(ordered);
        const problems: string[] = [];
        if (raw.length !== input.dates) problems.push(`The plan has ${raw.length} stops but the band has ${input.dates} dates.`);
        const over = legs.filter((l) => l.drive_hours > input.maxDriveHours);
        if (over.length) problems.push(`Legs over ${input.maxDriveHours}h: ${over.map((l) => `${l.from} to ${l.to} (${l.drive_hours}h)`).join("; ")}.`);
        const radius = radiusConflicts(ordered);
        if (radius.length) problems.push(`Radius-clause conflicts: ${radius.join("; ")}.`);
        const unknown = raw.flatMap((s) =>
          [s.venue, ...(s.openers ?? []).map((o: any) => o.name)].filter((n) => n && !seen.has(key(n))),
        );
        if (unknown.length) problems.push(`These names did not come from scout_city results: ${unknown.join(", ")}.`);
        if (problems.length && rejections < 2) {
          rejections++;
          return { result: { error: `Plan sent back. ${problems.join(" ")} Fix these and submit again.` }, summary: `Plan sent back: ${problems.length} problem${problems.length > 1 ? "s" : ""}` };
        }

        const lastScan = lastMap;
        const tasteOrder = [...lastScan].sort((a, b) => b.affinity - a.affinity).map((c) => c.city);
        const cal = calendar(ordered.map((s: any) => lastScan.find((c) => c.city === s.label)?.affinity ?? 0));
        let total = 0;
        const stops: PlanStop[] = ordered.map((s: any, i) => {
          const h = homeStop || i > 0 ? legs[i].drive_hours : 0;
          total += h;
          const scan = lastScan.find((c) => c.city === s.label);
          const v = seen.get(key(s.venue ?? ""));
          const c = findCity(s.label);
          const roomCheck =
            v?.popularity != null && artistPop != null && v.popularity > artistPop + 0.1
              ? "This room is better known than the band. Check the capacity before pitching."
              : undefined;
          return {
            city: s.label,
            lat: s.lat,
            lon: s.lon,
            why: s.why,
            affinity: scan?.affinity ?? 0,
            venue: { name: s.venue, why: s.venue_why, alternates: s.venue_alternates ?? [] },
            openers: s.openers ?? [],
            promo: { angle: s.promo_angle, partners: s.promo_partners ?? [], copy: s.promo_copy },
            driveHoursFromPrev: h,
            ...(cal ? cal[i] : {}),
            evidence: {
              tasteRank: scan ? tasteOrder.indexOf(scan.city) + 1 : undefined,
              of: lastScan.length,
              metroPop: scan?.population ?? (c ? metroPop(c) : 0),
              opportunity: scan?.opportunity,
              venueAffinity: v?.affinity,
              roomCheck,
            },
          };
        });
        const risks = [...(args.risks ?? [])];
        if (problems.length) risks.unshift(...problems.map((p) => `Not fixed by the agent: ${p}`));
        const plan: Plan = {
          artist: artistName,
          headline: args.headline,
          summary: args.summary,
          stops,
          skipped: args.skipped ?? [],
          risks,
          totalDriveHours: Math.round(total * 10) / 10,
          startDate: cal?.[0]?.date,
          checks: { legsOver: over.length, radiusConflicts: radius.length },
          mode: qlooMode(),
          model: MODEL,
        };
        return { result: { ok: true }, summary: "Plan submitted", plan };
      }
    }
    return { result: { error: `unknown tool ${name}` }, summary: "unknown tool" };
  }

  let lastMap: CityScore[] = [];
  let artistName = input.artist;
  const origEmit = emit;
  emit = (e) => {
    if (e.type === "map") lastMap = e.cities;
    origEmit(e);
  };

  const brief = [
    `Artist: ${input.artist}`,
    `Region: ${region.label} (region_id "${region.id}")`,
    `Home base / tour start: ${home ? cityLabel(home) : input.homeCity || "not given"}`,
    `Already played (skip unless asked): ${[...played].join("; ") || "none listed"}`,
    `Number of dates: ${input.dates} (one stop per date)`,
    input.startDate ? `Earliest start date: ${input.startDate}` : "",
    `Max drive per leg: ${input.maxDriveHours} hours`,
    input.notes ? `Manager's notes: ${input.notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: brief }];
  emit({ type: "status", text: `Briefing the agent (${qlooMode() === "live" ? "live Qloo data" : "sample data"})` });

  for (let turn = 0; turn < 24; turn++) {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      tools,
      messages,
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    } as any);

    for (const b of res.content as any[]) {
      if (b.type === "text" && b.text.trim()) emit({ type: "thinking", text: b.text.trim() });
    }
    if (res.stop_reason === "refusal") {
      emit({ type: "error", text: "The model declined this request." });
      return;
    }
    messages.push({ role: "assistant", content: res.content as any });
    const uses = (res.content as any[]).filter((b) => b.type === "tool_use");
    if (!uses.length) break;

    const results: Anthropic.ToolResultBlockParam[] = [];
    let plan: Plan | undefined;
    await Promise.all(
      uses.map(async (u) => {
        try {
          const out = await runTool(u.name, u.input);
          if (u.name === "lookup_artist" && Array.isArray(out.result) && out.result[0]?.name) artistName = out.result[0].name;
          emit({ type: "tool", name: u.name, input: u.input, summary: out.summary });
          if (out.plan) plan = out.plan;
          results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out.result) });
        } catch (err: any) {
          emit({ type: "tool", name: u.name, input: u.input, summary: `Error: ${err.message}` });
          results.push({ type: "tool_result", tool_use_id: u.id, content: String(err.message), is_error: true });
        }
      }),
    );
    flushQloo();
    if (plan) {
      emit({ type: "plan", plan });
      return plan;
    }
    messages.push({ role: "user", content: results });
  }
  emit({ type: "error", text: "The agent stopped before submitting a plan." });
}

export { shortRegionCities };
