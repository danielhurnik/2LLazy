/**
 * Helpers shared by the free JSON/RSS job-feed boards.
 *
 * These boards hand us structured payloads, so the work is normalisation rather
 * than scraping: strip HTML, format salaries, decide whether a posting is even
 * about what the user searched for, and float postings open to the user's
 * country to the top. Everything here is deterministic and nothing throws — a
 * board must survive an upstream schema change without breaking a whole search.
 */
import * as cheerio from "cheerio";
import { z } from "zod";
import type { CountryCode, ScrapeQuery, ScrapedJob, WorkType } from "../types";

/** Descriptions are stored verbatim, so cap them before they reach the DB. */
export const MAX_DESCRIPTION_CHARS = 6000;
/** Hard ceiling per board, so one chatty feed cannot dominate a search. */
export const MAX_JOBS_PER_BOARD = 120;
/** Politeness gap between paged requests to the same host. */
export const PAGE_DELAY_MS = 250;

// ─── Loose value coercion ─────────────────────────────────────────────────────
// Feeds change field types without warning (a number becomes a string, a string
// becomes null), so every field is read through a coercion that cannot throw.

/** Lenient zod fragments: accept `null` as readily as a missing key. */
export const looseString = z.string().nullish();
export const looseNumeric = z.union([z.number(), z.string()]).nullish();
export const looseList = z.array(z.unknown()).nullish();

/** True for a plain object — the only shape worth reading fields off. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Any scalar rendered as a trimmed string; anything else becomes `""`. */
export function str(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/** A finite positive number, or `undefined` — feeds use 0/"" for "no data". */
export function num(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[\s,]/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** Flattens an unknown array into non-empty strings, dropping everything else. */
export function strList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(str).filter(Boolean);
}

/**
 * Parses the many date shapes feeds use: unix seconds, unix milliseconds, ISO
 * strings, and `"YYYY-MM-DD HH:MM:SS"` (normalised to UTC so results do not
 * shift with the server's timezone).
 */
export function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  const asNumber = typeof value === "number" ? value : undefined;
  if (asNumber !== undefined) {
    const ms = asNumber < 1e11 ? asNumber * 1000 : asNumber;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  const raw = str(value);
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return toDate(Number(raw));
  const normalised = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(raw)
    ? `${raw.replace(" ", "T")}Z`
    : raw;
  const parsed = new Date(normalised);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

// ─── Text ─────────────────────────────────────────────────────────────────────

/**
 * Converts a feed's HTML description to readable plain text.
 *
 * Deliberately local and simple: the richer converter in `../parse/html` serves
 * scraped pages, and these boards must not depend on it.
 */
export function htmlToText(input: unknown, maxChars = MAX_DESCRIPTION_CHARS): string {
  const raw = typeof input === "string" ? input : "";
  if (!raw) return "";

  let text = raw;
  if (raw.includes("<")) {
    try {
      const $ = cheerio.load(raw);
      $("script, style, noscript").remove();
      $("br").replaceWith("\n");
      $("p, div, li, tr, h1, h2, h3, h4, h5, h6, blockquote").after("\n");
      text = $.root().text();
    } catch {
      text = raw.replace(/<[^>]*>/g, " ");
    }
  }

  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text.length > maxChars ? `${text.slice(0, maxChars).trimEnd()}…` : text;
}

/** Lowercases and strips diacritics so "Praha" and "Přáhá" compare equal. */
export function foldText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// ─── Salary ───────────────────────────────────────────────────────────────────

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  CAD: "CA$",
  AUD: "A$",
  NZD: "NZ$",
  CHF: "CHF ",
  PLN: "PLN ",
  CZK: "CZK ",
  INR: "₹",
  BRL: "R$",
  MXN: "MX$",
  SGD: "S$",
  ZAR: "R",
};

function money(amount: number, currency: string): string {
  const rounded = Math.round(amount);
  const grouped = rounded.toLocaleString("en-US");
  const symbol = CURRENCY_SYMBOLS[currency];
  if (symbol) return `${symbol}${grouped}`;
  return currency ? `${grouped} ${currency}` : grouped;
}

/**
 * Renders a numeric salary range as one display string, e.g.
 * `"$90,000 - $120,000 per year"`. Returns `undefined` when the feed gave no
 * usable figures, so callers can simply spread the result.
 */
export function formatSalaryRange(
  min: unknown,
  max: unknown,
  currency?: unknown,
  unit?: "year" | "month" | "day" | "hour",
): string | undefined {
  const lo = num(min);
  const hi = num(max);
  const low = lo !== undefined && lo > 0 ? lo : undefined;
  const high = hi !== undefined && hi > 0 ? hi : undefined;
  if (low === undefined && high === undefined) return undefined;

  const code = str(currency).toUpperCase();
  const suffix = unit ? ` per ${unit}` : "";

  if (low !== undefined && high !== undefined) {
    if (Math.round(low) === Math.round(high)) return `${money(low, code)}${suffix}`;
    const [a, b] = low <= high ? [low, high] : [high, low];
    return `${money(a, code)} - ${money(b, code)}${suffix}`;
  }
  if (low !== undefined) return `From ${money(low, code)}${suffix}`;
  return `Up to ${money(high as number, code)}${suffix}`;
}

// ─── Relevance ────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "and", "or", "the", "for", "with", "of", "a", "an", "to", "at", "in", "on", "any",
]);

