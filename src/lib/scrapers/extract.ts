/**
 * Deterministic job-data extraction.
 *
 * Replaces the gpt-4o-mini call that used to read each job page and guess at
 * {title, company, location, salary, description, workType}. Four layers run in
 * order of trustworthiness, each filling only the gaps the previous one left:
 *
 *   1. JSON-LD `schema.org/JobPosting` — published by most boards for Google
 *      Jobs, so the fields are already structured and authoritative.
 *   2. Microdata — the same vocabulary, older syntax.
 *   3. Meta tags / OpenGraph / `<h1>` — enough for a title and a summary.
 *   4. Heuristics over the main content — salary regexes, work-type keywords,
 *      company from the breadcrumb or the host name.
 *
 * The hint values a board already knows (the link text, the board's country)
 * are the floor. Nothing here throws: a page that defeats every layer still
 * yields a record built from the hint, marked with a low confidence so callers
 * can tell the difference.
 */
import * as cheerio from "cheerio";
import type { CountryCode, WorkType } from "./types";
import { dedupeRepeatedText, htmlToText, mainContentText, metaTags } from "./parse/html";
import { formatSalary, parseSalary } from "./parse/salary";
import { detectWorkType } from "./parse/worktype";
import {
  isUsablePosting,
  parseJobPostingLd,
  parseJobPostingMicrodata,
  type JsonLdJobPosting,
} from "./parse/jsonld";

/** Which layer produced a record. Surfaced for debugging and asserted in tests. */
export type ExtractionSource = "jsonld" | "microdata" | "meta" | "heuristic" | "hint";

export interface ExtractedJob {
  title: string;
  company: string;
  location: string;
  /** Human-readable range, "" when the posting does not publish pay. */
  salary: string;
  /** Plain text, whitespace-normalised, capped at `MAX_DESCRIPTION`. */
  description: string;
  workType: WorkType;
  postedAt: Date | null;
  country: CountryCode | null;
  via: ExtractionSource;
  /** 0–1 confidence that this is a complete, real job posting. */
  confidence: number;
}

export interface JobHint {
  url: string;
  title?: string;
  company?: string;
  location?: string;
  country?: CountryCode;
}

const MAX_DESCRIPTION = 6000;

/** Confidence attached to each layer, highest first. */
const CONFIDENCE: Record<ExtractionSource, number> = {
  jsonld: 0.95,
  microdata: 0.85,
  meta: 0.6,
  heuristic: 0.4,
  hint: 0.2,
};

/**
 * Site branding boards append to every `<title>`, e.g. "React Developer | Jobs.cz".
 * Stripped so two boards listing the same role produce the same title.
 */
const TITLE_SEPARATORS = /\s+[|·—–\-:]\s+/;

/** Words that mark a trailing segment as branding rather than part of the role. */
const BRANDING_HINTS =
  /^(jobs?|kariera|kariéra|prace|práce|nabidky|nabídky|oferty|praca|stellen|careers?|hiring|vacancies|apply|nofluffjobs|startupjobs|jobstack|cocuma|skilleto|jooble|remoteok|remotive|arbeitnow|jobicy|himalayas|we work remotely|adzuna)\b/i;

/**
 * Removes board branding from a page title without eating a real role name.
 * "Senior React Developer | Jobs.cz" → "Senior React Developer", but
 * "Frontend Developer - React" keeps both halves.
 */
export function cleanTitle(raw: string | null | undefined): string {
  const collapsed = dedupeRepeatedText(raw ?? "");
  if (!collapsed) return "";

  const parts = collapsed.split(TITLE_SEPARATORS).map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return collapsed;

  // Drop trailing segments that look like a board or company name.
  const kept = [...parts];
  while (kept.length > 1) {
    const last = kept[kept.length - 1];
    const isBranding = BRANDING_HINTS.test(last) || (last.split(/\s+/).length <= 3 && /\.(cz|com|pl|de|io|app)$/i.test(last));
    if (!isBranding) break;
    kept.pop();
  }
  return kept.join(" - ").trim();
}

