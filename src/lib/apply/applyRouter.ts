/**
 * applyRouter
 *
 * Routes an auto-apply request to the correct site handler based on the
 * posting's source (the uppercase board id from the scraper registry).
 * Unsupported sources return MANUAL_REQUIRED immediately — the UI then opens
 * the posting for the user instead of pretending.
 *
 * To add support for a new board: implement an `applyXxx()` function in
 * its own file (following the pattern in applyStartupjobs.ts) and add a
 * case here.
 */
import { applyStartupjobs, type ApplyResult } from "./applyStartupjobs";
import type { ApplicantProfile } from "./fillPlan";

export async function applyRouter(
  source: string,
  jobUrl: string,
  profile: ApplicantProfile,
  cvBuffer?: Buffer,
): Promise<ApplyResult> {
  switch (source) {
    case "STARTUPJOBS":
      return applyStartupjobs(jobUrl, profile, cvBuffer);

    default:
      return {
        status: "MANUAL_REQUIRED",
        errorMessage: `Auto-apply is not yet supported for ${source}. Use manual application.`,
      };
  }
}
