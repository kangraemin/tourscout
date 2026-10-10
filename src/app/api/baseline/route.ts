import Anthropic from "@anthropic-ai/sdk";
import { MODEL, ScoutInput } from "@/lib/agent";
import { regionById } from "@/lib/regions";
import { cityLabel, findCity } from "@/lib/geo";
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
        content: `Pick ${i.dates} cities in ${regionById(i.region).label} for a headline run by ${i.artist}, starting from ${i.homeCity || "anywhere"}. Skip: ${i.playedCities.join(", ") || "none"}. Max ${i.maxDriveHours}h drive per leg. Return city names as "City, ST" or "City, Country".`,
      },
    ],
  } as any);
  const text = (res.content as any[]).find((b) => b.type === "text")?.text ?? "{}";
  try {
    const cities: string[] = JSON.parse(text).cities ?? [];
    return Response.json({
      cities: cities
        .map((q) => findCity(q))
        .filter(Boolean)
        .map((c) => ({ label: cityLabel(c!), lat: c!.lat, lon: c!.lon })),
    });
  } catch {
    return Response.json({ cities: [] });
  }
}