/** Query terms are truncated so a wide taxonomy expansion stays meaningful. */
const MAX_INTENT_TERMS = 15;

function splitTokens(value: string): string[] {
  return foldText(value)
    .split(/[^a-z0-9+#]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/**
 * The tokens a posting may match on: the raw query, the board keyword, and the
 * strongest intent terms. Read off `q` rather than recomputed, so the feed
 * boards carry no dependency on the matching layer.
 */
export function queryTokens(q: ScrapeQuery): string[] {
  const sources: string[] = [q.query ?? "", q.intent?.scrapingKeyword ?? ""];
  const terms = [...(q.intent?.terms ?? [])]
    .sort((a, b) => (b?.weight ?? 0) - (a?.weight ?? 0))
    .slice(0, MAX_INTENT_TERMS);
  for (const t of terms) sources.push(str(t?.term));

  const tokens = new Set<string>();
  for (const source of sources) for (const token of splitTokens(source)) tokens.add(token);
  return [...tokens];
}

function containsToken(haystack: string, token: string): boolean {
  // Short tokens ("go", "qa", "c#") need word boundaries or they match anything.
  if (token.length > 3) return haystack.includes(token);
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(haystack);
}

/**
 * Permissive relevance gate for the boards with no server-side search: keep a
 * posting when any query token appears in it. Precision is the ranker's job in
 * `src/lib/matching`; over-filtering here would starve it of candidates.
 */
export function matchesQuery(text: string, q: ScrapeQuery): boolean {
  const tokens = queryTokens(q);
  if (tokens.length === 0) return true;
  const haystack = foldText(text ?? "");
  if (!haystack) return false;
  return tokens.some((token) => containsToken(haystack, token));
}

// ─── Country / region preference ──────────────────────────────────────────────
// A tiny local model of countries. `src/lib/geo` is another agent's file, so
// nothing here may import it; feed boards only need "does this location text
// concern the user's country?".

const REGION_MEMBERS: Record<string, CountryCode[]> = {
  europe: [
    "AT", "BE", "BG", "CH", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GB", "GR",
    "HR", "HU", "IE", "IS", "IT", "LT", "LU", "LV", "MT", "NL", "NO", "PL", "PT", "RO",
    "RS", "SE", "SI", "SK", "UA",
  ],
  "north america": ["US", "CA", "MX"],
  latam: ["AR", "BR", "CL", "CO", "CR", "EC", "MX", "PE", "UY", "VE"],
  apac: ["AU", "CN", "HK", "ID", "IN", "JP", "KR", "MY", "NZ", "PH", "SG", "TH", "TW", "VN"],
  emea: ["AE", "EG", "IL", "MA", "NG", "SA", "TR", "ZA"],
};

const REGION_SYNONYMS: Record<string, string[]> = {
  europe: ["europe", "european", "emea", "eu region", "cet", "cest"],
  "north america": ["north america", "americas", "us/canada", "usa & canada"],
  latam: ["latam", "latin america", "south america", "americas"],
  apac: ["apac", "asia", "asia pacific", "asia-pacific"],
  emea: ["emea", "middle east", "africa"],
};

/** Country codes we are willing to recognise by name inside free-form text. */
const KNOWN_COUNTRIES: CountryCode[] = [
  "AE", "AR", "AT", "AU", "BE", "BG", "BR", "CA", "CH", "CL", "CN", "CO", "CR", "CZ",
  "DE", "DK", "EE", "EG", "ES", "FI", "FR", "GB", "GR", "HK", "HR", "HU", "ID", "IE",
  "IL", "IN", "IS", "IT", "JP", "KR", "LT", "LU", "LV", "MA", "MX", "MY", "NG", "NL",
  "NO", "NZ", "PE", "PH", "PL", "PT", "RO", "RS", "SE", "SG", "SI", "SK", "TH", "TR",
  "TW", "UA", "US", "UY", "VN", "ZA",
];

/** Names a feed is likely to print that `Intl.DisplayNames` does not produce. */
const COUNTRY_ALIASES: Record<string, string[]> = {
  AE: ["uae", "united arab emirates"],
  CZ: ["czech republic", "czechia"],
  GB: ["uk", "united kingdom", "great britain", "britain", "england", "scotland", "wales", "northern ireland"],
  KR: ["south korea", "republic of korea"],
  NL: ["netherlands", "holland"],
  US: ["usa", "u.s.", "u.s.a.", "united states of america", "america", "states"],
  VN: ["vietnam", "viet nam"],
};

/** Terms that mean "no country restriction at all". */
const WORLDWIDE_HINTS = [
  "worldwide", "anywhere", "global", "international", "any location", "remote",
];

let regionIndex: Map<CountryCode, string[]> | null = null;

function regionsFor(country: CountryCode): string[] {
  if (!regionIndex) {
    regionIndex = new Map();
    for (const [region, members] of Object.entries(REGION_MEMBERS)) {
      for (const member of members) {
        const existing = regionIndex.get(member) ?? [];
        regionIndex.set(member, [...existing, ...(REGION_SYNONYMS[region] ?? [region])]);
      }
    }
    // Every European country is also served by EMEA-scoped postings.
    for (const member of REGION_MEMBERS.europe) {
      const existing = regionIndex.get(member) ?? [];
      regionIndex.set(member, [...new Set([...existing, ...REGION_SYNONYMS.emea])]);
    }
  }
  return regionIndex.get(country.toUpperCase()) ?? [];
}

function displayName(code: CountryCode): string {
  try {
    const name = new Intl.DisplayNames(["en"], { type: "region" }).of(code);
    return name && name !== code ? name : "";
  } catch {
    return "";
  }
}

/** Every spelling of a country we will accept, folded and longest-first. */
export function countryNames(country: CountryCode): string[] {
  const code = country.toUpperCase();
  const names = [displayName(code), ...(COUNTRY_ALIASES[code] ?? [])]
    .map((n) => foldText(n))
    .filter(Boolean);
  return [...new Set(names)].sort((a, b) => b.length - a.length);
}

/**
 * True when free-form location text concerns `country`. The bare ISO code is
 * only accepted in its uppercase form ("Remote, US") — lowercased it collides
 * with ordinary words like "in", "at" and "no".
 */
export function locationMatchesCountry(location: string, country: CountryCode): boolean {
  if (!location || !country || country === "*") return false;
  const folded = foldText(location);
  if (countryNames(country).some((name) => folded.includes(name))) return true;
  return new RegExp(`\\b${country.toUpperCase()}\\b`).test(location);
}

/** Resolves the single country a location string names, when it names one. */
export function resolveCountry(location: unknown): CountryCode | undefined {
  const text = str(location);
  if (!text) return undefined;
  const candidates = KNOWN_COUNTRIES.flatMap((code) =>
    countryNames(code).map((name) => ({ code, name })),
  ).sort((a, b) => b.name.length - a.name.length);

  const folded = foldText(text);
  for (const { code, name } of candidates) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`).test(folded)) return code;
  }
  for (const code of KNOWN_COUNTRIES) {
    if (new RegExp(`\\b${code}\\b`).test(text)) return code;
  }
  return undefined;
}

/** 0 = the user's city, 1 = their country, 2 = their region, 3 = worldwide. */
export function locationRank(location: string, q: ScrapeQuery): number {
  const text = location ?? "";
  const folded = foldText(text);
  if (!folded) return 3;
  if (q.city && folded.includes(foldText(q.city))) return 0;
  if (locationMatchesCountry(text, q.country)) return 1;
  if (regionsFor(q.country).some((region) => folded.includes(region))) return 2;
  if (WORLDWIDE_HINTS.some((hint) => folded.includes(hint))) return 3;
  return 4;
}

/**
 * Sorts postings the user is most likely to be eligible for first. Remote-only
 * boards must never drop a posting for being scoped elsewhere — a worldwide
 * board still beats no board at all — so this reorders instead of filtering.
 */
export function sortByLocationPreference<T extends ScrapedJob>(jobs: T[], q: ScrapeQuery): T[] {
  return [...jobs].sort((a, b) => locationRank(a.location, q) - locationRank(b.location, q));
}

// ─── Result plumbing ──────────────────────────────────────────────────────────

/** Keeps the first posting per source URL, preserving order. */
export function dedupeByUrl<T extends ScrapedJob>(jobs: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const job of jobs) {
    const key = job.sourceUrl.split("?")[0];
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(job);
  }
  return out;
}

/** How many pages a board should pull for this search. */
export function pageBudget(deepSearch: boolean, normal = 2, deep = 4): number {
  return deepSearch ? deep : normal;
}

/** Sleeps, resolving early (never rejecting) when the search is cancelled. */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * One-shot warning channel per scrape. A dead board should leave exactly one
 * line in the log, not one per page it failed to fetch.
 */
export function createWarner(boardId: string): (message: string, err?: unknown) => void {
  let warned = false;
  return (message, err) => {
    if (warned) return;
    warned = true;
    const detail = err instanceof Error ? `: ${err.message}` : err !== undefined ? `: ${String(err)}` : "";
    console.warn(`[${boardId}] ${message}${detail}`);
  };
}

/** Reads a work type out of whatever text a payload offers. */
export function workTypeFromText(...parts: Array<string | undefined>): WorkType {
  const text = foldText(parts.filter(Boolean).join(" "));
  if (/\bremote\b|work from home|wfh|\bdistributed\b/.test(text)) return "Remote";
  if (/\bhybrid\b/.test(text)) return "Hybrid";
  if (/\bon-?site\b|\bin-?office\b|\bon location\b/.test(text)) return "Onsite";
  return "";
}

/** Applies the per-board ceiling. */
export function capJobs<T>(jobs: T[]): T[] {
  return jobs.length > MAX_JOBS_PER_BOARD ? jobs.slice(0, MAX_JOBS_PER_BOARD) : jobs;
}
