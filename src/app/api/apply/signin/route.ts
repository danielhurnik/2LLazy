import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { signInHosts, signInTargetFor, signInToBoard } from "@/lib/apply/boardSignIn";
import { errorMessage, isRecord } from "@/lib/guards";

export const runtime = "nodejs";

const jsonError = (error: string, status: number) =>
  new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json" } });

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return jsonError("Unauthorized", 401);
  return Response.json({ hosts: signInHosts() });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return jsonError("Unauthorized", 401);

  const body: unknown = await req.json().catch(() => null);
  const host = isRecord(body) && typeof body.host === "string" ? body.host : "";
  const target = signInTargetFor(host);
  if (!target) return jsonError("Unknown sign-in host", 400);

  try {
    const signedIn = await signInToBoard(target);
    return Response.json({ ok: true, host: target.host, signedIn });
  } catch (err) {
    return jsonError(`Could not open the sign-in window: ${errorMessage(err).split("\n")[0]}`, 500);
  }
}
