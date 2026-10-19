import { z } from "zod";
import { ollamaAvailable, ollamaChat, ollamaChatJson } from "@/lib/ollama";
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

export async function mapFieldsWithOllama(fields: FieldDescriptor[], profile: ApplyProfile): Promise<OllamaMapResult> {
  if (fields.length === 0 || !(await ollamaAvailable())) {
    return { mapped: [], stillUnmatched: fields, used: false };
  }
  const prompt = [
    "You map job application form fields to keys of an applicant profile.",
    "Keys: fullName, firstName, lastName, email, phone, linkedInUrl, githubUrl, website, city, country, cv (file upload of the CV), coverLetter, message (free text about the applicant), salary, startDate, consent (required privacy/GDPR checkbox), marketing (newsletter or talent-pool opt-in), none.",
    "Labels may be Czech or English. Use none when unsure. Return one mapping per field index.",
    "",
    "Fields:",
    ...fields.map(fieldSummary),
  ].join("\n");

  let parsed: z.infer<typeof MappingSchema>;
  try {
    parsed = await ollamaChatJson([{ role: "user", content: prompt }], MappingSchema, { signal: AbortSignal.timeout(60_000) });
  } catch {
    return { mapped: [], stillUnmatched: fields, used: true };
  }

  const mapped: OllamaMapping[] = [];
  const taken = new Set<number>();
  for (const m of parsed.mappings) {
    const field = fields[m.index];
    if (!field || taken.has(m.index) || m.key === "none" || m.confidence < MIN_LLM_CONFIDENCE) continue;
    const value = resolveValue(m.key, profile, field);
    if (!value) continue;
    taken.add(m.index);
    mapped.push({ field, key: m.key, score: Math.min(LLM_SCORE_CAP, m.confidence), value });
  }
  return { mapped, stillUnmatched: fields.filter((_, i) => !taken.has(i)), used: true };
}

export async function draftFreeText(field: FieldDescriptor, profile: ApplyProfile, job: ApplyJob): Promise<string | null> {
  if (!(await ollamaAvailable())) return null;
  const prompt = [
    `Write a short answer (max 90 words, plain text, no greeting, no placeholders) for this field of a job application form.`,
    `Field: ${describeField(field)}`,
    `Job: ${job.title} at ${job.company}`,
    `Applicant: ${profile.name}${profile.city ? `, ${profile.city}` : ""}.`,
    `Write in the same language as the field label. Be concrete and polite. Do not invent experience or facts.`,
  ].join("\n");
  try {
    const text = await ollamaChat([{ role: "user", content: prompt }], { signal: AbortSignal.timeout(90_000), temperature: 0.3 });
    const trimmed = text.trim();
    return trimmed.length > 10 ? trimmed : null;
  } catch {
    return null;
  }
}
