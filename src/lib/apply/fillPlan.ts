/**
 * Deterministic fill-plan generation.
 *
 * Replaces the old "send the form snapshot to GPT" call: application forms ask
 * for the same handful of things in predictable words, so mapping fields by
 * their label, placeholder, name and type is both testable and free. English
 * and Czech vocabularies are covered because that is where the supported
 * boards live; a field the mapper cannot place is skipped rather than guessed
 * — a wrong value in someone's job application is far worse than a blank one.
 */
import type { FieldSnapshot } from "./snapshotFormFields";

export interface FillPlan {
  /** Field fills to perform, in order. */
  fills: Array<{ idx: number; value: string }>;
  /** The file-upload input for the CV, when one is present. */
  fileUploadIdx?: number;
  /** The submit / next button to click last. */
  submitIdx: number;
}

/** User profile shape passed in from the route. */
export interface ApplicantProfile {
  name: string;
  email: string;
  phone?: string | null;
  linkedInUrl?: string | null;
  githubUrl?: string | null;
  coverLetterText?: string | null;
}

/** Lowercased, diacritics stripped, so "Jméno" matches "jmeno". */
function fold(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

/** Everything a field says about itself, folded into one searchable string. */
function describe(field: FieldSnapshot): string {
  return fold([field.labelText, field.placeholder, field.ariaLabel, field.name, field.id].join(" "));
}

interface Rule {
  /** Matches the field's self-description. */
  pattern: RegExp;
  /** Matches the field's `type` attribute, when the type alone is the signal. */
  type?: RegExp;
  value: (profile: ApplicantProfile) => string | null | undefined;
  /** Restrict to a tag, e.g. cover letters only ever go into a textarea. */
  tag?: FieldSnapshot["tag"];
}

/**
 * Ordered by specificity: the first rule that matches a field claims it. The
 * generic "name" rule comes last so "company name" or "first name" have had
 * their chance to match something more precise first.
 */
const RULES: Rule[] = [
  { pattern: /e-?mail/, type: /^email$/, value: (p) => p.email },
  { pattern: /phone|telefon|mobil/, type: /^tel$/, value: (p) => p.phone },
  { pattern: /linked ?in/, value: (p) => p.linkedInUrl },
  { pattern: /git ?hub/, value: (p) => p.githubUrl },
  {
    pattern: /cover|motivat|message|zprava|pruvodni|dopis|why|note/,
    tag: "textarea",
    value: (p) => p.coverLetterText,
  },
  // "Jméno a příjmení" asks for the whole name and must win over the
  // last-name rule that "příjmení" alone would trigger.
  { pattern: /full ?name|jmeno a prijmeni/, value: (p) => p.name },
  { pattern: /first ?name|krestni/, value: (p) => p.name.split(/\s+/)[0] },
  { pattern: /last ?name|surname|prijmeni/, value: (p) => p.name.split(/\s+/).slice(1).join(" ") },
  { pattern: /your ?name|jmeno|(^|[^a-z])name([^a-z]|$)/, value: (p) => p.name },
];

/** True when a file input plausibly wants the CV rather than something else. */
function wantsCv(description: string): boolean {
  return /cv|resume|zivotopis|attachment|priloha|file|soubor/.test(description) || description.trim() === "";
}

/**
 * Maps the snapshotted fields to profile values.
 *
 * Returns `null` when the form has no clickable submit button or nothing the
 * mapper could confidently fill — both mean a human has to take over, and the
 * caller reports MANUAL_REQUIRED rather than submitting an empty form.
 */
export function generateFillPlan(
  fields: FieldSnapshot[],
  profile: ApplicantProfile,
): FillPlan | null {
  if (fields.length === 0) return null;

  const fills: FillPlan["fills"] = [];
  let fileUploadIdx: number | undefined;

  for (const field of fields) {
    if (field.tag === "button") continue;
    const description = describe(field);

    if (field.type === "file") {
      if (fileUploadIdx === undefined && wantsCv(description)) fileUploadIdx = field.idx;
      continue;
    }
    // Checkboxes are consents and preferences — never ours to decide.
    if (field.type === "checkbox" || field.type === "radio") continue;
    if (field.currentValue.trim() !== "") continue;

    for (const rule of RULES) {
      if (rule.tag && field.tag !== rule.tag) continue;
      const matched =
        (rule.type && rule.type.test(field.type)) || rule.pattern.test(description);
      if (!matched) continue;
      const value = rule.value(profile);
      if (value?.trim()) fills.push({ idx: field.idx, value: value.trim() });
      break;
    }
  }

  // The last visible submit button is the "send" on multi-section forms where
  // earlier buttons belong to widgets.
  const submit = [...fields].reverse().find((f) => f.tag === "button");
  if (!submit) return null;
  if (fills.length === 0 && fileUploadIdx === undefined) return null;

  return { fills, fileUploadIdx, submitIdx: submit.idx };
}
