"use client";

import { useState } from "react";

type Act = { name: string; affinity?: number; popularity?: number; genres: string[] };
type Result = { city: string; venue?: { name: string }; room: string; mode: string; artists: Act[] };

// The promoter's side: given a room, which acts have their listeners here.
export default function VenueMode({ onPick }: { onPick: (artist: string) => void }) {
  const [city, setCity] = useState("");
  const [venue, setVenue] = useState("");
  const [room, setRoom] = useState("small");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<Result | null>(null);

  async function look(e: React.FormEvent) {
    e.preventDefault();
    if (!city.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/venue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city: city.trim(), venue: venue.trim() || undefined, room }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `Lookup failed (${r.status}).`);
      setRes(j);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 grid gap-6 lg:grid-cols-[360px_1fr]">
      <form onSubmit={look} className="flex flex-col gap-4 self-start rounded-lg border-2 border-ink bg-panel p-5">
        <p className="text-muted">For talent buyers: find acts whose listeners are concentrated in your city, sized for your room.</p>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">City</span>
          <input className="field" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Richmond, VA" required />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Venue (optional)</span>
          <input className="field" value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Your room's name, to match its crowd" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Room size</span>
          <select className="field" value={room} onChange={(e) => setRoom(e.target.value)}>
            <option value="small">Up to about 300</option>
            <option value="mid">About 300 to 1,000</option>
          </select>
        </label>
        <button disabled={busy || !city.trim()} className="wide rounded-md bg-route px-4 py-3 text-base font-bold text-white disabled:opacity-50">
          {busy ? "Looking…" : "Find acts for this room"}
        </button>
      </form>

      <div className="flex flex-col gap-4">
        {res?.mode === "sample" && (
          <p className="rounded-md border-2 border-hot bg-[#fff8dc] px-4 py-2 text-sm">
            Sample data: this deployment has no Qloo key yet, so the acts below are placeholders.
          </p>
        )}
        {error && <p className="rounded-md border-2 border-route bg-white px-4 py-2 text-route">{error}</p>}
        {!res && !error && (
          <div className="rounded-lg border border-dashed border-muted p-5 text-muted">
            Results list acts whose fans over-index in the city (or in your venue&apos;s crowd, if Qloo knows the room),
            filtered to a popularity band that fits the room. Pick one to plan a routing that runs through your city.
          </div>
        )}
        {res && (
          <div className="rounded-lg border-2 border-ink bg-panel p-5">
            <h2 className="display text-2xl font-extrabold">
              Acts for {res.venue ? `${res.venue.name}, ` : ""}
              {res.city}
            </h2>
            <ol className="mt-3 divide-y divide-line">
              {res.artists.map((a, i) => (
                <li key={a.name} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <div>
                    <span className="mr-2 tabular-nums text-muted">{i + 1}.</span>
                    <span className="font-semibold">{a.name}</span>
                    {a.genres.length > 0 && <span className="ml-2 text-sm text-muted">{a.genres.slice(0, 2).join(", ")}</span>}
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="whitespace-nowrap tabular-nums">
                      Local match <b>{a.affinity !== undefined ? Math.round(a.affinity * 100) : "n/a"}</b>
                    </span>
                    <span className="whitespace-nowrap tabular-nums text-muted">
                      Popularity {a.popularity !== undefined ? Math.round(a.popularity * 100) : "n/a"}
                    </span>
                    <button type="button" onClick={() => onPick(a.name)} className="rounded-md border border-ink px-2.5 py-1 font-semibold hover:bg-paper">
                      Plan a tour for this act
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}
