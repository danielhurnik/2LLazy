/**
 * Query intent classification — deterministic, synchronous, no model call.
 *
 * The old implementation looked a query up in a small static table and fell
 * back to gpt-4o-mini for anything it did not recognise. The table survives (as
 * the far larger `taxonomy-data.ts`); the fallback is now literal term
 * matching, which is worse at inferring "a Rails job is a backend job" but is
 * free, instant, and never returns something different on the second call.
 */
import type { JobCategory, QueryIntent, Seniority } from "@/lib/scrapers/types";
import { expandQuery, TERM_WEIGHTS } from "./taxonomy";
import { flattenText } from "./tokenize";

/** Seniority words seen in queries and postings, across the boards' languages. */
const SENIORITY_PATTERNS: Array<{ level: Seniority; words: string[] }> = [
  { level: "Lead", words: ["lead", "principal", "staff", "head of", "architect", "vedouci", "teamlead", "team lead", "tech lead"] },
  { level: "Senior", words: ["senior", "sr", "senior level", "expert", "seniorni"] },
  { level: "Mid", words: ["mid", "medior", "middle", "regular", "mid-level", "medior level"] },
  { level: "Junior", words: ["junior", "jr", "entry level", "entry-level", "graduate", "trainee", "intern", "internship", "juniorni", "praktikant"] },
];

/**
 * Reads a seniority out of free text. Checked most-senior first so
 * "senior or lead" resolves to Lead rather than Senior.
 */
export function detectSeniority(text: string): Seniority | null {
  const flat = ` ${flattenText(text)} `;
  for (const { level, words } of SENIORITY_PATTERNS) {
    for (const word of words) {
      if (flat.includes(` ${flattenText(word)} `)) return level;
    }
  }
  return null;
}

/** Normalises the UI's skill-level value; "Any" and "" both mean no preference. */
export function parseSkillLevel(skillLevel: string | null | undefined): Seniority | null {
  const value = (skillLevel ?? "").trim().toLowerCase();
  if (!value || value === "any") return null;
  const match = SENIORITY_PATTERNS.find((p) => p.level.toLowerCase() === value);
  if (match) return match.level;
  return detectSeniority(value);
}

/**
 * Classifies a search into the structured intent the boards and the ranker
 * both consume. Always returns a usable intent, including for a query the
 * taxonomy has never seen.
 */
export function classifyQueryIntent(query: string, skillLevel?: string | null): QueryIntent {
  const trimmed = (query ?? "").trim();
  const { entries, terms, negativeTerms } = expandQuery(trimmed);
  const seniority = parseSkillLevel(skillLevel) ?? detectSeniority(trimmed);

  // The leading entry decides the category; ties go to the entry whose alias
  // matched most of the query, which `findTaxonomyEntries` already ordered.
  const primary = entries[0] ?? null;
  const category: JobCategory = primary?.category ?? "Other";

  const includedTitles = dedupe(entries.flatMap((e) => e.includedTitles));
  // A title one entry excludes but another includes is not an exclusion.
  const includedSet = new Set(includedTitles.map(flattenText));
  const excludedTitles = dedupe(entries.flatMap((e) => e.excludedTitles)).filter(
    (title) => !includedSet.has(flattenText(title)),
  );

  return {
    query: trimmed,
    category,
    seniority,
    terms: terms.length > 0 ? terms : literalFallback(trimmed),
    negativeTerms,
    includedTitles,
    excludedTitles,
    canonicalText: entries.map((e) => e.canonicalText).join(" ") || trimmed,
    scrapingKeyword: primary?.scrapingKeyword || trimmed,
  };
}

/**
 * A query of pure punctuation or stopwords still has to search for something,
 * so fall back to the raw string as a single term.
 */
function literalFallback(query: string) {
  const flat = flattenText(query);
  return flat ? [{ term: flat, weight: TERM_WEIGHTS.literal }] : [];
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = flattenText(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}
