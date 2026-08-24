/**
 * Accessors over the skill taxonomy.
 *
 * `TAXONOMY_DATA` is the raw knowledge; this module turns it into the lookup
 * structures the intent classifier needs and expands a free-text query into the
 * weighted term set the ranker scores against.
 */
import { TAXONOMY_DATA, type TaxonomyEntry } from "./taxonomy-data";
import { flattenText, normaliseToken, tokenizeExact } from "./tokenize";
import type { WeightedTerm } from "@/lib/scrapers/types";

export type { TaxonomyEntry } from "./taxonomy-data";
export const TAXONOMY = TAXONOMY_DATA;

/**
 * How much a match on each kind of term is worth. An exact alias is near-proof
 * that the posting is the role the user asked for; a `related` term on its own
 * is barely a hint.
 */
export const TERM_WEIGHTS = {
  alias: 3.0,
  strong: 2.0,
  related: 0.8,
  /** Words the user typed that the taxonomy does not know about. */
  literal: 1.2,
} as const;

/** alias (flattened) → entry. Built once at module load. */
const ALIAS_INDEX = new Map<string, TaxonomyEntry>();
for (const entry of TAXONOMY_DATA) {
  ALIAS_INDEX.set(flattenText(entry.id), entry);
  ALIAS_INDEX.set(flattenText(entry.label), entry);
  for (const alias of entry.aliases) {
    const key = flattenText(alias);
    // First writer wins: entries are ordered most-specific first, so "react"
    // resolves to React rather than to the broader Frontend entry.
    if (!ALIAS_INDEX.has(key)) ALIAS_INDEX.set(key, entry);
  }
}

export function getEntry(id: string): TaxonomyEntry | null {
  return TAXONOMY_DATA.find((e) => e.id === id) ?? null;
}

/** Resolves a whole query string to one taxonomy entry, if it names one. */
export function findTaxonomyEntry(query: string): TaxonomyEntry | null {
  return ALIAS_INDEX.get(flattenText(query)) ?? null;
}

/**
 * Every taxonomy entry the query names, longest phrase first.
 *
 * A query like "senior react node developer" names two entries; the ranker
 * needs both, and the caller needs to know which one led.
 */
export function findTaxonomyEntries(query: string): TaxonomyEntry[] {
  const whole = findTaxonomyEntry(query);
  if (whole) return [whole];

  const flat = flattenText(query);
  const found: TaxonomyEntry[] = [];
  const seen = new Set<string>();

  // Longest aliases first so "react native" beats "react".
  const aliases = [...ALIAS_INDEX.keys()].sort((a, b) => b.length - a.length);
  let remaining = ` ${flat} `;
  for (const alias of aliases) {
    if (!alias) continue;
    const needle = ` ${alias} `;
    if (!remaining.includes(needle)) continue;
    const entry = ALIAS_INDEX.get(alias)!;
    if (!seen.has(entry.id)) {
      seen.add(entry.id);
      found.push(entry);
    }
    // Consume the match so a shorter alias cannot claim the same words.
    remaining = remaining.replace(needle, " ");
  }
  return found;
}

export interface ExpandedQuery {
  entries: TaxonomyEntry[];
  terms: WeightedTerm[];
  negativeTerms: string[];
}

/**
 * Turns a query into the weighted positive terms and the negative terms the
 * scorer uses.
 *
 * When several entries match, a term one entry calls "negative" is dropped if
 * another calls it positive — otherwise a search for "react node" would
 * penalise itself for being both frontend and backend.
 */
export function expandQuery(query: string): ExpandedQuery {
  const entries = findTaxonomyEntries(query);
  const weights = new Map<string, number>();

  const add = (term: string, weight: number) => {
    const key = normaliseTerm(term);
    if (!key) return;
    weights.set(key, Math.max(weights.get(key) ?? 0, weight));
  };

  for (const entry of entries) {
    add(entry.id, TERM_WEIGHTS.alias);
    add(entry.label, TERM_WEIGHTS.alias);
    for (const alias of entry.aliases) add(alias, TERM_WEIGHTS.alias);
    for (const term of entry.strong) add(term, TERM_WEIGHTS.strong);
    for (const term of entry.related) add(term, TERM_WEIGHTS.related);
  }

  // Whatever the user typed always counts, known to the taxonomy or not.
  for (const token of tokenizeExact(query)) {
    if (token.length < 2) continue;
    add(token, TERM_WEIGHTS.literal);
  }

  const positive = new Set(weights.keys());
  const negatives = new Set<string>();
  for (const entry of entries) {
    for (const term of entry.negative) {
      const key = normaliseTerm(term);
      if (key && !positive.has(key)) negatives.add(key);
    }
  }

  const terms = [...weights.entries()]
    .map(([term, weight]) => ({ term, weight }))
    .sort((a, b) => b.weight - a.weight || a.term.localeCompare(b.term));

  return { entries, terms, negativeTerms: [...negatives].sort() };
}

/**
 * Canonical form of a taxonomy term. Multi-word terms keep their spaces so the
 * scorer can look for the phrase; single words go through the token folder so
 * "Node.js" and "node.js" collide.
 */
export function normaliseTerm(term: string): string {
  const trimmed = (term ?? "").trim();
  if (!trimmed) return "";
  return trimmed.includes(" ") ? flattenText(trimmed) : normaliseToken(trimmed);
}
