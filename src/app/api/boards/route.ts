/**
 * Which job boards apply to a country, and why the others do not.
 *
 * Backs the country picker on the search page and the Settings screen. Kept
 * separate from the scrape stream so the UI can show board coverage before the
 * user runs a search — a user in a country with no local board should be able
 * to see that up front, not discover it from thin results.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { detectCountry, listCountries } from "@/lib/geo";
import { boardStatus, countriesWithLocalBoards } from "@/lib/scrapers/registry";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = await prisma.userProfile
    .findUnique({ where: { userId: session.user.id }, select: { country: true } })
    .catch(() => null);

  const detected = detectCountry({
    explicit: req.nextUrl.searchParams.get("country"),
    profile: profile?.country ?? null,
    headers: req.headers,
  });

  const localBoardCountries = new Set(countriesWithLocalBoards());

  return NextResponse.json({
    country: detected.country,
    countryName: detected.countryName,
    detectedVia: detected.via,
    boards: boardStatus(detected.country),
    countries: listCountries().map((c) => ({
      code: c.code,
      name: c.name,
      /** True when this country has a board of its own, not just remote boards. */
      hasLocalBoards: localBoardCountries.has(c.code),
    })),
  });
}
