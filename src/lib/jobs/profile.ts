import { normalizeText } from "@/lib/text";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { readCvText } from "@/lib/cv";
import { ollamaAvailable, ollamaChatJson, ollamaPickModel, type OllamaMessage } from "@/lib/ollama";
import { prisma } from "@/lib/prisma";
import { detectCity, detectSeniority, extractSkills, type Seniority } from "./normalize";
import { DEFAULT_COUNTRY, isSupportedCountry, type CountryCode } from "./sources/types";

const SENIORITIES = ["junior", "mid", "senior", "lead"] as const;
const MAX_TITLES = 5;
const MAX_SKILLS = 40;
const MAX_CITIES = 3;
const MAX_LANGUAGES = 6;
const MAX_SUMMARY_LENGTH = 600;
const MAX_TITLE_LINE_LENGTH = 70;
const MIN_TITLE_LINE_LENGTH = 4;
const HEURISTIC_SUMMARY_LENGTH = 400;
const MIN_CV_LENGTH = 80;
const CV_TEXT_SENT_TO_MODEL = 6000;
const MODEL_TIMEOUT_MS = 120_000;
const MODEL_NUM_CTX = 8192;
const SENIOR_FROM_YEARS = 7;
const MID_FROM_YEARS = 3;
const MAX_PLAUSIBLE_YEARS = 45;

const TITLE_WORDS =
  /developer|engineer|vývojář|programátor|analyst|analytik|manager|manažer|designer|tester|architect|architekt|lead|consultant|konzultant|administrator|specialist|specialista|scientist|devops/i;
const NOT_A_TITLE = /@|https?:|•|^[-–—*]/;
const TITLE_TRAILER = /\s+[—–-]\s+.*$|\s*\(.*\)\s*$/;
const YEARS_OF_EXPERIENCE = /(\d{1,2})\+?\s*(?:years?|yrs|let|roky|rok)\b/gi;
const REMOTE_PREFERENCE = /\b(remote|home ?office|vzdalen\w*|z domova)\b/i;
const LANGUAGE_WORDS: Array<[RegExp, string]> = [
  [/\b(english|anglictina|anglicky)\b/i, "English"],
  [/\b(czech|cestina|cesky)\b/i, "Czech"],
  [/\b(slovak|slovenstina|slovensky)\b/i, "Slovak"],
  [/\b(german|nemcina|nemecky|deutsch)\b/i, "German"],
  [/\b(french|francouzstina)\b/i, "French"],
  [/\b(spanish|spanelstina)\b/i, "Spanish"],
];

export const PREFERRED_CHAT_MODELS = [process.env.OLLAMA_MODEL ?? "", "gemma3:4b", "gemma2:9b", "llama3"].filter(Boolean);
const MODEL_INSTRUCTIONS =
  "You turn a CV into a job-search profile and answer with JSON only. " +
  "titles: up to 5 job titles this person should search for, in English, most relevant first. " +
  "skills: technologies, tools and methods that actually appear in the CV. " +
  "seniority: junior, mid, senior or lead based on experience, or null if unclear. " +
  "cities: cities the person lives in or names as preferred, else empty. " +
  "remote: true only if the CV says remote work is wanted, otherwise null. " +
  "languages: spoken languages. summary: two plain sentences in English describing the candidate.";

export const searchProfileSchema = z.object({
  titles: z.array(z.string()).max(MAX_TITLES),
  skills: z.array(z.string()).max(MAX_SKILLS),
  seniority: z.enum(SENIORITIES).nullable(),
  cities: z.array(z.string()).max(MAX_CITIES),
  remote: z.boolean().nullable(),
  languages: z.array(z.string()).max(MAX_LANGUAGES),
  summary: z.string().max(MAX_SUMMARY_LENGTH),
  source: z.enum(["cv", "cv+ollama"]),
  builtAt: z.string(),
});

export type SearchProfile = z.infer<typeof searchProfileSchema>;

const modelProfileSchema = searchProfileSchema.omit({ source: true, builtAt: true });
type ModelProfile = z.infer<typeof modelProfileSchema>;

const unique = (values: string[]): string[] => Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));

function seniorityFromYears(text: string): Seniority | null {
  const years = Array.from(text.matchAll(YEARS_OF_EXPERIENCE))
    .map((match) => Number(match[1]))
    .filter((value) => value > 0 && value <= MAX_PLAUSIBLE_YEARS);
  if (years.length === 0) return null;
  const most = Math.max(...years);
  if (most >= SENIOR_FROM_YEARS) return "senior";
  return most >= MID_FROM_YEARS ? "mid" : "junior";
}

function titleLines(text: string): string[] {
  const lines = text
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").replace(TITLE_TRAILER, "").trim())
    .filter(
      (line) =>
        line.length >= MIN_TITLE_LINE_LENGTH &&
        line.length <= MAX_TITLE_LINE_LENGTH &&
        TITLE_WORDS.test(line) &&
        !NOT_A_TITLE.test(line),
    );
  return unique(lines).slice(0, MAX_TITLES);
}

