/**
 * Where is the user?
 *
 * Board selection needs an ISO country before any scraping starts, and the app
 * must work for a visitor who never touched a settings page. So we take the
 * best evidence available — what the request asked for, what the profile says,
 * what the CDN put in a header, what the browser prefers — and fall back to a
 * sensible default instead of failing. Nothing here throws: a malformed header
 * is just weaker evidence, never an error.
 */
import { DEFAULT_COUNTRY, getCountry, normaliseCountryCode } from "./countries";

/** Which piece of evidence decided the country. Surfaced in the UI. */
export type CountrySource = "explicit" | "profile" | "geo-header" | "accept-language" | "default";

export interface DetectInput {
  /** Country the request explicitly asked for (query param / body field). */
  explicit?: string | null;
  /** Country saved on the user's profile. */
  profile?: string | null;
  /** Incoming request headers. */
  headers?: Headers | null;
}

export interface DetectedCountry {
  country: string;
  via: CountrySource;
  countryName: string;
}

/**
 * Single-value geo headers set by the common hosts, most trustworthy first.
 * Vercel and Cloudflare come first because they are set by the edge itself;
 * the generic ones can be forged by a client, but they are still better
 * evidence than a browser language.
 */
const GEO_HEADERS = [
  "x-vercel-ip-country",
  "cf-ipcountry",
  "x-country-code",
  "x-geo-country",
  "x-appengine-country",
] as const;

/**
 * Placeholders the CDNs emit when they cannot geolocate: Cloudflare uses "XX"
 * for unknown and "T1" for Tor exit nodes, App Engine uses "ZZ".
 */
const RESERVED_GEO_VALUES = new Set(["XX", "T1", "ZZ"]);

/**
 * Languages spoken in essentially one country, used only when the browser sent
 * a bare language tag with no region. Deliberately excludes en/es/fr/pt/ar/zh
 * and anything else spoken across many markets — guessing "es" as Spain would
 * send a user in Mexico to the wrong boards.
 */
export const LANGUAGE_TO_COUNTRY: Readonly<Record<string, string>> = {
  cs: "CZ", sk: "SK", pl: "PL", de: "DE", nl: "NL", da: "DK", sv: "SE", fi: "FI",
  nb: "NO", no: "NO", hu: "HU", ro: "RO", bg: "BG", el: "GR", tr: "TR", he: "IL",
  ja: "JP", ko: "KR", th: "TH", vi: "VN", id: "ID", uk: "UA",
};

/** Header reads are wrapped because `headers` may be any Headers-like object. */
function readHeader(headers: Headers, name: string): string | null {
  try {
    const value = headers.get(name);
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

/** A geo header value is only usable if it is a real alpha-2 we know about. */
function fromGeoValue(value: string | null): string | null {
  if (!value) return null;
  const upper = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper) || RESERVED_GEO_VALUES.has(upper)) return null;
  return normaliseCountryCode(upper);
}

/**
 * Netlify ships geo data as base64-encoded JSON in `x-nf-geo`. Every step can
 * fail on a truncated or forged header, so the whole thing is best-effort.
 */
function fromNetlifyGeo(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const json = raw.trimStart().startsWith("{") ? raw : decodeBase64(raw);
    if (!json) return null;
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return null;
    const country = (parsed as { country?: unknown }).country;
    if (!country || typeof country !== "object") return null;
    const code = (country as { code?: unknown }).code;
    return typeof code === "string" ? fromGeoValue(code) : null;
  } catch {
    return null;
  }
}

/** base64 → UTF-8 text, or null when the input is not valid base64. */
function decodeBase64(value: string): string | null {
  try {
    const binary = atob(value);
    // atob yields one char per byte; re-decode so non-ASCII city names survive.
    return new TextDecoder().decode(Uint8Array.from(binary, (ch) => ch.charCodeAt(0)));
  } catch {
    return null;
  }
}

/**
 * Country from CDN/proxy geo headers, or null when none carry a country we
 * know. Exposed separately so callers that only have headers can reuse it.
 */
export function countryFromHeaders(headers: Headers): string | null {
  if (!headers || typeof headers.get !== "function") return null;
  for (const name of GEO_HEADERS) {
    const code = fromGeoValue(readHeader(headers, name));
    if (code) return code;
  }
  return fromNetlifyGeo(readHeader(headers, "x-nf-geo"));
}

/**
 * Country implied by an `Accept-Language` header, e.g. "cs-CZ,cs;q=0.9" → CZ.
 *
 * Tags are tried in q-value order. A region subtag is taken at face value; a
 * bare language only counts when it is effectively single-country (see
 * `LANGUAGE_TO_COUNTRY`), otherwise we fall through rather than guess.
 */
export function countryFromAcceptLanguage(header: string | null | undefined): string | null {
  if (typeof header !== "string" || !header.trim()) return null;
  const tags = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const qParam = params.map((p) => p.trim()).find((p) => p.toLowerCase().startsWith("q="));
      const q = qParam ? Number.parseFloat(qParam.slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), q: Number.isFinite(q) ? q : 0 };
    })
    .filter((entry) => entry.tag && entry.tag !== "*" && entry.q > 0)
    // Stable sort keeps header order for equal q, so the first listed wins.
    .sort((a, b) => b.q - a.q);

  for (const { tag } of tags) {
    const subtags = tag.split("-");
    const region = subtags.slice(1).find((part) => /^[a-z]{2}$/.test(part));
    const byRegion = region ? normaliseCountryCode(region) : null;
    if (byRegion) return byRegion;
    const byLanguage = LANGUAGE_TO_COUNTRY[subtags[0]];
    if (byLanguage) return byLanguage;
  }
  return null;
}

/**
 * Resolve the country to scrape for. First hit wins: an explicit choice beats
 * a saved profile, which beats the network's opinion, which beats the
 * browser's language, which beats the default.
 */
export function detectCountry(input: DetectInput): DetectedCountry {
  const ordered: Array<[CountrySource, () => string | null]> = [
    ["explicit", () => normaliseCountryCode(input.explicit)],
    ["profile", () => normaliseCountryCode(input.profile)],
    ["geo-header", () => (input.headers ? countryFromHeaders(input.headers) : null)],
    [
      "accept-language",
      () =>
        input.headers
          ? countryFromAcceptLanguage(readHeader(input.headers, "accept-language"))
          : null,
    ],
  ];

  for (const [via, resolve] of ordered) {
    const country = resolve();
    if (country) return describe(country, via);
  }
  return describe(DEFAULT_COUNTRY, "default");
}

function describe(country: string, via: CountrySource): DetectedCountry {
  return { country, via, countryName: getCountry(country)?.name ?? country };
}
