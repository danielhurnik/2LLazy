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
    parsed = await ollamaChatJson([{ role: "user", content: prompt }], MappingSchema, { signal: AbortSignal.timeout(60_000) });
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

const WRITER_MODEL_PREFERENCE = [process.env.OLLAMA_WRITER_MODEL ?? "", "gemma3:12b", "gemma3:4b", "gemma2:9b", "qwen2.5:7b", "mistral-nemo", "llama3.1"].filter(Boolean);
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

export async function draftFreeText(field: FieldDescriptor, profile: ApplyProfile, job: ApplyJob): Promise<DraftResult | null> {
  if (!(await ollamaAvailable())) return null;
  const czech = detectCzech(field, job);
  const model = await ollamaPickModel(WRITER_MODEL_PREFERENCE);
  const cv = excerpt(profile.cvText, 3200);
  const title = plain(job.title);
  const system = czech
    ? "Jsi uchazeč o práci a píšeš krátký průvodní text do formuláře pracovní nabídky. Piš přirozenou, gramaticky správnou češtinou v první osobě. Používej pouze fakta z životopisu a profilu; nic si nevymýšlej. Výstup je čistý text bez markdownu, bez nadpisů, bez odrážek, bez zástupných symbolů v závorkách."
    : "You are a job applicant writing a short message into a job application form. Write natural, correct English in the first person. Use only facts from the CV and profile; never invent anything. Output plain text only: no markdown, no headings, no bullet points, no bracketed placeholders.";
  const instructions = cv
    ? czech
      ? `Napiš text o 90–140 slovech: pozdrav "Dobrý den," na prvním řádku, dvě až tři konkrétní věty, které propojují mou zkušenost ze životopisu s požadavky této pozice, jedna věta, proč mě zajímá právě ${job.company}, zdvořilé zakončení a na posledním řádku mé jméno: ${profile.name}. Uváděj pouze zkušenosti, dovednosti a roky praxe, které jsou výslovně v životopise; co v životopise není, nezmiňuj. Žádné zástupné symboly, žádné hranaté závorky, žádný předmět e-mailu, žádné anglicismy tam, kde existuje běžné české slovo.`
      : `Write 90–140 words: the greeting "Hello," on the first line, two or three concrete sentences linking my experience from the CV to this job's requirements, one sentence on why ${job.company} interests me, a polite closing, and my name on the last line: ${profile.name}. Mention only experience, skills and years that appear verbatim in the CV; leave out anything the CV does not state. No placeholders, no brackets, no subject line.`
    : czech
      ? `Napiš text o 60–90 slovech: pozdrav "Dobrý den," na prvním řádku, věta, že se hlásím na pozici ${title}, jedna až dvě věty, proč mě tato pozice a ${job.company} zajímají (vycházej jen z popisu pozice), věta ve smyslu "podrobnosti o mé praxi najdete v přiloženém životopise", zdvořilé zakončení a na posledním řádku mé jméno: ${profile.name}. Neuváděj žádné roky praxe, technologie, projekty ani dovednosti jako své vlastní, protože můj životopis nemáš k dispozici. Žádné zástupné symboly ani hranaté závorky.`
      : `Write 60–90 words: the greeting "Hello," on the first line, a sentence that I am applying for ${title}, one or two sentences on why this role and ${job.company} interest me (based only on the job description), a sentence that my attached CV has the details of my experience, a polite closing, and my name on the last line: ${profile.name}. Do not claim any years of experience, technologies, projects or skills as mine, because my CV is not available to you. No placeholders or brackets.`;
  const user = [
    `${czech ? "Pozice" : "Job"}: ${title} — ${job.company}`,
    `${czech ? "Popis pozice (výňatek)" : "Job description (excerpt)"}: ${excerpt(job.description, 2500) || "-"}`,
    `${czech ? "Uchazeč" : "Applicant"}: ${profile.name}${profile.city ? `, ${profile.city}` : ""}`,
    `${czech ? "Životopis (výňatek)" : "CV (excerpt)"}: ${cv || (czech ? "není k dispozici, vycházej jen z názvu pozice a profilu" : "not available; rely on the job title and profile only")}`,
    `${czech ? "Pole formuláře" : "Form field"}: ${describeField(field)}`,
    field.value ? `${czech ? "Pole nyní obsahuje tuto obecnou šablonu, kterou nahradíš" : "The field currently holds this generic template, which you replace"}: "${excerpt(field.value, 300)}"` : "",
    "",
    instructions,
  ]
    .filter(Boolean)
    .join("\n");

  for (const temperature of [0.4, 0.15]) {
    try {
      const raw = await ollamaChat(
        [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        { model, temperature, numCtx: 8192, keepAlive: "10m", signal: AbortSignal.timeout(120_000) },
      );
      const text = cleanDraft(raw);
      if (draftIsUsable(text)) {
        const polished = czech ? await proofreadCzech(text, model) : text;
        return { text: enforceShape(polished, czech, profile.name), model };
      }
    } catch {
      return null;
    }
  }
  return null;
}

const GREETING_LINE = /^(dobr[ýy] (den|r[áa]no|ve[čc]er)|ahoj|zdrav[íi]m( v[áa]s)?|v[áa][žz]en[ýíé].{0,40}|hello|hi|dear .{0,40}|good (morning|afternoon|evening))[,!.]?$/i;
const SIGNOFF_LINE = /^(s (pozdravem|úctou|přáním hezkého dne)|best regards|kind regards|regards|sincerely|yours sincerely)[,.]?$/i;

function enforceShape(text: string, czech: boolean, name: string): string {
  const lines = text.split("\n").map((l) => l.trim());
  const greeting = czech ? "Dobrý den," : "Hello,";
  if (lines.length && GREETING_LINE.test(lines[0])) lines[0] = greeting;
  else lines.unshift(greeting, "");
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
            "Jsi korektor češtiny. Oprav gramatiku, pravopis, pády, předložky a slovosled, nahraď anglicismy běžnými českými výrazy. Zachovej obsah, délku, oslovení, podpis a členění na řádky. Nic nepřidávej ani neodstraňuj. Vrať pouze opravený text bez komentáře.",
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
