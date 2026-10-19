import type { ApplyFile, ApplyProfile } from "./types";

export type ProfileKey =
  | "fullName"
  | "firstName"
  | "lastName"
  | "email"
  | "phone"
  | "linkedInUrl"
  | "githubUrl"
  | "website"
  | "city"
  | "country"
  | "cv"
  | "coverLetter"
  | "message"
  | "salary"
  | "startDate"
  | "consent"
  | "marketing";

export interface FieldOption {
  value: string;
  text: string;
}

export interface FieldDescriptor {
  frameIndex: number;
  selector: string;
  tag: "input" | "textarea" | "select";
  type: string;
  name: string;
  id: string;
  label: string;
  placeholder: string;
  ariaLabel: string;
  autocomplete: string;
  accept: string;
  required: boolean;
  visible: boolean;
  checked: boolean;
  options: FieldOption[];
}

export interface FieldScore {
  key: ProfileKey;
  score: number;
}

export type FieldValue =
  | { kind: "text"; value: string }
  | { kind: "file"; file: ApplyFile }
  | { kind: "check"; value: boolean }
  | { kind: "select"; value: string };

export interface PlannedFill {
  field: FieldDescriptor;
  key: ProfileKey;
  score: number;
  value: FieldValue;
}

export interface FillPlan {
  fills: PlannedFill[];
  unmatched: FieldDescriptor[];
  unfillable: Array<{ field: FieldDescriptor; key: ProfileKey; score: number }>;
  requiredMissing: FieldDescriptor[];
  confidence: number;
}

export const MIN_FIELD_SCORE = 0.45;
export const AUTO_SUBMIT_CONFIDENCE = 0.8;

const IGNORED_INPUT_TYPES = new Set(["hidden", "submit", "button", "reset", "image", "search", "password"]);

export function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function containsPhrase(haystack: string, phrase: string): boolean {
  if (!haystack || !phrase) return false;
  if (haystack === phrase) return true;
  return (" " + haystack + " ").includes(" " + phrase + " ");
}

interface KeyRule {
  strong?: string[];
  phrases: string[];
  exclude?: string[];
  autocomplete?: string[];
}

const RULES: Record<ProfileKey, KeyRule> = {
  fullName: {
    strong: ["cele jmeno", "jmeno a prijmeni", "full name", "fullname", "name and surname"],
    phrases: ["your name", "name", "jmeno"],
    exclude: ["company", "firma", "firmy", "spolecnost", "user", "uzivatel", "file", "soubor", "prijmeni", "krestni", "first", "last", "surname", "pozice", "position", "contact person"],
    autocomplete: ["name"],
  },
  firstName: {
    phrases: ["krestni jmeno", "first name", "firstname", "given name", "forename", "krestni"],
    autocomplete: ["given-name"],
  },
  lastName: {
    phrases: ["prijmeni", "last name", "lastname", "surname", "family name"],
    autocomplete: ["family-name"],
  },
  email: {
    phrases: ["e mail", "email", "mail", "kontaktni e mail", "emailova adresa", "e mailova adresa"],
    autocomplete: ["email"],
  },
  phone: {
    phrases: ["telefon", "telefonni cislo", "phone", "phone number", "mobile", "mobil", "tel", "cislo"],
    exclude: ["cislo uctu", "account number", "id number", "ico"],
    autocomplete: ["tel", "tel-national"],
  },
  linkedInUrl: {
    phrases: ["linkedin", "linked in", "odkaz na linkedin", "linkedin profil", "linkedin profile", "linkedin url"],
  },
  githubUrl: {
    phrases: ["github", "git hub", "github profil", "github profile", "github url"],
  },
  website: {
    phrases: ["website", "web", "webova stranka", "portfolio", "osobni web", "personal site", "url", "odkaz", "profil", "profile link"],
    exclude: ["linkedin", "github"],
    autocomplete: ["url"],
  },
  city: {
    phrases: ["mesto", "city", "obec", "bydliste", "town", "misto bydliste", "lokalita", "location"],
    autocomplete: ["address-level2"],
  },
  country: {
    phrases: ["zeme", "stat", "country", "statni prislusnost", "nationality"],
    autocomplete: ["country", "country-name"],
  },
  cv: {
    phrases: ["cv", "zivotopis", "resume", "resume cv", "curriculum vitae", "prilozit zivotopis", "upload cv", "attach cv", "attachment", "priloha", "soubor", "nahrat"],
    exclude: ["motivacni", "cover", "pruvodni", "foto", "photo", "portfolio"],
  },
  coverLetter: {
    phrases: ["motivacni dopis", "cover letter", "pruvodni dopis", "motivation letter", "letter of motivation", "motivacni"],
  },
  message: {
    phrases: ["zprava", "message", "poznamka", "note", "comment", "komentar", "vzkaz", "proc", "why", "tell us", "about you", "o vas", "neco o sobe", "dalsi informace", "additional information"],
  },
  salary: {
    phrases: ["mzda", "plat", "salary", "mzdove ocekavani", "salary expectation", "expected salary", "ocekavana mzda", "financni ocekavani"],
  },
  startDate: {
    phrases: ["nastup", "datum nastupu", "start date", "available from", "moznost nastupu", "availability", "dostupnost"],
  },
  consent: {
    phrases: ["souhlas", "souhlasim", "zpracovani osobnich udaju", "osobni udaje", "osobnich udaju", "gdpr", "privacy", "privacy policy", "ochrana osobnich udaju", "terms", "podminky", "podminkami", "zasady", "agree", "consent", "i agree", "i accept", "accept"],
  },
  marketing: {
    phrases: ["newsletter", "marketing", "marketingove", "obchodni sdeleni", "obchodnich sdeleni", "novinky", "zasilani", "nabidky prace", "job alerts", "job offers", "subscribe", "odber", "informovat", "podobne nabidky", "similar offers", "talent pool", "databaze uchazecu", "evidovat", "budouci", "future"],
  },
};