/** Company from a breadcrumb trail, an `og:site_name`, or the host as a last resort. */
function companyFromPage(html: string, meta: Record<string, string>, url: string): string {
  const fromMeta = meta["og:site_name"] ?? meta["application-name"];
  if (fromMeta && fromMeta.length < 60) return fromMeta;

  try {
    const $ = cheerio.load(html);
    const crumb = $("[class*='breadcrumb'] a, [itemtype*='BreadcrumbList'] [itemprop='name']")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((t) => t.length > 1 && t.length < 60);
    // The last crumb before the posting itself is usually the employer.
    if (crumb.length >= 2) return crumb[crumb.length - 1];

    const labelled = $("[class*='company'], [class*='employer'], [data-company]").first().text().trim();
    if (labelled && labelled.length < 60) return labelled.replace(/\s+/g, " ");
  } catch {
    // fall through to the host name
  }

  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Renders the structured JSON-LD salary as the display string we store. */
function salaryFromLd(salary: JsonLdJobPosting["salary"]): string {
  if (!salary) return "";
  const { min, max, currency, unit } = salary;
  if (min == null && max == null) return "";
  const normalisedUnit = normaliseUnit(unit);
  return formatSalary({
    min,
    max,
    currency,
    unit: normalisedUnit,
    text: "",
  });
}

/** schema.org `unitText` values → the units `ParsedSalary` understands. */
function normaliseUnit(unit: string | null): "hour" | "day" | "week" | "month" | "year" | null {
  switch ((unit ?? "").toUpperCase()) {
    case "HOUR": return "hour";
    case "DAY": return "day";
    case "WEEK": return "week";
    case "MONTH": return "month";
    case "YEAR": return "year";
    default: return null;
  }
}

/** JSON-LD `employmentType`/`remote` mapped onto our three-value work type. */
function workTypeFromLd(posting: JsonLdJobPosting): WorkType {
  if (posting.remote) return "Remote";
  const locations = posting.locations.join(" ");
  return detectWorkType(`${posting.employmentType ?? ""} ${locations}`);
}

function clampDescription(text: string): string {
  return text.replace(/\s+\n/g, "\n").trim().slice(0, MAX_DESCRIPTION);
}

/** Builds the floor record every layer improves on. */
function fromHint(hint: JobHint, description: string): ExtractedJob {
  return {
    title: cleanTitle(hint.title ?? ""),
    company: hint.company ?? "",
    location: hint.location ?? "",
    salary: "",
    description: clampDescription(description),
    workType: "",
    postedAt: null,
    country: hint.country ?? null,
    via: "hint",
    confidence: CONFIDENCE.hint,
  };
}

/** Applies a candidate field only when it improves on what we already have. */
function fill<K extends keyof ExtractedJob>(
  target: ExtractedJob,
  key: K,
  value: ExtractedJob[K] | null | undefined,
  via: ExtractionSource,
): void {
  const current = target[key];
  const currentEmpty = current == null || current === "" ;
  const candidateEmpty = value == null || value === "";
  if (candidateEmpty || !currentEmpty) return;
  target[key] = value;
  // The record's provenance is the best layer that contributed anything.
  if (CONFIDENCE[via] > CONFIDENCE[target.via]) {
    target.via = via;
    target.confidence = CONFIDENCE[via];
  }
}

/** Merges one structured posting into the accumulating record. */
function applyPosting(job: ExtractedJob, posting: JsonLdJobPosting, via: ExtractionSource): void {
  fill(job, "title", cleanTitle(posting.title), via);
  fill(job, "company", posting.company ?? "", via);
  fill(job, "location", posting.locations[0] ?? "", via);
  fill(job, "country", posting.country, via);
  fill(job, "salary", salaryFromLd(posting.salary), via);
  fill(job, "postedAt", posting.datePosted, via);
  fill(job, "workType", workTypeFromLd(posting), via);

  const description = posting.description ? clampDescription(htmlToText(posting.description)) : "";
  // A structured description beats scraped page text even when we have some,
  // because page text drags in cookie banners and "similar jobs" lists.
  if (description.length > 200 && description.length > job.description.length / 2) {
    job.description = description;
    if (CONFIDENCE[via] > CONFIDENCE[job.via]) {
      job.via = via;
      job.confidence = CONFIDENCE[via];
    }
  } else {
    fill(job, "description", description, via);
  }
}

/**
 * Full extraction from a fetched page. Never throws — a page that defeats every
 * layer yields the hint-derived record with `via: "hint"`.
 */
export function extractJob(
  page: { html: string; text: string; url: string },
  hint: JobHint,
): ExtractedJob {
  const html = page?.html ?? "";
  const pageText = page?.text ?? "";
  const url = page?.url || hint.url;

  try {
    const body = mainContentText(html) || pageText;
    const job = fromHint(hint, body);

    // ── Layer 1 & 2: structured data ────────────────────────────────────────
    const structured = parseJobPostingLd(html).filter(isUsablePosting);
    for (const posting of structured) applyPosting(job, posting, "jsonld");

    if (!job.title || !job.company) {
      for (const posting of parseJobPostingMicrodata(html).filter(isUsablePosting)) {
        applyPosting(job, posting, "microdata");
      }
    }

    // ── Layer 3: meta tags and headings ─────────────────────────────────────
    const meta = metaTags(html);
    if (!job.title) {
      const $ = safeLoad(html);
      const heading = $ ? $("h1").first().text().trim() : "";
      const metaTitle = meta["og:title"] ?? heading ?? "";
      const docTitle = $ ? $("title").first().text() : "";
      fill(job, "title", cleanTitle(metaTitle || docTitle), "meta");
    }
    fill(job, "description", clampDescription(meta["og:description"] ?? meta.description ?? ""), "meta");

    // ── Layer 4: heuristics over the visible text ───────────────────────────
    const haystack = `${job.title}\n${job.description || body}`;
    if (!job.salary) {
      const parsed = parseSalary(haystack);
      fill(job, "salary", parsed ? formatSalary(parsed) : "", "heuristic");
    }
    if (!job.workType) fill(job, "workType", detectWorkType(haystack), "heuristic");
    if (!job.company) fill(job, "company", companyFromPage(html, meta, url), "heuristic");

    job.title = cleanTitle(job.title);
    job.company = dedupeRepeatedText(job.company);
    job.location = dedupeRepeatedText(job.location);
    job.description = clampDescription(job.description || body);
    return job;
  } catch {
    return fromHint(hint, pageText);
  }
}

/** Text-only fallback for boards that never expose markup (RSS bodies, APIs). */
export function extractJobFromText(text: string, hint: JobHint): ExtractedJob {
  const job = fromHint(hint, text ?? "");
  try {
    const haystack = `${hint.title ?? ""}\n${text ?? ""}`;
    const parsed = parseSalary(haystack);
    fill(job, "salary", parsed ? formatSalary(parsed) : "", "heuristic");
    fill(job, "workType", detectWorkType(haystack), "heuristic");
  } catch {
    // A parser that fails simply leaves the hint values in place.
  }
  return job;
}

function safeLoad(html: string): cheerio.CheerioAPI | null {
  try {
    return cheerio.load(html);
  } catch {
    return null;
  }
}
