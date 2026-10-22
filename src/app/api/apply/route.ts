import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { loadApplyInput, runApply, type ApplyInput } from "@/lib/apply/runner";
import type { ApplyEvent } from "@/lib/apply/types";
import { isRecord } from "@/lib/guards";

export const runtime = "nodejs";
export const maxDuration = 600;

const APPLICATION_ID = /^[a-z0-9]{10,40}$/i;
const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

const jsonError = (error: string, status: number) =>
  new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json" } });

function streamApply(input: ApplyInput, mode: { dryRun: boolean; autoSubmit: boolean }): Response {
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  let closed = false;
  const emit = (event: ApplyEvent) => {
    if (closed) return;
    writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)).catch(() => {
      closed = true;
    });
  };
  void runApply(input, emit, mode).finally(() => {
    closed = true;
    writer.close().catch(() => undefined);
  });
  return new Response(readable, { headers: SSE_HEADERS });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return jsonError("Unauthorized", 401);

  const body: unknown = await req.json().catch(() => null);
  const fields = isRecord(body) ? body : {};
  const applicationId = typeof fields.applicationId === "string" ? fields.applicationId : "";
  if (!APPLICATION_ID.test(applicationId)) return jsonError("Missing applicationId", 400);

  const loaded = await loadApplyInput(applicationId, userId);
  if ("code" in loaded) return jsonError(loaded.message, loaded.code);
  return streamApply(loaded, { dryRun: fields.dryRun === true, autoSubmit: fields.autoSubmit === true });
}
