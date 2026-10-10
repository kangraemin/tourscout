"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { CityScore, Plan, ScoutEvent } from "@/lib/agent";
import type { QlooCall } from "@/lib/qloo";
import { REGIONS, regionById } from "@/lib/regions";
import Itinerary from "@/components/Itinerary";
import Compare from "@/components/Compare";
import CallLog from "@/components/CallLog";

const TourMap = dynamic(() => import("@/components/TourMap"), { ssr: false });

type Form = {
  artist: string;
  region: string;
  homeCity: string;
  played: string;
  dates: number;
  maxDriveHours: number;
  notes: string;
  startDate: string;
};

export type BaselineChecks = { legsOver: number; longestLeg: number; totalDrive: number; radiusConflicts: number };

export type Run = {
  input: Form;
  trace: { kind: string; text: string }[];
  cities: CityScore[];
  home?: { label: string; lat: number; lon: number };
  plan?: Plan;
  calls: QlooCall[];
  baseline: { label: string; lat: number; lon: number }[];
  baselineUnmatched?: string[];
  baselineChecks?: BaselineChecks;
};

type Example = { id: string; title: string; blurb: string };

const EMPTY: Form = { artist: "", region: "na", homeCity: "", played: "", dates: 6, maxDriveHours: 7, notes: "", startDate: "" };

