import type { CityScore, Plan } from "@/lib/agent";
import type { BaselineChecks } from "@/app/page";

type Props = {
  plan: Plan;
  baseline: { label: string }[];
  unmatched?: string[];
  checks?: BaselineChecks;
  cities: CityScore[];
  maxDrive: number;
};

// Puts the agent's plan next to what the same model picks with no Qloo access.
// Taste is scored on the heatmap the agent used, so the booking checks below are the independent half.
export default function Compare({ plan, baseline, unmatched = [], checks, cities, maxDrive }: Props) {
  if (!baseline.length || !cities.length) return null;
  const aff = new Map(cities.map((c) => [c.city, c]));
  const rank = new Map([...cities].sort((a, b) => b.affinity - a.affinity).map((c, i) => [c.city, i + 1]));
  const row = (label: string) => ({ label, score: aff.get(label)?.affinity, rank: rank.get(label), played: aff.get(label)?.played });
  const ours = plan.stops.map((s) => row(s.city));
  const theirs = baseline.map((b) => row(b.label));
  const scored = (xs: { score?: number }[]) => xs.filter((x) => x.score !== undefined);
  const avg = (xs: { score?: number }[]) => {
    const v = scored(xs).map((x) => x.score!);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined;
  };
  const a = avg(ours);
  const b = avg(theirs);
  const ourLongest = Math.max(0, ...plan.stops.map((s) => s.driveHoursFromPrev));
  const fmt = (x?: number) => (x === undefined ? "n/a" : (x * 100).toFixed(0));

  const List = ({ rows }: { rows: ReturnType<typeof row>[] }) => (
    <ul className="mt-3 divide-y divide-line">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center justify-between gap-3 py-2">
          <span>
            {r.label}
            {r.played && <span className="ml-2 text-sm text-route">already played</span>}
          </span>
          <span className="text-sm tabular-nums text-muted">
            {r.score !== undefined ? `${fmt(r.score)} · #${r.rank} of ${cities.length}` : `not in the top ${cities.length}`}
          </span>
        </li>
      ))}
    </ul>
  );

  return (
    <section className="mt-10 rounded-lg border-2 border-ink bg-panel p-5">
      <h2 className="display text-2xl font-extrabold">Same question, without taste data</h2>
      <p className="mt-1 max-w-[72ch] text-muted">
        We gave the same model the same brief with no Qloo access. Its cities are checked against the same booking rules,
        then scored on the heatmap. The heatmap is what TourScout optimises for, so read the taste column as &quot;what the
        model can&apos;t see&quot;, not as an independent test.
      </p>

      <table className="mt-4 w-full max-w-[640px] text-left text-sm tabular-nums">
        <thead>
          <tr className="border-b border-line text-muted">
            <th className="py-1.5 font-normal">Check</th>
            <th className="py-1.5 font-semibold">TourScout</th>
            <th className="py-1.5 font-semibold">Model alone</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          <tr>
            <td className="py-1.5">Cities named</td>
            <td>{plan.stops.length}</td>
            <td>
              {baseline.length}
              {unmatched.length > 0 && <span className="text-muted"> (+{unmatched.length} not found: {unmatched.join(", ")})</span>}
            </td>
          </tr>
          <tr>
            <td className="py-1.5">Legs over {maxDrive} h</td>
            <td>{plan.checks?.legsOver ?? "n/a"}</td>
            <td>{checks ? checks.legsOver : "n/a"}</td>
          </tr>
          <tr>
            <td className="py-1.5">Longest leg</td>
            <td>{ourLongest} h</td>
            <td>{checks ? `${checks.longestLeg} h` : "n/a"}</td>
          </tr>
          <tr>
            <td className="py-1.5">Radius-clause clashes</td>
            <td>{plan.checks?.radiusConflicts ?? "n/a"}</td>
            <td>{checks ? checks.radiusConflicts : "n/a"}</td>
          </tr>
          <tr>
            <td className="py-1.5">Average taste match (0 to 100)</td>
            <td>
              <span className="rounded bg-hot px-1.5">{fmt(a)}</span>
            </td>
            <td>
              {fmt(b)}
              {scored(theirs).length < theirs.length && <span className="text-muted"> ({theirs.length - scored(theirs).length} with no signal left out)</span>}
            </td>
          </tr>
        </tbody>
      </table>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div>
          <p className="font-semibold">TourScout with Qloo</p>
          <List rows={ours} />
        </div>
        <div>
          <p className="font-semibold">Model alone</p>
          <List rows={theirs} />
        </div>
      </div>
    </section>
  );
}
