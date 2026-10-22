import { describe, it, expect } from "vitest";
import { NEXT_BUTTON, SUBMIT_BUTTON, VALIDATION_TEXT, findApplyEntry, isConfirmed } from "@/lib/apply/pageActions";
import type { ButtonDescriptor, PageScan } from "@/lib/apply/fieldScanner";
import type { FieldDescriptor } from "@/lib/apply/fieldMatcher";

const JOB_URL = "https://example.test/job/42";
const EMAIL_SELECTOR = "#email";
const FILLED = new Set([`0:${EMAIL_SELECTOR}`]);
const THANKS_CZ = "Děkujeme za vaši reakci";
const THANKS_EN = "Thank you for applying";
const REQUIRED_CZ = "Toto pole je povinné";

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

function button(overrides: Partial<ButtonDescriptor>): ButtonDescriptor {
  return {
    frameIndex: 0,
    selector: "button",
    text: "",
    kind: "button",
    href: "",
    visible: true,
    ...overrides,
  };
}

function scan(parts: { fields?: FieldDescriptor[]; buttons?: ButtonDescriptor[]; url?: string; bodyText?: string }): PageScan {
  return {
    frames: [],
    fields: parts.fields ?? [],
    buttons: parts.buttons ?? [],
    signals: {
      url: parts.url ?? JOB_URL,
      title: "",
      captcha: null,
      loginWall: false,
      stepHints: [],
      bodyText: parts.bodyText ?? "",
      errors: [],
    },
  };
}

const EMAIL_FIELD = field({ selector: EMAIL_SELECTOR, type: "email", label: "E-mail", value: "jana@example.com" });
const BEFORE = scan({ fields: [EMAIL_FIELD] });

const entryFor = (text: string) => findApplyEntry(scan({ buttons: [button({ text })] }));

describe("button and page text patterns", () => {
  it("recognises submit buttons", () => {
    for (const text of ["Odeslat zájem", "Send", "Odeslat"]) expect(SUBMIT_BUTTON.test(text), text).toBe(true);
  });

  it("recognises next-step buttons", () => {
    expect(NEXT_BUTTON.test("Pokračovat")).toBe(true);
    expect(NEXT_BUTTON.test("Odeslat")).toBe(false);
  });

  it("recognises a required-field warning", () => {
    expect(VALIDATION_TEXT.test(REQUIRED_CZ)).toBe(true);
    expect(VALIDATION_TEXT.test(THANKS_CZ)).toBe(false);
  });
});

describe("findApplyEntry", () => {
  it("finds the apply buttons met on the boards", async () => {
    for (const text of ["Mám zájem o nabídku", "MÁM ZÁJEM O TUTO POZICI", "Reply", "Požádat o tuto práci", "Odeslat zájem"]) {
      expect((await entryFor(text))?.text, text).toBe(text);
    }
  });

  it("does not take a plain send or a sign-in button for an apply entry", async () => {
    expect(await entryFor("Odeslat")).toBeNull();
    expect(await entryFor("Přihlásit")).toBeNull();
  });

  it("prefers a direct button over an apply link", async () => {
    const link = button({ selector: "a.apply", text: "Mám zájem", kind: "link", href: "https://example.test/job/42/apply" });
    const direct = button({ selector: "#reagovat", text: "Reagovat", kind: "button" });
    expect(await findApplyEntry(scan({ buttons: [link, direct] }))).toBe(direct);
  });

  it("ignores an invisible direct button", async () => {
    const hidden = button({ selector: "#reagovat", text: "Reagovat", kind: "submit", visible: false });
    const link = button({ selector: "a.apply", text: "Reagovat", kind: "link", href: "https://example.test/job/42/apply" });
    expect(await findApplyEntry(scan({ buttons: [hidden, link] }))).toBe(link);
  });

  it("picks the link whose href looks like an apply link", async () => {
    const profile = button({ selector: "a.company", text: "Mám zájem", kind: "link", href: "https://example.test/company/about" });
    const anchor = button({ selector: "a.form", text: "Mám zájem", kind: "link", href: "https://example.test/job/42#reagovat" });
    expect(await findApplyEntry(scan({ buttons: [profile, anchor] }))).toBe(anchor);
  });

  it("falls back to the first matching link", async () => {
    const first = button({ selector: "a.first", text: "Reply", kind: "link", href: "https://example.test/company/about" });
    const second = button({ selector: "a.second", text: "Reply", kind: "link", href: "https://example.test/company/team" });
    expect(await findApplyEntry(scan({ buttons: [first, second] }))).toBe(first);
  });

  it("returns null when nothing looks like an apply entry", async () => {
    expect(await findApplyEntry(scan({ buttons: [button({ text: "Zpět" })] }))).toBeNull();
  });
});

describe("isConfirmed", () => {
  it("accepts confirmation text even with the form still on screen", () => {
    expect(isConfirmed(BEFORE, scan({ fields: [EMAIL_FIELD], bodyText: THANKS_CZ }), FILLED)).toBe(true);
    expect(isConfirmed(BEFORE, scan({ fields: [EMAIL_FIELD], bodyText: THANKS_EN }), FILLED)).toBe(true);
  });

  it("accepts a move to a thank-you URL", () => {
    expect(isConfirmed(BEFORE, scan({ fields: [EMAIL_FIELD], url: `${JOB_URL}/thank-you` }), FILLED)).toBe(true);
  });

  it("does not count a thank-you URL that was already there before the submit", () => {
    const thanksUrl = `${JOB_URL}/thank-you`;
    expect(isConfirmed(scan({ url: thanksUrl }), scan({ fields: [EMAIL_FIELD], url: thanksUrl }), FILLED)).toBe(false);
  });

  it("accepts filled fields vanishing without a validation message", () => {
    expect(isConfirmed(BEFORE, scan({}), FILLED)).toBe(true);
    expect(isConfirmed(BEFORE, scan({ fields: [{ ...EMAIL_FIELD, visible: false }] }), FILLED)).toBe(true);
  });

  it("rejects a validation message with the fields still visible", () => {
    expect(isConfirmed(BEFORE, scan({ fields: [EMAIL_FIELD], bodyText: REQUIRED_CZ }), FILLED)).toBe(false);
  });

  it("rejects vanished fields when a validation message is shown", () => {
    expect(isConfirmed(BEFORE, scan({ bodyText: REQUIRED_CZ }), FILLED)).toBe(false);
  });

  it("rejects an unchanged page when nothing was filled", () => {
    expect(isConfirmed(BEFORE, scan({}), new Set())).toBe(false);
  });
});
