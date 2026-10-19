import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { requestResume } from "@/lib/apply/humanWait";
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
  const applicationId = typeof fields.applicationId === "string" ? fields.applicationId : "";
  if (!APPLICATION_ID.test(applicationId)) return jsonError("Missing applicationId", 400);

  const owned = await prisma.application.findFirst({ where: { id: applicationId, userId }, select: { id: true } });
  if (!owned) return jsonError("Not found", 404);

  return Response.json({ ok: true, waiting: requestResume(applicationId) });
}
