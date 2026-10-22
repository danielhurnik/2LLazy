import { z } from "zod";
import { ollamaAvailable, ollamaChat, ollamaChatJson, ollamaPickModel } from "@/lib/ollama";
import { describeField, resolveValue, type FieldDescriptor, type FieldValue, type ProfileKey } from "./fieldMatcher";
import type { ApplyJob, ApplyProfile } from "./types";
import { errorMessage } from "@/lib/guards";
import { foldDiacritics } from "@/lib/text";
import { loadVoice, samplesForPrompt, voiceGuard, type VoiceConfig, type VoiceLang } from "./voice";

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

interface OllamaMapping {
  field: FieldDescriptor;
  key: ProfileKey;
  score: number;
  value: FieldValue;
}

interface OllamaMapResult {
  mapped: OllamaMapping[];
  stillUnmatched: FieldDescriptor[];
  used: boolean;
}

const FIELD_MAPPING_TIMEOUT_MS = 60_000;
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
    parsed = await ollamaChatJson([{ role: "user", content: prompt }], MappingSchema, { model, signal: AbortSignal.timeout(FIELD_MAPPING_TIMEOUT_MS) });
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
  lang: VoiceLang;
}

const GENDER_SLASH = /\b\p{L}+\/[aá]\b/u;
const SKILL_LIST = /(\b[A-Z][\w.+#-]*\b\s*,\s*){2,}\b[A-Z][\w.+#-]*\b/;

const BANNED_PHRASES = [
  /rád bych se uch[aá]zel/i,
  /t[ií]mto se uch[aá]z[ií]m/i,
  /t[ií]mto se hl[aá]s[ií]m/i,
  /dovoluji si/i,
  /v p[rř][ií]loze zas[ií]l[aá]m/i,
  /bohat[ée] zku[sš]enosti/i,
  /t[ěe][sš][ií]m se na/i,
  /\bi am writing to\b/i,
  /\bi would like to (apply|express)\b/i,
  /\b(great|perfect) fit\b/i,
  /\bi believe\b/i,
  /\bi look forward\b/i,
  /\bopportunity\b/i,
  /\bstrong background\b/i,
  /\bproven\b/i,
  /\btrack record\b/i,
  /\bskill ?set\b/i,
  /\bexcited\b/i,
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

export function bannedPhrases(draft: string, neverSay: string[] = []): string[] {
  const configured = neverSay.map((phrase) => phrase.trim()).filter(Boolean);
  const lower = draft.toLowerCase();
  const fromConfig = configured.filter((phrase) => lower.includes(phrase.toLowerCase()));
  const fromRules = BANNED_PHRASES.map((re) => draft.match(re)?.[0] ?? "").filter(Boolean);
  return [...new Set([...fromRules, ...fromConfig])];
}

export function styleProblems(draft: string): string[] {
  const problems: string[] = [];
  const slash = draft.match(GENDER_SLASH)?.[0];
  if (slash) problems.push(`gender slash: ${slash}`);
  if (SKILL_LIST.test(draft)) problems.push("skill list");
  return problems;
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
  for (const word of wordList(foldDiacritics(text))) {
    if (word.length >= STEM_LENGTH) out.add(word.slice(0, STEM_LENGTH));
  }
  return out;
}

function numberKey(raw: string): string {
  const word = foldDiacritics(raw.toLowerCase());
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
    const key = foldDiacritics(term.toLowerCase());
    if (!unsupported.has(key)) unsupported.set(key, term);
  };
  for (const sentence of claimClausesOf(draft)) {
    for (const token of sentence.match(CLAIM_TOKEN) ?? []) {
      const lower = token.toLowerCase();
      if (lower.length < 2 || CLAIM_STOPWORDS.has(lower) || allowed.has(lower)) continue;
      if (/^[A-Z][a-záčďéěíňóřšťúůýž]+$/.test(token) && sentence.startsWith(token)) continue;
      if (job.includes(lower) && !cv.includes(lower)) flag(token);
    }
    for (const word of wordList(foldDiacritics(sentence))) {
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
    .replace(/!+/g, ".")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function buildPrompt(input: {
  czech: boolean;
  voice: VoiceConfig;
  field: FieldDescriptor;
  profile: ApplyProfile;
  job: ApplyJob;
  cv: string;
  title: string;
  company: string;
}): { system: string; user: string } {
  const { czech, voice, field, profile, job, cv, title, company } = input;
  const first = voice.signature;
  const samples = samplesForPrompt(voice, czech ? "cs" : "en");
  const system = czech
    ? `Píšeš krátkou zprávu do formuláře k pracovní nabídce jménem ${first}a, vývojáře, a musí znít jako on: v klidu, bez pozérství, o tu práci má zájem, ale nepřehání, příjemný na pokec. Krátké věty, první osoba. Jedna konkrétní, nenucená věc k téhle pozici nebo stacku. Žádný výčet dovedností (to má v životopise), žádné chválení firmy, žádné personalistické fráze, žádné opakování inzerátu, žádné emoji, žádné vykřičníky, žádné lomítkové tvary jako rád/a. Jen fakta ze životopisu. Výstup je čistý text bez markdownu.`
    : `You write a short message into a job application form as ${first}, a developer, and it has to sound like him: relaxed, lowkey, into the work without overdoing it, easy to be around. Short sentences, first person. One concrete, casual hook about this particular role or stack. No skill lists (the CV does that), no praising the company, no HR phrasing, no echoing the ad, no emoji, no exclamation marks. Only facts from the CV. Plain text, no markdown.`;
  const tone = voice.tone.length ? `${czech ? "Pravidla tónu" : "Tone rules"}:\n- ${voice.tone.join("\n- ")}` : "";
  const never = voice.neverSay.length ? `${czech ? "Nikdy nepoužij" : "Never use"}: ${voice.neverSay.join("; ")}` : "";
  const sampleBlock = samples.length
    ? `${czech ? "Takhle píše (ukázky jeho vlastních zpráv; drž jejich tón, neopisuj obsah)" : "This is how he writes (his own messages; keep the tone, do not copy the content)"}:\n${samples.map((s, i) => `--- ${i + 1}\n${s.text}`).join("\n")}\n---`
    : "";
  const { minWords, maxWords } = voice.limits;
  const closing = czech ? `Poslední řádek je jen "${first}". Před ním může být "Díky," nebo nic.` : `The last line is just "${first}". Before it, "Thanks," or nothing.`;
  const instructions = cv
    ? czech
      ? `Napiš ${minWords}–${maxWords} slov: "Dobrý den," na prvním řádku, pak nový odstavec začínající malým písmenem. Na jakou pozici se hlásí (vlastními slovy, bez citace názvu inzerátu), jedna až dvě konkrétní věci z jeho životopisu, které k tomu sedí, a jen pokud tam opravdu něco zajímavého je, jedna věta, co ho na té nabídce baví. Firmu pojmenuj ${company}. ${closing}`
      : `Write ${minWords}–${maxWords} words: "Hi," on the first line, then a new paragraph. Which role he is applying for (in his own words, no quoting the ad's title), one or two concrete things from his CV that fit, and only if something genuinely stands out, one sentence on what he likes about this posting. Call the company ${company}. ${closing}`
    : czech
      ? `Napiš ${Math.max(25, minWords - 15)}–${maxWords - 20} slov: "Dobrý den," na prvním řádku, pak nový odstavec začínající malým písmenem: na jakou pozici se hlásí (vlastními slovy) a jedna obyčejná věta, co ho na nabídce zaujalo. Podrobnosti k praxi jsou v životopise. Neuváděj žádné roky, technologie, projekty ani dovednosti jako jeho, protože jeho životopis nemáš. Firmu pojmenuj ${company}. ${closing}`
      : `Write ${Math.max(25, minWords - 15)}–${maxWords - 20} words: "Hi," on the first line, then a new paragraph: which role he is applying for (in his own words) and one plain sentence on what caught his eye. The CV has the details. Do not claim any years, technologies, projects or skills as his, because you do not have his CV. Call the company ${company}. ${closing}`;
  const user = [
    `${czech ? "Pozice" : "Job"}: ${title} — ${company}`,
    `${czech ? "Popis pozice (jen pro pochopení, neopisovat)" : "Job description (for understanding only, do not copy)"}: ${excerpt(job.description, 2500) || "-"}`,
    `${czech ? "Uchazeč" : "Applicant"}: ${profile.name}${profile.city ? `, ${profile.city}` : ""}`,
    `${czech ? "Životopis (výňatek)" : "CV (excerpt)"}: ${cv || (czech ? "není k dispozici" : "not available")}`,
    `${czech ? "Pole formuláře" : "Form field"}: ${describeField(field)}`,
    field.value ? `${czech ? "Pole nyní obsahuje tuto šablonu, kterou nahradíš" : "The field currently holds this template, which you replace"}: "${excerpt(field.value, 300)}"` : "",
    "",
    tone,
    never,
    "",
    sampleBlock,
    "",
    instructions,
  ]
    .filter(Boolean)
    .join("\n");
  return { system, user };
}

export async function draftFreeText(
  field: FieldDescriptor,
  profile: ApplyProfile,
  job: ApplyJob,
  onReject: (reason: string) => void = () => undefined,
): Promise<DraftResult | null> {
  if (!(await ollamaAvailable())) return null;
  const czech = detectCzech(field, job);
  const lang: VoiceLang = czech ? "cs" : "en";
  const voice = await loadVoice();
  const model = await ollamaPickModel(WRITER_MODEL_PREFERENCE);
  const cv = excerpt(profile.cvText, 3200);
  const title = plain(job.title);
  const company = shortCompanyName(job.company);
  const { system, user } = buildPrompt({ czech, voice, field, profile, job, cv, title, company });

  const allow = [profile.name, voice.signature, job.company, title, profile.city ?? ""];
  let forbidden: string[] = [];
  for (const temperature of [0.6, 0.4, 0.2]) {
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
      const problems = [...bannedPhrases(text, voice.neverSay), ...styleProblems(text), ...copiedPhrases(text, job.description, `${title} ${company}`)];
      if (cv) problems.push(...findUnsupportedClaims(text, profile.cvText ?? "", job.description, allow, job.skills));
      if (wordCount(text) > voice.limits.maxWords + 15) problems.push(`too long (${wordCount(text)} words)`);
      if (problems.length > 0) {
        onReject(`${model} t=${temperature}: ${problems.join(" | ")}`);
        forbidden = [...new Set([...forbidden, ...problems.filter((p) => !p.startsWith("too long") && !p.startsWith("skill list"))])];
        continue;
      }
      const polished = czech ? await proofreadCzech(text, model) : text;
      const shaped = enforceShape(polished, czech, voice.signature, profile.name);
      const verdict = await voiceGuard(shaped, lang, voice);
      if (!verdict.ok) {
        onReject(`${model} t=${temperature}: voice (similarity ${verdict.similarity} < ${verdict.threshold})`);
        continue;
      }
      return { text: shaped, model, lang };
    } catch (err) {
      onReject(`${model} t=${temperature}: ${errorMessage(err).split("\n")[0]}`);
      return null;
    }
  }
  if (cv) return draftFreeText(field, { ...profile, cvText: null }, job, onReject);
  return null;
}

const GREETING_LINE = /^(dobr[ýyéá] (den|r[áa]no|ve[čc]er|odpoledne)|ahoj|zdrav[íi]m( v[áa]s)?|v[áa][žz]en[ýíé].{0,40}|hello|hi|dear .{0,40}|good (morning|afternoon|evening))[,!.]?$/i;
const SIGNOFF_LINE = /^(s (pozdravem|úctou|přáním hezkého dne)|best regards|kind regards|regards|sincerely|yours sincerely)[,.]?$/i;

const FORMAL_SIGNOFF = /^(s (pozdravem|úctou|přáním (hezkého|pěkného) dne)|best regards|kind regards|warm regards|regards|sincerely|yours sincerely|yours faithfully)[,.]?$/i;

export function enforceShape(text: string, czech: boolean, signature: string, fullName = signature): string {
  const lines = text.split("\n").map((l) => l.trim());
  const names = [signature, fullName].map((n) => n.trim().toLowerCase()).filter(Boolean);
  const isNameLine = (line: string) => names.includes(line.replace(/[.,!]$/, "").trim().toLowerCase());
  for (let i = lines.length - 1; i >= Math.max(1, lines.length - 5); i -= 1) {
    if (isNameLine(lines[i])) {
      lines.splice(i + 1);
      break;
    }
  }
  const greeting = czech ? "Dobrý den," : "Hi,";
  if (lines.length && GREETING_LINE.test(lines[0])) lines[0] = greeting;
  else lines.unshift(greeting, "");
  const bodyIndex = lines.findIndex((l, i) => i > 0 && l.length > 0);
  if (bodyIndex > 0) {
    lines[bodyIndex] = lines[bodyIndex].replace(/^(\p{Lu}{2,}(?:\s+\p{Lu}{2,})*)/u, (shouting) => shouting.toLowerCase());
    if (czech) lines[bodyIndex] = lines[bodyIndex].charAt(0).toLowerCase() + lines[bodyIndex].slice(1);
  }
  const signatureLine = signature.trim();
  const lastLine = lines[lines.length - 1] ?? "";
  if (isNameLine(lastLine)) lines[lines.length - 1] = signatureLine;
  else {
    const inline = names.find((n) => lastLine.toLowerCase().includes(n));
    let signOffStays = false;
    if (inline) {
      lines[lines.length - 1] = lastLine.replace(new RegExp(`\\s*${inline.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.?$`, "i"), "").trim();
      if (SIGNOFF_LINE.test(lines[lines.length - 1])) {
        lines[lines.length - 1] = lines[lines.length - 1].replace(/[.]$/, ",");
        signOffStays = true;
      }
    }
    if (!signOffStays && lines[lines.length - 1] !== "") lines.push("");
    lines.push(signatureLine);
  }
  for (let i = 1; i < lines.length - 1; i += 1) {
    if (FORMAL_SIGNOFF.test(lines[i])) lines[i] = czech ? "Díky," : "Thanks,";
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
            "Jsi korektor češtiny. Oprav jen gramatiku, pravopis, pády, předložky a slovosled. Technické výrazy, které vývojáři běžně používají (frontend, backend, deploy, merge, React, TypeScript a podobně), nech být. Zachovej obsah, délku, uvolněný tón, oslovení, podpis a členění na řádky; nepřidávej zdvořilostní fráze ani nic jiného. Vrať pouze opravený text bez komentáře.",
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
