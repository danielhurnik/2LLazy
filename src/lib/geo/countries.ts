/**
 * Country dataset accessors and free-text → country matching.
 *
 * The app scrapes boards for whatever country the user is in, so every other
 * module (board registry, scrapers, UI) resolves countries through here rather
 * than hard-coding a list. Everything is deterministic and offline: no geo-IP
 * service, no model call, no network.
 */
import { COUNTRY_DATA } from "./data";

export interface CountryInfo {
  /** ISO 3166-1 alpha-2, uppercase. */
  code: string;
  /** English display name, e.g. "Czechia". */
  name: string;
  /** Lowercase alternate names/spellings used for text matching. */
  aliases: string[];
  /** ISO 639-1 codes, most common first, e.g. ["cs","en"]. */
  languages: string[];
  /** ISO 4217, e.g. "CZK". */
  currency: string;
  /** e.g. "Europe", "North America", "Asia", "Africa", "South America", "Oceania". */
  region: string;
  /** Major cities, lowercase, used to infer a country from a free-text location. */
  cities: string[];
}

/** Used when nothing in the request tells us where the user is. */
export const DEFAULT_COUNTRY = "US";

/** Longest multi-word label in the dataset ("united states of america"). */
const MAX_GRAM_WORDS = 4;

/**
 * Letters that survive NFD decomposition unchanged, so "łódź" still folds to
 * "lodz" and matches the ASCII spelling boards usually emit.
 */
const FOLDED_LETTERS: Record<string, string> = {
  "ł": "l",
  "ø": "o",
  "æ": "ae",
  "œ": "oe",
  "ß": "ss",
  "đ": "d",
  "ð": "d",
  "þ": "th",
  "ı": "i",
  "ħ": "h",
};

/**
 * Fold text to lowercase ASCII words: diacritics stripped, punctuation turned
 * into single spaces. Both the dataset labels and the incoming text go through
 * this, so matching is case-, accent- and punctuation-insensitive.
 */
function fold(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\u0000-\u007f]/g, (ch) => FOLDED_LETTERS[ch] ?? " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const BY_CODE = new Map<string, CountryInfo>();
/** Folded country name or alias → code. */
const BY_LABEL = new Map<string, string>();
/** Folded city → code, or `null` when two countries in the dataset share it. */
const BY_CITY = new Map<string, string | null>();

for (const entry of COUNTRY_DATA) {
  Object.freeze(entry.aliases);
  Object.freeze(entry.languages);
  Object.freeze(entry.cities);
  BY_CODE.set(entry.code, Object.freeze(entry));
  for (const label of [entry.name, ...entry.aliases]) {
    const key = fold(label);
    if (key) BY_LABEL.set(key, entry.code);
  }
  for (const city of entry.cities) {
    const key = fold(city);
    if (!key) continue;
    const seen = BY_CITY.get(key);
    // A city claimed by two countries is worse than no city at all: drop it
    // rather than let "Cambridge" silently decide between GB and US.
    BY_CITY.set(key, seen === undefined || seen === entry.code ? entry.code : null);
  }
}

/** Every known country, sorted by English name. */
export function listCountries(): CountryInfo[] {
  return [...COUNTRY_DATA].sort((a, b) => a.name.localeCompare(b.name, "en"));
}

/**
 * Look up one country. Accepts anything `normaliseCountryCode` accepts (code,
 * English name or alias) so callers never have to normalise twice.
 */
export function getCountry(code: string): CountryInfo | null {
  if (typeof code !== "string" || !code.trim()) return null;
  const direct = BY_CODE.get(code.trim().toUpperCase());
  if (direct) return direct;
  const normalised = normaliseCountryCode(code);
  return normalised ? BY_CODE.get(normalised) ?? null : null;
}

/**
 * Accepts a code, an English name, or an alias (any case). Returns uppercase
 * alpha-2 or null. A valid alpha-2 outside the dataset also returns null, so a
 * caller never ends up holding a country it cannot name or pick boards for.
 */
export function normaliseCountryCode(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (BY_CODE.has(upper)) return upper;
  const label = fold(raw);
  return label ? BY_LABEL.get(label) ?? null : null;
}

/** Every 1..MAX_GRAM_WORDS word window of `words`, longest windows first. */
function* grams(words: string[]): Generator<string> {
  for (let size = Math.min(MAX_GRAM_WORDS, words.length); size >= 1; size--) {
    // Right to left: "San Francisco, CA, USA" names its country last.
    for (let start = words.length - size; start >= 0; start--) {
      yield words.slice(start, start + size).join(" ");
    }
  }
}

/**
 * Best-effort country for a free-text location like "Prague, Czech Republic"
 * or "Remote (Germany)".
 *
 * Country names and aliases win over cities, and a bare two-letter code is only
 * honoured when it trails the string ("London, UK") — that keeps "Remote IT
 * Support" from being read as Italy. Returns null rather than guessing.
 */
export function countryFromLocationText(text: string | null | undefined): string | null {
  if (typeof text !== "string") return null;
  const folded = fold(text);
  if (!folded) return null;
  const words = folded.split(" ");

  // Two-letter labels are skipped here; the trailing-code pass below handles
  // them, where an uppercase "UK" is a deliberate country marker.
  for (const gram of grams(words)) {
    if (gram.length < 3) continue;
    const byLabel = BY_LABEL.get(gram);
    if (byLabel) return byLabel;
  }
  for (const gram of grams(words)) {
    if (gram.length < 3) continue;
    const byCity = BY_CITY.get(gram);
    if (byCity) return byCity;
  }

  const trailing = /(?:^|[^A-Za-z])([A-Z]{2})[^A-Za-z0-9]*$/.exec(text.trim());
  return trailing ? normaliseCountryCode(trailing[1]) : null;
}

/**
 * Accept-Language header to send when scraping boards in this country, e.g.
 * "cs-CZ,cs;q=0.9,en;q=0.8". English is always appended as the last fallback so
 * international boards still answer in a language the extractors can parse.
 */
export function acceptLanguageFor(code: string): string {
  const country = getCountry(code) ?? BY_CODE.get(DEFAULT_COUNTRY)!;
  const languages = country.languages.includes("en")
    ? [...country.languages]
    : [...country.languages, "en"];
  const parts = [`${languages[0]}-${country.code}`];
  languages.forEach((language, index) => {
    const q = Math.max(0.1, 1 - (index + 1) / 10);
    parts.push(`${language};q=${q.toFixed(1)}`);
  });
  return parts.join(",");
}
