import { describe, it, expect } from "vitest";
import {
  AUTO_SUBMIT_CONFIDENCE,
  findCountryOption,
  planFill,
  resolveValue,
  scoreField,
  type FieldDescriptor,
} from "@/lib/apply/fieldMatcher";
import type { ApplyProfile } from "@/lib/apply/types";
import { normalizeText } from "@/lib/text";

const PROFILE: ApplyProfile = {
  name: "Jana Nováková",
  firstName: "Jana",
  lastName: "Nováková",
  email: "jana@example.com",
  phone: "+420601123456",
  linkedInUrl: "https://www.linkedin.com/in/jana",
  githubUrl: null,
  city: "Praha",
  country: "CZ",
  cv: { name: "cv.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") },
  cvText: null,
};

function field(overrides: Partial<FieldDescriptor>): FieldDescriptor {
  return {
    frameIndex: 0,
    selector: "input",
    tag: "input",
    type: "text",
    name: "",
    id: "",
    label: "",
    placeholder: "",
    ariaLabel: "",
    autocomplete: "",
    accept: "",
    required: false,
    visible: true,
    checked: false,
    value: "",
    options: [],
    ...overrides,
  };
}

const keyOf = (overrides: Partial<FieldDescriptor>) => scoreField(field(overrides))?.key ?? null;

describe("normalizeText", () => {
  it("strips diacritics, case and punctuation", () => {
    expect(normalizeText("Příjmení*:")).toBe("prijmeni");
    expect(normalizeText("Kontaktní e-mail")).toBe("kontaktni e mail");
  });
});

describe("scoreField — Czech labels", () => {
  it("maps the startupjobs quick form", () => {
    expect(keyOf({ type: "text", name: "name", label: "Jméno", placeholder: "Napište celé jméno" })).toBe("fullName");
    expect(keyOf({ type: "url", name: "linkedin", label: "LinkedIn", placeholder: "Sdílejte svůj odkaz na LinkedIn" })).toBe("linkedInUrl");
    expect(keyOf({ type: "email", name: "email", label: "Kontaktní e-mail" })).toBe("email");
    expect(keyOf({ type: "tel", label: "Telefon", placeholder: "Příklad: 601 123 456" })).toBe("phone");
  });

  it("splits first and last name", () => {
    expect(keyOf({ label: "Křestní jméno" })).toBe("firstName");
    expect(keyOf({ label: "Příjmení" })).toBe("lastName");
    expect(keyOf({ label: "Jméno a příjmení" })).toBe("fullName");
  });

  it("does not treat company or user names as the applicant name", () => {
    expect(keyOf({ label: "Název firmy", name: "company_name" })).toBeNull();
    expect(keyOf({ name: "username" })).toBeNull();
  });

  it("recognises CV upload and cover letter inputs", () => {
    expect(keyOf({ type: "file", label: "Životopis", accept: ".pdf,.doc" })).toBe("cv");
    expect(keyOf({ type: "file", name: "resume" })).toBe("cv");
    expect(keyOf({ type: "file", label: "Motivační dopis" })).toBe("coverLetter");
    expect(keyOf({ tag: "textarea", type: "textarea", label: "Motivační dopis" })).toBe("coverLetter");
  });

  it("recognises city and country", () => {
    expect(keyOf({ label: "Město" })).toBe("city");
    expect(keyOf({ tag: "select", type: "select", name: "country" })).toBe("country");
  });
});

describe("scoreField — English labels and autocomplete", () => {
  it("uses the autocomplete attribute as the strongest signal", () => {
    expect(scoreField(field({ autocomplete: "given-name", label: "Name" }))).toEqual({ key: "firstName", score: 1 });
    expect(keyOf({ autocomplete: "family-name" })).toBe("lastName");
    expect(keyOf({ autocomplete: "tel-national" })).toBe("phone");
  });

  it("maps common English labels", () => {
    expect(keyOf({ label: "Full name" })).toBe("fullName");
    expect(keyOf({ label: "Phone number" })).toBe("phone");
    expect(keyOf({ type: "url", label: "GitHub profile" })).toBe("githubUrl");
    expect(keyOf({ type: "url", label: "Portfolio / website" })).toBe("website");
    expect(keyOf({ tag: "textarea", type: "textarea", label: "Why do you want to work with us?" })).toBe("message");
    expect(keyOf({ tag: "textarea", type: "richtext", label: "Jak mohu vaši firmu posunout vpřed?" })).toBe("message");
    expect(keyOf({ tag: "textarea", type: "textarea", label: "Něco úplně neznámého" })).toBe("message");
  });

  it("ignores hidden, submit and password inputs", () => {
    expect(keyOf({ type: "hidden", name: "email" })).toBeNull();
    expect(keyOf({ type: "submit", name: "name" })).toBeNull();
    expect(keyOf({ type: "password", label: "Password" })).toBeNull();
  });
});

