/**
 * Lexical relevance scoring — the replacement for cosine similarity over
 * OpenAI embeddings.
 *
 * The shape is BM25 with field weighting: a term hit in the title counts for
 * far more than the same hit buried in a description, rare terms count for more
 * than common ones, and long postings do not win just by being long. On top of
 * that sit the domain rules the embeddings used to approximate — negative
 * terms, excluded titles, seniority, recency, location and salary.
 *
 * Everything is explainable on purpose. `ScoreResult.reasons` is shown to the
 * user, so a bad ranking is a bug someone can report and fix rather than an
 * opaque number to argue with.
 */
import type { QueryIntent, Seniority } from "@/lib/scrapers/types";
import { detectSeniority } from "./intent";
import { flattenText, tokenize } from "./tokenize";
import { normaliseTerm } from "./taxonomy";

export interface ScoreInput {
  title: string;
  company?: string | null;
  description: string;
  location?: string | null;
  salary?: string | null;
  workType?: string | null;
  postedAt?: Date | null;
  country?: string | null;
}

export interface ScoreContext {
  /** Inverse document frequency over the current result set. */
  idf?: Map<string, number>;
  /** Average document length in tokens, for BM25 length normalisation. */
  avgDocLength?: number;
  city?: string | null;
  country?: string | null;
  remoteOnly?: boolean;
  salaryMin?: number | null;
  salaryMax?: number | null;
}

export interface ScoreResult {
  score: number;
  matched: string[];
  missing: string[];
  reasons: string[];
}

// ── Tuning constants ─────────────────────────────────────────────────────────
// Every number here is a judgement call; they are named and commented so they
// can be argued with in a pull request instead of reverse-engineered.

/** BM25 term-frequency saturation. 1.2 is the standard starting point. */
const K1 = 1.2;
/** BM25 length normalisation. 0.75 is the standard starting point. */
const B = 0.75;
/** A title hit is worth this many description hits. */
const TITLE_WEIGHT = 3.0;
/** Assumed average posting length when no corpus statistics are supplied. */
const DEFAULT_AVG_LENGTH = 220;
/** IDF used for a term the corpus has never seen, and for every title match. */
const DEFAULT_IDF = 1.6;

/**
 * Floor under corpus IDF.
 *
 * Raw Robertson/Sparck-Jones IDF collapses toward zero for a term present in
 * every document. That is right for *ordering* within a result set but wrong
 * for the absolute score, which decides whether a posting is shown at all: a
 * board that returns fifty genuine React jobs for a React query would drive
 * "react" to no weight and filter every one of them out. Floor it so a real
 * match always carries evidence.
 */
const MIN_CORPUS_IDF = 0.35;

/** A negative term in the title is close to disqualifying. */
const NEGATIVE_TITLE_PENALTY = 0.55;
/** The same term in the body is only weak evidence. */
const NEGATIVE_BODY_PENALTY = 0.08;
/** Multiplier applied when the title matches an excluded role and nothing else. */
const EXCLUDED_TITLE_MULTIPLIER = 0.15;
/** Multiplier for a seniority mismatch, e.g. a Junior posting for a Senior search. */
const SENIORITY_MISMATCH_MULTIPLIER = 0.65;
const SENIORITY_MATCH_BONUS = 0.06;
/** Multiplier for an onsite role when the user asked for remote only. */
const NON_REMOTE_MULTIPLIER = 0.35;

const CITY_BONUS = 0.08;
const COUNTRY_BONUS = 0.04;
const OUT_OF_COUNTRY_PENALTY = 0.06;
const SALARY_IN_RANGE_BONUS = 0.08;
const SALARY_PRESENT_BONUS = 0.02;
const RECENCY_BONUS = 0.07;

/** Saturation constant for the final 0–1 squash; see `saturate`. */
const SATURATION_K = 10;