export default function Home() {
  const [form, setForm] = useState<Form>(EMPTY);
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [examples, setExamples] = useState<Example[]>([]);

  useEffect(() => {
    fetch("/examples/index.json")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Example[]) => {
        setExamples(list);
        // Open on a finished plan so the first screen shows what the tool produces.
        if (list[0]) loadExample(list[0].id, false);
      })
      .catch(() => setExamples([]));
  }, []);

  const region = regionById(form.region);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function loadExample(id: string, scroll = true) {
    setError(null);
    const r = await fetch(`/examples/${id}.json`);
    if (!r.ok) return setError("That example could not be loaded. Try another one or run your own.");
    const saved: Run = await r.json();
    setForm({ ...EMPTY, ...saved.input });
    setRun(saved);
    if (scroll) document.getElementById("results")?.scrollIntoView({ behavior: "smooth" });
  }

  async function scout(e: React.FormEvent) {
    e.preventDefault();
    if (!form.artist.trim() || busy) return;
    setBusy(true);
    setError(null);
    const body = {
      artist: form.artist.trim(),
      region: form.region,
      homeCity: form.homeCity.trim() || undefined,
      playedCities: form.played.split(/[;\n]/).map((s) => s.trim()).filter(Boolean),
      dates: form.dates,
      maxDriveHours: form.maxDriveHours,
      notes: form.notes.trim() || undefined,
      startDate: form.startDate || undefined,
    };
    const fresh: Run = { input: form, trace: [], cities: [], calls: [], baseline: [] };
    setRun(fresh);

    fetch("/api/baseline", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => (r.ok ? r.json() : { cities: [] }))
      .then((d) => setRun((cur) => (cur ? { ...cur, baseline: d.cities ?? [], baselineUnmatched: d.unmatched, baselineChecks: d.checks } : cur)))
      .catch(() => {});

    try {
      const res = await fetch("/api/scout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `The scout request failed (${res.status}).`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) apply(JSON.parse(line) as ScoutEvent);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function apply(ev: ScoutEvent) {
    setRun((cur) => {
      if (!cur) return cur;
      const next = { ...cur };
      if (ev.type === "status") next.trace = [...cur.trace, { kind: "status", text: ev.text }];
      if (ev.type === "thinking") next.trace = [...cur.trace, { kind: "note", text: ev.text }];
      if (ev.type === "tool") next.trace = [...cur.trace, { kind: "tool", text: ev.summary }];
      if (ev.type === "qloo") next.calls = ev.calls;
      if (ev.type === "map") {
        next.cities = ev.cities;
        next.home = ev.home;
      }
      if (ev.type === "plan") next.plan = ev.plan;
      if (ev.type === "error") {
        next.trace = [...cur.trace, { kind: "error", text: ev.text }];
        setError(ev.text);
      }
      return next;
    });
  }

  const sample = run?.plan?.mode === "sample" || run?.calls.some((c) => c.mode === "sample");
  const stops = useMemo(() => run?.plan?.stops ?? [], [run?.plan]);

  return (
    <main className="mx-auto max-w-[1320px] px-4 pb-24 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-ink py-5">
        <div className="flex items-center gap-3">
          <span className="shield red" aria-hidden>
            TS
          </span>
          <h1 className="display text-3xl font-extrabold sm:text-4xl">TourScout</h1>
        </div>
        <p className="max-w-[46ch] text-muted">
          Type an artist and TourScout finds the cities where their kind of listener lives, then a room and an opener in
          each.
        </p>
      </header>

      <section className="mt-6 grid gap-6 lg:grid-cols-[360px_1fr]">
        <form onSubmit={scout} className="flex flex-col gap-4 self-start rounded-lg border-2 border-ink bg-panel p-5">
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Artist</span>
            <input className="field" value={form.artist} onChange={(e) => set("artist", e.target.value)} placeholder="e.g. Wednesday" required />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="font-semibold">Region</span>
              <select className="field" value={form.region} onChange={(e) => set("region", e.target.value)}>
                {REGIONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-semibold">Start from</span>
              <input className="field" value={form.homeCity} onChange={(e) => set("homeCity", e.target.value)} placeholder="Asheville, NC" />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Cities you&apos;ve already played</span>
            <textarea className="field min-h-[64px]" value={form.played} onChange={(e) => set("played", e.target.value)} placeholder="Separate with semicolons: Chicago, IL; Nashville, TN" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="font-semibold">Dates</span>
              <input type="number" min={2} max={12} className="field" value={form.dates} onChange={(e) => set("dates", Number(e.target.value))} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-semibold">Max drive</span>
              <select className="field" value={form.maxDriveHours} onChange={(e) => set("maxDriveHours", Number(e.target.value))}>
                {[4, 5, 6, 7, 8, 10, 12].map((h) => (
                  <option key={h} value={h}>
                    {h} hours
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-semibold">Earliest start</span>
              <input type="date" className="field" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Anything else the agent should know</span>
            <textarea className="field min-h-[64px]" value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="All-ages rooms only. Want one college town. Off on Mondays." />
          </label>
          <button disabled={busy || !form.artist.trim()} className="wide rounded-md bg-route px-4 py-3 text-base font-bold text-white disabled:opacity-50">
            {busy ? "Scouting…" : "Scout the tour"}
          </button>

          {examples.length > 0 && (
            <div className="border-t border-line pt-4">
              <p className="mb-2 font-semibold">Or open a finished example</p>
              <ul className="flex flex-col gap-2">
                {examples.map((x) => (
                  <li key={x.id}>
                    <button type="button" onClick={() => loadExample(x.id)} className="w-full rounded-md border border-line px-3 py-2 text-left hover:border-shield">
                      <span className="block font-semibold">{x.title}</span>
                      <span className="text-sm text-muted">{x.blurb}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </form>

        <div className={`flex flex-col gap-4 ${run ? "order-first lg:order-none" : ""}`} id="results">
          {sample && (
            <p className="rounded-md border-2 border-hot bg-[#fff8dc] px-4 py-2 text-sm">
              Sample data: this deployment has no Qloo key yet, so cities, venues and artists below are placeholders.
            </p>
          )}
          <div>
            <div className="relative h-[380px] overflow-hidden rounded-lg border-2 border-ink sm:h-[520px]">
              <TourMap cities={run?.cities ?? []} stops={stops} baseline={run?.baseline ?? []} home={run?.home} bbox={region.bbox} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-full bg-hot" /> Taste match (bigger = stronger)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-5 bg-route" /> Route
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-full border-2 border-dashed border-muted" /> Guess without Qloo
              </span>
            </div>
          </div>

          {error && <p className="rounded-md border-2 border-route bg-white px-4 py-2 text-route">{error}</p>}

          {run && (run.trace.length > 0 || busy) && !run.plan && (
            <ol className="rounded-lg border border-line bg-panel p-4 text-sm" aria-live="polite">
              {run.trace.map((t, i) => (
                <li key={i} className={`py-0.5 ${t.kind === "note" ? "text-muted" : ""} ${t.kind === "error" ? "text-route" : ""}`}>
                  {t.kind === "tool" ? "✓ " : ""}
                  {t.text}
                </li>
              ))}
              {busy && <li className="pulse py-0.5 text-shield">Working…</li>}
            </ol>
          )}

          {!run && (
            <div className="rounded-lg border border-dashed border-muted p-5 text-muted">
              The map fills in as the agent reads Qloo&apos;s taste heatmap. Yellow circles are cities where your
              audience&apos;s taste is common; the red line is the route it proposes.
            </div>
          )}
        </div>
      </section>

      {run?.plan && (
        <>
          <Itinerary plan={run.plan} home={run.home} />
          <Compare plan={run.plan} baseline={run.baseline} unmatched={run.baselineUnmatched} checks={run.baselineChecks} cities={run.cities} maxDrive={run.input.maxDriveHours} />
          <CallLog calls={run.calls} trace={run.trace} />
        </>
      )}

      <footer className="mt-16 border-t border-line pt-4 text-sm text-muted">
        Taste data from the Qloo API. Routes are straight-line estimates, so check real drive times before you book. Open
        source on{" "}
        <a className="underline" href="https://github.com/kangraemin/tourscout">
          GitHub
        </a>
        .
      </footer>
    </main>
  );
}
