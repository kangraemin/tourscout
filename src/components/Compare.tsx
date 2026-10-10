import type { CityScore, Plan } from "@/lib/agent";

// Scores both city lists against the same Qloo heatmap so the difference is measured, not asserted.
export default function Compare({ plan, baseline, cities }: { plan: Plan; baseline: { label: string }[]; cities: CityScore[] }) {
  if (!baseline.length || !cities.length) return null;
  const aff = new Map(cities.map((c) => [c.city, c]));
  const rank = new Map([...cities].sort((a, b) => b.affinity - a.affinity).map((c, i) => [c.city, i + 1]));
  const row = (label: string) => ({ label, score: aff.get(label)?.affinity, rank: rank.get(label), played: aff.get(label)?.played });
  const ours = plan.stops.map((s) => row(s.city));
  const theirs = baseline.map((b) => row(b.label));
  const avg = (xs: { score?: number }[]) => {
    const v = xs.map((x) => x.score ?? 0);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
  };
  const a = avg(ours);
  const b = avg(theirs);

  const List = ({ rows }: { rows: ReturnType<typeof row>[] }) => (
    <ul className="mt-3 divide-y divide-line">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center justify-between gap-3 py-2">
          <span>
            {r.label}
            {r.played && <span className="ml-2 text-sm text-route">already played</span>}
          </span>
          <span className="text-sm tabular-nums text-muted">
            {r.score !== undefined ? `${(r.score * 100).toFixed(0)} · #${r.rank} of ${cities.length}` : "no taste signal"}
          </span>
        </li>
      ))}
    </ul>
  );

  return (
    <section className="mt-10 rounded-lg border-2 border-ink bg-panel p-5">
      <h2 className="display text-2xl font-extrabold">Same question, without taste data</h2>
      <p className="mt-1 max-w-[72ch] text-muted">
        We asked the same model to pick {plan.stops.length} cities with no Qloo access, then scored both lists on the same
        heatmap. Taste match runs 0 to 100.
      </p>
      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <div>
          <p className="font-semibold">
            TourScout with Qloo <span className="ml-2 rounded bg-hot px-2 py-0.5 tabular-nums">avg {(a * 100).toFixed(0)}</span>
          </p>
          <List rows={ours} />
        </div>
        <div>
          <p className="font-semibold">
            Model alone <span className="ml-2 rounded bg-paper px-2 py-0.5 tabular-nums">avg {(b * 100).toFixed(0)}</span>
          </p>
          <List rows={theirs} />
        </div>
      </div>
    </section>
  );
}