/**
 * Floor and span of the coverage factor.
 *
 * A posting that matches one incidental keyword ("Composition API" in a Vue ad
 * hit on a Backend search) must not score like one that matches the whole term
 * set. The raw BM25 total is therefore scaled by how much of the query's total
 * term weight the posting actually evidenced. `* 3` means roughly a third of
 * the weight is enough for full marks — query term sets include many alias
 * spellings that no single posting will ever contain.
 */
const COVERAGE_FLOOR = 0.35;
const COVERAGE_SPAN = 0.65;
const COVERAGE_FULL_AT = 3;

/**
 * Cut-off the scrape pipeline uses to decide what is worth showing.
 *
 * Calibrated against the fixture corpus in `tests/unit/matching-score.test.ts`:
 * a posting whose title names the searched role lands around 0.5–0.8, one that
 * only mentions it in passing lands around 0.2–0.35, and an unrelated posting
 * ("IT Director", "Sales Engineer") lands below 0.15. 0.18 keeps the passing
 * mentions — a Fullstack role does deserve to show up in a React search — while
 * dropping the noise.
 */
export const RELEVANCE_THRESHOLD = 0.18;

/** Builds IDF and average length over a result set. */
export function buildCorpusStats(docs: string[]): { idf: Map<string, number>; avgDocLength: number } {
  const idf = new Map<string, number>();
  const documentFrequency = new Map<string, number>();
  let totalLength = 0;

  for (const doc of docs) {
    const tokens = tokenize(doc);
    totalLength += tokens.length;
    for (const token of new Set(tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  const n = Math.max(docs.length, 1);
  for (const [term, df] of documentFrequency) {
    // Robertson/Sparck-Jones IDF. Floored rather than allowed toward zero — see
    // MIN_CORPUS_IDF in ./score for why a homogeneous result set must not
    // flatten every term to nothing.
    idf.set(term, Math.max(MIN_CORPUS_IDF, Math.log(1 + (n - df + 0.5) / (df + 0.5))));
  }

  return { idf, avgDocLength: docs.length > 0 ? totalLength / n : DEFAULT_AVG_LENGTH };
}

interface FieldStats {
  counts: Map<string, number>;
  length: number;
  flat: string;
}

function analyse(text: string): FieldStats {
  const tokens = tokenize(text ?? "");
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return { counts, length: tokens.length, flat: ` ${flattenText(text ?? "")} ` };
}

/** Occurrences of a taxonomy term — a phrase in the flat text, a word in the counts. */
function occurrences(term: string, field: FieldStats): number {
  if (term.includes(" ")) {
    let count = 0;
    let index = field.flat.indexOf(` ${term} `);
    while (index !== -1) {
      count++;
      index = field.flat.indexOf(` ${term} `, index + 1);
    }
    return count;
  }
  return field.counts.get(term) ?? 0;
}

function bm25(tf: number, idf: number, length: number, avgLength: number): number {
  if (tf <= 0) return 0;
  const denominator = tf + K1 * (1 - B + B * (length / Math.max(avgLength, 1)));
  return idf * ((tf * (K1 + 1)) / Math.max(denominator, 1e-6));
}

/** Squashes an unbounded score into [0,1) while preserving order at the top end. */
function saturate(raw: number): number {
  if (raw <= 0) return 0;
  return raw / (raw + SATURATION_K);
}

function titleMatchesAny(titleFlat: string, fragments: string[]): string | null {
  for (const fragment of fragments) {
    const needle = flattenText(fragment);
    if (needle && titleFlat.includes(needle)) return fragment;
  }
  return null;
}

/** Pulls the first plausible salary figure out of the display string. */
function salaryMidpoint(salary: string): number | null {
  const numbers = (salary.match(/\d[\d\s.,]*/g) ?? [])
    .map((raw) => Number(raw.replace(/[\s.,]/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (numbers.length === 0) return null;
  return numbers.reduce((a, b) => a + b, 0) / numbers.length;
}

export function scoreJob(job: ScoreInput, intent: QueryIntent, ctx: ScoreContext = {}): ScoreResult {
  const title = analyse(job.title ?? "");
  const body = analyse(`${job.company ?? ""} ${job.description ?? ""}`);
  const avgLength = ctx.avgDocLength && ctx.avgDocLength > 0 ? ctx.avgDocLength : DEFAULT_AVG_LENGTH;

  const matched: string[] = [];
  const missing: string[] = [];
  const reasons: string[] = [];

  // ── Positive term evidence ────────────────────────────────────────────────
  let raw = 0;
  let titleHits = 0;
  let totalWeight = 0;
  let matchedWeight = 0;
  for (const { term, weight } of intent.terms) {
    const key = normaliseTerm(term);
    if (!key) continue;
    totalWeight += weight;
    const bodyIdf = Math.max(ctx.idf?.get(key) ?? DEFAULT_IDF, MIN_CORPUS_IDF);
    const inTitle = occurrences(key, title);
    const inBody = occurrences(key, body);

    if (inTitle === 0 && inBody === 0) {
      // Only report a strong term as missing; nobody needs to know the posting
      // omitted a "related" keyword.
      if (weight >= 2) missing.push(term);
      continue;
    }

    matched.push(term);
    matchedWeight += weight;
    if (inTitle > 0) titleHits++;
    // The title contribution deliberately ignores corpus statistics. Whether a
    // posting's *title* answers the query is a fact about that posting, not
    // about what else happened to come back in the same batch.
    raw += weight * TITLE_WEIGHT * bm25(inTitle, DEFAULT_IDF, Math.max(title.length, 1), 8);
    raw += weight * bm25(inBody, bodyIdf, body.length, avgLength);
  }

  if (totalWeight > 0) {
    const coverage = Math.min(1, (matchedWeight / totalWeight) * COVERAGE_FULL_AT);
    raw *= COVERAGE_FLOOR + COVERAGE_SPAN * coverage;
  }

  let score = saturate(raw);
  if (titleHits > 0) {
    reasons.push(`title mentions ${matched.slice(0, 3).join(", ")}`);
  } else if (matched.length > 0) {
    reasons.push(`description mentions ${matched.slice(0, 3).join(", ")}`);
  }

  // ── Negative term evidence ────────────────────────────────────────────────
  // This is what the anti-query embedding used to do: a Backend posting that
  // happens to say "JavaScript" should not win a Frontend search.
  const bodyNegatives: string[] = [];
  for (const term of intent.negativeTerms) {
    const key = normaliseTerm(term);
    if (!key) continue;
    if (occurrences(key, title) > 0) {
      score -= NEGATIVE_TITLE_PENALTY * score;
      reasons.push(`title suggests a different role (${term})`);
      bodyNegatives.length = 0;
      break;
    }
    if (occurrences(key, body) > 0) bodyNegatives.push(term);
  }
  if (bodyNegatives.length > 0) {
    // Compounding rather than summing keeps the penalty inside (0,1) no matter
    // how many out-of-domain terms a long posting happens to contain.
    score *= Math.pow(1 - NEGATIVE_BODY_PENALTY, Math.min(bodyNegatives.length, 6));
    if (bodyNegatives.length >= 3) {
      reasons.push(`mentions other domains (${bodyNegatives.slice(0, 3).join(", ")})`);
    }
  }

  // ── Title inclusion / exclusion ───────────────────────────────────────────
  const includedHit = titleMatchesAny(title.flat, intent.includedTitles);
  const excludedHit = titleMatchesAny(title.flat, intent.excludedTitles);
  if (excludedHit && !includedHit) {
    score *= EXCLUDED_TITLE_MULTIPLIER;
    reasons.push(`title is an excluded role (${excludedHit})`);
  } else if (includedHit) {
    reasons.push(`title matches "${includedHit}"`);
  }

  // ── Seniority ─────────────────────────────────────────────────────────────
  if (intent.seniority) {
    // The title is authoritative: a junior ad that says "you will work
    // alongside our senior developers" is still a junior ad.
    const postingLevel =
      detectSeniority(job.title) ?? detectSeniority(job.description ?? "");
    if (postingLevel && postingLevel !== intent.seniority) {
      score *= SENIORITY_MISMATCH_MULTIPLIER;
      reasons.push(`${postingLevel} role, you asked for ${intent.seniority}`);
    } else if (postingLevel === intent.seniority) {
      score += SENIORITY_MATCH_BONUS;
      reasons.push(`${postingLevel} level matches`);
    }
  }

  // ── Working arrangement ───────────────────────────────────────────────────
  const workType = (job.workType ?? "").toLowerCase();
  const looksRemote = workType === "remote" || /\bremote\b|\bwork from home\b/i.test(job.location ?? "");
  if (ctx.remoteOnly && !looksRemote) {
    score *= NON_REMOTE_MULTIPLIER;
    reasons.push("not a remote role");
  }

  // ── Location ──────────────────────────────────────────────────────────────
  const location = flattenText(job.location ?? "");
  if (ctx.city) {
    const city = flattenText(ctx.city);
    if (city && location.includes(city)) {
      score += CITY_BONUS;
      reasons.push(`located in ${ctx.city}`);
    }
  }
  if (ctx.country && job.country) {
    if (job.country.toUpperCase() === ctx.country.toUpperCase()) {
      score += COUNTRY_BONUS;
    } else if (!looksRemote) {
      score -= OUT_OF_COUNTRY_PENALTY;
      reasons.push(`based in ${job.country}, not ${ctx.country}`);
    }
  }

  // ── Salary ────────────────────────────────────────────────────────────────
  if (job.salary) {
    const midpoint = salaryMidpoint(job.salary);
    const wantsRange = ctx.salaryMin != null || ctx.salaryMax != null;
    if (wantsRange && midpoint != null) {
      const inRange =
        (ctx.salaryMin == null || midpoint >= ctx.salaryMin) &&
        (ctx.salaryMax == null || midpoint <= ctx.salaryMax);
      if (inRange) {
        score += SALARY_IN_RANGE_BONUS;
        reasons.push("salary is in your range");
      }
    } else if (!wantsRange) {
      score += SALARY_PRESENT_BONUS;
    }
  }

  // ── Recency ───────────────────────────────────────────────────────────────
  // A bonus only: an undated posting must not be punished for the board's
  // failure to publish a date.
  if (job.postedAt) {
    const days = (Date.now() - job.postedAt.getTime()) / 86_400_000;
    if (days >= 0 && days < 60) {
      const freshness = days <= 14 ? 1 : (60 - days) / 46;
      score += RECENCY_BONUS * freshness;
      if (days <= 7) reasons.push("posted this week");
    }
  }

  return {
    score: Math.max(0, Math.min(1, score)),
    matched,
    missing,
    reasons,
  };
}

/** Scores every job and sorts descending. Pure — the input array is untouched. */
export function rankJobs<T extends ScoreInput>(
  jobs: T[],
  intent: QueryIntent,
  ctx: ScoreContext = {},
): Array<T & { score: number; matched: string[]; reasons: string[] }> {
  const stats = ctx.idf ? ctx : { ...ctx, ...buildCorpusStats(jobs.map((j) => `${j.title} ${j.description}`)) };
  return jobs
    .map((job) => {
      const result = scoreJob(job, intent, stats);
      return { ...job, score: result.score, matched: result.matched, reasons: result.reasons };
    })
    .sort((a, b) => b.score - a.score);
}

/** Convenience predicate used by boards that filter before ranking. */
export function isRelevant(job: ScoreInput, intent: QueryIntent, ctx?: ScoreContext): boolean {
  return scoreJob(job, intent, ctx).score >= RELEVANCE_THRESHOLD;
}

export type { Seniority };
