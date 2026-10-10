// Small in-memory limiter so a public demo can't drain the API budget.
// Per serverless instance only, which is fine for a demo.
const hits = new Map<string, number[]>();

export function allow(ip: string, limit = Number(process.env.RUNS_PER_HOUR ?? 6)) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3600_000);
  if (recent.length >= limit) return false;
  recent.push(now);
  hits.set(ip, recent);
  return true;
}
