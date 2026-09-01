/**
 * Employers whose ATS job boards we read.
 *
 * ATS APIs cannot be searched — you have to name the employer — so this list is
 * what turns six adapters into real coverage. It is deliberately a plain data
 * file: **adding your own country's employers is the single most useful
 * contribution anyone can make to this project**, and it takes one line.
 *
 * ## Adding an employer
 *
 * Open the company's careers page and read the URL:
 *
 *   boards.greenhouse.io/SLUG            → ats: "greenhouse"
 *   jobs.lever.co/SLUG                   → ats: "lever"
 *   jobs.ashbyhq.com/SLUG                → ats: "ashby"
 *   jobs.smartrecruiters.com/SLUG        → ats: "smartrecruiters"
 *   SLUG.recruitee.com                   → ats: "recruitee"
 *   apply.workable.com/SLUG              → ats: "workable"
 *
 * Then add an entry and check it:
 *
 *   npx tsx scripts/verify-employers.ts --ats greenhouse
 *
 * ## About these entries
 *
 * The slugs below are best-effort and **not individually verified** — this repo
 * cannot reach the internet from CI, and a company can migrate ATS at any time.
 * A wrong slug is harmless: the adapter gets a 404, warns once and moves on.
 * Run `scripts/verify-employers.ts` to see which resolve for you, and please
 * send a pull request pruning any that do not.
 */
import type { Employer } from "./types";

/**
 * Countries an employer hires in. `remote: true` additionally offers the
 * employer to any country, which is how a Berlin company hiring remotely across
 * Europe reaches a user in Portugal.
 */
