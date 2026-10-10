import { runScout, ScoutEvent, ScoutInput } from "@/lib/agent";
import { allow } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const parsed = ScoutInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Bad input" }, { status: 400 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!allow(ip)) {
    return Response.json(
      { error: "This demo allows a few live runs per hour per visitor. The example tours on the home page are always available." },
      { status: 429 },
    );
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: ScoutEvent) => controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      try {
        await runScout(parsed.data, emit);
      } catch (err: any) {
        emit({ type: "error", text: err?.message ?? "Something went wrong" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
