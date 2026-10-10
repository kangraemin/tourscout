// Small in-memory limiter so a public demo can't drain the API budget.
// Per serverless instance only, which is fine for a demo.
const hits = new Map<string, number[]>();
const DAY = "__day__";

export function allow(ip: string, limit = Number(process.env.RUNS_PER_HOUR ?? 6)) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3600_000);
  if (recent.length >= limit) return false;
  // Site-wide cap across all visitors, counted on agent runs only.
  if (!ip.includes(":")) {
    const day = (hits.get(DAY) ?? []).filter((t) => now - t < 86_400_000);
    if (day.length >= Number(process.env.RUNS_PER_DAY ?? 150)) return false;
    day.push(now);
    hits.set(DAY, day);
  }
  recent.push(now);
  hits.set(ip, recent);
  return true;
}
