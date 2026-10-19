import type { JobSource as JobSourceEnum } from "@prisma/client";
import type { ApplyPath, CountryCode, RawJob } from "./sources/types";
import { normalizeText } from "@/lib/text";
import { canonicalUrl, dedupeRepeatedHalf } from "./dedupe";

type WorkType = "Remote" | "Hybrid" | "Onsite";

export type Seniority = "junior" | "mid" | "senior" | "lead";

export interface NormalizedJob {
  title: string;
  company: string;
  location: string;
  description: string;
  sourceUrl: string;
  source: JobSourceEnum;
  salary?: string;
  workType?: WorkType;
  postedAt?: Date;
  country: CountryCode;
  city: string | null;
  remote: boolean | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  skills: string[];
  applyPath?: ApplyPath;
}

interface ParsedSalary {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: "month" | "hour" | "day" | "year" | null;
}

type SalaryPeriod = NonNullable<ParsedSalary["period"]>;

const MAX_DESCRIPTION_LENGTH = 6000;
const MAX_TITLE_LENGTH = 200;
const MAX_COMPANY_LENGTH = 120;
const MAX_LOCATION_LENGTH = 120;
const REMOTE_LOCATION = "Remote";

const THOUSAND = 1000;
const MAX_PLAUSIBLE_SALARY = 10_000_000;
const SALARY_FIGURES_IN_A_RANGE = 2;

const CITIES: Record<CountryCode, Array<{ name: string; asciiFoldedAliases: string[] }>> = {
  CZ: [
    { name: "Praha", asciiFoldedAliases: ["praha", "prague", "prag"] },
    { name: "Brno", asciiFoldedAliases: ["brno"] },
    { name: "Ostrava", asciiFoldedAliases: ["ostrava"] },
    { name: "Plzeň", asciiFoldedAliases: ["plzen", "pilsen"] },
    { name: "Olomouc", asciiFoldedAliases: ["olomouc"] },
    { name: "Liberec", asciiFoldedAliases: ["liberec"] },
    { name: "Hradec Králové", asciiFoldedAliases: ["hradec kralove"] },
    { name: "České Budějovice", asciiFoldedAliases: ["ceske budejovice", "budweis"] },
    { name: "Pardubice", asciiFoldedAliases: ["pardubice"] },
    { name: "Zlín", asciiFoldedAliases: ["zlin"] },
    { name: "Ústí nad Labem", asciiFoldedAliases: ["usti nad labem"] },
    { name: "Jihlava", asciiFoldedAliases: ["jihlava"] },
    { name: "Karlovy Vary", asciiFoldedAliases: ["karlovy vary"] },
    { name: "Opava", asciiFoldedAliases: ["opava"] },
    { name: "Mladá Boleslav", asciiFoldedAliases: ["mlada boleslav"] },
    { name: "Kladno", asciiFoldedAliases: ["kladno"] },
    { name: "Teplice", asciiFoldedAliases: ["teplice"] },
    { name: "Frýdek-Místek", asciiFoldedAliases: ["frydek mistek"] },
  ],
};

const REMOTE_PATTERN = /\b(remote|vzdalen[aey]?|home ?office|z domova|prace z domu|fully remote|100 ?% remote)\b/;
const HYBRID_PATTERN = /\b(hybrid|hybridni|hybridne|castecne z domova)\b/;
const ONSITE_PATTERN = /\b(onsite|on site|office|kancelar)\b/;

const CURRENCY_PATTERNS: Array<[RegExp, string]> = [
  [/kč|czk|korun/i, "CZK"],
  [/€|eur\b/i, "EUR"],
  [/\$|usd\b/i, "USD"],
  [/zł|pln\b/i, "PLN"],
  [/£|gbp\b/i, "GBP"],
];

const SALARY_PERIOD_PATTERNS: Array<[RegExp, SalaryPeriod]> = [
  [/hod|hour|\/\s*h\b/i, "hour"],
  [/\bMD\b|\bden\b|\bday\b/i, "day"],
  [/\brok|year|annum|p\.\s*a\./i, "year"],
  [/m[eě]s|month|\/\s*m\b|mo\b/i, "month"],
];

const CURRENCY_TOKENS = /kč|kc\b|czk|eur|usd|pln|gbp|[€$£]/gi;
const SALARY_FIGURE_WITH_OPTIONAL_THOUSANDS_SUFFIX =
  /(\d{1,3}(?:[  .,]\d{3})+|\d+(?:[.,]\d+)?)\s*(k(?!\p{L})|tis\.?)?/giu;
