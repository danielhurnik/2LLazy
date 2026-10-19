import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { refreshPostings } from "@/lib/jobs/refresh";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await refreshPostings());
}
