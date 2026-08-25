/**
 * HTML → text helpers shared by every deterministic extraction layer.
 *
 * Job pages come from hundreds of hand-written templates, so each helper is
 * defensive by design: malformed or truncated markup must degrade to an empty
 * string instead of throwing and killing a whole search.
 */
import * as cheerio from "cheerio";

/** Chrome that never carries job content and only pollutes the text view. */
const CHROME_SELECTOR =
  "script, style, noscript, svg, iframe, template, form, nav, header, footer, aside, [role='navigation'], [aria-hidden='true']";

/** Elements that imply a line break around their text. */
const BLOCK_SELECTOR =
  "p, div, section, article, main, ul, ol, li, dl, dt, dd, table, thead, tbody, tr, td, th, h1, h2, h3, h4, h5, h6, blockquote, pre, figure, figcaption, address, details, summary";

/** Elements likely to wrap the real posting, best candidates first. */
const MAIN_SELECTORS = [
  "[itemprop='description']",
  "main",
  "article",
  "[role='main']",
  "#content",
  "#main",
  "#job",
  "#jobDescriptionText",
  ".job-description",
  ".jobDescription",
  ".job-detail",
  ".job-details",
  ".job-offer",
  ".job-ad",
  ".posting",
  ".vacancy",
  ".description",
  ".content",
  ".main",
];

/**
 * Collapses runs of horizontal whitespace while keeping at most one blank line,
 * so paragraph structure survives but the text stays comparable in tests.
 */
function normalizeText(raw: string): string {
  return raw
    .replace(/\r/g, "")
    .replace(/[ \t\u00a0\u2007\u202f\u200b]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Marks block boundaries with real newlines before the text is flattened.
 * Cheerio's `.text()` concatenates without separators, which would otherwise
 * glue a heading straight onto the following paragraph.
 */
function insertBreaks($: cheerio.CheerioAPI): void {
  $("br, hr").replaceWith("\n");
  $(BLOCK_SELECTOR).each((_, el) => {
    $(el).prepend("\n");
    $(el).append("\n");
  });
}

/** HTML → readable plain text. Preserves paragraph and list breaks, strips chrome. */
export function htmlToText(html: string): string {
  if (!html || typeof html !== "string") return "";
  // Plain text in, plain text out — avoids cheerio wrapping a bare string.
  if (!/[<&]/.test(html)) return normalizeText(html);
  try {
    const $ = cheerio.load(html);
    $(CHROME_SELECTOR).remove();
    insertBreaks($);
    const body = $("body");
    return normalizeText(body.length ? body.text() : $.root().text());
  } catch {
    return normalizeText(html.replace(/<[^>]*>/g, " "));
  }
}

/** All `<meta>` name/property → content pairs, lowercased keys. First one wins. */
export function metaTags(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!html || typeof html !== "string") return out;
  try {
    const $ = cheerio.load(html);
    $("meta").each((_, el) => {
      const $el = $(el);
      const key = ($el.attr("property") ?? $el.attr("name") ?? $el.attr("itemprop") ?? "")
        .trim()
        .toLowerCase();
      const content = ($el.attr("content") ?? "").replace(/\s+/g, " ").trim();
      if (key && content && !(key in out)) out[key] = content;
    });
  } catch {
    // A page whose <head> cannot be parsed simply contributes no meta tags.
  }
  return out;
}

/**
 * Picks the most likely main-content element and returns its text.
 *
 * Scoring subtracts link text twice so a nav-heavy sidebar never beats the real
 * description, which is almost always the longest low-link-density block.
 */
export function mainContentText(html: string): string {
  if (!html || typeof html !== "string") return "";
  try {
    const $ = cheerio.load(html);
    $(CHROME_SELECTOR).remove();
    insertBreaks($);

    let best = "";
    let bestScore = 0;
    $(MAIN_SELECTORS.join(", "))
      .slice(0, 40)
      .each((_, el) => {
        const $el = $(el);
        const text = normalizeText($el.text());
        if (!text) return;
        const score = text.length - $el.find("a").text().length * 2;
        if (score > bestScore) {
          bestScore = score;
          best = text;
        }
      });

    if (bestScore >= 200) return best;
    const body = $("body");
    const fallback = normalizeText(body.length ? body.text() : $.root().text());
    return fallback.length > best.length ? fallback : best;
  } catch {
    return htmlToText(html);
  }
}

/**
 * Removes the doubled-title artefact boards produce when a heading is rendered
 * twice into one node: "React DeveloperReact Developer" → "React Developer".
 * Also tolerates a separator between the halves ("Foo | Foo").
 */
export function dedupeRepeatedText(text: string | null | undefined): string {
  if (!text) return "";
  const t = text.replace(/\s+/g, " ").trim();
  const n = t.length;
  if (n < 6) return t;

  if (n % 2 === 0) {
    const half = n / 2;
    if (t.slice(0, half) === t.slice(half)) return t.slice(0, half).trim();
  }
  // "Foo - Foo" / "Foo Foo": an odd separator sits between the two halves.
  for (let sepLen = 1; sepLen <= 3; sepLen++) {
    if ((n - sepLen) % 2 !== 0) continue;
    const half = (n - sepLen) / 2;
    const sep = t.slice(half, half + sepLen);
    if (!/^[\s|\-–—·•,/]+$/.test(sep)) continue;
    if (t.slice(0, half) === t.slice(half + sepLen)) return t.slice(0, half).trim();
  }
  return t;
}
