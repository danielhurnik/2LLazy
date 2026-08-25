/**
 * Deterministic job matching.
 *
 * Replaces the OpenAI embedding pipeline: `classifyQueryIntent` turns a search
 * box string into structured intent using a hand-written taxonomy, and
 * `scoreJob` ranks postings against it with BM25 plus domain rules. No network,
 * no API key, no per-request cost, and every score comes with its reasons.
 */
export { classifyQueryIntent, detectSeniority, parseSkillLevel } from "./intent";
export {
  scoreJob,
  rankJobs,
  isRelevant,
  buildCorpusStats,
  RELEVANCE_THRESHOLD,
  type ScoreInput,
  type ScoreContext,
  type ScoreResult,
} from "./score";
export {
  TAXONOMY,
  TERM_WEIGHTS,
  expandQuery,
  findTaxonomyEntry,
  findTaxonomyEntries,
  getEntry,
  normaliseTerm,
  type TaxonomyEntry,
} from "./taxonomy";
export { tokenize, tokenizeExact, normaliseToken, flattenText, stemToken } from "./tokenize";
