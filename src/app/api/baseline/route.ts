import Anthropic from "@anthropic-ai/sdk";
import { MODEL, RADIUS_KM, ScoutInput } from "@/lib/agent";
import { regionById } from "@/lib/regions";
import { cityLabel, driveHours, findCity, haversineKm, metroOf, routeStops } from "@/lib/geo";
import { allow } from "@/lib/ratelimit";
import { recentShows } from "@/lib/setlist";

export const runtime = "nodejs";
export const maxDuration = 120;

// The same question asked to the same model with no Qloo access, shown next to the plan for comparison.
// It gets everything the agent gets except Qloo: the same booking rules, the same setlist.fm history,
// the same effort setting. So the gap between the two is down to the taste data.
export async function POST(req: Request) {
  const parsed = ScoutInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Bad input" }, { status: 400 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!allow(`baseline:${ip}`)) return Response.json({ cities: [] }, { status: 429 });
  const i = parsed.data;
  const client = new Anthropic();
  const region = regionById(i.region);
  const since = new Date(Date.now() - 548 * 86400000).toISOString().slice(0, 10);
  const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const shows = (await recentShows(undefined, i.artist, since).catch(() => undefined)) ?? [];
  const inRegion = shows.filter((s) => {
    const c = findCity(s.city);
    return c && region.countries.includes(c.cc);
  });
  const playedAll = [...new Set([...i.playedCities, ...inRegion.filter((s) => s.date >= yearAgo).map((s) => s.city)])];
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    output_config: {
      effort: "medium",
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
        content: [
          `Pick exactly ${i.dates} different cities in ${region.label} for a headline run by ${i.artist}. The van starts from ${i.homeCity || "anywhere"}; the home city is not one of the show dates.`,
          `Pick the cities where this artist's audience is strongest but they haven't played. Already played, skip: ${playedAll.join("; ") || "none"}.`,
          `Rules: max ${i.maxDriveHours}h drive per leg. No two stops within ${RADIUS_KM} km of each other or of a played city (venue radius clauses).`,
          inRegion.length ? `Recent shows (setlist.fm): ${JSON.stringify(inRegion.slice(0, 40).map(({ date, city, venue }) => ({ date, city, venue })))}` : "",
          i.notes ? `Manager's notes: ${i.notes}` : "",
          `Return city names as "City, ST" or "City, Country".`,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  } as any);
  const text = (res.content as any[]).find((b) => b.type === "text")?.text ?? "{}";
  try {
    const names: string[] = JSON.parse(text).cities ?? [];
    const found = names.map((q) => ({ q, c: findCity(q) }));
    const stops = found.filter((x) => x.c).map(({ c }) => ({ label: cityLabel(c!), lat: c!.lat, lon: c!.lon }));
    // Check the guess against the same booking rules the agent's plan has to pass.
    const home = i.homeCity ? findCity(i.homeCity) : undefined;
    const start = home ? { label: cityLabel(home), lat: home.lat, lon: home.lon } : undefined;
    const ordered = routeStops(start, stops);
    let prev = start ?? ordered[0];
    const legs = ordered.map((s) => {
      const h = driveHours(haversineKm(prev, s));
      prev = s;
      return h;
    });
    const played = playedAll.map((q) => findCity(q)).filter(Boolean).map((c) => metroOf(c!));
    let radius = 0;
    ordered.forEach((s, k) => {
      if (played.some((p) => haversineKm(p, s) < RADIUS_KM)) radius++;
      for (let j = k + 1; j < ordered.length; j++) if (haversineKm(s, ordered[j]) < RADIUS_KM) radius++;
    });
    return Response.json({
      cities: stops,
      unmatched: found.filter((x) => !x.c).map((x) => x.q),
      checks: {
        legsOver: legs.filter((h) => h > i.maxDriveHours).length,
        longestLeg: Math.round(Math.max(0, ...legs) * 10) / 10,
        totalDrive: Math.round(legs.reduce((a, b) => a + b, 0) * 10) / 10,
        radiusConflicts: radius,
      },
    });
  } catch {
    return Response.json({ cities: [] });
  }
}
