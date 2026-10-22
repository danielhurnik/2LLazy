import { prisma } from "@/lib/prisma";

export interface ObstacleSummary {
  host: string;
  attempts: number;
  captchas: number;
  logins: number;
  blockerHost: string | null;
}

interface ObstacleRow {
  kind: "CAPTCHA" | "LOGIN";
  host: string;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function summariseObstacles(host: string, attempts: number, rows: ObstacleRow[]): ObstacleSummary | null {
  if (!host || attempts === 0) return null;
  const perHost = new Map<string, number>();
  let captchas = 0;
  let logins = 0;
  for (const row of rows) {
    if (row.kind === "CAPTCHA") captchas += 1;
    else logins += 1;
    perHost.set(row.host, (perHost.get(row.host) ?? 0) + 1);
  }
  const blockerHost = [...perHost.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { host, attempts, captchas, logins, blockerHost: blockerHost && blockerHost !== host ? blockerHost : null };
}

export async function obstacleSummaryFor(userId: string, jobId: string): Promise<ObstacleSummary | null> {
  const job = await prisma.jobPosting.findUnique({ where: { id: jobId }, select: { sourceUrl: true } });
  const host = job ? hostOf(job.sourceUrl) : "";
  if (!host) return null;

  const ran = await prisma.application.findMany({
    where: { userId, evidencePath: { not: null } },
    select: { id: true, job: { select: { sourceUrl: true } } },
  });
  const onHost = ran.filter((application) => hostOf(application.job.sourceUrl) === host).map((application) => application.id);
  if (onHost.length === 0) return null;

  const rows = await prisma.applyObstacle.findMany({
    where: { applicationId: { in: onHost } },
    select: { kind: true, host: true },
  });
  return summariseObstacles(host, onHost.length, rows);
}