describe("scoreField — checkboxes", () => {
  it("separates GDPR consent from marketing opt-ins", () => {
    expect(keyOf({ type: "checkbox", label: "Souhlasím se zpracováním osobních údajů" })).toBe("consent");
    expect(keyOf({ type: "checkbox", label: "I agree to the privacy policy" })).toBe("consent");
    expect(keyOf({ type: "checkbox", label: "Souhlasím se zasíláním obchodních sdělení" })).toBe("marketing");
    expect(keyOf({ type: "checkbox", label: "Subscribe to the newsletter" })).toBe("marketing");
    expect(keyOf({ type: "checkbox", label: "Keep my CV for future job offers" })).toBe("marketing");
  });

  it("never maps a checkbox to a text field key", () => {
    expect(keyOf({ type: "checkbox", label: "Email" })).toBeNull();
  });

  it("treats talent-pool and future-position opt-ins as marketing even when worded as consent", () => {
    const teamio = "I give consent to Thermo Fisher Scientific Brno s.r.o. company to let me know when there is another suitable position for me.";
    expect(keyOf({ type: "checkbox", label: teamio })).toBe("marketing");
    expect(keyOf({ type: "checkbox", label: "Souhlasím s evidencí mých údajů pro další vhodné pozice" })).toBe("marketing");
  });

  it("ticks a vague agreement box only when it is required", () => {
    expect(keyOf({ type: "checkbox", label: "I agree" })).toBeNull();
    expect(keyOf({ type: "checkbox", label: "I agree", required: true })).toBe("consent");
    expect(keyOf({ type: "checkbox", label: "Souhlasím se zpracováním osobních údajů" })).toBe("consent");
  });
});

describe("planFill — name splitting", () => {
  it("puts only the first name into a bare 'Jméno' field when a surname field exists", () => {
    const form = [
      field({ selector: "#jmeno", label: "Jméno", placeholder: "Jméno", required: true }),
      field({ selector: "#prijmeni", label: "Příjmení", required: true }),
    ];
    const plan = planFill(form, PROFILE);
    expect(plan.fills.map((f) => [f.key, (f.value as { value: string }).value])).toEqual([
      ["firstName", "Jana"],
      ["lastName", "Nováková"],
    ]);
  });

  it("keeps the full name when the field explicitly asks for it", () => {
    const form = [field({ selector: "#full", label: "Jméno a příjmení" }), field({ selector: "#last", label: "Příjmení" })];
    expect(planFill(form, PROFILE).fills.map((f) => f.key)).toEqual(["fullName", "lastName"]);
  });

  it("leaves account-creation opt-ins unchecked and reads currency selects as salary", () => {
    expect(keyOf({ type: "checkbox", label: "Vytvořit profesní profil na Skilleto" })).toBe("marketing");
    expect(keyOf({ tag: "select", type: "select", options: [{ value: "czk", text: "Kč" }, { value: "eur", text: "EUR" }] })).toBe("salary");
  });
});

describe("planFill — file slots", () => {
  it("puts the CV into the CV slot only, not into generic attachment slots", () => {
    const form = [
      field({ selector: "#cv", type: "file", label: "CV", required: true }),
      field({ selector: "#att1", type: "file", label: "Attachment 1" }),
      field({ selector: "#att2", type: "file", label: "Attachment 2" }),
    ];
    const plan = planFill(form, PROFILE);
    expect(plan.fills.map((f) => f.field.selector)).toEqual(["#cv"]);
    expect(plan.unfillable.map((u) => u.field.selector).sort()).toEqual(["#att1", "#att2"]);
    expect(plan.requiredMissing).toEqual([]);
  });
});

