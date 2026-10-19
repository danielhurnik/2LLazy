import type { QueryIntent } from "@/lib/queryIntent";
import type { SearchProfile } from "./profile";
import { normalizeText } from "./dedupe";
import { detectCity, detectSeniority, type NormalizedJob, type Seniority } from "./normalize";

export interface ScoreRequest {
  query: string;
  skillLevel: string;
  city: string;
  intent: QueryIntent;
  salaryMin?: number | null;
  salaryMax?: number | null;
  profile?: SearchProfile | null;
}

export interface ScoredJob {
  score: number;
  reasons: string[];
  rejectedBy?: string;
}

interface Contribution {
  value: number;
  reason?: string;
  totalMultiplier?: number;
}

export const SCORE_THRESHOLD = 0.3;

const WEIGHTS = { title: 0.35, keywords: 0.25, location: 0.15, seniority: 0.1, recency: 0.1, salary: 0.05 };

const TITLE_SCORE = { containsQuery: 1, containsIncludedTitle: 0.9, allQueryTokens: 0.7 };
const LOCATION_SCORE = { noCity: 0.5, remote: 1, remoteButCityWanted: 0.8, remoteAbroad: 0.6, sameCity: 1, otherCity: 0.2, anyCity: 0.7 };
const FOREIGN_COUNTRY_IN_LOCATION =
  /\b(POL|SVK|HUN|DEU|AUT|GBR|USA|NLD|ESP|FRA|ITA|ROU|BGR|UKR|Poland|Polska|Germany|Slovakia|Hungary|Austria|United Kingdom|United States|Netherlands|Spain|France|Italy|Romania|Bulgaria|Ukraine)\b/;
const OTHER_CITY_TOTAL_MULTIPLIER = 0.5;
const REMOTE_IN_LOCATION_TEXT = /remote|home ?office|vzdalen|z domova/i;
const SENIORITY_SCORE = { noPreference: 0.6, match: 1, undetected: 0.5, mismatch: 0 };
const RECENCY_SCORE = { unknownDate: 0.3, thisWeek: 1, thisMonth: 0.5, older: 0 };
const SALARY_SCORE = { notParsed: 0, listed: 1, inRange: 1, outOfRange: 0.3 };
const PROFILE_SHARE_OF_TOTAL = 0.15;
const PROFILE_WEIGHTS = { skills: 0.7, title: 0.3 };
const PROFILE_SKILLS_FOR_FULL_SCORE = 6;
const PROFILE_SKILL_EXAMPLES_IN_REASON = 3;

const DAYS_IN_WEEK = 7;
const DAYS_IN_MONTH = 30;
const ONE_DAY_MS = 86_400_000;
const KEYWORD_HITS_FOR_FULL_SCORE = 10;
const KEYWORD_EXAMPLES_IN_REASON = 4;
const MIN_TOKEN_LENGTH = 2;
const SCORE_DECIMAL_PLACES_FACTOR = 1000;

const STOPWORDS = new Set([
  "a", "an", "and", "the", "of", "for", "in", "on", "to", "with", "or", "is", "are", "as", "at", "by",
  "we", "you", "our", "your", "this", "that", "from", "into", "etc", "modern", "strong", "good", "new",
  "developer", "engineer", "development", "engineering", "experience", "skills", "work", "team", "role",
  "position", "job", "jobs", "using", "based", "e", "g", "i", "ie", "via", "all", "any",
]);

const SKILL_LEVEL_TO_SENIORITY: Record<string, Seniority> = {
  junior: "junior",
  mid: "mid",
  medior: "mid",
  senior: "senior",
  lead: "lead",
};

const contribution = (value: number, reason?: string, totalMultiplier?: number): Contribution => ({
  value,
  reason,
  totalMultiplier,
});

export function tokens(text: string): string[] {
  const words = normalizeText(text)
    .split(" ")
    .filter((word) => word.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(word));
  return Array.from(new Set(words));
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / ONE_DAY_MS;
}

function wantedSeniority(skillLevel: string): Seniority | undefined {
  const key = skillLevel.toLowerCase();
  return Object.hasOwn(SKILL_LEVEL_TO_SENIORITY, key) ? SKILL_LEVEL_TO_SENIORITY[key] : undefined;
}

