import { NextRequest } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { applicationTag } from "@/lib/data/applications";
import { favouriteTag } from "@/lib/data/favourites";
import { streamCoverLetter } from "@/lib/coverLetter";
import { readCvText } from "@/lib/cv";
import { auth } from "@/auth";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Pause between chunks; enough to animate, short enough to feel instant. */
const STREAM_DELAY_MS = 12;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const userId = session.user.id;

  const body = await req.json().catch(() => ({}));
  const jobId: string = body.jobId ?? "";

  if (!jobId) {
    return new Response("Missing jobId", { status: 400 });
  }

  const job = await prisma.jobPosting.findUnique({ where: { id: jobId } });
  if (!job) {
    return new Response("Job not found", { status: 404 });
  }

  const userProfile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { coverLetterLanguage: true },
  });
  const language = userProfile?.coverLetterLanguage ?? "English";

  const cvText = await readCvText(userId).catch(() => "");

  const encoder = new TextEncoder();
  const transform = new TransformStream<Uint8Array, Uint8Array>();
  const writer = transform.writable.getWriter();

  const send = (payload: Record<string, unknown>) =>
    writer.write(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

  (async () => {
    let fullContent = "";
    try {
      // Chunked rather than emitted whole so the existing typing animation in
      // StreamingCoverLetterDialog still reads as text arriving.
      for (const token of streamCoverLetter({
        jobTitle: job.title,
        company: job.company,
        jobDescription: job.description,
        cvText,
        language,
      })) {
        fullContent += token;
        await send({ token });
        await new Promise((resolve) => setTimeout(resolve, STREAM_DELAY_MS));
      }

      // Persist cover letter, link it to the application (if one exists), and auto-favourite
      const coverLetter = await prisma.coverLetter.create({
        data: { userId, jobId, content: fullContent, generatedFromTemplate: true },
      });

      const application = await prisma.application.findFirst({ where: { userId, jobId } });

      await prisma.$transaction([
        ...(application
          ? [prisma.application.update({
            where: { id: application.id },
            data: { coverLetterId: coverLetter.id },
          })]
          : []),
        prisma.userFavourite.upsert({
          where: { userId_jobId: { userId, jobId } },
          create: { userId, jobId },
          update: {},
        }),
      ]);

      revalidateTag(applicationTag(userId), "default");
      revalidateTag(favouriteTag(userId), "default");
      revalidatePath("/dashboard");
      revalidatePath("/favourites");

      await send({ done: true });
    } catch (err) {
      await send({ error: String(err) });
    } finally {
      await writer.close();
    }
  })();

  return new Response(transform.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
