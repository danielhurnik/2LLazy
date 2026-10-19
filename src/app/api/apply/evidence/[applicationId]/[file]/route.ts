import fs from "fs/promises";
import path from "path";
import { auth } from "@/auth";
import { EVIDENCE_ROOT } from "@/lib/apply/evidence";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const APPLICATION_ID = /^[a-z0-9]{10,40}$/i;
const FILE_NAME = /^[a-z0-9][a-z0-9._-]{0,80}$/i;
const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  json: "application/json",
  txt: "text/plain; charset=utf-8",
};

const jsonError = (error: string, status: number) =>
  new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json" } });

export async function GET(_req: Request, { params }: { params: Promise<{ applicationId: string; file: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return jsonError("Unauthorized", 401);

  const { applicationId, file } = await params;
  if (!APPLICATION_ID.test(applicationId) || !FILE_NAME.test(file) || file.includes("..")) return jsonError("Not found", 404);
  const owned = await prisma.application.findFirst({ where: { id: applicationId, userId }, select: { id: true } });
  if (!owned) return jsonError("Not found", 404);

  const filePath = path.resolve(EVIDENCE_ROOT, applicationId, file);
  if (!filePath.startsWith(path.resolve(EVIDENCE_ROOT, applicationId) + path.sep)) return jsonError("Not found", 404);
  const data = await fs.readFile(filePath).catch(() => null);
  if (!data) return jsonError("Not found", 404);

  const extension = file.split(".").pop()?.toLowerCase() ?? "";
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": CONTENT_TYPES[extension] ?? "application/octet-stream",
      "Cache-Control": "private, no-store",
      "Content-Disposition": "inline",
    },
  });
}
