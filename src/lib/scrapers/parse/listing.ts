/**
 * Picking job links off a listing page.
 *
 * This replaces the old "hand the whole page to GPT and ask which links are
 * jobs" call. A board that knows its own markup passes a `cardSelector` or a
 * `urlPattern` and gets an exact answer; a board that does not falls back to a
 * generic set of job-detail URL shapes, which covers most boards because job
 * URLs are conventional (`/job/`, `/nabidka/`, `/oferta/`, `/rpd/`…).
 *
 * Relevance is deliberately NOT decided here. The old GPT call tried to filter
 * to matching jobs while reading the page, which meant a bad prompt silently
 * dropped good jobs. Now every plausible link is followed and the lexical
 * ranker in `src/lib/matching` does the filtering, where it can be tested.
 */
import * as cheerio from "cheerio";

export interface JobLink {
  title: string;
  url: string;
}

export interface SelectJobLinksOptions {
  /** CSS selector for job cards on this board. Tried first when supplied. */
  cardSelector?: string;
  /** CSS selector for the anchor inside a card, relative to the card. */
  linkSelector?: string;
  /** Only accept URLs matching this. Strongly preferred — boards should supply it. */
  urlPattern?: RegExp;
  /** Cap on returned links. Default 60. */
  limit?: number;
}

const DEFAULT_LIMIT = 60;

/**
 * Job-detail URL shapes across the boards this app scrapes, in the languages
 * they publish in. Used only when a board did not supply its own pattern.
 */
const JOB_URL_PATTERNS: RegExp[] = [
  /\/(job|jobs|it-job|job-offer|job-listing|position|positions|offer|offers|vacancy|vacancies|career|careers|opening)[/-]/i,
  /\/(nabidka|nabidky|pozice|prace)[/-]/i, // Czech / Slovak
  /\/(oferta|oferty|praca|ogloszenie)[/-]/i, // Polish
  /\/(stelle|stellen|jobangebot)[/-]/i, // German
  /\/(emploi|offre|offres)[/-]/i, // French
  /\/(empleo|vacante|oferta-de-trabajo)[/-]/i, // Spanish
  /\/(vaga|vagas)[/-]/i, // Portuguese
  /\/rpd\//i, // Jobs.cz
  /\/desc\//i, // Jooble
  /\/remote-jobs\//i,
];

/** Navigation, legal and utility paths that are never a job posting. */
const NAV_PATTERN =
  /\/(login|signin|sign-in|signup|sign-up|register|account|profile|about|contact|press|privacy|terms|cookies?|gdpr|faq|help|support|blog|news|article|tag|tags|category|categories|search|filter|company|companies|employer|employers|pricing|newsletter|subscribe|logout|rss|feed|sitemap|app|download)(\/|$|\?|#)/i;

/** Locale switch links: `/en/`, `/cs/`, `/de-de/` at the start of a path. */
const LOCALE_ONLY_PATTERN = /^\/[a-z]{2}(-[a-z]{2})?\/?$/i;

/** Tracking parameters that make two links to the same posting look different. */
const TRACKING_PARAMS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "gclid", "fbclid", "msclkid", "ref", "referrer", "source", "src", "trk", "at",
];

/** Strips tracking noise and the fragment so the same posting dedupes to one URL. */
export function canonicaliseUrl(raw: string): string {
  try {
    const url = new URL(raw);
    for (const param of TRACKING_PARAMS) url.searchParams.delete(param);
    url.hash = "";
    // A trailing slash is not a different page.
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch {
    return raw;
  }
}

/**
 * Turns a URL slug into a readable title, for links whose anchor text is an
 * icon or empty: `/job/senior-react-developer-1234` → "Senior React Developer".
 */
export function titleFromUrl(raw: string): string {
  try {
    const { pathname } = new URL(raw);
    const slug = pathname.split("/").filter(Boolean).pop() ?? "";
    const words = slug
      .replace(/\.(html?|php|aspx?)$/i, "")
      .split(/[-_]+/)
      // Trailing numeric ids carry no meaning; interior numbers might ("web3").
      .filter((part, index, all) => part && !(index === all.length - 1 && /^\d+$/.test(part)));
    if (words.length === 0) return "";
    return words
      .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
      .join(" ");
  } catch {
    return "";
  }
}

function looksLikeJobUrl(url: string, pattern?: RegExp): boolean {
  if (pattern) return pattern.test(url);
  return JOB_URL_PATTERNS.some((p) => p.test(url));
}

function isNavigation(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    if (pathname === "/" || pathname === "") return true;
    if (LOCALE_ONLY_PATTERN.test(pathname)) return true;
    return NAV_PATTERN.test(pathname);
  } catch {
    return true;
  }
}

/**
 * Deterministically picks job-detail links off a listing page.
 *
 * Prefers the board's own card markup (cleaner titles), falls back to filtering
 * every link on the page. Returns at most `limit` links, deduped by canonical
 * URL, in the order the page presented them — boards sort by relevance or date,
 * and that ordering is information worth keeping.
 */
export function selectJobLinks(
  page: { html: string; url: string; links: Array<{ text: string; url: string }> },
  opts: SelectJobLinksOptions = {},
): JobLink[] {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const seen = new Set<string>();
  const out: JobLink[] = [];

  const push = (rawUrl: string, rawTitle: string): void => {
    if (out.length >= limit) return;
    const url = canonicaliseUrl(rawUrl);
    if (!url.startsWith("http") || seen.has(url)) return;
    if (isNavigation(url)) return;
    if (!looksLikeJobUrl(url, opts.urlPattern)) return;

    const title = (rawTitle ?? "").replace(/\s+/g, " ").trim() || titleFromUrl(url);
    if (!title) return;

    seen.add(url);
    out.push({ title, url });
  };

  // Preferred path: the board told us what a card looks like.
  if (opts.cardSelector && page.html) {
    try {
      const $ = cheerio.load(page.html);
      const base = new URL(page.url);
      $(opts.cardSelector).each((_, card) => {
        const $card = $(card);
        const anchor = opts.linkSelector ? $card.find(opts.linkSelector).first() : $card.find("a[href]").first();
        const href = (anchor.attr("href") ?? $card.attr("href") ?? "").trim();
        if (!href) return;
        try {
          // A card's own heading beats its link text, which is often "Apply".
          const heading = $card.find("h1, h2, h3, h4, [class*='title'], [class*='Title']").first().text();
          push(new URL(href, base).href, heading || anchor.text());
        } catch {
          // unparseable href — skip this card
        }
      });
    } catch {
      // malformed markup — fall through to the link-list path
    }
  }

  if (out.length >= limit) return out;

  // Fallback: filter every link the fetcher already collected.
  for (const link of page.links) {
    push(link.url, link.text);
    if (out.length >= limit) break;
  }

  return out;
}
