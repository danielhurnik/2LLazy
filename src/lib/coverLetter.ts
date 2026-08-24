/**
 * Deterministic cover-letter composer.
 *
 * This is a *scaffold generator*, not a ghostwriter: it reads the job ad and
 * the candidate's CV, intersects both against a local technology vocabulary,
 * and assembles a letter whose every factual claim comes from one of those two
 * documents. Everything the app cannot know — concrete results, motivation — is
 * left as a visible `«…»` placeholder instead of being invented.
 *
 * The keyword vocabulary and matchers live here rather than in `src/lib/matching`
 * so this module has no cross-module build dependency; `cvMatch.ts` reuses them.
 */

// ─── Keyword vocabulary ───────────────────────────────────────────────────────

/**
 * `[displayLabel, ...surfaceForms]`. When only a label is given it doubles as
 * the single surface form. A form prefixed with `^` is matched case-sensitively —
 * needed for short, ambiguous names such as `Go`, `R` and `C` that would
 * otherwise fire on ordinary prose.
 */
const KEYWORD_TABLE: string[][] = [
  ["JavaScript", "javascript", "java script"],
  ["TypeScript", "typescript"],
  ["Python", "python"],
  ["Java", "java"],
  ["Kotlin", "kotlin"],
  ["Swift", "swift"],
  ["Go", "^Go", "golang"],
  ["Rust", "rust"],
  ["Ruby", "ruby"],
  ["PHP", "php"],
  ["C#", "c#", "csharp"],
  ["C++", "c++", "cpp"],
  ["C", "^C"],
  ["Scala", "scala"],
  ["Elixir", "elixir"],
  ["Dart", "dart"],
  ["R", "^R"],
  ["Objective-C", "objective-c"],
  ["SQL", "sql"],
  ["Bash", "bash", "shell scripting"],
  ["React", "react", "react.js", "reactjs"],
  ["Next.js", "next.js", "nextjs"],
  ["Vue", "vue", "vue.js", "vuejs"],
  ["Nuxt", "nuxt", "nuxt.js"],
  ["Angular", "angular", "angularjs"],
  ["Svelte", "svelte", "sveltekit"],
  ["Redux", "redux"],
  ["jQuery", "jquery"],
  ["HTML", "html", "html5"],
  ["CSS", "css", "css3"],
  ["Sass", "sass", "scss"],
  ["Tailwind", "tailwind", "tailwindcss"],
  ["Bootstrap", "bootstrap"],
  ["Material UI", "material ui", "material-ui", "mui"],
  ["Webpack", "webpack"],
  ["Vite", "vite"],
  ["Storybook", "storybook"],
  ["WebGL", "webgl", "three.js"],
  ["Accessibility", "accessibility", "wcag", "a11y"],
  ["Node.js", "node.js", "nodejs", "node js"],
  ["Express", "express.js", "expressjs", "express"],
  ["NestJS", "nestjs", "nest.js"],
  ["Django", "django"],
  ["Flask", "flask"],
  ["FastAPI", "fastapi"],
  ["Spring", "spring boot", "spring"],
  ["Laravel", "laravel"],
  ["Symfony", "symfony"],
  ["Ruby on Rails", "ruby on rails", "rails"],
  ["ASP.NET", "asp.net", ".net", "dotnet"],
  ["GraphQL", "graphql"],
  ["REST API", "rest api", "restful", "rest"],
  ["gRPC", "grpc"],
  ["WebSocket", "websocket", "websockets"],
  ["Microservices", "microservices", "microservice"],
  ["Kafka", "kafka"],
  ["RabbitMQ", "rabbitmq"],
  ["Redis", "redis"],
  ["React Native", "react native"],
  ["Flutter", "flutter"],
  ["iOS", "ios", "swiftui"],
  ["Android", "android", "jetpack compose"],
  ["PostgreSQL", "postgresql", "postgres"],
  ["MySQL", "mysql", "mariadb"],
  ["MongoDB", "mongodb", "mongo"],
  ["SQLite", "sqlite"],
  ["Elasticsearch", "elasticsearch", "opensearch"],
  ["Snowflake", "snowflake"],
  ["BigQuery", "bigquery"],
  ["Spark", "apache spark", "pyspark", "spark"],
  ["Airflow", "airflow"],
  ["dbt", "dbt"],
  ["ETL", "etl", "elt"],
  ["Pandas", "pandas"],
  ["NumPy", "numpy"],
  ["scikit-learn", "scikit-learn", "sklearn"],
  ["TensorFlow", "tensorflow"],
  ["PyTorch", "pytorch"],
  ["Machine learning", "machine learning", "strojove uceni"],
  ["Power BI", "power bi", "powerbi"],
  ["Tableau", "tableau"],
  ["AWS", "aws", "amazon web services"],
  ["Azure", "azure"],
  ["Google Cloud", "google cloud", "gcp"],
  ["Docker", "docker"],
  ["Kubernetes", "kubernetes", "k8s"],
  ["Terraform", "terraform"],
  ["Ansible", "ansible"],
  ["Helm", "helm"],
  ["Jenkins", "jenkins"],
  ["GitHub Actions", "github actions"],
  ["GitLab CI", "gitlab ci", "gitlab-ci"],
  ["CI/CD", "ci/cd", "cicd", "continuous integration"],
  ["Linux", "linux", "unix"],
  ["Nginx", "nginx"],
  ["Prometheus", "prometheus"],
  ["Grafana", "grafana"],
  ["Serverless", "serverless", "lambda"],
  ["Jest", "jest"],
  ["Vitest", "vitest"],
  ["Cypress", "cypress"],
  ["Playwright", "playwright"],
  ["Selenium", "selenium"],
  ["JUnit", "junit"],
  ["pytest", "pytest"],
  ["TDD", "tdd", "test driven development"],
  ["Unit testing", "unit testing", "unit tests"],
  ["E2E testing", "e2e testing", "end-to-end testing"],
  ["OAuth", "oauth", "oidc"],
  ["JWT", "jwt"],
  ["OWASP", "owasp"],
  ["Penetration testing", "penetration testing", "pentest"],
  ["GDPR", "gdpr", "gdpr compliance"],
  ["SSO", "sso", "saml"],
  ["Figma", "figma"],
  ["Sketch", "sketch"],
  ["UX research", "ux research", "user research"],
  ["Design system", "design system", "design systems"],
  ["Prototyping", "prototyping", "prototypes"],
  ["Agile", "agile", "agilni"],
  ["Scrum", "scrum"],
  ["Kanban", "kanban"],
  ["Jira", "jira"],
  ["Git", "git"],
  ["Code review", "code review", "code reviews"],
  ["Mentoring", "mentoring", "mentorship"],
  ["A/B testing", "a/b testing", "ab testing"],
  ["SEO", "seo"],
  ["Analytics", "analytics", "google analytics"],
];

