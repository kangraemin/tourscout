import { z } from "zod";
import { cityLabel, findCity } from "@/lib/geo";
import { Qloo, qlooMode } from "@/lib/qloo";
import { allow } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 60;

const Input = z.object({
  city: z.string().min(2).max(60),
  venue: z.string().max(80).optional(),
  room: z.enum(["small", "mid"]).default("small"),
});

// Popularity is Qloo's 0-1 percentile. These bands are rough stand-ins for "draws a few hundred" vs "draws up to ~1,000".
const BANDS = { small: { popMin: 0.2, popMax: 0.85 }, mid: { popMin: 0.6, popMax: 0.95 } };

export async function POST(req: Request) {
  const parsed = Input.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Enter a city, for example Richmond, VA." }, { status: 400 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!allow(`venue:${ip}`, 30)) return Response.json({ error: "Too many lookups this hour. Try again later." }, { status: 429 });

  const { city, venue, room } = parsed.data;
  const c = findCity(city);
  const label = c ? cityLabel(c) : city;
  const qloo = new Qloo();
  try {
    const place = venue ? (await qloo.searchPlace(`${venue} ${label}`))[0] : undefined;
    const artists = await qloo.artistsForCity(label, { venueId: place?.id, ...BANDS[room], take: 20 });
    return Response.json({
      city: label,
      venue: place ? { id: place.id, name: place.name } : undefined,
      room,
      mode: qlooMode(),
      artists: artists.map((a: any) => ({ name: a.name, affinity: a.affinity, popularity: a.popularity, genres: a.genres })),
      calls: qloo.calls,
    });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 502 });
  }
}
