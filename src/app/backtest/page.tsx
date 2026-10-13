import fs from "node:fs";
import path from "node:path";
import Link from "next/link";

export const metadata = { title: "TourScout backtest" };

type Row = {
  artist: string;
  playedBefore: number;
  newCities: string[];
  picks: Record<string, string[]>;
  hits: Record<string, string[]>;
};
type Result = {
  generatedAt: string;
  before: { from: string; to: string };
  after: { from: string };
  k: number;
  qlooMode: string;
  artists: number;
  summary: Record<
    string,
    { hits: number; picks: number; hitRate: number; artistsWithAHit: number }
  >;
  rows: Row[];
};

const METHODS: [string, string][] = [
  ["modelQloo", "Model + Qloo shortlist (what TourScout does)"],
  ["model", "Same model, no Qloo"],
  ["qlooSized", "Qloo taste weighted by city size"],
  ["qloo", "Qloo taste only"],
  ["population", "Biggest metros"],
];

function load(): Result | null {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "public/backtest.json"), "utf8"),
    );
  } catch {
    return null;
  }
}

export default function Backtest() {
  const r = load();
  return (
    <main className="mx-auto max-w-[1100px] px-4 py-8 sm:px-8">
      <Link href="/" className="text-sm font-semibold underline">
        Back to TourScout
      </Link>
      <h1 className="display mt-4 text-4xl font-extrabold">
        Did the taste data point at real tour stops?
      </h1>
      <p className="mt-3 max-w-[70ch]">
        For each band we took their real North American shows from setlist.fm.
        Cities played from {r?.before.from ?? "2025-07-01"} up to{" "}
        {r?.before.to ?? "2026-07-01"} count as already played. Then each method
        names {r?.k ?? 10} cities the band hasn&apos;t played, and we check
        which of them the band actually played from{" "}
        {r?.after.from ?? "2026-07-01"} on.
      </p>
      <p className="mt-3 max-w-[70ch]">
        What the numbers say: Qloo&apos;s taste map, weighted by city size, beats
        just picking the biggest metros. On the cities where those two
        disagree, the Qloo picks were real stops 21% of the time against 15%.
        Adding Qloo&apos;s shortlist to the model barely moved its hit rate. Two
        caveats. Most shows in this window were announced months ahead, before
        the model&apos;s training cutoff, so the model may simply remember them.
        And this test rewards guessing where a band already goes. TourScout is
        built to find the cities the usual routing skips, and a test like this
        can&apos;t reward that. 24 bands is a small sample.
      </p>

      {!r && (
        <p className="mt-6 rounded-lg border border-dashed border-muted p-5 text-muted">
          No results yet. Run <code>npx tsx scripts/backtest.ts</code> with
          setlist.fm, Qloo and Anthropic keys to produce them.
        </p>
      )}

      {r && (
        <>
          {r.qlooMode !== "live" && (
            <p className="mt-4 rounded-md border-2 border-hot bg-[#fff8dc] px-4 py-2 text-sm">
              These numbers were produced with sample Qloo data, not the live
              API.
            </p>
          )}
          <div className="mt-6 overflow-x-auto rounded-lg border-2 border-ink bg-panel">
            <table className="w-full min-w-[520px] text-left">
              <thead className="border-b-2 border-ink">
                <tr>
                  <th className="p-3">Method</th>
                  <th className="p-3">Picks that were real stops</th>
                  <th className="p-3">Hit rate</th>
                  <th className="p-3">Bands with at least one hit</th>
                </tr>
              </thead>
              <tbody>
                {METHODS.map(([k, label]) => {
                  const s = r.summary[k];
                  if (!s) return null;
                  return (
                    <tr key={k} className="border-b border-line last:border-0">
                      <td className="p-3 font-semibold">{label}</td>
                      <td className="p-3 tabular-nums">
                        {s.hits} of {s.picks}
                      </td>
                      <td className="p-3 tabular-nums">
                        {Math.round(s.hitRate * 100)}%
                      </td>
                      <td className="p-3 tabular-nums">
                        {s.artistsWithAHit} of {r.artists}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <h2 className="display mt-10 text-2xl font-extrabold">
            Band by band
          </h2>
          <div className="mt-3 grid gap-4">
            {r.rows.map((row) => (
              <article
                key={row.artist}
                className="rounded-lg border border-line bg-panel p-4"
              >
                <h3 className="font-bold">
                  {row.artist}{" "}
                  <span className="font-normal text-muted">
                    {row.playedBefore} cities before, {row.newCities.length} new
                    cities after
                  </span>
                </h3>
                <dl className="mt-2 grid gap-2 text-sm md:grid-cols-2 lg:grid-cols-4">
                  {METHODS.map(([k, label]) => {
                    const picks = row.picks[k] ?? [];
                    const hits = row.hits[k] ?? [];
                    return (
                      <div key={k}>
                        <dt className="text-muted">
                          {label}: {hits.length} hit
                          {hits.length === 1 ? "" : "s"}
                        </dt>
                        <dd>
                          {picks.map((c, i) => (
                            <span
                              key={c}
                              className={
                                hits.includes(c) ? "font-bold text-shield" : ""
                              }
                            >
                              {c}
                              {i < picks.length - 1 ? "; " : ""}
                            </span>
                          ))}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </article>
            ))}
          </div>
          <p className="mt-6 text-sm text-muted">
            Generated {r.generatedAt.slice(0, 10)}. Script: scripts/backtest.ts.
            Show data from{" "}
            <a className="underline" href="https://www.setlist.fm">
              setlist.fm
            </a>
            .
          </p>
        </>
      )}
    </main>
  );
}