const DIGIT_GROUP_SPACES = /[  ]/g;
const DOT_THOUSANDS_SEPARATOR = /\.(?=\d{3}\b)/g;

const SENIORITY_PATTERNS: Array<[RegExp, Seniority]> = [
  [/\b(lead|principal|head of|architect|staff)\b/, "lead"],
  [/\bsenior\b|\bsr\b/, "senior"],
  [/\b(junior|jr|graduate|absolvent|trainee|intern)\b/, "junior"],
  [/\b(medior|mid|middle|intermediate)\b/, "mid"],
];

const SKILLS: Array<[string, string[]]> = [
  ["React", ["react", "reactjs"]], ["React Native", ["react native"]], ["Vue", ["vue", "vuejs"]],
  ["Angular", ["angular"]], ["Svelte", ["svelte"]], ["Next.js", ["next js", "nextjs"]], ["Nuxt", ["nuxt"]],
  ["TypeScript", ["typescript"]], ["JavaScript", ["javascript", "es6"]], ["HTML", ["html", "html5"]],
  ["CSS", ["css", "css3", "sass", "scss", "less"]], ["Tailwind", ["tailwind"]], ["Node.js", ["node js", "nodejs", "node"]],
  ["Express", ["express"]], ["NestJS", ["nestjs", "nest js"]], ["Python", ["python"]], ["Django", ["django"]],
  ["FastAPI", ["fastapi"]], ["Java", ["java"]], ["Spring", ["spring", "spring boot"]], ["Kotlin", ["kotlin"]],
  ["Swift", ["swift"]], ["C#", ["csharp"]], [".NET", ["dotnet"]], ["C++", ["cpp"]], ["Go", ["golang"]],
  ["Rust", ["rust"]], ["PHP", ["php"]], ["Laravel", ["laravel"]], ["Symfony", ["symfony"]], ["Ruby", ["ruby", "rails"]],
  ["Scala", ["scala"]], ["SQL", ["sql"]], ["PostgreSQL", ["postgresql", "postgres"]], ["MySQL", ["mysql", "mariadb"]],
  ["MongoDB", ["mongodb", "mongo"]], ["Redis", ["redis"]], ["Elasticsearch", ["elasticsearch", "elastic"]],
  ["GraphQL", ["graphql"]], ["REST", ["rest", "rest api"]], ["gRPC", ["grpc"]], ["Docker", ["docker"]],
  ["Kubernetes", ["kubernetes", "k8s"]], ["AWS", ["aws"]], ["Azure", ["azure"]], ["GCP", ["gcp", "google cloud"]],
  ["Terraform", ["terraform"]], ["Ansible", ["ansible"]], ["Linux", ["linux"]], ["CI/CD", ["ci cd", "cicd"]],
  ["Git", ["git"]], ["Jenkins", ["jenkins"]], ["GitLab", ["gitlab"]], ["Playwright", ["playwright"]],
  ["Cypress", ["cypress"]], ["Selenium", ["selenium"]], ["Jest", ["jest"]], ["Figma", ["figma"]],
  ["Flutter", ["flutter"]], ["Android", ["android"]], ["iOS", ["ios"]], ["Pandas", ["pandas"]],
  ["Spark", ["spark"]], ["Kafka", ["kafka"]], ["Airflow", ["airflow"]], ["Machine Learning", ["machine learning", "strojove uceni"]],
  ["PyTorch", ["pytorch"]], ["TensorFlow", ["tensorflow"]], ["LLM", ["llm", "openai", "langchain"]],
  ["Unity", ["unity"]], ["Unreal", ["unreal"]], ["Power BI", ["power bi", "powerbi"]], ["Snowflake", ["snowflake"]],
];

const SKILL_PATTERNS = SKILLS.map(([name, patterns]) => [name, new RegExp(`\\b(${patterns.join("|")})\\b`)] as const);

const wholeWord = (word: string) => new RegExp(`\\b${word}\\b`);

export function detectCity(text: string, country: CountryCode = "CZ"): string | null {
  const folded = normalizeText(text);
  if (!folded) return null;
  const city = CITIES[country].find(({ asciiFoldedAliases }) =>
    asciiFoldedAliases.some((alias) => wholeWord(alias).test(folded)),
  );
  return city?.name ?? null;
}

function explicitWorkType(folded: string): WorkType | undefined {
  if (REMOTE_PATTERN.test(folded)) return "Remote";
  if (HYBRID_PATTERN.test(folded)) return "Hybrid";
  if (ONSITE_PATTERN.test(folded)) return "Onsite";
  return undefined;
}

