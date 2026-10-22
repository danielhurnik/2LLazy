import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { requestResume, requestResumeAll, waitingApplicationIds } from "@/lib/apply/humanWait";
import { sweepStaleApplyRuns } from "@/lib/apply/runner";
import { isRecord } from "@/lib/guards";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const APPLICATION_ID = /^[a-z0-9]{10,40}$/i;

const jsonError = (error: string, status: number) =>
  new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json" } });

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return jsonError("Unauthorized", 401);

  const body: unknown = await req.json().catch(() => null);
  const fields = isRecord(body) ? body : {};

  if (fields.all === true) {
    const waiting = waitingApplicationIds();
    const owned = waiting.length
      ? await prisma.application.findMany({ where: { id: { in: waiting }, userId }, select: { id: true } })
      : [];
    const resumed = requestResumeAll(owned.map((row) => row.id));
    const swept = await sweepStaleApplyRuns(userId);
    return Response.json({ ok: true, resumed, swept });
  }

  const applicationId = typeof fields.applicationId === "string" ? fields.applicationId : "";
  if (!APPLICATION_ID.test(applicationId)) return jsonError("Missing applicationId", 400);

  const owned = await prisma.application.findFirst({ where: { id: applicationId, userId }, select: { id: true } });
  if (!owned) return jsonError("Not found", 404);

  return Response.json({ ok: true, waiting: requestResume(applicationId) });
}
