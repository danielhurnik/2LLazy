import { describe, it, expect } from "vitest";
import { describeScan, findButton, type ButtonDescriptor, type PageScan } from "@/lib/apply/fieldScanner";
import type { FieldDescriptor } from "@/lib/apply/fieldMatcher";

const SCAN_URL = "https://example.test/job/42";
const SEND_PATTERN = /^odeslat/i;

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

function scan(parts: { fields?: FieldDescriptor[]; buttons?: ButtonDescriptor[]; signals?: Partial<PageScan["signals"]> }): PageScan {
  return {
    frames: [],
    fields: parts.fields ?? [],
    buttons: parts.buttons ?? [],
    signals: { url: SCAN_URL, title: "", captcha: null, loginWall: false, stepHints: [], bodyText: "", errors: [], ...parts.signals },
  };
}

describe("findButton", () => {
  it("prefers a submit button among the matches", () => {
    const plain = button({ selector: "#plain", text: "Odeslat", kind: "button" });
    const submit = button({ selector: "#submit", text: "Odeslat zájem", kind: "submit" });
    expect(findButton(scan({ buttons: [plain, submit] }), SEND_PATTERN)).toBe(submit);
  });

  it("falls back to the first match when none is a submit", () => {
    const first = button({ selector: "#first", text: "Odeslat" });
    const second = button({ selector: "#second", text: "Odeslat CV", kind: "link" });
    expect(findButton(scan({ buttons: [first, second] }), SEND_PATTERN)).toBe(first);
  });

  it("ignores invisible buttons", () => {
    const hiddenSubmit = button({ selector: "#hidden", text: "Odeslat", kind: "submit", visible: false });
    const shown = button({ selector: "#shown", text: "Odeslat", kind: "button" });
    expect(findButton(scan({ buttons: [hiddenSubmit, shown] }), SEND_PATTERN)).toBe(shown);
    expect(findButton(scan({ buttons: [hiddenSubmit] }), SEND_PATTERN)).toBeNull();
  });

  it("respects the kinds filter", () => {
    const link = button({ selector: "a.send", text: "Odeslat", kind: "link", href: "https://example.test/send" });
    const plain = button({ selector: "#plain", text: "Odeslat", kind: "button" });
    expect(findButton(scan({ buttons: [link] }), SEND_PATTERN, { kinds: ["submit", "button"] })).toBeNull();
    expect(findButton(scan({ buttons: [link, plain] }), SEND_PATTERN, { kinds: ["link"] })).toBe(link);
  });

  it("returns null when no text matches", () => {
    expect(findButton(scan({ buttons: [button({ text: "Zpět" })] }), SEND_PATTERN)).toBeNull();
  });
});

describe("describeScan", () => {
  const EMAIL = field({ selector: "#email", type: "email", label: "E-mail", required: true });
  const MESSAGE = field({ selector: "#message", tag: "textarea", type: "textarea", placeholder: "Vaše zpráva" });
  const HIDDEN_TOKEN = field({ selector: "#token", type: "hidden", name: "csrf", visible: false });
  const SUBMIT = button({ selector: "#submit", text: "Odeslat", kind: "submit" });
  const HIDDEN_LINK = button({ selector: "a.hidden", text: "Skryté", kind: "link", visible: false });

  it("reports totals next to the visible counts", () => {
    const text = describeScan(scan({ fields: [EMAIL, MESSAGE, HIDDEN_TOKEN], buttons: [SUBMIT, HIDDEN_LINK] }));
    expect(text).toContain(`scan ${SCAN_URL} frames=0`);
    expect(text).toContain("fields=3/2 visible");
    expect(text).toContain("buttons=2/1 visible");
    expect(text).toContain("captcha=no login=false");
  });

  it("samples only visible fields and buttons", () => {
    const text = describeScan(scan({ fields: [EMAIL, MESSAGE, HIDDEN_TOKEN], buttons: [SUBMIT, HIDDEN_LINK] }));
    expect(text).toContain('fields: email*:"E-mail", textarea:"Vaše zpráva" |');
    expect(text).toContain('buttons: "Odeslat"[submit]');
    expect(text).not.toContain("csrf");
    expect(text).not.toContain("Skryté");
  });

  it("names a field by aria label or name when it has no label or placeholder", () => {
    const byAria = field({ selector: "#phone", type: "tel", ariaLabel: "Telefon" });
    const byName = field({ selector: "#city", name: "city" });
    expect(describeScan(scan({ fields: [byAria, byName] }))).toContain('fields: tel:"Telefon", text:"city" |');
  });

  it("renders the captcha, login wall and frame errors", () => {
    const errors = ["frame 1 https://ads.example.test: Execution context was destroyed"];
    const text = describeScan(scan({ signals: { captcha: "g-recaptcha", loginWall: true, errors } }));
    expect(text).toContain("captcha=g-recaptcha login=true");
    expect(text).toContain(` errors=${JSON.stringify(errors)}`);
  });

  it("omits the errors part when there are none", () => {
    expect(describeScan(scan({}))).not.toContain("errors=");
  });
});
