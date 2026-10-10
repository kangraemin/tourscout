"use client";

import { useState } from "react";
import type { Plan } from "@/lib/agent";

export default function Itinerary({ plan, home }: { plan: Plan; home?: { label: string } }) {
  const [copied, setCopied] = useState<number | null>(null);

  function asText() {
    const lines = [`${plan.artist}: ${plan.headline}`, "", plan.summary, ""];
    plan.stops.forEach((s, i) => {
      lines.push(`${i + 1}. ${s.city} (${s.driveHoursFromPrev}h drive)`);
      lines.push(`   Venue: ${s.venue.name}${s.venue.alternates.length ? ` (backup: ${s.venue.alternates.join(", ")})` : ""}`);
      if (s.openers.length) lines.push(`   Openers: ${s.openers.map((o) => o.name).join(", ")}`);
      lines.push(`   Why: ${s.why}`);
      lines.push("");
    });
    return lines.join("\n");
  }

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-ink pb-3">
        <div>
          <h2 className="display text-3xl font-extrabold">{plan.headline}</h2>
          <p className="mt-1 max-w-[70ch] text-muted">{plan.summary}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => navigator.clipboard.writeText(asText()).then(() => setCopied(-1))}
            className="rounded-md border-2 border-ink bg-panel px-3 py-2 font-semibold"
          >
            {copied === -1 ? "Copied" : "Copy plan"}
          </button>
          <button onClick={() => window.print()} className="rounded-md border-2 border-ink bg-panel px-3 py-2 font-semibold">
            Print day sheet
          </button>
        </div>
      </div>

      <ol className="mt-2">
        {home && (
          <li className="flex items-center gap-3 py-3 text-muted">
            <span className="shield red">H</span>
            Leave from {home.label}
          </li>
        )}
        {plan.stops.map((s, i) => (
          <li key={s.city} className="relative">
            <p className="ml-[15px] border-l-4 border-dotted border-route py-2 pl-6 text-sm text-muted">
              {s.driveHoursFromPrev > 0 ? `About ${s.driveHoursFromPrev} h on the road` : "First show"}
            </p>
            <article className="grid gap-4 rounded-lg border-2 border-ink bg-panel p-5 md:grid-cols-[1.1fr_1fr]">
              <div>
                <div className="flex items-center gap-3">
                  <span className="shield">{i + 1}</span>
                  <h3 className="display text-2xl font-extrabold">{s.city}</h3>
                  {s.affinity > 0 && (
                    <span className="rounded bg-hot px-2 py-0.5 text-sm font-semibold">taste match {(s.affinity * 100).toFixed(0)}</span>
                  )}
                </div>
                <p className="mt-3 max-w-[62ch]">{s.why}</p>
                <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div>
                    <dt className="text-sm text-muted">Pitch this room</dt>
                    <dd className="font-semibold">{s.venue.name}</dd>
                    <dd className="text-sm">{s.venue.why}</dd>
                    {s.venue.alternates.length > 0 && <dd className="mt-1 text-sm text-muted">Backup: {s.venue.alternates.join(", ")}</dd>}
                  </div>
                  <div>
                    <dt className="text-sm text-muted">Ask to open</dt>
                    {s.openers.map((o) => (
                      <dd key={o.name}>
                        <span className="font-semibold">{o.name}</span> <span className="text-sm">{o.why}</span>
                      </dd>
                    ))}
                  </div>
                </dl>
              </div>
              <div className="rounded-md bg-paper p-4">
                <p className="text-sm text-muted">Promo angle</p>
                <p className="font-semibold">{s.promo.angle}</p>
                {s.promo.partners.length > 0 && <p className="mt-2 text-sm">Local partners worth a DM: {s.promo.partners.join(", ")}</p>}
                <blockquote className="mt-3 border-l-4 border-shield bg-white p-3 text-[15px]">{s.promo.copy}</blockquote>
                <button
                  onClick={() => navigator.clipboard.writeText(s.promo.copy).then(() => setCopied(i))}
                  className="mt-2 text-sm font-semibold text-shield underline"
                >
                  {copied === i ? "Copied" : "Copy post"}
                </button>
              </div>
            </article>
          </li>
        ))}
      </ol>

      {(plan.skipped.length > 0 || plan.risks.length > 0) && (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {plan.skipped.length > 0 && (
            <div className="rounded-lg border border-line bg-panel p-5">
              <h3 className="display text-xl font-extrabold">Strong cities left off this run</h3>
              <ul className="mt-2 space-y-2">
                {plan.skipped.map((s) => (
                  <li key={s.city}>
                    <span className="font-semibold">{s.city}</span>: {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {plan.risks.length > 0 && (
            <div className="rounded-lg border border-line bg-panel p-5">
              <h3 className="display text-xl font-extrabold">Check before you book</h3>
              <ul className="mt-2 list-disc space-y-2 pl-5">
                {plan.risks.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
