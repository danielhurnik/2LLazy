import fs from "fs/promises";
import path from "path";
import { auth } from "@/auth";
import { EVIDENCE_ROOT } from "@/lib/apply/evidence";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const APPLICATION_ID = /^[a-z0-9]{10,40}$/i;

const jsonError = (error: string, status: number) =>
  new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json" } });

export async function GET(_req: Request, { params }: { params: Promise<{ applicationId: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return jsonError("Unauthorized", 401);

  const { applicationId } = await params;
  if (!APPLICATION_ID.test(applicationId)) return jsonError("Not found", 404);
  const owned = await prisma.application.findFirst({ where: { id: applicationId, userId }, select: { id: true } });
  if (!owned) return jsonError("Not found", 404);

  const entries = await fs.readdir(path.join(EVIDENCE_ROOT, applicationId)).catch(() => [] as string[]);
  const files = entries.filter((name) => /^[a-z0-9][a-z0-9._-]*$/i.test(name)).sort();
  return Response.json({ files }, { headers: { "Cache-Control": "private, no-store" } });
}