function workTypeHintedBy(folded: string): WorkType | undefined {
  if (HYBRID_PATTERN.test(folded)) return "Hybrid";
  if (REMOTE_PATTERN.test(folded)) return "Remote";
  return undefined;
}

export function detectWorkType(raw: Pick<RawJob, "workType" | "location" | "title">): WorkType | undefined {
  const declared = normalizeText(raw.workType ?? "");
  return (
    (declared ? explicitWorkType(declared) : undefined) ??
    workTypeHintedBy(normalizeText(`${raw.location ?? ""} ${raw.title}`))
  );
}

function detectCurrency(text: string): string | null {
  return CURRENCY_PATTERNS.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

function detectSalaryPeriod(text: string): SalaryPeriod | null {
  return SALARY_PERIOD_PATTERNS.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

function stripCurrencySoKcIsNotReadAsThousands(text: string): string {
  return text.replace(CURRENCY_TOKENS, " ");
}

function parseFigure(digits: string, thousandsSuffix: string | undefined): number {
  const value = parseFloat(digits.replace(DIGIT_GROUP_SPACES, "").replace(DOT_THOUSANDS_SEPARATOR, "").replace(",", "."));
  return thousandsSuffix ? value * THOUSAND : value;
}

function isPlausibleSalary(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value < MAX_PLAUSIBLE_SALARY;
}

function salaryFigures(text: string): number[] {
  const figures: number[] = [];
  const numericText = stripCurrencySoKcIsNotReadAsThousands(text);
  for (const [, digits, thousandsSuffix] of numericText.matchAll(SALARY_FIGURE_WITH_OPTIONAL_THOUSANDS_SUFFIX)) {
    const value = parseFigure(digits, thousandsSuffix);
    if (isPlausibleSalary(value)) figures.push(value);
    if (figures.length === SALARY_FIGURES_IN_A_RANGE) break;
  }
  return figures;
}

function expandLowerBoundWrittenWithoutThousands(min: number, max: number): number {
  return max >= THOUSAND && min < THOUSAND ? min * THOUSAND : min;
}

export function parseSalary(text: string | undefined): ParsedSalary {
  if (!text) return { min: null, max: null, currency: null, period: null };
  const currency = detectCurrency(text);
  const period = detectSalaryPeriod(text);
  const figures = salaryFigures(text);
  if (figures.length === 0) return { min: null, max: null, currency, period };

  const max = Math.max(...figures);
  const min = expandLowerBoundWrittenWithoutThousands(Math.min(...figures), max);
  return { min: Math.round(min), max: Math.round(max), currency, period };
}

function spellOutSymbolsThatNormalizingDrops(text: string): string {
  return text.replace(/c#/gi, " csharp ").replace(/\.net\b/gi, " dotnet ").replace(/c\+\+/gi, " cpp ");
}

export function extractSkills(text: string): string[] {
  const folded = normalizeText(spellOutSymbolsThatNormalizingDrops(text));
  return SKILL_PATTERNS.filter(([, pattern]) => pattern.test(folded)).map(([name]) => name);
}

export function detectSeniority(title: string): Seniority | null {
  const folded = normalizeText(title);
  return SENIORITY_PATTERNS.find(([pattern]) => pattern.test(folded))?.[1] ?? null;
}

function cleanText(text: string, maxLength = MAX_DESCRIPTION_LENGTH): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength);
}

export function normalizeJob(raw: RawJob, country: CountryCode): NormalizedJob {
  const title = cleanText(dedupeRepeatedHalf(raw.title), MAX_TITLE_LENGTH);
  const company = cleanText(dedupeRepeatedHalf(raw.company), MAX_COMPANY_LENGTH);
  const description = cleanText(raw.description);
  const workType = detectWorkType(raw);
  const salary = raw.salary?.trim() || undefined;
  const parsedSalary = parseSalary(salary);
  const city = detectCity(raw.location ?? "", country) ?? detectCity(title, country);
  const fallbackLocation = workType === "Remote" ? REMOTE_LOCATION : (city ?? "");
  const location = cleanText(dedupeRepeatedHalf(raw.location ?? ""), MAX_LOCATION_LENGTH) || fallbackLocation;

  return {
    title,
    company,
    location,
    description,
    sourceUrl: canonicalUrl(raw.url),
    source: raw.source,
    salary,
    workType,
    postedAt: raw.postedAt,
    country,
    city,
    remote: workType ? workType === "Remote" : null,
    salaryMin: parsedSalary.min,
    salaryMax: parsedSalary.max,
    salaryCurrency: parsedSalary.currency,
    skills: extractSkills(`${title} ${description}`),
    applyPath: raw.applyPath,
  };
}