interface CompiledKeyword {
  label: string;
  /** Case-insensitive alternation of the plain forms, or `null` when none. */
  loose: RegExp | null;
  /** Case-sensitive alternation of the `^`-prefixed forms, or `null`. */
  strict: RegExp | null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Wrap one surface form in word boundaries. Boundaries are applied only on the
 * sides that end in a letter or digit, so `c++` still matches at the end of a
 * word and `.net` matches inside `ASP.NET`.
 */
function formPattern(form: string): string {
  const body = escapeRegExp(form).replace(/\s+/g, "\\s+");
  const lead = /[\p{L}\p{N}]/u.test(form[0]) ? "(?<![\\p{L}\\p{N}])" : "";
  const tail = /[\p{L}\p{N}]/u.test(form[form.length - 1]) ? "(?![\\p{L}\\p{N}])" : "";
  return `${lead}${body}${tail}`;
}

function compile(entry: string[]): CompiledKeyword {
  const forms = entry.length > 1 ? entry.slice(1) : [entry[0]];
  // Longest first so `react.js` wins over `react` and each hit is counted once.
  const sorted = [...forms].sort((a, b) => b.length - a.length);
  const loose = sorted.filter((f) => !f.startsWith("^")).map(formPattern);
  const strict = sorted.filter((f) => f.startsWith("^")).map((f) => formPattern(f.slice(1)));
  return {
    label: entry[0],
    loose: loose.length ? new RegExp(loose.join("|"), "giu") : null,
    strict: strict.length ? new RegExp(strict.join("|"), "gu") : null,
  };
}

const KEYWORDS: CompiledKeyword[] = KEYWORD_TABLE.map(compile);
const BY_LABEL = new Map(KEYWORDS.map((k) => [k.label, k]));

/** Strip diacritics but keep case, so `Vývojář` and `vyvojar` compare equal. */
function deaccent(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function countIn(keyword: CompiledKeyword, haystack: string): number {
  let total = 0;
  for (const re of [keyword.loose, keyword.strict]) {
    if (!re) continue;
    re.lastIndex = 0;
    total += [...haystack.matchAll(re)].length;
  }
  return total;
}

/** One vocabulary term found in a document, with how often it occurs. */
export interface KeywordHit {
  label: string;
  count: number;
}

/**
 * Find every vocabulary term present in `text`, most frequent first.
 * Matching is case- and diacritic-insensitive and word-boundary aware.
 */
export function extractKeywords(text: string): KeywordHit[] {
  if (!text) return [];
  const haystack = deaccent(text);
  const hits: KeywordHit[] = [];
  for (const keyword of KEYWORDS) {
    const count = countIn(keyword, haystack);
    if (count > 0) hits.push({ label: keyword.label, count });
  }
  return hits.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** True when `text` mentions the vocabulary term `label` at least once. */
export function containsKeyword(text: string, label: string): boolean {
  const keyword = BY_LABEL.get(label);
  if (!keyword || !text) return false;
  return countIn(keyword, deaccent(text)) > 0;
}

// ─── CV facts ─────────────────────────────────────────────────────────────────

const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/u;
const PHONE_CANDIDATE_RE = /[+(]?\d[\d\s().\-/]{7,20}\d/g;
const NAME_RE = /^[\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’.-]+){1,3}$/u;
const NOT_A_NAME = new Set([
  "curriculum", "vitae", "resume", "cv", "zivotopis", "lebenslauf", "profile",
  "profil", "summary", "contact", "kontakt", "personal", "about", "experience",
  "education", "skills", "portfolio",
]);
const ROLE_WORD_RE =
  /(developer|engineer|designer|manager|analyst|architect|consultant|specialist|administrator|scientist|programmer|tester|devops|vyvojar|programator|entwickler|ingenieur|developpeur|desarrollador|programista)/i;
const ROLE_SEPARATOR_RE = /\s(?:@|\||·|–|—|-|at|u|ve|bei|chez|en|w)\s/i;

/**
 * Trailing employment dates: "(2022 - present)", "2019 – 2022", "since 2021".
 * Stripped before the role/company split so a date range's dash is not mistaken
 * for the separator between a job title and an employer.
 */
const ROLE_DATE_TAIL_RE =
  /[([]?\s*(?:\d{1,2}\/)?(?:19|20)\d{2}\s*(?:[-–—]|to|az|až|do|bis|until)?\s*(?:(?:\d{1,2}\/)?(?:19|20)\d{2}|present|now|current|today|dnes|soucasnost|současnost|heute|obecnie|actualidad|aujourd'hui)?\s*[)\]]?\s*$/i;

function lines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/** Pull the candidate's display name off the top of the CV. */
function extractName(cvLines: string[]): string {
  for (const line of cvLines.slice(0, 12)) {
    const candidate = line.replace(/^(curriculum vitae|cv|resume|životopis)\s*[-–—:]\s*/i, "").trim();
    if (candidate.length > 60 || !NAME_RE.test(candidate)) continue;
    const words = deaccent(candidate).toLowerCase().split(/\s+/);
    if (words.some((w) => NOT_A_NAME.has(w))) continue;
    return candidate;
  }
  return "";
}

function extractEmail(cvText: string): string {
  return cvText.match(EMAIL_RE)?.[0] ?? "";
}

/**
 * Take the first number that looks like a phone: 9–15 digits, optionally
 * grouped or internationally prefixed. Lines that read as date ranges are
 * skipped by the digit-count bounds.
 */
function extractPhone(cvText: string): string {
  for (const raw of cvText.match(PHONE_CANDIDATE_RE) ?? []) {
    const value = raw.trim();
    const digits = value.replace(/\D/g, "").length;
    if (digits >= 9 && digits <= 15) return value;
  }
  return "";
}

/** The candidate's most recent `role @ company`, when the CV shape reveals it. */
function extractCurrentRole(cvLines: string[]): { role: string; company: string } | null {
  for (const rawLine of cvLines) {
    if (rawLine.length > 90 || !ROLE_WORD_RE.test(deaccent(rawLine))) continue;

    // Drop the employment dates first — a range's dash would otherwise be read
    // as the separator between the job title and the employer.
    const line = rawLine.replace(ROLE_DATE_TAIL_RE, "").replace(/[,;\s]+$/, "").trim();
    if (!line) continue;

    const parts = splitRoleLine(line);
    if (!parts) continue;

    let [left, right] = parts;
    if (!ROLE_WORD_RE.test(deaccent(left)) && ROLE_WORD_RE.test(deaccent(right))) {
      [left, right] = [right, left];
    }
    if (!left || !right || right.length > 60 || !/\p{L}/u.test(right)) continue;
    return { role: left, company: right };
  }
  return null;
}

/**
 * Splits "Senior Developer at Acme" or "Senior Developer, Acme s.r.o." into its
 * two halves. The word separator is tried first; a comma is the fallback,
 * because "Role, Company" is the most common CV layout and a company name may
 * itself contain commas ("Acme, s.r.o.") that must not split it further.
 */
function splitRoleLine(line: string): [string, string] | null {
  const separator = line.match(ROLE_SEPARATOR_RE);
  if (separator && separator.index !== undefined) {
    return [
      line.slice(0, separator.index).trim(),
      line.slice(separator.index + separator[0].length).replace(/\(.*$/, "").trim(),
    ];
  }

  const comma = line.indexOf(",");
  if (comma > 0) {
    return [line.slice(0, comma).trim(), line.slice(comma + 1).replace(/\(.*$/, "").trim()];
  }

  return null;
}

// ─── Localised phrases ────────────────────────────────────────────────────────

interface LetterPhrases {
  greeting: string;
  opening: string;
  currentRole: string;
  currentRoleUnknown: string;
  skillsIntro: string;
  skillsItem: string;
  noSkills: string;
  motivation: string;
  closing: string;
  signOff: string;
  nameUnknown: string;
  companyUnknown: string;
  roleUnknown: string;
  gapsHeading: string;
  gapsIntro: string;
  note: string;
  and: string;
}

const PHRASES: Record<string, LetterPhrases> = {
  English: {
    greeting: "Dear Hiring Team at {company},",
    opening: "I am applying for the {role} role at {company}.",
    currentRole: "I currently work as {current} at {currentCompany}.",
    currentRoleUnknown: "«describe your current role and employer in one sentence»",
    skillsIntro: "Your posting asks for {skills}. Here is where I have used them:",
    skillsItem: "- **{skill}** — «add a concrete result you delivered with {skill}»",
    noSkills: "«list two or three skills from your CV that match this posting»",
    motivation: "«say in one sentence what draws you to {company}»",
    closing: "I would be glad to walk you through my work in an interview.",
    signOff: "Best regards,",
    nameUnknown: "«your name»",
    companyUnknown: "«the company»",
    roleUnknown: "«the role»",
    gapsHeading: "### Not yet covered",
    gapsIntro: "The posting also mentions the following, which your CV does not evidence:",
    note: "_Template assembled from your CV and this job ad. Replace every «…» and check every sentence before sending._",
    and: "and",
  },
  Czech: {
    greeting: "Dobrý den, tým společnosti {company},",
    opening: "Hlásím se na pozici {role} ve společnosti {company}.",
    currentRole: "Momentálně pracuji jako {current} ve společnosti {currentCompany}.",
    currentRoleUnknown: "«jednou větou popište svou současnou roli a zaměstnavatele»",
    skillsIntro: "V inzerátu zmiňujete {skills}. Kde jsem je použil/a:",
    skillsItem: "- **{skill}** — «doplňte konkrétní výsledek, kterého jste díky {skill} dosáhl/a»",
    noSkills: "«uveďte dvě až tři dovednosti ze svého CV, které odpovídají inzerátu»",
    motivation: "«jednou větou napište, co vás na společnosti {company} zaujalo»",
    closing: "Rád/a vám svou práci představím osobně na pohovoru.",
    signOff: "S pozdravem,",
    nameUnknown: "«vaše jméno»",
    companyUnknown: "«společnost»",
    roleUnknown: "«pozice»",
    gapsHeading: "### Zatím nedoloženo",
    gapsIntro: "Inzerát dále zmiňuje následující, co ve vašem CV není doloženo:",
    note: "_Šablona sestavená z vašeho CV a tohoto inzerátu. Před odesláním nahraďte každé «…» a text si zkontrolujte._",
    and: "a",
  },
  German: {
    greeting: "Sehr geehrtes Team von {company},",
    opening: "hiermit bewerbe ich mich auf die Stelle als {role} bei {company}.",
    currentRole: "Derzeit arbeite ich als {current} bei {currentCompany}.",
    currentRoleUnknown: "«beschreiben Sie Ihre aktuelle Rolle und Ihren Arbeitgeber in einem Satz»",
    skillsIntro: "In Ihrer Ausschreibung nennen Sie {skills}. Damit habe ich gearbeitet:",
    skillsItem: "- **{skill}** — «ergänzen Sie ein konkretes Ergebnis, das Sie mit {skill} erreicht haben»",
    noSkills: "«nennen Sie zwei bis drei Fähigkeiten aus Ihrem Lebenslauf, die zur Ausschreibung passen»",
    motivation: "«schreiben Sie in einem Satz, was Sie an {company} reizt»",
    closing: "Gerne stelle ich Ihnen meine Arbeit in einem persönlichen Gespräch vor.",
    signOff: "Mit freundlichen Grüßen,",
    nameUnknown: "«Ihr Name»",
    companyUnknown: "«das Unternehmen»",
    roleUnknown: "«die Stelle»",
    gapsHeading: "### Noch nicht belegt",
    gapsIntro: "Die Ausschreibung nennt außerdem Folgendes, wofür Ihr Lebenslauf keinen Beleg enthält:",
    note: "_Vorlage aus Ihrem Lebenslauf und dieser Stellenanzeige zusammengestellt. Ersetzen Sie jedes «…» und prüfen Sie den Text vor dem Versand._",
    and: "und",
  },
  Polish: {
    greeting: "Szanowni Państwo,",
    opening: "Składam aplikację na stanowisko {role} w firmie {company}.",
    currentRole: "Obecnie pracuję jako {current} w firmie {currentCompany}.",
    currentRoleUnknown: "«opisz w jednym zdaniu swoją obecną rolę i pracodawcę»",
    skillsIntro: "W ogłoszeniu wymieniają Państwo {skills}. Oto gdzie z nich korzystałem/am:",
    skillsItem: "- **{skill}** — «dodaj konkretny rezultat osiągnięty dzięki {skill}»",
    noSkills: "«wymień dwie lub trzy umiejętności z CV pasujące do ogłoszenia»",
    motivation: "«napisz w jednym zdaniu, co przyciąga Cię do firmy {company}»",
    closing: "Chętnie opowiem o swojej pracy podczas rozmowy.",
    signOff: "Z poważaniem,",
    nameUnknown: "«Twoje imię i nazwisko»",
    companyUnknown: "«firma»",
    roleUnknown: "«stanowisko»",
    gapsHeading: "### Jeszcze nieudokumentowane",
    gapsIntro: "Ogłoszenie wymienia także poniższe elementy, których CV nie potwierdza:",
    note: "_Szablon złożony z Twojego CV i tego ogłoszenia. Przed wysłaniem zastąp każde «…» i sprawdź całość._",
    and: "i",
  },
  Spanish: {
    greeting: "Estimado equipo de {company}:",
    opening: "Me presento a la vacante de {role} en {company}.",
    currentRole: "Actualmente trabajo como {current} en {currentCompany}.",
    currentRoleUnknown: "«describe en una frase tu puesto actual y tu empresa»",
    skillsIntro: "En la oferta mencionáis {skills}. Así los he utilizado:",
    skillsItem: "- **{skill}** — «añade un resultado concreto que hayas logrado con {skill}»",
    noSkills: "«indica dos o tres competencias de tu CV que encajen con la oferta»",
    motivation: "«escribe en una frase qué te atrae de {company}»",
    closing: "Estaré encantado/a de comentar mi trabajo en una entrevista.",
    signOff: "Un cordial saludo,",
    nameUnknown: "«tu nombre»",
    companyUnknown: "«la empresa»",
    roleUnknown: "«el puesto»",
    gapsHeading: "### Aún sin acreditar",
    gapsIntro: "La oferta también menciona lo siguiente, que tu CV no acredita:",
    note: "_Plantilla creada a partir de tu CV y de esta oferta. Sustituye cada «…» y revisa el texto antes de enviarlo._",
    and: "y",
  },
  French: {
    greeting: "Madame, Monsieur,",
    opening: "Je vous adresse ma candidature au poste de {role} chez {company}.",
    currentRole: "J'occupe actuellement le poste de {current} chez {currentCompany}.",
    currentRoleUnknown: "«décrivez en une phrase votre poste actuel et votre employeur»",
    skillsIntro: "Votre annonce mentionne {skills}. Voici où je les ai mis en pratique :",
    skillsItem: "- **{skill}** — «ajoutez un résultat concret obtenu grâce à {skill}»",
    noSkills: "«citez deux ou trois compétences de votre CV correspondant à l'annonce»",
    motivation: "«écrivez en une phrase ce qui vous attire chez {company}»",
    closing: "Je serai ravi(e) de vous présenter mon travail lors d'un entretien.",
    signOff: "Cordialement,",
    nameUnknown: "«votre nom»",
    companyUnknown: "«l'entreprise»",
    roleUnknown: "«le poste»",
    gapsHeading: "### Pas encore démontré",
    gapsIntro: "L'annonce mentionne également les points suivants, absents de votre CV :",
    note: "_Modèle assemblé à partir de votre CV et de cette annonce. Remplacez chaque «…» et relisez le texte avant l'envoi._",
    and: "et",
  },
};

/** Languages with a hand-written phrase table. Anything else falls back to English. */
export const SUPPORTED_LETTER_LANGUAGES: string[] = Object.keys(PHRASES);

const LANGUAGE_ALIASES: Record<string, string> = {
  en: "English", english: "English", anglictina: "English",
  cs: "Czech", cz: "Czech", czech: "Czech", cestina: "Czech", cesky: "Czech",
  de: "German", german: "German", deutsch: "German", nemcina: "German",
  pl: "Polish", polish: "Polish", polski: "Polish", polstina: "Polish",
  es: "Spanish", spanish: "Spanish", espanol: "Spanish", castellano: "Spanish",
  fr: "French", french: "French", francais: "French", francouzstina: "French",
};

/** Map a free-form language label from the user profile onto a phrase table. */
function resolvePhrases(language: string): LetterPhrases {
  const key = deaccent(String(language ?? "")).trim().toLowerCase();
  return PHRASES[LANGUAGE_ALIASES[key] ?? ""] ?? PHRASES.English;
}

function fill(template: string, vars: Record<string, string>): string {
  const filled = template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? "");
  // Company names routinely end in an abbreviation ("Acme s.r.o.", "Beta Ltd.")
  // which would otherwise collide with the template's own full stop.
  return filled
    .replace(/([^.])\.\.(?!\.)/g, "$1.")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Join labels with localised "and": `React, TypeScript and Docker`. */
function joinList(items: string[], and: string): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${and} ${items[items.length - 1]}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface CoverLetterInput {
  jobTitle: string;
  company: string;
  jobDescription: string;
  cvText: string;
  /** Language label from the user profile, e.g. `"English"` or `"Czech"`. */
  language: string;
  candidateName?: string;
  candidateEmail?: string;
  candidatePhone?: string;
}

export interface ComposedCoverLetter {
  /** Markdown, ready to edit. */
  content: string;
  /** Skills found in BOTH the job description and the CV — the letter's evidence. */
  matchedSkills: string[];
  /** Job requirements with no CV evidence, surfaced so the user can fill them in. */
  gaps: string[];
  /** Spots the user should personalise, e.g. "«add a concrete result here»". */
  placeholders: string[];
}

/** How many matched skills get their own bullet, and how many gaps are listed. */
const MAX_SKILL_BULLETS = 6;
const MAX_GAPS = 8;

/**
 * Compose a cover-letter template from the job ad and the CV.
 *
 * Nothing is invented: matched skills are those the CV actually mentions, the
 * signature comes from the CV, and every unknown becomes a `«…»` placeholder.
 * Never throws — malformed input degrades to a usable skeleton.
 */
export function composeCoverLetter(input: CoverLetterInput): ComposedCoverLetter {
  const phrases = resolvePhrases(input.language);
  const cvText = String(input.cvText ?? "");
  const jobDescription = String(input.jobDescription ?? "");
  const company = String(input.company ?? "").trim() || phrases.companyUnknown;
  const role = String(input.jobTitle ?? "").trim() || phrases.roleUnknown;

  const cvLines = lines(cvText);
  const name = (input.candidateName ?? "").trim() || extractName(cvLines) || phrases.nameUnknown;
  const email = (input.candidateEmail ?? "").trim() || extractEmail(cvText);
  const phone = (input.candidatePhone ?? "").trim() || extractPhone(cvText);
  const current = extractCurrentRole(cvLines);

  const jobKeywords = extractKeywords(`${role} ${jobDescription}`);
  const matchedSkills = jobKeywords.filter((k) => containsKeyword(cvText, k.label)).map((k) => k.label);
  const gaps = jobKeywords
    .filter((k) => !matchedSkills.includes(k.label))
    .map((k) => k.label)
    .slice(0, MAX_GAPS);

  const bullets = matchedSkills.slice(0, MAX_SKILL_BULLETS);
  const vars = {
    company,
    role,
    current: current?.role ?? "",
    currentCompany: current?.company ?? "",
    skills: joinList(bullets, phrases.and),
  };

  const paragraphs: string[] = [
    fill(phrases.greeting, vars),
    `${fill(phrases.opening, vars)} ${fill(phrases.motivation, vars)}`,
    current ? fill(phrases.currentRole, vars) : phrases.currentRoleUnknown,
  ];

  if (bullets.length > 0) {
    paragraphs.push(fill(phrases.skillsIntro, vars));
    paragraphs.push(bullets.map((skill) => fill(phrases.skillsItem, { ...vars, skill })).join("\n"));
  } else {
    // No overlap (or no CV at all) — ask for the skills instead of inventing them.
    paragraphs.push(phrases.noSkills);
  }

  paragraphs.push(phrases.closing);
  paragraphs.push([phrases.signOff, name, [email, phone].filter(Boolean).join(" · ")].filter(Boolean).join("\n"));

  if (gaps.length > 0) {
    paragraphs.push("---");
    paragraphs.push(phrases.gapsHeading);
    paragraphs.push(phrases.gapsIntro);
    paragraphs.push(gaps.map((gap) => `- ${gap}`).join("\n"));
  }

  paragraphs.push(phrases.note);

  const content = paragraphs.join("\n\n");
  return {
    content,
    matchedSkills,
    gaps,
    placeholders: content.match(/«[^»]*»/gu) ?? [],
  };
}

/** Chunk size that reads like typing in the streaming dialog. */
const STREAM_CHUNK = 24;

/**
 * Split text into small chunks on word boundaries. Concatenating every chunk
 * reproduces `text` byte for byte, so the SSE client rebuilds it exactly.
 */
export function* chunkForStreaming(text: string, size = STREAM_CHUNK): Generator<string> {
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    while (end < text.length && !/\s/.test(text[end])) end++;
    yield text.slice(start, end);
    start = end;
  }
}

/** Yields the composed letter in small chunks so the existing SSE UI keeps its typing effect. */
export function* streamCoverLetter(input: CoverLetterInput): Generator<string> {
  yield* chunkForStreaming(composeCoverLetter(input).content);
}
