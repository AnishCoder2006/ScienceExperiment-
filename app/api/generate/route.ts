import { getConcept } from "@/lib/concepts";
import { generateDiagram } from "@/lib/pipeline";
import type { PipelineEvent } from "@/lib/types";

// POST /api/generate  { "conceptId": 3 }
// Runs Part A live for one concept and streams progress as NDJSON (one JSON object per line):
//   {"type":"status","message":"Asking gemini-3.5-flash-lite for a diagram…"}
//   {"type":"attempt","attempt":1,"failed":["Inside viewBox"]}
//   {"type":"result","result":{...}}   or   {"type":"error","message":"..."}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Vercel stops the function after this many seconds. */
export const maxDuration = 300;
/** Our own budget is a bit shorter, so the user gets a clear error instead of a cut connection. */
const TIME_BUDGET_MS = 290_000;

export async function POST(request: Request) {
  let conceptId: unknown;
  try {
    ({ conceptId } = await request.json());
  } catch {
    return Response.json({ error: 'Send JSON like {"conceptId": 1}.' }, { status: 400 });
  }

  const concept = getConcept(Number(conceptId));
  if (!concept) return Response.json({ error: `Unknown concept: ${String(conceptId)}.` }, { status: 400 });
  if (!process.env.GEMINI_API_KEY) {
    return Response.json({ error: "The server has no GEMINI_API_KEY set, so live generation is turned off." }, { status: 500 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: PipelineEvent) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        const result = await generateDiagram(concept, { deadline: Date.now() + TIME_BUDGET_MS, onEvent: send });
        send({ type: "result", result });
      } catch (e) {
        console.error(`Generate failed for concept ${concept.id}:`, e);
        send({ type: "error", message: e instanceof Error ? e.message : "Unknown error while generating." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