describe("resolveValue", () => {
  it("fills profile values and the CV file", () => {
    expect(resolveValue("fullName", PROFILE, field({}))).toEqual({ kind: "text", value: "Jana Nováková" });
    expect(resolveValue("phone", PROFILE, field({ type: "tel" }))).toEqual({ kind: "text", value: "+420601123456" });
    expect(resolveValue("cv", PROFILE, field({ type: "file" }))).toEqual({ kind: "file", file: PROFILE.cv });
    expect(resolveValue("consent", PROFILE, field({ type: "checkbox" }))).toEqual({ kind: "check", value: true });
    expect(resolveValue("marketing", PROFILE, field({ type: "checkbox" }))).toEqual({ kind: "check", value: false });
  });

  it("returns null for data the profile does not have", () => {
    expect(resolveValue("githubUrl", PROFILE, field({}))).toBeNull();
    expect(resolveValue("salary", PROFILE, field({}))).toBeNull();
    expect(resolveValue("cv", { ...PROFILE, cv: null }, field({ type: "file" }))).toBeNull();
  });

  it("picks the country option of a select by Czech or English name", () => {
    const options = [
      { value: "", text: "Vyberte" },
      { value: "203", text: "Česká republika" },
      { value: "703", text: "Slovensko" },
    ];
    expect(findCountryOption(options, "CZ")?.value).toBe("203");
    expect(findCountryOption([{ value: "cz", text: "Czechia" }], "CZ")?.value).toBe("cz");
    expect(findCountryOption(options, "DE")).toBeNull();
    expect(resolveValue("country", PROFILE, field({ tag: "select", type: "select", options }))).toEqual({ kind: "select", value: "203" });
  });
});

describe("planFill", () => {
  const STARTUPJOBS_FORM: FieldDescriptor[] = [
    field({ selector: "#name", type: "text", name: "name", label: "Jméno", placeholder: "Napište celé jméno", required: true }),
    field({ selector: "#linkedin", type: "url", name: "linkedin", label: "LinkedIn" }),
    field({ selector: "#email", type: "email", name: "email", label: "Kontaktní e-mail", required: true }),
    field({ selector: "#tel", type: "tel", label: "Telefon", required: true }),
    field({ selector: "#hidden", type: "hidden", name: "offerId" }),
  ];

  it("fills every field of the startupjobs form with high confidence", () => {
    const plan = planFill(STARTUPJOBS_FORM, PROFILE);
    expect(plan.fills.map((f) => f.key)).toEqual(["fullName", "linkedInUrl", "email", "phone"]);
    expect(plan.requiredMissing).toEqual([]);
    expect(plan.unmatched).toEqual([]);
    expect(plan.confidence).toBeGreaterThanOrEqual(AUTO_SUBMIT_CONFIDENCE);
  });

  it("blocks auto-submit when a required field cannot be filled", () => {
    const form = [...STARTUPJOBS_FORM, field({ selector: "#salary", label: "Mzdové očekávání", required: true })];
    const plan = planFill(form, PROFILE);
    expect(plan.requiredMissing.map((f) => f.selector)).toEqual(["#salary"]);
    expect(plan.unfillable[0]?.key).toBe("salary");
    expect(plan.confidence).toBeLessThan(AUTO_SUBMIT_CONFIDENCE);
  });

  it("skips invisible fields and leaves marketing boxes unchecked", () => {
    const form = [
      ...STARTUPJOBS_FORM,
      field({ selector: "#ghost", type: "email", name: "email", visible: false }),
      field({ selector: "#gdpr", type: "checkbox", label: "Souhlasím se zpracováním osobních údajů", required: true }),
      field({ selector: "#news", type: "checkbox", label: "Chci dostávat newsletter" }),
    ];
    const plan = planFill(form, PROFILE);
    const bySelector = Object.fromEntries(plan.fills.map((f) => [f.field.selector, f.value]));
    expect(bySelector["#ghost"]).toBeUndefined();
    expect(bySelector["#gdpr"]).toEqual({ kind: "check", value: true });
    expect(bySelector["#news"]).toEqual({ kind: "check", value: false });
    expect(plan.requiredMissing).toEqual([]);
  });

  it("reports zero confidence when nothing matches", () => {
    const plan = planFill([field({ label: "Oblíbená barva" })], PROFILE);
    expect(plan.fills).toEqual([]);
    expect(plan.unmatched).toHaveLength(1);
    expect(plan.confidence).toBe(0);
  });
});