const TYPE_EVIDENCE: Record<string, Partial<Record<ProfileKey, number>>> = {
  email: { email: 0.95 },
  tel: { phone: 0.95 },
  url: { website: 0.5 },
  file: { cv: 0.6 },
  textarea: { message: 0.4 },
};

const SIGNAL_WEIGHTS: Array<[keyof FieldDescriptor, number]> = [
  ["label", 0.95],
  ["ariaLabel", 0.9],
  ["placeholder", 0.8],
  ["name", 0.75],
  ["id", 0.5],
];

function addScore(scores: Map<ProfileKey, number>, key: ProfileKey, score: number): void {
  if (score > (scores.get(key) ?? 0)) scores.set(key, score);
}

function phraseStrength(text: string, phrase: string): number {
  if (text === phrase) return 1;
  if (containsPhrase(text, phrase)) return phrase.includes(" ") ? 0.95 : 0.85;
  return 0;
}

function keyEvidence(text: string, rule: KeyRule): number {
  let best = 0;
  for (const phrase of rule.strong ?? []) {
    best = Math.max(best, phraseStrength(text, normalizeText(phrase)));
  }
  if (best > 0) return best;
  if (rule.exclude?.some((phrase) => containsPhrase(text, normalizeText(phrase)))) return 0;
  for (const phrase of rule.phrases) {
    best = Math.max(best, phraseStrength(text, normalizeText(phrase)));
  }
  return best;
}

function autocompleteTokens(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/\s+/).filter(Boolean));
}

function isCheckable(field: FieldDescriptor): boolean {
  return field.tag === "input" && (field.type === "checkbox" || field.type === "radio");
}

export function scoreField(field: FieldDescriptor): FieldScore | null {
  if (field.tag === "input" && IGNORED_INPUT_TYPES.has(field.type)) return null;
  const scores = new Map<ProfileKey, number>();

  const autocomplete = autocompleteTokens(field.autocomplete);
  if (autocomplete.size > 0) {
    for (const [key, rule] of Object.entries(RULES) as Array<[ProfileKey, KeyRule]>) {
      if (rule.autocomplete?.some((token) => autocomplete.has(token))) addScore(scores, key, 1);
    }
  }

  const typeKey = field.tag === "input" ? field.type : field.tag;
  for (const [key, score] of Object.entries(TYPE_EVIDENCE[typeKey] ?? {}) as Array<[ProfileKey, number]>) {
    addScore(scores, key, score);
  }

  const checkable = isCheckable(field);
  for (const [prop, weight] of SIGNAL_WEIGHTS) {
    const text = normalizeText(String(field[prop] ?? ""));
    if (!text) continue;
    for (const [key, rule] of Object.entries(RULES) as Array<[ProfileKey, KeyRule]>) {
      const isCheckKey = key === "consent" || key === "marketing";
      if (checkable !== isCheckKey) continue;
      const evidence = keyEvidence(text, rule);
      if (evidence > 0) addScore(scores, key, weight * evidence);
    }
  }

  if (field.tag === "input" && field.type === "file" && scores.has("coverLetter") && !scores.has("cv")) {
    scores.delete("message");
  }
  if (field.tag === "input" && field.type === "url") {
    if (scores.has("linkedInUrl") || scores.has("githubUrl")) scores.delete("website");
  }
  if (checkable && scores.has("marketing")) {
    return { key: "marketing", score: scores.get("marketing") ?? 0 };
  }
  if (field.type === "email" && scores.has("email")) return { key: "email", score: scores.get("email") ?? 0 };
  if (field.type === "tel" && scores.has("phone")) return { key: "phone", score: scores.get("phone") ?? 0 };

  let best: FieldScore | null = null;
  for (const [key, score] of scores) {
    if (score >= MIN_FIELD_SCORE && (!best || score > best.score)) best = { key, score };
  }
  return best;
}

const COUNTRY_NAMES: Record<string, string[]> = {
  CZ: ["ceska republika", "cesko", "czech republic", "czechia", "czech", "cz"],
  SK: ["slovensko", "slovenska republika", "slovakia", "slovak republic", "sk"],
  PL: ["polsko", "poland", "polska", "pl"],
  DE: ["nemecko", "germany", "deutschland", "de"],
  AT: ["rakousko", "austria", "osterreich", "at"],
  GB: ["velka britanie", "spojene kralovstvi", "united kingdom", "great britain", "uk", "gb"],
  US: ["spojene staty", "united states", "usa", "us"],
  NL: ["nizozemsko", "netherlands", "nederland", "nl"],
};

