import Anthropic from "@anthropic-ai/sdk";
import { MODEL, RADIUS_KM, ScoutInput } from "@/lib/agent";
import { regionById } from "@/lib/regions";
import { cityLabel, driveHours, findCity, haversineKm, metroOf, routeStops } from "@/lib/geo";
import { allow } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 60;

// The same question asked to the same model with no Qloo access, shown next to the plan for comparison.
export async function POST(req: Request) {
  const parsed = ScoutInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Bad input" }, { status: 400 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!allow(`baseline:${ip}`)) return Response.json({ cities: [] }, { status: 429 });
  const i = parsed.data;
  const client = new Anthropic();
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
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
        content: `Pick exactly ${i.dates} different cities in ${regionById(i.region).label} for a headline run by ${i.artist}, starting from ${i.homeCity || "anywhere"}. Skip: ${i.playedCities.join(", ") || "none"}. Max ${i.maxDriveHours}h drive per leg. Return city names as "City, ST" or "City, Country".`,
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
    const played = i.playedCities.map((q) => findCity(q)).filter(Boolean).map((c) => metroOf(c!));
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
