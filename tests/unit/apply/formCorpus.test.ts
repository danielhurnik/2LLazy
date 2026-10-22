import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { planFill, type FieldDescriptor, type ProfileKey } from "@/lib/apply/fieldMatcher";
import type { ApplyProfile } from "@/lib/apply/types";

type Expectation = ProfileKey | "skip";

interface FixtureField extends Partial<Omit<FieldDescriptor, "options">> {
  tag: FieldDescriptor["tag"];
  label: string;
  expected: Expectation;
  options?: Array<{ value: string; text: string }>;
  knownMismatch?: string;
}

interface FormFixture {
  board: string;
  page: string;
  capturedFrom: string;
  fields: FixtureField[];
}

interface Mismatch {
  board: string;
  label: string;
  expected: Expectation;
  actual: Expectation;
  known: boolean;
}

const FORMS_DIR = fileURLToPath(new URL("./forms/", import.meta.url));

const PROFILE: ApplyProfile = {
  name: "Jana Nováková",
  firstName: "Jana",
  lastName: "Nováková",
  email: "jana@example.com",
  phone: "+420601123456",
  linkedInUrl: "https://www.linkedin.com/in/jana",
  githubUrl: "https://github.com/jana",
  city: "Praha",
  country: "CZ",
  cv: { name: "cv.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") },
  cvText: null,
};

function loadFixtures(): FormFixture[] {
  return readdirSync(FORMS_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(readFileSync(`${FORMS_DIR}${name}`, "utf8")) as FormFixture);
}

function toDescriptor(field: FixtureField, index: number): FieldDescriptor {
  const { expected: _expected, knownMismatch: _knownMismatch, ...rest } = field;
  return {
    frameIndex: 0,
    selector: `#fixture-${index}`,
    type: field.tag === "input" ? "text" : field.tag,
    name: "",
    id: "",
    placeholder: "",
    ariaLabel: "",
    autocomplete: "",
    accept: "",
    required: false,
    visible: true,
    checked: false,
    value: "",
    ...rest,
    options: field.options ?? [],
  };
}

function actualKeys(fixture: FormFixture): Map<FieldDescriptor, Expectation> {
  const descriptors = fixture.fields.map(toDescriptor);
  const plan = planFill(descriptors, PROFILE);
  const actual = new Map<FieldDescriptor, Expectation>(descriptors.map((descriptor) => [descriptor, "skip"]));
  for (const fill of plan.fills) actual.set(fill.field, fill.key);
  for (const entry of plan.unfillable) actual.set(entry.field, entry.key);
  return actual;
}

function mismatchesOf(fixture: FormFixture): Mismatch[] {
  const actual = actualKeys(fixture);
  const descriptors = [...actual.keys()];
  return fixture.fields.flatMap((field, index) => {
    const got = actual.get(descriptors[index]) ?? "skip";
    if (got === field.expected) return [];
    return [{ board: fixture.board, label: field.label, expected: field.expected, actual: got, known: Boolean(field.knownMismatch) }];
  });
}

function rankedReport(mismatches: Mismatch[]): string {
  const groups = new Map<string, Mismatch[]>();
  for (const mismatch of mismatches) {
    const key = `${mismatch.expected} -> ${mismatch.actual}`;
    groups.set(key, [...(groups.get(key) ?? []), mismatch]);
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([key, items]) => `${items.length}× ${key}: ${items.map((item) => `${item.board} "${item.label}"`).join("; ")}`)
    .join("\n");
}

describe("form corpus", () => {
  const fixtures = loadFixtures();
  const mismatches = fixtures.flatMap(mismatchesOf);

  it("has fixtures", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it("maps every field the way the fixture expects, except the known mismatches", () => {
    const unexpected = mismatches.filter((mismatch) => !mismatch.known);
    if (mismatches.length > 0) console.log(`form corpus mismatches (known included):\n${rankedReport(mismatches)}`);
    expect(unexpected, rankedReport(unexpected)).toEqual([]);
  });

  it("keeps knownMismatch flags only on fields that still mismatch", () => {
    const stillFailing = new Set(mismatches.filter((mismatch) => mismatch.known).map((mismatch) => `${mismatch.board}|${mismatch.label}`));
    const stale = fixtures.flatMap((fixture) =>
      fixture.fields.filter((field) => field.knownMismatch && !stillFailing.has(`${fixture.board}|${field.label}`)).map((field) => `${fixture.board} "${field.label}"`),
    );
    expect(stale, "these fields now match; drop their knownMismatch").toEqual([]);
  });
});
