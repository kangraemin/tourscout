import type { QlooCall } from "@/lib/qloo";

export default function CallLog({ calls, trace }: { calls: QlooCall[]; trace: { kind: string; text: string }[] }) {
  return (
    <details className="mt-10 rounded-lg border border-line bg-panel p-5">
      <summary className="cursor-pointer font-semibold">
        How the agent got here: {trace.filter((t) => t.kind === "tool").length} steps, {calls.length} Qloo requests
      </summary>
      <ol className="mt-4 space-y-1 text-sm">
        {trace.map((t, i) => (
          <li key={i} className={t.kind === "note" ? "text-muted" : ""}>
            {t.kind === "tool" ? "✓ " : ""}
            {t.text}
          </li>
        ))}
      </ol>
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-muted">
            <tr>
              <th className="py-1 pr-3 font-semibold">Endpoint</th>
              <th className="py-1 pr-3 font-semibold">Key parameters</th>
              <th className="py-1 pr-3 text-right font-semibold">Results</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((c, i) => (
              <tr key={i} className="border-t border-line align-top">
                <td className="py-1.5 pr-3 font-semibold">{c.path}</td>
                <td className="py-1.5 pr-3 break-all">
                  {Object.entries(c.params)
                    .filter(([k]) => k !== "take")
                    .map(([k, v]) => `${k}=${v.length > 60 ? v.slice(0, 57) + "…" : v}`)
                    .join("  ")}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{c.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
