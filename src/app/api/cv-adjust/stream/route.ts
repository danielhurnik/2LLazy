/**
 * CV match report.
 *
 * This endpoint used to send the user's CV and the job ad to GPT-4o and stream
 * back a rewritten CV. It now streams a deterministic report instead: which of
 * the posting's requirements the CV already evidences, which it does not, and
 * the CV line backing each match. Nothing is rewritten and nothing is invented.
 *
 * The SSE wire format is unchanged (`{token}` … `{done:true}` / `{error}`) so
 * the existing dialog keeps working.
 */
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { readCvText } from "@/lib/cv";
import { auth } from "@/auth";
import { buildCvMatchReport, renderCvMatchMarkdown } from "@/lib/cvMatch";
import { chunkForStreaming } from "@/lib/coverLetter";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Pause between chunks so the report renders progressively rather than at once. */
const STREAM_DELAY_MS = 8;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const userId = session.user.id;

  const body = await req.json().catch(() => ({}));
  const { jobId } = body as { jobId?: string };

  if (!jobId) {
    return new Response("Missing jobId", { status: 400 });
  }

  const job = await prisma.jobPosting.findUnique({ where: { id: jobId } });
  if (!job) return new Response("Job not found", { status: 404 });

  const cvText = await readCvText(userId).catch(() => "");
  if (!cvText) {
    return new Response(
      `data: ${JSON.stringify({ error: "No CV uploaded. Please upload your CV in Settings first." })}\n\n`,
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );
  }

  const encoder = new TextEncoder();
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();

  const send = (payload: Record<string, unknown>) =>
    writer.write(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

  (async () => {
    try {
      const report = buildCvMatchReport(cvText, {
        title: job.title,
        company: job.company,
        description: job.description,
      });
      const markdown = renderCvMatchMarkdown(report, { title: job.title, company: job.company });

      for (const token of chunkForStreaming(markdown)) {
        await send({ token });
        await new Promise((resolve) => setTimeout(resolve, STREAM_DELAY_MS));
      }
      await send({ done: true });
    } catch (err) {
      await send({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      await writer.close().catch(() => {});
    }
  })();

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
