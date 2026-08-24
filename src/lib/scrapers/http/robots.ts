/**
 * robots.txt: what a board is willing to have crawled, and how fast.
 *
 * Reading it is both the polite thing and the practical one — `Crawl-delay`
 * tells us the pacing that will not get us blocked, and `Sitemap:` lines are
 * how the non-browser discovery path finds job URLs without rendering a
 * single-page app.
 *
 * The parser implements the parts of the de-facto standard that matter here:
 * user-agent group selection with a `*` fallback, `Allow`/`Disallow` with
 * longest-match-wins, `Crawl-delay`, and `Sitemap`. It is deliberately
 * permissive on malformed input: a robots.txt we cannot parse must not stop a
 * scrape, but a rule we *can* read is always obeyed.
 */

export interface RobotsRules {
  /** Path prefixes that are disallowed for us, longest first. */
  disallow: string[];
  /** Path prefixes explicitly allowed, longest first; these beat disallow. */
  allow: string[];
  /** Seconds the host asked us to wait between requests, if stated. */
  crawlDelaySeconds: number | null;
  /** Absolute sitemap URLs advertised by the host. */
  sitemaps: string[];
}

export const PERMISSIVE: RobotsRules = {
  disallow: [],
  allow: [],
  crawlDelaySeconds: null,
  sitemaps: [],
};

/** Our crawler's token, matched against `User-agent` groups. */
export const USER_AGENT_TOKEN = "2llazy";

export function parseRobots(text: string, userAgent = USER_AGENT_TOKEN): RobotsRules {
  if (!text || typeof text !== "string") return { ...PERMISSIVE };

  const rules: RobotsRules = { disallow: [], allow: [], crawlDelaySeconds: null, sitemaps: [] };

  // Group selection: a block naming us wins outright over the `*` block, so
  // both are collected and the specific one is preferred at the end.
  const specific = { disallow: [] as string[], allow: [] as string[], crawlDelay: null as number | null };
  const wildcard = { disallow: [] as string[], allow: [] as string[], crawlDelay: null as number | null };

  let active: Array<typeof specific> = [];
  let lastLineWasUserAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;

    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "sitemap") {
      if (value) rules.sitemaps.push(value);
      continue;
    }

    if (field === "user-agent") {
      // Consecutive User-agent lines share one group of rules.
      if (!lastLineWasUserAgent) active = [];
      const token = value.toLowerCase();
      if (token === "*") active.push(wildcard);
      else if (token.includes(userAgent)) active.push(specific);
      lastLineWasUserAgent = true;
      continue;
    }
    lastLineWasUserAgent = false;

    if (active.length === 0) continue;

    if (field === "disallow") {
      // An empty Disallow means "nothing is disallowed" — not a bare-path block.
      if (value) for (const group of active) group.disallow.push(value);
    } else if (field === "allow") {
      if (value) for (const group of active) group.allow.push(value);
    } else if (field === "crawl-delay") {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) {
        for (const group of active) group.crawlDelay = seconds;
      }
    }
  }

  const chosen =
    specific.disallow.length || specific.allow.length || specific.crawlDelay !== null
      ? specific
      : wildcard;

  const byLength = (a: string, b: string) => b.length - a.length;
  rules.disallow = chosen.disallow.sort(byLength);
  rules.allow = chosen.allow.sort(byLength);
  rules.crawlDelaySeconds = chosen.crawlDelay;
  return rules;
}

/** Turns a robots path pattern (with `*` and `$`) into a matcher. */
function matches(pattern: string, path: string): boolean {
  if (!pattern.includes("*") && !pattern.endsWith("$")) return path.startsWith(pattern);
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\\\$$/, "$");
  try {
    return new RegExp(`^${escaped}`).test(path);
  } catch {
    return false;
  }
}

/** True when `url`'s path is crawlable under these rules. Longest match wins. */
export function isAllowed(rules: RobotsRules, url: string): boolean {
  let path: string;
  try {
    const parsed = new URL(url);
    path = parsed.pathname + parsed.search;
  } catch {
    return true;
  }

  const longestAllow = rules.allow.find((pattern) => matches(pattern, path));
  const longestDisallow = rules.disallow.find((pattern) => matches(pattern, path));

  if (!longestDisallow) return true;
  if (!longestAllow) return false;
  // Both matched: the more specific rule governs.
  return longestAllow.length >= longestDisallow.length;
}