function titleContribution(req: ScoreRequest, normalizedTitle: string): Contribution {
  const normalizedQuery = normalizeText(req.query);
  if (normalizedQuery && normalizedTitle.includes(normalizedQuery)) {
    return contribution(TITLE_SCORE.containsQuery, `Title matches "${req.query.trim()}"`);
  }
  const includedTitle = req.intent.includedTitles.find((title) => normalizedTitle.includes(normalizeText(title)));
  if (includedTitle) return contribution(TITLE_SCORE.containsIncludedTitle, `Title matches "${includedTitle}"`);

  const queryTokens = tokens(req.query);
  const foundTokens = queryTokens.filter((token) => normalizedTitle.includes(token));
  if (queryTokens.length === 0 || foundTokens.length === 0) return contribution(0);
  const coverage = foundTokens.length / queryTokens.length;
  return contribution(TITLE_SCORE.allQueryTokens * coverage, `Title mentions ${foundTokens.join(", ")}`);
}

function excludedTitleIn(normalizedTitle: string, intent: QueryIntent): string | undefined {
  return intent.excludedTitles.find((title) => new RegExp(`\\b${normalizeText(title)}\\b`).test(normalizedTitle));
}

function keywordContribution(req: ScoreRequest, job: NormalizedJob): Contribution {
  const vocabulary = new Set([
    ...tokens(req.intent.canonicalText),
    ...tokens(req.intent.scrapingKeyword),
    ...tokens(req.query),
  ]);
  if (vocabulary.size === 0) return contribution(0);
  const jobTokens = new Set(tokens(`${job.title} ${job.description} ${job.skills.join(" ")}`));
  const hits = Array.from(vocabulary).filter((token) => jobTokens.has(token));
  const value = Math.min(1, hits.length / Math.min(vocabulary.size, KEYWORD_HITS_FOR_FULL_SCORE));
  if (hits.length === 0) return contribution(value);
  const plural = hits.length === 1 ? "" : "s";
  const examples = hits.slice(0, KEYWORD_EXAMPLES_IN_REASON).join(", ");
  return contribution(value, `${hits.length} matching keyword${plural} (${examples})`);
}

function namedLocationOutside(job: NormalizedJob, wantedCity: string): string | null {
  const location = job.location?.trim();
  if (!location) return null;
  const normalizedLocation = normalizeText(location);
  if (REMOTE_IN_LOCATION_TEXT.test(normalizedLocation)) return null;
  return normalizedLocation.includes(normalizeText(wantedCity)) ? null : location;
}

function locationContribution(req: ScoreRequest, job: NormalizedJob): Contribution {
  const requestedCity = req.city.trim();
  const wantedCity = requestedCity ? (detectCity(req.city, job.country) ?? requestedCity) : null;
  if (job.remote && !job.city && FOREIGN_COUNTRY_IN_LOCATION.test(job.location)) {
    return contribution(LOCATION_SCORE.remoteAbroad, "Remote, employer abroad");
  }
  if (job.remote) return contribution(wantedCity ? LOCATION_SCORE.remoteButCityWanted : LOCATION_SCORE.remote, "Remote");
  if (!job.city) {
    const elsewhere = wantedCity ? namedLocationOutside(job, wantedCity) : null;
    return elsewhere
      ? contribution(LOCATION_SCORE.otherCity, `Located in ${elsewhere}, not ${wantedCity}`, OTHER_CITY_TOTAL_MULTIPLIER)
      : contribution(LOCATION_SCORE.noCity);
  }
  if (!wantedCity) return contribution(LOCATION_SCORE.anyCity, job.city);
  const isSameCity = normalizeText(job.city) === normalizeText(wantedCity);
  return isSameCity
    ? contribution(LOCATION_SCORE.sameCity, job.city)
    : contribution(LOCATION_SCORE.otherCity, `Located in ${job.city}, not ${wantedCity}`, OTHER_CITY_TOTAL_MULTIPLIER);
}

function seniorityContribution(req: ScoreRequest, job: NormalizedJob): Contribution {
  const chosen = wantedSeniority(req.skillLevel);
  const wanted = chosen ?? req.profile?.seniority ?? undefined;
  if (!wanted) return contribution(SENIORITY_SCORE.noPreference);
  const actual = detectSeniority(job.title);
  const label = chosen ? req.skillLevel : `${wanted} (from your CV)`;
  if (actual === wanted) return contribution(SENIORITY_SCORE.match, `Seniority: ${label}`);
  if (actual === null) return contribution(SENIORITY_SCORE.undetected);
  return contribution(SENIORITY_SCORE.mismatch, `Seniority mismatch (${actual})`);
}

function recencyContribution(job: NormalizedJob, firstSeenAt?: Date): Contribution {
  const postedOrFirstSeen = job.postedAt ?? firstSeenAt;
  if (!postedOrFirstSeen) return contribution(RECENCY_SCORE.unknownDate);
  const ageInDays = daysBetween(new Date(), postedOrFirstSeen);
  if (ageInDays <= DAYS_IN_WEEK) return contribution(RECENCY_SCORE.thisWeek, "Posted this week");
  if (ageInDays <= DAYS_IN_MONTH) return contribution(RECENCY_SCORE.thisMonth, "Posted this month");
  return contribution(RECENCY_SCORE.older);
}