function spokenLanguages(folded: string): string[] {
  return LANGUAGE_WORDS.filter(([pattern]) => pattern.test(folded)).map(([, name]) => name);
}

export function heuristicProfile(cvText: string, country: CountryCode): SearchProfile {
  const folded = normalizeText(cvText);
  const titles = titleLines(cvText);
  const city = detectCity(cvText, country);
  return {
    titles,
    skills: extractSkills(cvText).slice(0, MAX_SKILLS),
    seniority: detectSeniority(titles.join(" ")) ?? seniorityFromYears(cvText),
    cities: city ? [city] : [],
    remote: REMOTE_PREFERENCE.test(folded) ? true : null,
    languages: spokenLanguages(folded).slice(0, MAX_LANGUAGES),
    summary: cvText.replace(/\s+/g, " ").trim().slice(0, HEURISTIC_SUMMARY_LENGTH),
    source: "cv",
    builtAt: new Date().toISOString(),
  };
}

function mergeProfiles(heuristic: SearchProfile, model: ModelProfile): SearchProfile {
  return {
    titles: unique(model.titles).length ? unique(model.titles).slice(0, MAX_TITLES) : heuristic.titles,
    skills: unique([...heuristic.skills, ...model.skills]).slice(0, MAX_SKILLS),
    seniority: model.seniority ?? heuristic.seniority,
    cities: unique(model.cities).length ? unique(model.cities).slice(0, MAX_CITIES) : heuristic.cities,
    remote: model.remote ?? heuristic.remote,
    languages: unique([...model.languages, ...heuristic.languages]).slice(0, MAX_LANGUAGES),
    summary: model.summary.trim() || heuristic.summary,
    source: "cv+ollama",
    builtAt: heuristic.builtAt,
  };
}

async function modelProfile(cvText: string): Promise<ModelProfile> {
  const messages: OllamaMessage[] = [
    { role: "system", content: MODEL_INSTRUCTIONS },
    { role: "user", content: cvText.slice(0, CV_TEXT_SENT_TO_MODEL) },
  ];
  const model = await ollamaPickModel(PREFERRED_CHAT_MODELS);
  return ollamaChatJson(messages, modelProfileSchema, { model, numCtx: MODEL_NUM_CTX, signal: AbortSignal.timeout(MODEL_TIMEOUT_MS) });
}

async function enrichWithModel(heuristic: SearchProfile, cvText: string): Promise<SearchProfile> {
  try {
    return mergeProfiles(heuristic, await modelProfile(cvText));
  } catch (err) {
    console.warn("[search-profile] local model enrichment failed, keeping the CV-only profile:", err);
    return heuristic;
  }
}

async function profileCountry(userId: string): Promise<CountryCode> {
  const row = await prisma.userProfile.findUnique({ where: { userId }, select: { country: true } });
  const code = row?.country ?? "";
  return isSupportedCountry(code) ? code : DEFAULT_COUNTRY;
}

interface UserProfileFields {
  searchProfile?: Prisma.InputJsonValue;
  searchProfileUpdatedAt?: Date | null;
  rankerModel?: Prisma.InputJsonValue;
  rankerTrainedAt?: Date | null;
}

export async function updateUserProfile(userId: string, data: UserProfileFields): Promise<void> {
  const existing = await prisma.userProfile.findUnique({ where: { userId }, select: { id: true } });
  if (existing) {
    await prisma.userProfile.update({ where: { userId }, data });
    return;
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, email: true } });
  await prisma.userProfile.create({ data: { userId, name: user.name ?? "", email: user.email, ...data } });
}

async function saveSearchProfile(userId: string, profile: SearchProfile): Promise<void> {
  await updateUserProfile(userId, { searchProfile: profile, searchProfileUpdatedAt: new Date() });
}

async function cvTextOrExplain(userId: string): Promise<string> {
  let cvText: string;
  try {
    cvText = await readCvText(userId);
  } catch (err) {
    throw new Error(`The uploaded CV could not be read (${err instanceof Error ? err.message : String(err)}). Upload it as PDF or plain text.`);
  }
  if (cvText.trim().length < MIN_CV_LENGTH) {
    throw new Error("Upload a CV in Settings first; the search profile is built from it.");
  }
  return cvText;
}

export async function buildSearchProfile(userId: string): Promise<SearchProfile> {
  const cvText = await cvTextOrExplain(userId);
  const heuristic = heuristicProfile(cvText, await profileCountry(userId));
  const profile = (await ollamaAvailable()) ? await enrichWithModel(heuristic, cvText) : heuristic;
  await saveSearchProfile(userId, profile);
  return profile;
}

export async function searchProfileFor(userId: string): Promise<SearchProfile | null> {
  const row = await prisma.userProfile.findUnique({ where: { userId }, select: { searchProfile: true } });
  const parsed = searchProfileSchema.safeParse(row?.searchProfile);
  return parsed.success ? parsed.data : null;
}
