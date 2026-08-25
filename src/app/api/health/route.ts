/**
 * Liveness and readiness for a container or a load balancer.
 *
 * Deliberately the one route outside the session check (see `src/proxy.ts`).
 * Probing an authenticated page instead would tie the healthcheck to auth
 * configuration — a container reporting unhealthy because `AUTH_URL` is wrong
 * tells you nothing about whether the process is alive, and hides the real
 * fault behind a restart loop.
 *
 * Returns 200 when the app can reach its database, 503 when it cannot. Nothing
 * here is sensitive: no versions, no configuration, no counts.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cap the probe so an unreachable database fails fast instead of hanging. */
const DB_TIMEOUT_MS = 3_000;

export async function GET() {
  const startedAt = Date.now();

  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("database probe timed out")), DB_TIMEOUT_MS),
      ),
    ]);
  } catch {
    return NextResponse.json(
      { status: "unhealthy", database: "unreachable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    { status: "ok", database: "ok", latencyMs: Date.now() - startedAt },
    { headers: { "Cache-Control": "no-store" } },
  );
}
