// Run the agent once against a running TourScout server and save the result as a homepage example.
// Usage: node scripts/make-example.mjs <id> "<title>" "<blurb>" '<request json>' [baseUrl]
import { readFileSync, writeFileSync } from "node:fs";

const [id, title, blurb, bodyJson, base = "http://localhost:3311"] = process.argv.slice(2);
if (!id || !bodyJson) {
  console.error('usage: node scripts/make-example.mjs <id> "<title>" "<blurb>" \'<request json>\' [baseUrl]');
  process.exit(1);
}
const body = JSON.parse(bodyJson);
const post = (path) => fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const run = {
  input: {
    artist: body.artist,
    region: body.region ?? "na",
    homeCity: body.homeCity ?? "",
    played: (body.playedCities ?? []).join("; "),
    dates: body.dates ?? 6,
    maxDriveHours: body.maxDriveHours ?? 7,
    notes: body.notes ?? "",
    startDate: body.startDate ?? "",
  },
  trace: [],
  cities: [],
  calls: [],
  baseline: [],
};

const [baseRes, scoutRes] = await Promise.all([post("/api/baseline"), post("/api/scout")]);
const b = await baseRes.json();
run.baseline = b.cities ?? [];
run.baselineUnmatched = b.unmatched ?? [];
run.baselineChecks = b.checks;

for (const line of (await scoutRes.text()).split("\n")) {
  if (!line.trim()) continue;
  const e = JSON.parse(line);
  if (e.type === "status") run.trace.push({ kind: "status", text: e.text });
  if (e.type === "thinking") run.trace.push({ kind: "note", text: e.text });
  if (e.type === "tool") run.trace.push({ kind: "tool", text: e.summary });
  if (e.type === "error") run.trace.push({ kind: "error", text: e.text });
  if (e.type === "qloo") run.calls = e.calls;
  if (e.type === "map") Object.assign(run, { cities: e.cities, home: e.home });
  if (e.type === "plan") run.plan = e.plan;
}
if (!run.plan) {
  console.error("no plan in the response", run.trace.slice(-3));
  process.exit(1);
}

writeFileSync(`public/examples/${id}.json`, JSON.stringify(run));
const indexPath = "public/examples/index.json";
const index = JSON.parse(readFileSync(indexPath, "utf8")).filter((x) => x.id !== id);
index.push({ id, title, blurb });
writeFileSync(indexPath, JSON.stringify(index, null, 2));
console.log(`saved ${id}: ${run.plan.headline}`);