export function countryDisplayName(code: string): string {
  const names = COUNTRY_NAMES[code.toUpperCase()];
  return names ? names[0].replace(/\b\w/g, (c) => c.toUpperCase()) : code;
}

export function findCountryOption(options: FieldOption[], code: string): FieldOption | null {
  const names = COUNTRY_NAMES[code.toUpperCase()] ?? [normalizeText(code)];
  for (const name of names) {
    const hit = options.find((o) => normalizeText(o.text) === name || normalizeText(o.value) === name);
    if (hit) return hit;
  }
  for (const name of names) {
    if (name.length < 3) continue;
    const hit = options.find((o) => containsPhrase(normalizeText(o.text), name));
    if (hit) return hit;
  }
  return null;
}

function text(value: string | null | undefined): FieldValue | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? { kind: "text", value: trimmed } : null;
}

export function resolveValue(key: ProfileKey, profile: ApplyProfile, field: FieldDescriptor): FieldValue | null {
  if (field.tag === "select") {
    if (key === "country") {
      const option = findCountryOption(field.options, profile.country);
      return option ? { kind: "select", value: option.value } : null;
    }
    return null;
  }
  switch (key) {
    case "fullName":
      return text(profile.name);
    case "firstName":
      return text(profile.firstName);
    case "lastName":
      return text(profile.lastName);
    case "email":
      return text(profile.email);
    case "phone":
      return text(profile.phone);
    case "linkedInUrl":
      return text(profile.linkedInUrl);
    case "githubUrl":
      return text(profile.githubUrl);
    case "website":
      return text(profile.linkedInUrl ?? profile.githubUrl);
    case "city":
      return text(profile.city);
    case "country":
      return text(countryDisplayName(profile.country));
    case "cv":
      return field.type === "file" && profile.cv ? { kind: "file", file: profile.cv } : null;
    case "consent":
      return { kind: "check", value: true };
    case "marketing":
      return { kind: "check", value: false };
    default:
      return null;
  }
}

export function isFillableField(field: FieldDescriptor): boolean {
  if (!field.visible) return false;
  if (field.tag === "input" && IGNORED_INPUT_TYPES.has(field.type)) return false;
  return true;
}

export function planFill(fields: FieldDescriptor[], profile: ApplyProfile): FillPlan {
  const plan: FillPlan = { fills: [], unmatched: [], unfillable: [], requiredMissing: [], confidence: 0 };
  const candidates = fields.filter(isFillableField);

  for (const field of candidates) {
    const scored = scoreField(field);
    if (!scored) {
      plan.unmatched.push(field);
      continue;
    }
    const value = resolveValue(scored.key, profile, field);
    if (value) {
      plan.fills.push({ field, key: scored.key, score: scored.score, value });
    } else {
      plan.unfillable.push({ field, ...scored });
    }
  }

  return finalizePlan(plan, candidates);
}

export function finalizePlan(plan: FillPlan, fields: FieldDescriptor[]): FillPlan {
  const candidates = fields.filter(isFillableField);
  const filled = new Set(plan.fills.map((f) => f.field));
  plan.unmatched = plan.unmatched.filter((f) => !filled.has(f));
  plan.unfillable = plan.unfillable.filter((u) => !filled.has(u.field));
  const required = candidates.filter((f) => f.required && !(isCheckable(f) && scoreField(f)?.key === "marketing"));
  plan.requiredMissing = required.filter((f) => !filled.has(f));
  plan.confidence = computeConfidence(plan, required.length, candidates.length);
  return plan;
}

function computeConfidence(plan: FillPlan, requiredCount: number, candidateCount: number): number {
  if (plan.fills.length === 0) return 0;
  const coverage = requiredCount === 0 ? 1 : (requiredCount - plan.requiredMissing.length) / requiredCount;
  const avgScore = plan.fills.reduce((sum, f) => sum + f.score, 0) / plan.fills.length;
  const optionalGaps = plan.unmatched.length + plan.unfillable.length - plan.requiredMissing.length;
  const gapPenalty = Math.min(0.2, Math.max(0, optionalGaps) * 0.05);
  const filledShare = plan.fills.length / Math.max(1, candidateCount);
  let confidence = coverage * (0.6 + 0.25 * avgScore + 0.15 * filledShare) - gapPenalty;
  if (plan.requiredMissing.length > 0) confidence = Math.min(confidence, AUTO_SUBMIT_CONFIDENCE - 0.2);
  return Math.max(0, Math.min(1, Number(confidence.toFixed(3))));
}

export function describeField(field: FieldDescriptor): string {
  const parts = [field.label, field.placeholder, field.ariaLabel, field.name, field.id].map((p) => p.trim()).filter(Boolean);
  const kind = field.tag === "input" ? field.type : field.tag;
  return `${kind}${field.required ? "*" : ""} ${parts[0] ?? field.selector}`;
}
