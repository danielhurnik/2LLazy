/**
 * The deterministic fill-plan mapper — the piece of auto-apply that decides
 * what goes into which form field. A wrong value here lands in somebody's real
 * job application, so the mapper must prefer skipping a field to guessing.
 */
import { describe, expect, it } from "vitest";
import { generateFillPlan, type ApplicantProfile } from "@/lib/apply/fillPlan";
import type { FieldSnapshot } from "@/lib/apply/snapshotFormFields";

const PROFILE: ApplicantProfile = {
  name: "Jana Nováková",
  email: "jana@example.com",
  phone: "+420 777 123 456",
  linkedInUrl: "https://linkedin.com/in/jananovakova",
  githubUrl: "https://github.com/jananovakova",
  coverLetterText: "Dear team, I would love to join.",
};

let nextIdx = 0;
function field(partial: Partial<FieldSnapshot>): FieldSnapshot {
  return {
    idx: nextIdx++,
    tag: "input",
    type: "text",
    id: "",
    name: "",
    placeholder: "",
    ariaLabel: "",
    labelText: "",
    currentValue: "",
    isRequired: false,
    ...partial,
  };
}

function valueFor(plan: ReturnType<typeof generateFillPlan>, idx: number): string | undefined {
  return plan?.fills.find((f) => f.idx === idx)?.value;
}

describe("generateFillPlan", () => {
  it("maps a typical application form, Czech labels included", () => {
    nextIdx = 0;
    const fields = [
      field({ labelText: "Jméno a příjmení" }),
      field({ type: "email", labelText: "E-mail" }),
      field({ type: "tel", labelText: "Telefon" }),
      field({ tag: "textarea", labelText: "Průvodní dopis" }),
      field({ type: "file", name: "cv" }),
      field({ tag: "button", type: "submit" }),
    ];

    const plan = generateFillPlan(fields, PROFILE);
    expect(plan).not.toBeNull();
    expect(valueFor(plan, 0)).toBe("Jana Nováková");
    expect(valueFor(plan, 1)).toBe("jana@example.com");
    expect(valueFor(plan, 2)).toBe("+420 777 123 456");
    expect(valueFor(plan, 3)).toBe("Dear team, I would love to join.");
    expect(plan!.fileUploadIdx).toBe(4);
    expect(plan!.submitIdx).toBe(5);
  });

  it("splits first and last name when the form asks for them separately", () => {
    nextIdx = 0;
    const fields = [
      field({ labelText: "First name" }),
      field({ labelText: "Last name" }),
      field({ tag: "button", type: "submit" }),
    ];

    const plan = generateFillPlan(fields, PROFILE);
    expect(valueFor(plan, 0)).toBe("Jana");
    expect(valueFor(plan, 1)).toBe("Nováková");
  });

  it("never touches checkboxes, prefilled fields, or fields it cannot place", () => {
    nextIdx = 0;
    const fields = [
      field({ type: "checkbox", labelText: "I agree to the terms" }),
      field({ labelText: "Expected salary" }),
      field({ type: "email", labelText: "E-mail", currentValue: "already@filled.com" }),
      field({ labelText: "Full name" }),
      field({ tag: "button", type: "submit" }),
    ];

    const plan = generateFillPlan(fields, PROFILE);
    expect(plan!.fills).toEqual([{ idx: 3, value: "Jana Nováková" }]);
  });

  it("returns null when there is no submit button or nothing to fill", () => {
    nextIdx = 0;
    expect(generateFillPlan([field({ type: "email", labelText: "E-mail" })], PROFILE)).toBeNull();

    nextIdx = 0;
    expect(
      generateFillPlan(
        [field({ labelText: "Expected salary" }), field({ tag: "button", type: "submit" })],
        PROFILE,
      ),
    ).toBeNull();
  });
});
