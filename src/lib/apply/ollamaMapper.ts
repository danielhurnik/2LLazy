import { z } from "zod";
import { ollamaAvailable, ollamaChat, ollamaChatJson, ollamaPickModel } from "@/lib/ollama";
import { describeField, resolveValue, type FieldDescriptor, type FieldValue, type ProfileKey } from "./fieldMatcher";
import type { ApplyJob, ApplyProfile } from "./types";

const MAPPABLE_KEYS = [
  "fullName",
  "firstName",
  "lastName",
  "email",
  "phone",
  "linkedInUrl",
  "githubUrl",
  "website",
  "city",
  "country",
  "cv",
  "coverLetter",
  "message",
  "salary",
  "startDate",
  "consent",
  "marketing",
  "none",
] as const;

const MappingSchema = z.object({
  mappings: z.array(
    z.object({
      index: z.number().int().min(0),
      key: z.enum(MAPPABLE_KEYS),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

export interface OllamaMapping {
  field: FieldDescriptor;
  key: ProfileKey;
  score: number;
  value: FieldValue;
}

export interface OllamaMapResult {
  mapped: OllamaMapping[];
  stillUnmatched: FieldDescriptor[];
  used: boolean;
}

const MIN_LLM_CONFIDENCE = 0.6;
const LLM_SCORE_CAP = 0.7;

function fieldSummary(field: FieldDescriptor, index: number): string {
  const options = field.options.length ? ` options=[${field.options.slice(0, 12).map((o) => o.text).join(" | ")}]` : "";
  return `${index}: ${describeField(field)} | tag=${field.tag} type=${field.type} name="${field.name}" placeholder="${field.placeholder}"${options}`;
}

const isCheckbox = (field: FieldDescriptor) => field.tag === "input" && (field.type === "checkbox" || field.type === "radio");

export async function mapFieldsWithOllama(fields: FieldDescriptor[], profile: ApplyProfile): Promise<OllamaMapResult> {
  const candidates = fields.filter((f) => !isCheckbox(f));
  if (candidates.length === 0 || !(await ollamaAvailable())) {
    return { mapped: [], stillUnmatched: fields, used: false };
  }
  const prompt = [
    "You map job application form fields to keys of an applicant profile.",
    "Keys: fullName, firstName, lastName, email, phone, linkedInUrl, githubUrl, website, city, country, cv (file upload of the CV), coverLetter, message (free text about the applicant), salary, startDate, none.",
    "Labels may be Czech or English. Use none when unsure. Return one mapping per field index.",
    "",
    "Fields:",
    ...candidates.map(fieldSummary),
  ].join("\n");

  let parsed: z.infer<typeof MappingSchema>;
  try {
    const model = await ollamaPickModel(JSON_MODEL_PREFERENCE);
    parsed = await ollamaChatJson([{ role: "user", content: prompt }], MappingSchema, { model, signal: AbortSignal.timeout(60_000) });
  } catch {
    return { mapped: [], stillUnmatched: fields, used: true };
  }

  const mapped: OllamaMapping[] = [];
  const taken = new Set<FieldDescriptor>();
  for (const m of parsed.mappings) {
    const field = candidates[m.index];
    if (!field || taken.has(field) || m.key === "none" || m.key === "consent" || m.key === "marketing" || m.confidence < MIN_LLM_CONFIDENCE) continue;
    const value = resolveValue(m.key, profile, field);
    if (!value) continue;
    taken.add(field);
    mapped.push({ field, key: m.key, score: Math.min(LLM_SCORE_CAP, m.confidence), value });
  }
  return { mapped, stillUnmatched: fields.filter((f) => !taken.has(f)), used: true };
}

const WRITER_MODEL_PREFERENCE = [process.env.OLLAMA_WRITER_MODEL ?? "", "gemma3:4b", "gemma3:12b", "gemma2:9b", "qwen2.5:7b", "mistral-nemo", "llama3.1"].filter(Boolean);
const JSON_MODEL_PREFERENCE = [process.env.OLLAMA_MODEL ?? "", "gemma3:4b", "gemma2:9b", "llama3"].filter(Boolean);
const CZECH_LETTERS = /[ěščřžýáíéůúďťňĚŠČŘŽÝÁÍÉŮÚĎŤŇ]/;
const PLACEHOLDER_LIKE = /[\[\]{}<>]|your name|jméno a příjmení|\(name\)|lorem ipsum|\*\*/i;
const MIN_DRAFT_CHARS = 180;
const MAX_DRAFT_CHARS = 1400;

const PICTOGRAPHS = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu;

function plain(text: string | null | undefined): string {
  return (text ?? "").replace(PICTOGRAPHS, "").replace(/\s+/g, " ").trim();
}

function excerpt(text: string | null | undefined, max: number): string {
  const cleaned = plain(text);
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}

export interface DraftResult {
  text: string;
  model: string;
}

const BANNED_PHRASES = [
  /nadšen[ýáéí]|nadšení/i,
  /vášn|vášeň/i,
  /přesvědčen/i,
  /prospěšn/i,
  /inovativn/i,
  /unikátn/i,
  /výzv[ao]u?\b/i,
  /synergi/i,
  /mindset/i,
  /šikovn/i,
  /skvěl/i,
  /dynamick/i,
  /ideáln[ií] kandidát/i,
  /rád bych se podílel/i,
  /mohl bych přispět/i,
  /jsem si jist/i,
  /cenn[ýé]m? aktiv/i,
  /\bi am (excited|thrilled|passionate)\b/i,
  /\bpassion(ate)?\b/i,
  /\bleverage\b/i,
  /\bsynerg/i,
  /\bideal candidate\b/i,
  /\bvaluable asset\b/i,
  /\bi am confident\b/i,
  /\bcutting[- ]edge\b/i,
  /\binnovative\b/i,
  /\bdynamic\b/i,
];
const COMPANY_SUFFIX = /,?\s*(s\.\s?r\.\s?o\.?|spol\.\s*s\s*r\.\s*o\.?|a\.\s?s\.?|k\.\s?s\.?|v\.\s?o\.\s?s\.?|gmbh|ltd\.?|inc\.?|llc|plc|b\.\s?v\.?|sp\.\s*z\s*o\.\s*o\.?)\s*$/i;
const COPIED_PHRASE_WORDS = 5;

export function shortCompanyName(company: string): string {
  return company.replace(COMPANY_SUFFIX, "").trim() || company;
}

function wordList(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function grams(words: string[], size: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + size <= words.length; i += 1) out.add(words.slice(i, i + size).join(" "));
  return out;
}

export function copiedPhrases(draft: string, source: string, allowedText = ""): string[] {
  const sourceGrams = grams(wordList(source), COPIED_PHRASE_WORDS);
  const allowedGrams = grams(wordList(allowedText), COPIED_PHRASE_WORDS);
  const hits = new Set<string>();
  for (const gram of grams(wordList(draft), COPIED_PHRASE_WORDS)) {
    if (sourceGrams.has(gram) && !allowedGrams.has(gram)) hits.add(gram);
  }
  return [...hits];
}

const EXPERIENCE_SENTENCE = /(zkušenost|praxi|praxe|pracoval|pracuji|mám za sebou|dělám|dělal|umím|znám|ovládám|používám|používal|využíval|využívám|vyvíjel|vyvíjím|vyvinul|postavil|stavím|stavěl|vytvořil|tvořil|navrhl|navrhoval|implementoval|spolupracoval|podílel|vedl|řídil|věnuji|věnoval|\d+\s*(let|rok)|(let|rok)[yůu]?\b.*prax|experience|worked|working|i know|i use|i used|familiar|proficient|skilled|i built|i develop|i have been|i led|i designed|i implemented|i delivered|i shipped|contributed|years)/i;
const CLAUSE_SPLIT = /[,;]|\s+a\s+(?=r[áa]d|cht[ěe]l|chci|zaj[ií]m)|\s+and\s+(?=i(?:'d| would| want| am interested)|which)/i;
const WISH_CLAUSE = /(r[áa]d(a)? bych|cht[ěe]l(a)? bych|chci|zaj[ií]m[áa] m[ěe]|zaj[ií]malo by|nau[čc]il|roz[sš][ií][rř]il|posunout|would like|want to|interested in|learn|keen to|looking to|hope to)/i;

function claimClausesOf(text: string): string[] {
  const clauses: string[] = [];
  const sentences = text
    .split("\n")
    .slice(1)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
  for (const sentence of sentences) {
    if (!EXPERIENCE_SENTENCE.test(sentence)) continue;
    for (const clause of sentence.split(CLAUSE_SPLIT)) {
      const trimmed = clause.trim();
      if (trimmed && !WISH_CLAUSE.test(trimmed)) clauses.push(trimmed);
    }
  }
  return clauses;
}

export function bannedPhrases(draft: string): string[] {
  return BANNED_PHRASES.map((re) => draft.match(re)?.[0] ?? "").filter(Boolean);
}

const CLAIM_TOKEN = /\b[A-Z][A-Za-z0-9+#]*(?:\.[A-Za-z]+)?\b|\.NET\b/g;
const CLAIM_STOPWORDS = new Set(["dobrý", "den", "hello", "dear", "s", "best", "kind", "regards", "cv", "ai", "it"]);
const STEM_LENGTH = 5;
const GENERIC_STEMS = new Set([
  "pozic", "praci", "prace", "firma", "firmy", "firme", "vyvoj", "zkuse", "proje", "aplik", "softw", "techn", "nabid", "spole", "zivot", "pracu", "praxe", "praxi", "zajim", "roky", "rokyp", "tymu", "tymem", "nastr", "reseni", "resen", "pozad", "znalo", "dovedn", "doved", "kodu", "kod", "vyvoja", "vyvij", "pracov", "work", "exper", "posit", "compa", "team", "proje", "devel", "skill", "years", "role", "job", "appli", "build", "using", "with", "tools", "produ", "servi",
]);
const YEARS_CLAIM = /(?<![\p{L}\d])(\d{1,2}|jeden|jednoho|dva|dvou|tři|tří|čtyři|čtyř|pět|pěti|šest|šesti|sedm|sedmi|osm|osmi|devět|devíti|deset|deseti|one|two|three|four|five|six|seven|eight|nine|ten)\s*(\+|a více|or more)?\s*-?(let|roky|rok|roků|years?)(?:[ouáéý]\p{L}*)?/giu;

function stemsOf(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of wordList(normalizeForStem(text))) {
    if (word.length >= STEM_LENGTH) out.add(word.slice(0, STEM_LENGTH));
  }
  return out;
}

function normalizeForStem(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function numberKey(raw: string): string {
  const word = normalizeForStem(raw.toLowerCase());
  if (/^\d+$/.test(word)) return word;
  const table: Record<string, string> = { jed: "1", dva: "2", dvo: "2", tri: "3", cty: "4", pet: "5", ses: "6", sed: "7", osm: "8", dev: "9", des: "10", one: "1", two: "2", thr: "3", fou: "4", fiv: "5", six: "6", sev: "7", eig: "8", nin: "9", ten: "10" };
  return table[word.slice(0, 3)] ?? word;
}

function claimableTerms(jobDescription: string, skills: string[]): Set<string> {
  const capitalised = (jobDescription.match(/(?<![.!?]\s)(?<!^)\b\p{Lu}[\p{L}\d+#.]{2,}/gmu) ?? []).filter((t) => !/^[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][a-záčďéěíňóřšťúůýž]+$/.test(t));
  return stemsOf([...skills, ...capitalised].join(" "));
}

export function findUnsupportedClaims(draft: string, cvText: string, jobDescription: string, allow: string[], skills: string[] = []): string[] {
  const cv = cvText.toLowerCase();
  const job = jobDescription.toLowerCase();
  const allowed = new Set(allow.flatMap((a) => a.toLowerCase().split(/\s+/)));
  const cvStems = stemsOf(cvText);
  const jobStems = claimableTerms(jobDescription, skills);
  const allowStems = stemsOf(allow.join(" "));
  const cvNumbers = new Set([...cvText.matchAll(YEARS_CLAIM)].map((m) => numberKey(m[1])));
  const unsupported = new Map<string, string>();
  const flag = (term: string) => {
    const key = normalizeForStem(term.toLowerCase());
    if (!unsupported.has(key)) unsupported.set(key, term);
  };
  for (const sentence of claimClausesOf(draft)) {
    for (const token of sentence.match(CLAIM_TOKEN) ?? []) {
      const lower = token.toLowerCase();
      if (lower.length < 2 || CLAIM_STOPWORDS.has(lower) || allowed.has(lower)) continue;
      if (/^[A-Z][a-záčďéěíňóřšťúůýž]+$/.test(token) && sentence.startsWith(token)) continue;
      if (job.includes(lower) && !cv.includes(lower)) flag(token);
    }
    for (const word of wordList(normalizeForStem(sentence))) {
      if (word.length < STEM_LENGTH) continue;
      const stem = word.slice(0, STEM_LENGTH);
      if (GENERIC_STEMS.has(stem) || allowStems.has(stem) || cvStems.has(stem) || !jobStems.has(stem)) continue;
      flag(word);
    }
    for (const match of sentence.matchAll(YEARS_CLAIM)) {
      if (!cvNumbers.has(numberKey(match[1]))) flag(match[0].trim());
    }
  }
  return [...unsupported.values()];
}

function detectCzech(field: FieldDescriptor, job: ApplyJob): boolean {
  const formText = `${field.label} ${field.placeholder} ${field.ariaLabel} ${field.value}`;
  if (CZECH_LETTERS.test(formText)) return true;
  if (/^[\s\S]{0,5}$/.test(formText.trim())) return CZECH_LETTERS.test(job.description.slice(0, 1500));
  return false;
}

function draftIsUsable(text: string): boolean {
  return text.length >= MIN_DRAFT_CHARS && text.length <= MAX_DRAFT_CHARS && !PLACEHOLDER_LIKE.test(text);
}

function cleanDraft(raw: string): string {
  return raw
    .replace(PICTOGRAPHS, "")
    .replace(/^```[a-z]*\n?|```$/g, "")
    .replace(/^(subject|předmět)\s*:.*$/gim, "")
    .replace(/^["“„']+|["”“']+$/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function draftFreeText(
  field: FieldDescriptor,
  profile: ApplyProfile,
  job: ApplyJob,
  onReject: (reason: string) => void = () => undefined,
): Promise<DraftResult | null> {
  if (!(await ollamaAvailable())) return null;
  const czech = detectCzech(field, job);
  const model = await ollamaPickModel(WRITER_MODEL_PREFERENCE);
  const cv = excerpt(profile.cvText, 3200);
  const title = plain(job.title);
  const company = shortCompanyName(job.company);
  const system = czech
    ? "Píšeš za uchazeče krátkou zprávu do formuláře k pracovní nabídce. Tón: věcný, přirozený, jako když vývojář píše sám za sebe kamarádovi z branže, kterého nezná. Krátké věty. Žádné lichotky firmě, žádné nadšení, žádné fráze z personalistiky, žádné opakování textu inzerátu. Používej pouze fakta ze životopisu; nic si nevymýšlej. Výstup je čistý text bez markdownu, nadpisů, odrážek a zástupných symbolů."
    : "You write a short message into a job application form on behalf of the applicant. Tone: matter-of-fact and natural, like a developer writing to a stranger in the trade. Short sentences. No flattery, no enthusiasm, no HR phrasing, no echoing the job ad. Use only facts from the CV; invent nothing. Output plain text only, no markdown, headings, bullets or placeholders.";
  const sample = czech
    ? `Příklad tónu (jiná pozice, jiný člověk, nekopíruj obsah):\nDobrý den,\n\nhlásím se na pozici frontend vývojáře. Poslední tři roky dělám hlavně React a TypeScript, naposledy jsem u klienta postavil interní aplikaci pro správu objednávek od návrhu po nasazení. Zaujalo mě, že jde o práci s mapovými daty, k tomu jsem se zatím dostal jen okrajově a rád bych se v tom posunul.\n\nŽivotopis posílám v příloze, klidně se ozvěte a domluvíme hovor.\n\nPetr Novák`
    : `Example of the tone (different role, different person, do not copy the content):\nHello,\n\nI'm applying for the frontend developer role. For the last three years I've mostly worked with React and TypeScript; most recently I built an internal order-management app for a client, from design to deployment. What caught my eye is the map data part, which I've only touched briefly so far and would like to get deeper into.\n\nMy CV is attached; happy to jump on a call.\n\nPeter Novak`;
  const instructions = cv
    ? czech
      ? `Napiš 50–90 slov: "Dobrý den," na prvním řádku, pak nový odstavec začínající malým písmenem. První odstavec: na jakou pozici se hlásím (vlastními slovy, bez citování názvu inzerátu) a jedna až dvě konkrétní věci z mého životopisu, které s ní souvisejí. Jedna věta, co konkrétně mě na té nabídce zajímá, řečeno obyčejně, bez chvály firmy. Poslední odstavec: že životopis posílám v příloze a rád si zavolám. Na posledním řádku jen mé jméno: ${profile.name}. Firmu pojmenuj ${company}, bez právní formy. Nepoužívej slova nadšený, přesvědčen, prospěšný, inovativní, unikátní, výzva, šikovný, skvělý, mindset. Neopisuj žádné sousloví z popisu pozice.`
      : `Write 50–90 words: "Hello," on the first line, then a new paragraph. First paragraph: which role I'm applying for (in my own words, without quoting the ad's title) and one or two concrete things from my CV that relate to it. One plain sentence on what specifically interests me in this posting, without praising the company. Last paragraph: my CV is attached and I'm happy to talk. Last line is only my name: ${profile.name}. Call the company ${company}, no legal suffix. Avoid the words excited, passionate, confident, innovative, dynamic, leverage, ideal candidate. Do not copy any phrase from the job description.`
    : czech
      ? `Napiš 40–70 slov: "Dobrý den," na prvním řádku, pak nový odstavec začínající malým písmenem: na jakou pozici se hlásím (vlastními slovy) a jedna obyčejná věta, co mě na nabídce zajímá. Pak věta, že podrobnosti k mé praxi jsou v přiloženém životopise a rád si zavolám. Na posledním řádku jen mé jméno: ${profile.name}. Firmu pojmenuj ${company}. Neuváděj žádné roky praxe, technologie, projekty ani dovednosti jako své vlastní, protože můj životopis nemáš. Nepoužívej slova nadšený, přesvědčen, prospěšný, inovativní, unikátní, výzva, šikovný, skvělý. Neopisuj sousloví z popisu pozice.`
      : `Write 40–70 words: "Hello," on the first line, then a new paragraph: which role I'm applying for (in my own words) and one plain sentence on what interests me in it. Then a sentence that the details of my experience are in the attached CV and I'm happy to talk. Last line is only my name: ${profile.name}. Call the company ${company}. Do not claim any years, technologies, projects or skills as mine, because you do not have my CV. Avoid excited, passionate, confident, innovative, dynamic. Do not copy phrases from the job description.`;
  const user = [
    `${czech ? "Pozice" : "Job"}: ${title} — ${company}`,
    `${czech ? "Popis pozice (jen pro pochopení, neopisovat)" : "Job description (for understanding only, do not copy)"}: ${excerpt(job.description, 2500) || "-"}`,
    `${czech ? "Uchazeč" : "Applicant"}: ${profile.name}${profile.city ? `, ${profile.city}` : ""}`,
    `${czech ? "Životopis (výňatek)" : "CV (excerpt)"}: ${cv || (czech ? "není k dispozici" : "not available")}`,
    `${czech ? "Pole formuláře" : "Form field"}: ${describeField(field)}`,
    field.value ? `${czech ? "Pole nyní obsahuje tuto šablonu, kterou nahradíš" : "The field currently holds this template, which you replace"}: "${excerpt(field.value, 300)}"` : "",
    "",
    sample,
    "",
    instructions,
  ]
    .filter(Boolean)
    .join("\n");

  const allow = [profile.name, job.company, title, profile.city ?? ""];
  let forbidden: string[] = [];
  for (const temperature of [0.5, 0.3, 0.15]) {
    const banLine = forbidden.length
      ? czech
        ? `\nVyhni se těmto výrazům a souslovím: ${forbidden.join("; ")}.`
        : `\nAvoid these terms and phrases: ${forbidden.join("; ")}.`
      : "";
    try {
      const raw = await ollamaChat(
        [
          { role: "system", content: system },
          { role: "user", content: user + banLine },
        ],
        { model, temperature, numCtx: 8192, keepAlive: "10m", signal: AbortSignal.timeout(120_000) },
      );
      const text = cleanDraft(raw);
      if (!draftIsUsable(text)) {
        onReject(`${model} t=${temperature}: unusable length/placeholder (${text.length} chars)`);
        continue;
      }
      const problems = [...bannedPhrases(text), ...copiedPhrases(text, job.description, `${title} ${company}`)];
      if (cv) problems.push(...findUnsupportedClaims(text, profile.cvText ?? "", job.description, allow, job.skills));
      if (problems.length > 0) {
        onReject(`${model} t=${temperature}: ${problems.join(" | ")}`);
        forbidden = [...new Set([...forbidden, ...problems])];
        continue;
      }
      const polished = czech ? await proofreadCzech(text, model) : text;
      return { text: enforceShape(polished, czech, profile.name), model };
    } catch (err) {
      onReject(`${model} t=${temperature}: ${(err as Error).message.split("\n")[0]}`);
      return null;
    }
  }
  if (cv) return draftFreeText(field, { ...profile, cvText: null }, job, onReject);
  return null;
}

const GREETING_LINE = /^(dobr[ýyéá] (den|r[áa]no|ve[čc]er|odpoledne)|ahoj|zdrav[íi]m( v[áa]s)?|v[áa][žz]en[ýíé].{0,40}|hello|hi|dear .{0,40}|good (morning|afternoon|evening))[,!.]?$/i;
const SIGNOFF_LINE = /^(s (pozdravem|úctou|přáním hezkého dne)|best regards|kind regards|regards|sincerely|yours sincerely)[,.]?$/i;

export function enforceShape(text: string, czech: boolean, name: string): string {
  const lines = text.split("\n").map((l) => l.trim());
  const isNameLine = (line: string) => line.replace(/[.,!]$/, "").trim().toLowerCase() === name.trim().toLowerCase();
  for (let i = lines.length - 1; i >= Math.max(1, lines.length - 5); i -= 1) {
    if (isNameLine(lines[i])) {
      lines.splice(i + 1);
      break;
    }
  }
  const greeting = czech ? "Dobrý den," : "Hello,";
  if (lines.length && GREETING_LINE.test(lines[0])) lines[0] = greeting;
  else lines.unshift(greeting, "");
  const bodyIndex = lines.findIndex((l, i) => i > 0 && l.length > 0);
  if (bodyIndex > 0) {
    lines[bodyIndex] = lines[bodyIndex].replace(/^(\p{Lu}{2,}(?:\s+\p{Lu}{2,})*)/u, (shouting) => shouting.toLowerCase());
    if (czech) lines[bodyIndex] = lines[bodyIndex].charAt(0).toLowerCase() + lines[bodyIndex].slice(1);
  }
  const nameLine = name.trim();
  const lastLine = lines[lines.length - 1] ?? "";
  if (lastLine.replace(/[.,]$/, "").toLowerCase() === nameLine.toLowerCase()) lines[lines.length - 1] = nameLine;
  else if (lastLine.toLowerCase().includes(nameLine.toLowerCase())) {
    lines[lines.length - 1] = lastLine.replace(new RegExp(`\\s*${nameLine.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.?$`, "i"), "").trim();
    if (SIGNOFF_LINE.test(lines[lines.length - 1])) lines[lines.length - 1] = lines[lines.length - 1].replace(/[.]$/, ",");
    lines.push(nameLine);
  } else {
    lines.push("", czech ? "S pozdravem," : "Best regards,", nameLine);
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function proofreadCzech(text: string, model: string): Promise<string> {
  try {
    const raw = await ollamaChat(
      [
        {
          role: "system",
          content:
            "Jsi korektor češtiny. Oprav jen gramatiku, pravopis, pády, předložky a slovosled a nahraď zbytečné anglicismy běžnými českými slovy. Zachovej obsah, délku, neformální věcný tón, oslovení, podpis a členění na řádky; nepřidávej zdvořilostní fráze ani nic jiného. Vrať pouze opravený text bez komentáře.",
        },
        { role: "user", content: text },
      ],
      { model, temperature: 0, numCtx: 4096, keepAlive: "10m", signal: AbortSignal.timeout(90_000) },
    );
    const polished = cleanDraft(raw);
    const sameShape = Math.abs(polished.length - text.length) <= text.length * 0.35;
    return draftIsUsable(polished) && sameShape ? polished : text;
  } catch {
    return text;
  }
}