export const EMPLOYERS: Employer[] = [
  // ── Czech and Slovak market ────────────────────────────────────────────────
  { slug: "productboard", name: "Productboard", ats: "greenhouse", countries: ["CZ"], remote: true },
  { slug: "kiwi", name: "Kiwi.com", ats: "recruitee", countries: ["CZ", "SK"], remote: true },
  { slug: "socialbakers", name: "Socialbakers", ats: "recruitee", countries: ["CZ"] },
  { slug: "mews", name: "Mews", ats: "recruitee", countries: ["CZ", "NL"], remote: true },
  { slug: "rohlik", name: "Rohlik Group", ats: "recruitee", countries: ["CZ"] },
  { slug: "cleverbee", name: "Cleverbee", ats: "recruitee", countries: ["CZ"] },
  { slug: "gohealth", name: "GoHealth", ats: "workable", countries: ["CZ", "SK"] },

  // ── German-speaking Europe ────────────────────────────────────────────────
  { slug: "personio", name: "Personio", ats: "greenhouse", countries: ["DE"], remote: true },
  { slug: "gorillas", name: "Gorillas", ats: "greenhouse", countries: ["DE"] },
  { slug: "n26", name: "N26", ats: "greenhouse", countries: ["DE", "ES"], remote: true },
  { slug: "celonis", name: "Celonis", ats: "greenhouse", countries: ["DE", "US"], remote: true },
  { slug: "getyourguide", name: "GetYourGuide", ats: "greenhouse", countries: ["DE"], remote: true },
  { slug: "sumup", name: "SumUp", ats: "greenhouse", countries: ["DE", "GB", "PL"], remote: true },
  { slug: "contentful", name: "Contentful", ats: "greenhouse", countries: ["DE", "US"], remote: true },
  { slug: "adjust", name: "Adjust", ats: "greenhouse", countries: ["DE"], remote: true },

  // ── United Kingdom and Ireland ────────────────────────────────────────────
  { slug: "monzo", name: "Monzo", ats: "greenhouse", countries: ["GB"], remote: true },
  { slug: "wise", name: "Wise", ats: "greenhouse", countries: ["GB", "EE"], remote: true },
  { slug: "starlingbank", name: "Starling Bank", ats: "greenhouse", countries: ["GB"] },
  { slug: "deliveroo", name: "Deliveroo", ats: "greenhouse", countries: ["GB"] },
  { slug: "octopusenergy", name: "Octopus Energy", ats: "greenhouse", countries: ["GB"], remote: true },
  { slug: "intercom", name: "Intercom", ats: "greenhouse", countries: ["IE", "GB", "US"], remote: true },

  // ── Nordics, Benelux, Iberia ──────────────────────────────────────────────
  { slug: "spotify", name: "Spotify", ats: "greenhouse", countries: ["SE", "GB", "US"], remote: true },
  { slug: "klarna", name: "Klarna", ats: "greenhouse", countries: ["SE", "DE", "GB"], remote: true },
  { slug: "bolt", name: "Bolt", ats: "greenhouse", countries: ["EE"], remote: true },
  { slug: "pleo", name: "Pleo", ats: "greenhouse", countries: ["DK", "GB", "ES"], remote: true },
  { slug: "messagebird", name: "Bird", ats: "greenhouse", countries: ["NL"], remote: true },
  { slug: "backbase", name: "Backbase", ats: "greenhouse", countries: ["NL"], remote: true },
  { slug: "glovo", name: "Glovo", ats: "greenhouse", countries: ["ES"], remote: true },

  // ── Poland and wider CEE ──────────────────────────────────────────────────
  { slug: "docplanner", name: "Docplanner", ats: "smartrecruiters", countries: ["PL", "ES"], remote: true },
  { slug: "brainly", name: "Brainly", ats: "greenhouse", countries: ["PL"], remote: true },
  { slug: "uipath", name: "UiPath", ats: "greenhouse", countries: ["RO", "US"], remote: true },

  // ── Australia ─────────────────────────────────────────────────────────────
  { slug: "canva", name: "Canva", ats: "greenhouse", countries: ["AU"], remote: true },
  { slug: "cultureamp", name: "Culture Amp", ats: "greenhouse", countries: ["AU", "US", "GB"] },
  { slug: "airwallex", name: "Airwallex", ats: "lever", countries: ["AU", "SG", "US"] },
  { slug: "safetyculture", name: "SafetyCulture", ats: "lever", countries: ["AU", "US", "GB"] },
  { slug: "linktree", name: "Linktree", ats: "lever", countries: ["AU"], remote: true },
  { slug: "immutable", name: "Immutable", ats: "lever", countries: ["AU"], remote: true },

  // ── Remote-first, worldwide ───────────────────────────────────────────────
  { slug: "gitlab", name: "GitLab", ats: "greenhouse", countries: [], remote: true },
  { slug: "automattic", name: "Automattic", ats: "greenhouse", countries: [], remote: true },
  { slug: "elastic", name: "Elastic", ats: "greenhouse", countries: [], remote: true },
  { slug: "hashicorp", name: "HashiCorp", ats: "greenhouse", countries: [], remote: true },
  { slug: "grafanalabs", name: "Grafana Labs", ats: "greenhouse", countries: [], remote: true },
  { slug: "sourcegraph", name: "Sourcegraph", ats: "greenhouse", countries: [], remote: true },
  { slug: "supabase", name: "Supabase", ats: "greenhouse", countries: [], remote: true },
  { slug: "cloudflare", name: "Cloudflare", ats: "greenhouse", countries: ["US", "GB", "PT"], remote: true },
  { slug: "canonical", name: "Canonical", ats: "greenhouse", countries: [], remote: true },
  { slug: "doist", name: "Doist", ats: "ashby", countries: [], remote: true },
  { slug: "posthog", name: "PostHog", ats: "ashby", countries: [], remote: true },
  { slug: "linear", name: "Linear", ats: "ashby", countries: [], remote: true },
  { slug: "deel", name: "Deel", ats: "ashby", countries: [], remote: true },
  { slug: "ramp", name: "Ramp", ats: "ashby", countries: ["US"], remote: true },
  { slug: "vercel", name: "Vercel", ats: "ashby", countries: [], remote: true },
  { slug: "netlify", name: "Netlify", ats: "greenhouse", countries: [], remote: true },
  { slug: "mozilla", name: "Mozilla", ats: "greenhouse", countries: [], remote: true },
  { slug: "duckduckgo", name: "DuckDuckGo", ats: "lever", countries: [], remote: true },
  { slug: "matterport", name: "Matterport", ats: "lever", countries: ["US"], remote: true },
  { slug: "shopify", name: "Shopify", ats: "smartrecruiters", countries: ["CA"], remote: true },
  { slug: "bosch", name: "Bosch", ats: "smartrecruiters", countries: ["DE", "CZ", "HU", "IN"] },
  { slug: "visa", name: "Visa", ats: "smartrecruiters", countries: ["US", "GB", "PL"] },
  { slug: "ubisoft", name: "Ubisoft", ats: "smartrecruiters", countries: ["FR", "CA", "SE"] },
];

/** Employers whose boards apply to a country, plus the remote-anywhere ones. */
export function employersForCountry(country: string): Employer[] {
  const code = country.toUpperCase();
  return EMPLOYERS.filter(
    (employer) => employer.remote === true || employer.countries.includes(code),
  );
}

/** Every employer on one ATS, used by the verify script and the board runner. */
export function employersOn(platform: string): Employer[] {
  return EMPLOYERS.filter((employer) => employer.ats === platform);
}

/** Countries named by at least one employer, for coverage reporting. */
export function employerCountries(): string[] {
  return [...new Set(EMPLOYERS.flatMap((employer) => employer.countries))].sort();
}