function hasParsedSalaryFigures(job: NormalizedJob): boolean {
  return Boolean(job.salary) && job.salaryMin != null;
}

function salaryContribution(req: ScoreRequest, job: NormalizedJob): Contribution {
  if (!hasParsedSalaryFigures(job)) return contribution(SALARY_SCORE.notParsed);
  const wantsRange = req.salaryMin != null || req.salaryMax != null;
  if (!wantsRange || job.salaryMin == null || job.salaryMax == null) {
    return contribution(SALARY_SCORE.listed, "Salary listed");
  }
  const midpoint = (job.salaryMin + job.salaryMax) / 2;
  const isInRange =
    (req.salaryMin == null || midpoint >= req.salaryMin) && (req.salaryMax == null || midpoint <= req.salaryMax);
  return isInRange
    ? contribution(SALARY_SCORE.inRange, "Salary in your range")
    : contribution(SALARY_SCORE.outOfRange, "Salary listed");
}

function profileSkillsContribution(profile: SearchProfile, job: NormalizedJob): Contribution {
  const wanted = new Set(profile.skills.map(normalizeText));
  if (wanted.size === 0) return contribution(0);
  const shared = job.skills.filter((skill) => wanted.has(normalizeText(skill)));
  const value = Math.min(1, shared.length / Math.min(wanted.size, PROFILE_SKILLS_FOR_FULL_SCORE));
  if (shared.length === 0) return contribution(value);
  const extra = shared.length - PROFILE_SKILL_EXAMPLES_IN_REASON;
  const examples = shared.slice(0, PROFILE_SKILL_EXAMPLES_IN_REASON).join(", ");
  const more = extra > 0 ? ` +${extra}` : "";
  return contribution(value, `Matches your CV skills (${examples}${more})`);
}

function profileTitleContribution(profile: SearchProfile, normalizedTitle: string): Contribution {
  const fits = profile.titles.some((title) => normalizedTitle.includes(normalizeText(title)));
  return fits ? contribution(1, "Title fits your CV") : contribution(0);
}

function profileContributions(req: ScoreRequest, job: NormalizedJob, normalizedTitle: string): Array<[number, Contribution]> {
  if (!req.profile) return [];
  return [
    [PROFILE_WEIGHTS.skills, profileSkillsContribution(req.profile, job)],
    [PROFILE_WEIGHTS.title, profileTitleContribution(req.profile, normalizedTitle)],
  ];
}

export function scoreJob(req: ScoreRequest, job: NormalizedJob, firstSeenAt?: Date): ScoredJob {
  const normalizedTitle = normalizeText(job.title);
  const title = titleContribution(req, normalizedTitle);

  const nothingInTitleRescuesIt = title.value === 0;
  if (nothingInTitleRescuesIt) {
    const excluded = excludedTitleIn(normalizedTitle, req.intent);
    if (excluded) return { score: 0, reasons: [`Excluded: ${excluded}`], rejectedBy: excluded };
  }

  const weightedContributions: Array<[number, Contribution]> = [
    [WEIGHTS.title, title],
    [WEIGHTS.keywords, keywordContribution(req, job)],
    [WEIGHTS.location, locationContribution(req, job)],
    [WEIGHTS.seniority, seniorityContribution(req, job)],
    [WEIGHTS.recency, recencyContribution(job, firstSeenAt)],
    [WEIGHTS.salary, salaryContribution(req, job)],
  ];
  const profileParts = profileContributions(req, job, normalizedTitle);
  const weightedSum = weightedContributions.reduce((sum, [weight, part]) => sum + weight * part.value, 0);
  const profileFit = profileParts.reduce((sum, [weight, part]) => sum + weight * part.value, 0);
  const blended = req.profile ? weightedSum * (1 - PROFILE_SHARE_OF_TOTAL) + PROFILE_SHARE_OF_TOTAL * profileFit : weightedSum;
  const allParts = [...weightedContributions, ...profileParts];
  const score = allParts.reduce((total, [, part]) => total * (part.totalMultiplier ?? 1), blended);
  const reasons = allParts.flatMap(([, part]) => (part.reason ? [part.reason] : []));

  return { score: Math.round(score * SCORE_DECIMAL_PLACES_FACTOR) / SCORE_DECIMAL_PLACES_FACTOR, reasons };
}
